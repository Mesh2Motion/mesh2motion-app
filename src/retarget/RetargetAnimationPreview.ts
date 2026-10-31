import { type AnimationClip, AnimationMixer, Object3D, type Scene, type SkinnedMesh, type AnimationAction } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { AnimationUtility } from '../lib/processes/animations-listing/AnimationUtility.ts'
import type { StepBoneMapping } from './steps/StepBoneMapping.ts'
import { RetargetUtils } from './RetargetUtils.ts'
import { AnimationRetargetService } from './AnimationRetargetService.ts'
import { RigConfig } from '../lib/RigConfig.ts'

/**
 * RetargetAnimationPreview - Provides live preview of bone retargeting by automatically
 * loading and playing animations while applying bone mappings in real-time
 */
export class RetargetAnimationPreview extends EventTarget {
  private readonly step_bone_mapping: StepBoneMapping
  // animation GLBs from the asset library are meshopt compressed
  private readonly gltf_loader: GLTFLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

  private animation_mixer: AnimationMixer | null = null
  private current_animation_clip: AnimationClip | null = null
  private retargeted_animation_clip: AnimationClip | null = null

  private is_preview_active: boolean = false
  private has_added_event_listeners: boolean = false

  constructor (step_bone_mapping: StepBoneMapping) {
    super()
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
   * Load the walk animation for the source rig, or the first animation if it has no walk
   */
  private async load_first_animation (): Promise<void> {
    // get location of animation file to load that has preview animations
    const source_skeleton_type = AnimationRetargetService.getInstance().get_skeleton_type()
    // every rig should have a walk animation
    const rig_animations = RigConfig.animations_for(source_skeleton_type)
    const preview_animation = rig_animations.find(animation => animation.name.toLowerCase().includes('walk')) ?? rig_animations[0]

    if (preview_animation === undefined) {
      console.log('No animation file found for skeleton type:', source_skeleton_type)
      return
    }

    // page lives one folder below the static root
    const animation_file_path = '../' + preview_animation.file

    // if we are coming back to this step and already loaded a default animation, skip reloading
    // and just do the playing
    if (this.current_animation_clip !== null) {
      this.play_default_animation()
      return
    }

    try {
      await new Promise<void>((resolve, reject) => {
        this.gltf_loader.load(
          animation_file_path,
          (gltf: any) => {
            if (gltf.animations !== null && gltf.animations !== undefined && gltf.animations.length > 0) {
              this.current_animation_clip = gltf.animations[0]

              if (this.current_animation_clip !== null) {
                console.log('Loaded animation:', this.current_animation_clip.name)

                const skeleton_type = AnimationRetargetService.getInstance().get_skeleton_type()
                const position_tracking_bone_name: string | undefined = 
                RigConfig.by_skeleton_type(skeleton_type)?.position_tracking_bone_name

                console.log('should be keeping this bone for position tracking', position_tracking_bone_name)

                // Clean up the animation track data before using it
                // This removes unnecessary position tracks and keeps only rotation data
                AnimationUtility.clean_track_data([this.current_animation_clip], position_tracking_bone_name)
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

    // with no mappings there is nothing to retarget, so show the rest pose instead of the source clip
    if (!this.has_something_to_retarget()) {
      this.retargeted_animation_clip = null
      const target_armature: Scene | null = AnimationRetargetService.getInstance().get_target_armature()
      if (target_armature !== null) {
        RetargetUtils.reset_skinned_mesh_to_rest_pose(target_armature)
      }
      return
    }

    // Create retargeted animation clip using shared service
    this.retargeted_animation_clip = AnimationRetargetService.getInstance().retarget_animation_clip(
      this.current_animation_clip
    )

    this.play_default_animation()
  }

  // identical rigs need no mappings, everything else needs at least one
  private has_something_to_retarget (): boolean {
    const retarget_service = AnimationRetargetService.getInstance()

    if (retarget_service.get_bone_mappings().size > 0) {
      return true
    }

    return RetargetUtils.are_source_and_target_bones_identical(
      retarget_service.get_source_armature(),
      retarget_service.get_target_armature()
    )
  }

  private play_default_animation (): void {
    const retargeted_clip: AnimationClip | null = this.retargeted_animation_clip
    if (retargeted_clip === null) {
      console.error('retargeting animation clip is null while playing default animation.')
      return
    }

    const animation_mixer: AnimationMixer | null = this.animation_mixer
    if (animation_mixer === null) {
      console.error('Animation mixer is null while playing default animation.')
      return
    }

    // Apply the retargeted animation to all target skinned meshes
    const skinned_meshes: SkinnedMesh[] = AnimationRetargetService.getInstance().get_target_skinned_meshes()
    skinned_meshes.forEach((skinned_mesh) => {
      const action: AnimationAction = animation_mixer.clipAction(retargeted_clip, skinned_mesh)
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
    const skinned_meshes: SkinnedMesh[] = AnimationRetargetService.getInstance().get_target_skinned_meshes()
    skinned_meshes.forEach((skinned_mesh) => {
      skinned_mesh.skeleton.bones.forEach(bone => {
        bone.updateMatrixWorld(true)
      })
    })
  }
}
