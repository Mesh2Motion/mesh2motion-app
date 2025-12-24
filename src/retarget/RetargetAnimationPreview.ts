import { type AnimationClip, AnimationMixer, Object3D, type Scene, type SkinnedMesh, type AnimationAction } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { AnimationUtility } from '../lib/processes/animations-listing/AnimationUtility.ts'
import type { StepBoneMapping } from './steps/StepBoneMapping.ts'
import { RetargetUtils } from './RetargetUtils.ts'
import { AnimationRetargetService } from './AnimationRetargetService.ts'

/**
 * RetargetAnimationPreview - Provides live preview of bone retargeting by automatically
 * loading and playing animations while applying bone mappings in real-time
 */
export class RetargetAnimationPreview extends EventTarget {
  private readonly _main_scene: Scene
  private readonly step_bone_mapping: StepBoneMapping
  private readonly gltf_loader: GLTFLoader = new GLTFLoader()

  private animation_mixer: AnimationMixer | null = null
  private current_animation_clip: AnimationClip | null = null
  private retargeted_animation_clip: AnimationClip | null = null
  private target_skinned_meshes: SkinnedMesh[] = []

  private is_preview_active: boolean = false
  private has_added_event_listeners: boolean = false

  constructor (main_scene: Scene, step_bone_mapping: StepBoneMapping) {
    super()
    this._main_scene = main_scene
    this.step_bone_mapping = step_bone_mapping
  }

  public begin (): void {
    if (!this.has_added_event_listeners) {
      this.add_event_listeners()
      this.has_added_event_listeners = true
    }
  }

  private add_event_listeners (): void {
    // Listen for bone mapping changes
    this.step_bone_mapping.addEventListener('bone-mappings-changed', () => {
      console.log('Bone mappings changed, updating preview animation...')
      this.update_preview_animation()
    })

    this.setup_animation_loop()
  }

  /**
   * Start the preview system by loading the first available animation
   */
  public async start_preview (): Promise<void> {
    this.is_preview_active = true

    // we have already loaded an animation and retargeted it, just play it again
    // this will happen when going back to bone mapping step from animation listing step
    if (this.retargeted_animation_clip !== null) {
      this.play_default_animation()
      return
    }

    if (!this.step_bone_mapping.has_both_skeletons()) {
      console.log('Cannot start preview: both skeletons are required')
      return
    }

    const target_skeleton_data = this.step_bone_mapping.get_target_skeleton_data()
    if (target_skeleton_data === null) {
      console.log('Cannot start preview: target skeleton data is null')
      return
    }

    // Extract skinned meshes from target skeleton data
    this.target_skinned_meshes = []
    target_skeleton_data.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        this.target_skinned_meshes.push(child as SkinnedMesh)
      }
    })

    if (this.target_skinned_meshes.length === 0) {
      console.log('Cannot start preview: no skinned meshes found in target')
      return
    }

    // Create animation mixer for the target skeleton
    // Use a dummy Object3D as root since we apply animations directly to skinned meshes
    // there are often more than one skinned mesh we want to animate at a time
    this.animation_mixer = new AnimationMixer(new Object3D())

    // Load the first animation based on skeleton type
    await this.load_first_animation()

    console.log('Preview started successfully')
  }

  /**
   * Stop the preview and clean up
   */
  public stop_preview (): void {
    if (this.animation_mixer !== null) {
      this.animation_mixer.stopAllAction()
      this.animation_mixer = null
    }

    this.current_animation_clip = null
    this.retargeted_animation_clip = null
    this.is_preview_active = false
    console.log('Preview stopped')
  }

  /**
   * Load the first animation from the appropriate animation file
   */
  private async load_first_animation (): Promise<void> {
    // get location of animation file to load that has preview animations
    const source_skeleton_type = this.step_bone_mapping.get_source_skeleton_type()
    const animation_file_path = RetargetUtils.get_animation_file_path(source_skeleton_type)

    if (animation_file_path === null) {
      console.log('No animation file found for skeleton type:', source_skeleton_type)
      return
    }

    // if we are coming back to this step and already loaded a default animation, skip reloading
    // and just do the playing
    if (this.current_animation_clip !== null) {
    
    }

    try {
      await new Promise<void>((resolve, reject) => {
        this.gltf_loader.load(
          animation_file_path,
          (gltf: any) => {
            if (gltf.animations !== null && gltf.animations !== undefined && gltf.animations.length > 0) {
              // find the "walk animation clip". every rig should have one of those.
              const walk_animation = gltf.animations.find((clip: AnimationClip) => clip.name.toLowerCase().includes('walk'))
              this.current_animation_clip = walk_animation ?? gltf.animations[0]

              if (this.current_animation_clip !== null) {
                console.log('Loaded animation:', this.current_animation_clip.name)

                // Clean up the animation track data before using it
                // This removes unnecessary position tracks and keeps only rotation data
                AnimationUtility.clean_track_data([this.current_animation_clip])
              }
              this.update_preview_animation()
              resolve()
            } else {
              reject(new Error('No animations found in file'))
            }
          },
          undefined,
          (error) => {
            reject(error)
          }
        )
      })
    } catch (error) {
      console.error('Error loading animation:', error)
    }
  }

  /**
   * Update the preview animation by applying current bone mappings
   */
  private update_preview_animation (): void {
    if (!this.is_preview_active || this.current_animation_clip === null || this.animation_mixer === null) {
      return
    }

    // Stop any currently playing animation
    this.animation_mixer.stopAllAction()

    // Get current bone mappings
    const bone_mappings = this.step_bone_mapping.get_bone_mapping()

    if (bone_mappings.size === 0) {
      console.log('No bone mappings yet, skipping animation retarget')
      return
    }

    // Create retargeted animation clip using shared service
    this.retargeted_animation_clip = AnimationRetargetService.retarget_animation_clip(
      this.current_animation_clip,
      bone_mappings,
      this.step_bone_mapping.get_target_mapping_template(),
      this.step_bone_mapping.get_source_armature(),
      this.step_bone_mapping.get_target_skeleton_data(),
      this.target_skinned_meshes
    )

    this.play_default_animation()
  }

  private play_default_animation (): void {
    if (this.retargeted_animation_clip === null) {
      console.error('retargeting animation clip is null while playing default animation.')
      return
    }

    if (this.animation_mixer === null) {
      console.error('Animation mixer is null while playing default animation.')
      return
    }

    // Apply the retargeted animation to all target skinned meshes
    this.target_skinned_meshes.forEach((skinned_mesh) => {
      const action: AnimationAction = this.animation_mixer.clipAction(this.retargeted_animation_clip, skinned_mesh)
      action.reset()
      action.play() // should loop automatically
    })
  }

  private setup_animation_loop (): void {
    let last_time = performance.now()
    const animate = (): void => {
      requestAnimationFrame(animate)

      // calculate delta time and pass it into preview
      const current_time = performance.now()
      const delta_time = (current_time - last_time) / 1000 // Convert to seconds
      last_time = current_time

      if (this.is_preview_active) {
        this.animation_frame_logic(delta_time)
      }
    }
    animate()
  }

  private animation_frame_logic (delta_time: number): void {
    if (this.animation_mixer === null) return

    this.animation_mixer.update(delta_time)

    // CRITICAL: Update the skeleton and skinned meshes after animation changes the bones
    // Why do I need this when I don't need it in the main Mesh2Motion engine?
    this.target_skinned_meshes.forEach((skinned_mesh) => {
      skinned_mesh.skeleton.bones.forEach(bone => {
        bone.updateMatrixWorld(true)
      })
    })
  }
}
