import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { saveAs } from 'file-saver'
import JSZip from 'jszip'

import { PreviewFrameCapture } from './PreviewFrameCapture.ts'
import { PreviewClipEncoder } from './PreviewClipEncoder.ts'

import { Generators } from '../lib/Generators.ts'
import { ThemeManager } from '../lib/ThemeManager.ts'
import { AnimationUtility } from '../lib/processes/animations-listing/AnimationUtility.ts'
import { DOMUtilities } from '../lib/DOMUtilities.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { RigConfig, type RigAnimation } from '../lib/RigConfig.ts'

type ThemeName = 'light' | 'dark'

interface ThemeEnvironment {
  theme: ThemeName
  container: THREE.Group
  floor_color: number
}

interface PreviewClip {
  clip: THREE.AnimationClip
  loop: boolean
}

/**
 * Generates the small looping MP4 previews shown in the animation listing.
 *
 * Animations are not recorded in real time. Each frame is posed with mixer.setTime(),
 * rendered off-screen, and handed to a WebCodecs encoder with an exact timestamp. Every
 * preview gets exactly the frames of its clip at a constant frame rate, both themes are
 * rendered from the same pose, and generation runs as fast as the GPU allows.
 */
class PreviewGenerator {
  private readonly renderer_: THREE.WebGLRenderer
  private readonly scene_: THREE.Scene
  private readonly camera_: THREE.PerspectiveCamera
  private readonly controls_: OrbitControls
  private mixer_: THREE.AnimationMixer | null = null
  private readonly clock_: THREE.Clock
  public readonly theme_manager: ThemeManager

  private readonly theme_environments: ThemeEnvironment[]

  private skinned_mesh: THREE.SkinnedMesh | null = null
  private preview_clips: PreviewClip[] = []
  private is_recording: boolean = false

  // size of the preview videos. The app's CSS expects this size
  private readonly preview_width: number = 100
  private readonly preview_height: number = 120
  private readonly preview_fps: number = 24 // the library animations are authored at 24 fps
  private readonly preview_bitrate: number = 250_000

  private readonly status_element: HTMLElement | null = document.getElementById('record-status')

  constructor () {
    this.renderer_ = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer_.shadowMap.enabled = true
    this.renderer_.toneMapping = THREE.ACESFilmicToneMapping // a bit softer of a look
    this.renderer_.toneMappingExposure = 2.0 // tweak this value for brightness
    document.body.appendChild(this.renderer_.domElement)

    this.theme_manager = new ThemeManager()
    this.scene_ = new THREE.Scene()
    this.camera_ = Generators.create_camera()

    // both theme environments live in the scene. Only one is visible at a time
    this.theme_environments = [this.create_theme_environment('dark'), this.create_theme_environment('light')]
    this.theme_environments.forEach((environment) => this.scene_.add(environment.container))
    this.show_theme_environment(this.theme_manager.get_current_theme())

    // the on-screen canvas is a larger version of the preview, with the same aspect ratio, to make positioning easier
    const display_multiplier: number = 4
    this.renderer_.setSize(this.preview_width * display_multiplier, this.preview_height * display_multiplier)
    this.camera_.aspect = this.preview_width / this.preview_height
    this.camera_.updateProjectionMatrix()

    this.controls_ = new OrbitControls(this.camera_, this.renderer_.domElement)
    this.controls_.target.set(0, 0.4, 0)
    this.controls_.minDistance = 1
    this.controls_.maxDistance = 100
    this.controls_.update()

    this.clock_ = new THREE.Clock()
  }

  private create_theme_environment (theme: ThemeName): ThemeEnvironment {
    let grid_color = 0x4b6368
    let floor_color = 0x2d4353
    let light_strength: number = 10
    if (theme === 'light') {
      grid_color = 0xcccccc
      floor_color = 0xecf0f1
      light_strength = 14
    }

    const container = new THREE.Group()
    container.name = `Setup objects (${theme})`
    container.add(...Generators.create_default_lights(light_strength))
    container.add(...Generators.create_grid_helper(grid_color, floor_color))
    return { theme, container, floor_color }
  }

  private show_theme_environment (theme: ThemeName): ThemeEnvironment {
    let shown: ThemeEnvironment | undefined
    this.theme_environments.forEach((environment) => {
      environment.container.visible = environment.theme === theme
      if (environment.container.visible) {
        shown = environment
      }
    })
    if (shown === undefined) {
      throw new Error('No environment for theme ' + theme)
    }
    if (this.scene_.fog instanceof THREE.Fog) {
      this.scene_.fog.color.set(shown.floor_color)
    } else {
      this.scene_.fog = new THREE.Fog(shown.floor_color, 20, 80)
    }
    return shown
  }

