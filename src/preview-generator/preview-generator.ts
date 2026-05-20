import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import { WebMRecorder } from './webm-recorder.ts'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'

import { Generators } from '../lib/Generators.ts'
import { ThemeManager } from '../lib/ThemeManager.ts'
import { AnimationUtility } from '../lib/processes/animations-listing/AnimationUtility.ts'
import { DOMUtilities } from '../lib/DOMUtilities.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'

class PreviewGenerator {
  private readonly renderer_: THREE.WebGLRenderer
  private readonly scene_: THREE.Scene
  private readonly camera_: THREE.PerspectiveCamera
  private readonly controls_: OrbitControls
  private mixer_: THREE.AnimationMixer | null = null
  private readonly clock_: THREE.Clock
  public readonly theme_manager: ThemeManager

  private readonly recorder: WebMRecorder
  private readonly zip: JSZip

  private environment_container: THREE.Group
  private new_skinned_mesh: THREE.SkinnedMesh
  private animation_clips: THREE.AnimationClip[] = []

  private current_animation_index_processing: number = 0

  private selected_file_to_load: string = ''

  private readonly preview_height: number = 120
  private readonly preview_width: number = 100

  constructor () {
    // Setup renderer, scene, camera
    this.renderer_ = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer_.shadowMap.enabled = true // Enable shadows
    this.recorder = new WebMRecorder(this.renderer_, this.preview_width, this.preview_height)

    // Set Filmic tone mapping for less saturated, more cinematic look
    this.renderer_.toneMapping = THREE.ACESFilmicToneMapping // a bit softer of a look
    this.renderer_.toneMappingExposure = 2.0 // tweak this value for brightness

    document.body.appendChild(this.renderer_.domElement)

    this.theme_manager = new ThemeManager()
    this.zip = new JSZip()
    this.environment_container = new THREE.Group()

    this.scene_ = new THREE.Scene()
    this.camera_ = Generators.create_camera()

    this.regenerate_floor_grid()

    // set the canvas size and aspect ratio, otherwise distortion happens for models
    // we are adding a multiplier so the preview is higher resolution and easier to position
    const preview_multiplier: number = 4
    this.renderer_.setSize(this.preview_width * preview_multiplier, this.preview_height * preview_multiplier)
    this.camera_.aspect = (this.preview_width * preview_multiplier) / (this.preview_height * preview_multiplier)
    this.camera_.updateProjectionMatrix()


    // Add orbit controls
    this.controls_ = new OrbitControls(this.camera_, this.renderer_.domElement)
    this.controls_.target.set(0, 0.4, 0)
    this.controls_.minDistance = 5
    this.controls_.maxDistance = 30
    this.controls_.update()

    this.clock_ = new THREE.Clock()
  }

  public regenerate_floor_grid (): void {
    // remove previous setup objects from scene if they exist
    const setup_container = this.scene_.getObjectByName('Setup objects')
    if (setup_container !== null) {
      this.scene_.remove(setup_container)
    }

    // change color of grid based on theme
    let grid_color = 0x4b6368
    let floor_color = 0x2d4353
    let light_strength: number = 10
    if (this.theme_manager.get_current_theme() === 'light') {
      grid_color = 0xcccccc // light theme color
      floor_color = 0xecf0f1 // light theme color
      light_strength = 14
    }

    this.scene_.fog = new THREE.Fog(floor_color, 20, 80)
    this.environment_container = new THREE.Group()
    this.environment_container.name = 'Setup objects'
    this.environment_container.add(...Generators.create_default_lights(light_strength))
    this.environment_container.add(...Generators.create_grid_helper(grid_color, floor_color))
    this.scene_.add(this.environment_container)
  }

