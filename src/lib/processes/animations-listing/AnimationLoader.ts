import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AnimationClip } from 'three'
import { AnimationUtility } from './AnimationUtility.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

export interface AnimationLoadProgress {
  loaded: number
  total: number
  percentage: number
  currentFile: string
  currentFileProgress: number
  currentFileLoaded: number
  currentFileTotal: number
  overallBytesLoaded: number
  overallBytesTotal: number
}

export class AnimationLoader extends EventTarget {
  private readonly gltf_loader: GLTFLoader = new GLTFLoader()
  private animations_file_path: string = 'animations/'
  private readonly file_progress_map = new Map<string, { loaded: number, total: number }>()
  private completed_files: number = 0
  private total_files: number = 0

  /**
   * Sets the base path for animation files
   */
  public set_animations_file_path (path: string): void {
    this.animations_file_path = path
  }

  /**
   * Loads all animations for the specified skeleton type
   * @param skeleton_type The type of skeleton to load animations for
   * @param skeleton_scale Scale factor to apply to position keyframes
   * @returns Promise that resolves with the loaded animation clips
   */
  public async load_animations (
    skeleton_type: SkeletonType,
    skeleton_scale: number = 1.0
  ): Promise<TransformedAnimationClipPair[]> {
    const file_paths = this.get_animation_file_paths(skeleton_type)

    if (file_paths.length === 0) {
      throw new Error(`No animation files found for skeleton type: ${skeleton_type}`)
    }

    // Initialize progress tracking
    this.file_progress_map.clear()
    this.completed_files = 0
    this.total_files = file_paths.length

    // Initialize all files in progress map
    file_paths.forEach(file_path => {
      this.file_progress_map.set(file_path, { loaded: 0, total: 1 })
    })

    return await new Promise((resolve, reject) => {
      const loaded_clips: TransformedAnimationClipPair[] = []
      let completed_loads = 0
      const total_loads = file_paths.length
      let has_error = false

      // Emit initial progress
      this.emit_enhanced_progress('', 0, 1)

      file_paths.forEach((file_path, index) => {
        this.gltf_loader.load(
          file_path,
          (gltf: any) => {
            if (has_error) return // Don't process if we already had an error

            try {
              // Mark file as completed
              this.file_progress_map.set(file_path, { loaded: 1, total: 1 })
              this.completed_files++

              // Process the loaded animations
              const processed_clips = this.process_loaded_animations(gltf.animations as AnimationClip[], skeleton_scale)
              loaded_clips.push(...processed_clips)

              completed_loads++

              // Emit progress update
              this.emit_enhanced_progress(file_path, 1, 1)

              // Check if all animations are loaded
              if (completed_loads === total_loads) {
                // Sort animations alphabetically by name
                loaded_clips.sort((a, b) => {
                  return a.display_animation_clip.name.localeCompare(b.display_animation_clip.name)
                })

                resolve(loaded_clips)
              }
            } catch (error) {
              if (!has_error) {
                has_error = true
                const error_message = error instanceof Error ? error.message : String(error)
                reject(new Error(`Failed to process animations from ${file_path}: ${error_message}`))
              }
            }
          },
          (progress_event) => {
            // Enhanced progress tracking during file loading
            if (progress_event.lengthComputable) {
              const current_progress = { loaded: progress_event.loaded, total: progress_event.total }
              this.file_progress_map.set(file_path, current_progress)

              // Emit real-time progress
              this.emit_enhanced_progress(file_path, progress_event.loaded, progress_event.total)
            }
          },
          (error) => {
            if (!has_error) {
              has_error = true
              const error_message = error instanceof Error ? error.message : String(error)
              reject(new Error(`Failed to load animation file ${file_path}: ${error_message}`))
            }
          }
        )
      })
    })
  }

  /**
   * Gets the file paths for animations based on skeleton type
   */
  private get_animation_file_paths (skeleton_type: SkeletonType): string[] {
    const base_path = this.animations_file_path

    switch (skeleton_type) {
      case SkeletonType.Human:
        return [
          `${base_path}human-base-animations.glb`,
          `${base_path}human-addon-animations.glb`
        ]
      case SkeletonType.Quadraped:
        return [`${base_path}quad-creature-animations.glb`]
      case SkeletonType.Bird:
        return [`${base_path}bird-animations.glb`]
      case SkeletonType.Dragon:
        return [`${base_path}dragon-animations.glb`]
      default:
        console.error('Unknown skeleton type for loading animations:', skeleton_type)
        return []
    }
  }

  /**
   * Processes raw animation clips from GLTF file
   */
  private process_loaded_animations (
    raw_animations: AnimationClip[],
    skeleton_scale: number
  ): TransformedAnimationClipPair[] {
    // Deep clone the animations to avoid modifying originals
    const cloned_animations = AnimationUtility.deep_clone_animation_clips(raw_animations)

    // Clean track data (remove position tracks except for specific cases)
    AnimationUtility.clean_track_data(cloned_animations)

    // Apply skeleton scaling to position keyframes
    AnimationUtility.apply_skeleton_scale_to_position_keyframes(cloned_animations, skeleton_scale)

    // Create the transformed pairs
    const transformed_pairs = cloned_animations.map(clip => ({
      original_animation_clip: clip,
      display_animation_clip: AnimationUtility.deep_clone_animation_clip(clip)
    }))

    // Apply finger rotation constraints to prevent backward bending
    // This is especially important for models with simplified hand skeletons
    AnimationUtility.apply_finger_rotation_constraints(transformed_pairs)

    return transformed_pairs
  }

  /**
   * Emits enhanced progress event to listeners
   */
  private emit_enhanced_progress (current_file: string, file_loaded: number, file_total: number): void {
    // Calculate overall progress across all files
    let total_bytes_loaded = 0
    let total_bytes_total = 0
    let files_in_progress = 0

    this.file_progress_map.forEach((progress, file_path) => {
      total_bytes_loaded += progress.loaded
      total_bytes_total += progress.total
      if (progress.loaded < progress.total) {
        files_in_progress++
      }
    })

    // Calculate percentages
    const current_file_percentage = file_total > 0 ? Math.round((file_loaded / file_total) * 100) : 0

    // Calculate file-based progress (completed files vs total files)
    const file_based_percentage = this.total_files > 0
      ? Math.round(((this.completed_files + (files_in_progress > 0 ? 0.5 : 0)) / this.total_files) * 100)
      : 0

    // send the current animation loading progress data to listener to handle
    const progress: AnimationLoadProgress = {
      loaded: this.completed_files,
      total: this.total_files,
      percentage: file_based_percentage,
      currentFile: current_file,
      currentFileProgress: current_file_percentage,
      currentFileLoaded: file_loaded,
      currentFileTotal: file_total,
      overallBytesLoaded: total_bytes_loaded,
      overallBytesTotal: total_bytes_total
    }

    this.dispatchEvent(new CustomEvent('progress', { detail: progress }))
  }
}