  public initialize (skeleton_type: SkeletonType): void {
    const rig = RigConfig.by_skeleton_type(skeleton_type)
    if (rig === undefined) {
      console.error('Unknown rig selected for preview generation:', skeleton_type)
      return
    }

    this.set_status('Loading model and animations...')

    // page lives one folder below the static root
    // animation GLBs from the asset library are meshopt compressed
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    const clip_promises = rig.animations.map(async (animation: RigAnimation): Promise<PreviewClip | null> => {
      const clip_gltf = await loader.loadAsync('../' + animation.file)
      const clip = clip_gltf.animations[0]
      return clip === undefined ? null : { clip, loop: animation.loop }
    })

    loader.load('../' + rig.model_file, (gltf) => {
      void (async () => {
        this.scene_.add(gltf.scene)
        this.preview_clips = (await Promise.all(clip_promises)).filter((entry) => entry !== null)

        gltf.scene.traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.SkinnedMesh) {
            this.skinned_mesh = child
            child.castShadow = true
          }
          if (child instanceof THREE.Mesh) {
            child.receiveShadow = true
          }
        })

        if (this.skinned_mesh === null || this.preview_clips.length === 0) {
          this.set_status('No skinned mesh or animations found for this rig')
          return
        }

        this.mixer_ = new THREE.AnimationMixer(this.skinned_mesh)

        // remove all root motion data. This is the same function that the animation listing uses
        // TODO: with cleaning up data, the fox sitting has a weird height offset
        // I would think the cleanup should work with all skeleton types
        if (skeleton_type === SkeletonType.Human) {
          AnimationUtility.clean_track_data(this.preview_clips.map(entry => entry.clip), rig.position_tracking_bone_name)
        }

        this.fit_camera_to_animations()
        this.play_display_clip()
        this.animate_()
        this.set_status(`${this.preview_clips.length} animations loaded. Adjust the camera, then press Record.`)
      })()
    })

    document.getElementById('record-button')?.addEventListener('click', () => {
      void this.start_recording()
    })
    document.getElementById('fit-camera-button')?.addEventListener('click', () => {
      this.fit_camera_to_animations()
    })
  }

  private play_display_clip (): void {
    if (this.mixer_ === null) return
    this.mixer_.stopAllAction()
    const action = this.mixer_.clipAction(this.preview_clips[0].clip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = false
    action.reset().play()
  }

  /**
   * Some animations move far from their starting pose (backflips, jumps, lunges), so the camera is fit to
   * the bounds of every pose across all animations, not just the rest pose. The current viewing angle is kept,
   * so the camera can still be orbited after fitting.
   */
  private fit_camera_to_animations (): void {
    if (this.mixer_ === null || this.skinned_mesh === null) return

    const samples_per_clip = 8
    const all_poses_bounds = new THREE.Box3()
    const pose_bounds = new THREE.Box3()

    for (const { clip } of this.preview_clips) {
      this.mixer_.stopAllAction()
      this.mixer_.clipAction(clip).reset().play()
      for (let i = 0; i <= samples_per_clip; i++) {
        this.mixer_.setTime((clip.duration * i) / samples_per_clip)
        this.skinned_mesh.updateMatrixWorld(true)
        this.skinned_mesh.computeBoundingBox() // takes the current bone pose into account
        pose_bounds.copy(this.skinned_mesh.boundingBox!).applyMatrix4(this.skinned_mesh.matrixWorld)
        all_poses_bounds.union(pose_bounds)
      }
    }
    this.play_display_clip()

    const bounding_sphere = all_poses_bounds.getBoundingSphere(new THREE.Sphere())
    const vertical_half_fov = THREE.MathUtils.degToRad(this.camera_.fov / 2)
    const horizontal_half_fov = Math.atan(Math.tan(vertical_half_fov) * this.camera_.aspect)
    const margin = 1.05
    const distance = (bounding_sphere.radius * margin) / Math.sin(Math.min(vertical_half_fov, horizontal_half_fov))

    const view_direction = this.camera_.position.clone().sub(this.controls_.target).normalize()
    this.controls_.target.copy(bounding_sphere.center)
    this.camera_.position.copy(bounding_sphere.center).addScaledVector(view_direction, distance)
    this.controls_.update()
  }

  private async start_recording (): Promise<void> {
    if (this.is_recording || this.mixer_ === null || this.skinned_mesh === null) {
      console.warn('Animations not loaded yet, or already recording.')
      return
    }
    if (!await PreviewClipEncoder.is_supported(this.preview_width, this.preview_height)) {
      this.set_status('This browser does not support H.264 encoding with WebCodecs. Try Chrome or Edge.')
      return
    }

    this.is_recording = true
    const start_time = performance.now()
    const zip = new JSZip()
    const capture = new PreviewFrameCapture(this.preview_width, this.preview_height)
    let total_frames = 0

    try {
      for (let clip_index = 0; clip_index < this.preview_clips.length; clip_index++) {
        const { clip, loop } = this.preview_clips[clip_index]
        this.set_status(`Recording ${clip_index + 1} / ${this.preview_clips.length}: ${clip.name}`)

        const files = await this.record_clip(capture, clip, loop)
        files.forEach((file) => zip.file(file.name, file))
        total_frames += files.length > 0 ? this.frame_count_for_clip(clip, loop) : 0
      }

      this.set_status('Zipping...')
      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, 'animation-previews.zip')

      const seconds = ((performance.now() - start_time) / 1000).toFixed(1)
      this.set_status(`Done: ${this.preview_clips.length * this.theme_environments.length} previews (${total_frames} frames per theme) in ${seconds}s`)
    } catch (error) {
      console.error(error)
      this.set_status('Recording failed: ' + String(error))
    } finally {
      capture.dispose()
      this.show_theme_environment(this.theme_manager.get_current_theme())
      this.play_display_clip()
      this.is_recording = false
    }
  }

  /**
   * A looping clip's last frame matches its first, so it is left out to keep the loop seamless.
   * A one-shot clip keeps its last frame so the final pose is shown.
   */
  private frame_count_for_clip (clip: THREE.AnimationClip, loop: boolean): number {
    const frame_intervals = Math.max(1, Math.round(clip.duration * this.preview_fps))
    return loop ? frame_intervals : frame_intervals + 1
  }

  /** Records one clip in every theme. Each pose is rendered once per theme, so all themes match frame for frame */
  private async record_clip (capture: PreviewFrameCapture, clip: THREE.AnimationClip, loop: boolean): Promise<File[]> {
    if (this.mixer_ === null) return []

    const encoders = this.theme_environments.map(() =>
      new PreviewClipEncoder(this.preview_width, this.preview_height, this.preview_fps, this.preview_bitrate))

    // play once and hold the last pose. With the default repeat, setTime(duration) wraps back to the first pose
    this.mixer_.stopAllAction()
    const action = this.mixer_.clipAction(clip)
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = true
    action.reset().play()

    // frames are captured in batches. This remembers which theme's encoder each queued frame goes to
    let queued_encoder_indexes: number[] = []
    const send_batch_to_encoders = async (): Promise<void> => {
      const frames = await capture.collect_frames()
      frames.forEach((pixels, i) => { encoders[queued_encoder_indexes[i]].add_frame(pixels) })
      queued_encoder_indexes = []
    }

    const frame_count = this.frame_count_for_clip(clip, loop)
    for (let frame = 0; frame < frame_count; frame++) {
      this.mixer_.setTime(Math.min(frame / this.preview_fps, clip.duration))

      for (let index = 0; index < this.theme_environments.length; index++) {
        if (capture.is_batch_full()) {
          await send_batch_to_encoders()
        }
        const environment = this.theme_environments[index]
        this.show_theme_environment(environment.theme)
        capture.set_background_color(environment.floor_color)
        capture.queue_frame(this.scene_, this.camera_)
        queued_encoder_indexes.push(index)
      }
    }
    await send_batch_to_encoders()

    return await Promise.all(this.theme_environments.map(async (environment, index) =>
      await encoders[index].finish(`${environment.theme}_${clip.name}.mp4`)))
  }

  private set_status (message: string): void {
    console.info(message)
    if (this.status_element !== null) {
      this.status_element.textContent = message
    }
  }

  private readonly animate_ = (): void => {
    requestAnimationFrame(this.animate_)
    // while recording, the recorder poses the model itself
    if (this.is_recording) return

    this.mixer_?.update(this.clock_.getDelta())
    this.controls_.update()
    this.renderer_.render(this.scene_, this.camera_)
  }
}

const app = new PreviewGenerator()

// Populate animation file dropdown from central rig config
const animation_file_dropdown = document.getElementById('animation-file-dropdown') as HTMLSelectElement | null
if (animation_file_dropdown !== null) {
  DOMUtilities.populate_animation_rig_select(animation_file_dropdown)
}

// don't start the application logic until we pick a model to use
animation_file_dropdown?.addEventListener('change', (event) => {
  const selected_rig = (event.target as HTMLSelectElement).value as SkeletonType

  // disable the select drop-down to prevent re-initialization
  animation_file_dropdown.disabled = true

  app.initialize(selected_rig)
})