  public initialize (file_to_load: string): void {
    this.selected_file_to_load = file_to_load

    const loader = new GLTFLoader()
    loader.load(this.selected_file_to_load, (gltf) => {
      this.scene_.add(gltf.scene)

      // Find the first SkinnedMesh
      gltf.scene.traverse((child: any) => {
        if (child.isSkinnedMesh) {
          this.new_skinned_mesh = child
          this.new_skinned_mesh.castShadow = true // Enable shadow casting for mesh
        }
        if (child.isMesh) {
          child.receiveShadow = true // Let all meshes receive shadows (e.g., grid/floor)
        }
      })

      if (this.new_skinned_mesh && gltf.animations && gltf.animations.length > 0) {
        this.mixer_ = new THREE.AnimationMixer(this.new_skinned_mesh)

        this.animation_clips = gltf.animations

        // remove all root motion data.
        // This is the same function that the animation listing done
        // TODO: with cleaning up data, the fox sitting has a weird height offset
        // I would think the cleanup should work with all skeleton types
        if (file_to_load.includes('human')) {
          AnimationUtility.clean_track_data(this.animation_clips, SkeletonType.Human )
        }

        const clip = this.animation_clips[0]
        const action = this.mixer_.clipAction(clip)
        action.reset()
        action.play()
        this.animate_()
      }
    }) // end GLTF loading

    // setup event listener for record button
    const record_button = document.getElementById('record-button')
    record_button?.addEventListener('click', () => {
      void this.start_recording()
    })
  }

  private async start_recording (): Promise<void> {
    if (this.new_skinned_mesh === null) {
      console.warn('Animation or animations not loaded yet.')
      return
    }
    // First pass: current theme
    this.current_animation_index_processing = 0 // reset counter if we do it again
    await this.process_animation_clip()

    // Switch theme and do a second pass
    this.theme_manager.toggle_theme()
    this.regenerate_floor_grid() // update grid/floor colors for new theme
    // Optionally, you may want to force a re-render or update other theme-dependent visuals here

    this.current_animation_index_processing = 0
    await this.process_animation_clip()

    // zip up all the video results and download everything
    await this.generate_zip()

    console.log('finished successfully')
  }

  private async process_animation_clip (): Promise<void> {
    // load up new animation to play
    const clip = this.animation_clips[this.current_animation_index_processing]
    const action: THREE.AnimationAction = this.mixer_.clipAction(clip)

    console.log('processing animation', this.current_animation_index_processing, clip.name)

    action.setLoop(THREE.LoopOnce, 1)
    action.reset()

    // wait for the animation to finish
    await new Promise<void>(resolve => {
      const handler = async (e: any) => {
        this.mixer_.removeEventListener('finished', handler)
        // Stop recording after animation ends
        const file = await this.recorder.stop()

        // Start recording before playing the animation
        this.zip.file(file.name, file)
        resolve()
      }
      this.mixer_.removeEventListener('finished', handler)
      this.mixer_.addEventListener('finished', handler)

      const theme_name: string = this.theme_manager.get_current_theme()
      this.recorder.start(`${theme_name}_${clip.name}.webm`)
      action.play()
    })

    // stop all animations in mixer
    this.mixer_.stopAllAction()

    this.current_animation_index_processing += 1

    // for testing a few, change to something small like 5
    const temp_limit = this.animation_clips.length

    if (this.current_animation_index_processing < temp_limit) {
      await this.process_animation_clip()
    }
  }

  // Generate zip and trigger download
  private async generate_zip (): Promise<void> {
    const blob = await this.zip.generateAsync({ type: 'blob' })
    saveAs(blob, 'animation-previews.zip')
  }

  private readonly animate_ = (): void => {
    requestAnimationFrame(this.animate_)
    if (this.mixer_) {
      this.mixer_.update(this.clock_.getDelta())
    }
    this.controls_.update()
    this.renderer_.render(this.scene_, this.camera_)
  }
}

const app = new PreviewGenerator()

// Populate animation file dropdown from central rig config
const animation_file_dropdown = document.getElementById('animation-file-dropdown') as HTMLSelectElement | null
if (animation_file_dropdown !== null) {
  DOMUtilities.populate_animation_file_select(animation_file_dropdown)
}

// look out for select change
// don't start the application logic until we pick a model to use
animation_file_dropdown?.addEventListener('change', (event) => {
  const selected_file = (event.target as HTMLSelectElement).value

  // disable the select drop-down to prevent re-initialization
  animation_file_dropdown.disabled = true

  app.initialize(selected_file)
})
