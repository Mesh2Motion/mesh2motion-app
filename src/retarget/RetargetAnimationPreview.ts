import { AnimationClip, AnimationMixer, type Scene, type SkinnedMesh, VectorKeyframeTrack, QuaternionKeyframeTrack } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import type { StepBoneMapping } from './StepBoneMapping.ts'

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
  private _added_event_listeners: boolean = false

  constructor (main_scene: Scene, step_bone_mapping: StepBoneMapping) {
    super()
    this._main_scene = main_scene
    this.step_bone_mapping = step_bone_mapping
  }

  public begin (): void {
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }
  }

  private add_event_listeners (): void {
    // Listen for bone mapping changes
    this.step_bone_mapping.addEventListener('bone-mappings-changed', () => {
      console.log('Bone mappings changed, updating preview animation...')
      this.update_preview_animation()
    })
  }

  /**
   * Start the preview system by loading the first available animation
   */
  public async start_preview (): Promise<void> {
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
    // Try creating mixer on the first skinned mesh instead of the parent group
    this.animation_mixer = new AnimationMixer(this.target_skinned_meshes[0])

    // Debug: Log the target skeleton structure
    console.log('Target skeleton structure:')
    this.target_skinned_meshes.forEach((mesh, index) => {
      console.log(`  SkinnedMesh ${index}: ${mesh.name}, bones: ${mesh.skeleton.bones.length}`)
      mesh.skeleton.bones.forEach((bone, boneIndex) => {
        console.log(`    Bone ${boneIndex}: ${bone.name}`)
      })
    })

    // Load the first animation based on skeleton type
    await this.load_first_animation()

    this.is_preview_active = true
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
    const source_skeleton_type = this.step_bone_mapping.get_source_skeleton_type()
    const animation_file_path = this.get_animation_file_path(source_skeleton_type)

    if (animation_file_path === null) {
      console.log('No animation file found for skeleton type:', source_skeleton_type)
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
                console.log('Loaded first animation:', this.current_animation_clip.name)
                console.log('Source animation tracks:')
                this.current_animation_clip.tracks.forEach((track, index) => {
                  console.log(`  Track ${index}: ${track.name} (${track.values.length} values)`)
                })
                console.log('Total tracks:', this.current_animation_clip.tracks.length)
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
   * Get the animation file path based on skeleton type
   */
  private get_animation_file_path (skeleton_type: SkeletonType): string | null {
    switch (skeleton_type) {
      case SkeletonType.Human:
        return '/animations/human-base-animations.glb'
      case SkeletonType.Quadraped:
        return '/animations/quad-creature-animations.glb'
      case SkeletonType.Bird:
        return '/animations/bird-animations.glb'
      case SkeletonType.Dragon:
        return '/animations/dragon-animations.glb'
      default:
        return null
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

    // Create retargeted animation clip
    this.retargeted_animation_clip = this.retarget_animation_clip(
      this.current_animation_clip,
      bone_mappings
    )

    // Optimize the clip
    //this.retargeted_animation_clip.optimize()

    // Apply the retargeted animation to all target skinned meshes
    this.target_skinned_meshes.forEach((skinned_mesh, index) => {
      if (this.animation_mixer !== null && this.retargeted_animation_clip !== null) {
        console.log(`Playing animation on SkinnedMesh ${index}: ${skinned_mesh.name}`)

        const action = this.animation_mixer.clipAction(this.retargeted_animation_clip, skinned_mesh)
        action.play()

        console.log('Animation clip playing: ', this.retargeted_animation_clip)
        console.log(`  Action playing - enabled: ${action.enabled}, paused: ${action.paused}`)
      }
    })

    console.log('Preview animation updated and playing')
  }

  /**
   * Retarget an animation clip using bone mappings
   * @param source_clip - The original animation clip from the source skeleton
   * @param bone_mappings - Map of target bone name -> source bone name
   * @returns A new animation clip retargeted for the target skeleton
   */
  private retarget_animation_clip (source_clip: AnimationClip, bone_mappings: Map<string, string>): AnimationClip {
    const new_tracks: any[] = []

    // Create a reverse mapping for easier lookup: source bone name -> target bone names[]
    const reverse_mappings = new Map<string, string[]>()
    bone_mappings.forEach((source_bone_name, target_bone_name) => {
      if (!reverse_mappings.has(source_bone_name)) {
        reverse_mappings.set(source_bone_name, [])
      }
      const target_list = reverse_mappings.get(source_bone_name)
      if (target_list !== undefined) {
        target_list.push(target_bone_name)
      }
    })

    // Process each track in the source animation
    source_clip.tracks.forEach((track) => {
      // Parse the track name to get the bone name and property
      // Track names are typically in format: "boneName.property" or ".bones[boneName].property"
      const track_name_parts = this.parse_track_name(track.name)
      if (track_name_parts === null) {
        return
      }

      const { bone_name, property } = track_name_parts

      // Check if this bone is mapped to any target bones
      const target_bone_names = reverse_mappings.get(bone_name)
      if (target_bone_names === undefined || target_bone_names.length === 0) {
        return // Skip unmapped bones
      }

      // Create a track for each target bone this source bone maps to
      target_bone_names.forEach((target_bone_name) => {
        const new_track_name = this.create_track_name(target_bone_name, property)

        // Clone the track with the new name
        if (property === 'quaternion') {
          const new_track = new QuaternionKeyframeTrack(
            new_track_name,
            track.times.slice(),
            track.values.slice()
          )
          new_tracks.push(new_track)
        } else if (property === 'position' || property === 'scale') {
          const new_track = new VectorKeyframeTrack(
            new_track_name,
            track.times.slice(),
            track.values.slice()
          )
          new_tracks.push(new_track)
        }
      })

      console.log('All the new tracks we created for the preview:', new_tracks)
    })

    // Create the retargeted animation clip
    const retargeted_clip = new AnimationClip(
      `${source_clip.name}_retargeted`,
      source_clip.duration,
      new_tracks
    )

    console.log('Retargeted animation clip created:', retargeted_clip)
    console.log(`Retargeted animation: ${source_clip.name} -> ${retargeted_clip.name} (${new_tracks.length} tracks)`)
    return retargeted_clip
  }

  /**
   * Parse a track name to extract bone name and property
   * Handles various formats like "boneName.property" or ".bones[boneName].property"
   */
  private parse_track_name (track_name: string): { bone_name: string, property: string } | null {
    // Try format: "boneName.property"
    const simple_match = track_name.match(/^([^.]+)\.(.+)$/)
    if (simple_match !== null) {
      return {
        bone_name: simple_match[1],
        property: simple_match[2]
      }
    }

    // Try format: ".bones[boneName].property"
    const bones_match = track_name.match(/\.bones\[([^\]]+)\]\.(.+)$/)
    if (bones_match !== null) {
      return {
        bone_name: bones_match[1],
        property: bones_match[2]
      }
    }

    return null
  }

  /**
   * Create a track name in the format expected by Three.js
   * For named bones, use: BoneName.property
   */
  private create_track_name (bone_name: string, property: string): string {
    return `${bone_name}.${property}`
  }

  /**
   * Update animation mixer on each frame
   */
  public update (delta_time: number): void {
    if (this.animation_mixer !== null && this.is_preview_active) {
      this.animation_mixer.update(delta_time)
    }
  }

  /**
   * Check if preview is currently active
   */
  public is_active (): boolean {
    return this.is_preview_active
  }
}
