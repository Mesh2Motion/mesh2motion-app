import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type AnimationClip, type SkinnedMesh } from 'three'
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

// Custom error types for better error handling
export class NoAnimationsError extends Error {
  constructor (message: string = 'No animations found in the file.') {
    super(message)
    this.name = 'NoAnimationsError'
  }
}

export class IncompatibleSkeletonError extends Error {
  constructor (message: string = 'Animation skeleton is incompatible with target skeleton.') {
    super(message)
    this.name = 'IncompatibleSkeletonError'
  }
}

export class LoadError extends Error {
  constructor (message: string = 'Failed to load animation file.') {
    super(message)
    this.name = 'LoadError'
  }
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
   * Extracts bone name from animation track name
   */
  private extract_bone_name_from_track (track_name: string): string | null {
    const bones_match = track_name.match(/\.bones\[([^\]]+)\]\.(?:quaternion|position|scale)$/)
    if (bones_match !== null) {
      return bones_match[1].toLowerCase()
    }

    const simple_match = track_name.match(/^([^.]+)\.(?:quaternion|position|scale)$/)
    if (simple_match !== null) {
      return simple_match[1].toLowerCase()
    }

    return null
  }

  /**
   * Gets all bone names referenced in animation clips
   */
  private get_animation_bone_names (animation_clips: AnimationClip[]): Set<string> {
    const bone_names = new Set<string>()
    animation_clips.forEach((clip) => {
      clip.tracks.forEach((track) => {
        const bone_name = this.extract_bone_name_from_track(track.name)
        if (bone_name !== null) {
          bone_names.add(bone_name)
        }
      })
    })
    return bone_names
  }

  /**
   * Validates that animation bones are compatible with target skeleton
   * @throws {IncompatibleSkeletonError} If bones don't match
   * @throws {NoAnimationsError} If no recognizable bone tracks found
   */
  public validate_animation_bones_match (
    animation_clips: AnimationClip[],
    skinned_meshes: SkinnedMesh[]
  ): void {
    if (skinned_meshes.length === 0) {
      throw new Error('No skinned meshes available to validate animations.')
    }

    // Get target bone names from skeleton
    const target_bone_names = new Set<string>()
    skinned_meshes.forEach((skinned_mesh) => {
      skinned_mesh.skeleton.bones.forEach((bone) => {
        target_bone_names.add(bone.name.toLowerCase())
      })
    })

    const animation_bone_names = this.get_animation_bone_names(animation_clips)

    if (animation_bone_names.size === 0) {
      throw new NoAnimationsError('Imported animations do not contain recognizable bone tracks.')
    }

    // Check bone count mismatch
    if (animation_bone_names.size !== target_bone_names.size) {
      throw new IncompatibleSkeletonError('bone count mismatch')
    }

    // Check bone name mismatch (animation has bones not in target skeleton)
    const missing_bones = Array.from(animation_bone_names).filter(bone => !target_bone_names.has(bone))
    if (missing_bones.length > 0) {
      throw new IncompatibleSkeletonError('bone names don\'t match')
    }
  }

  /**
   * Loads animations from a local GLB file and validates against target skeleton.
   * @param file The GLB file to load
   * @param skinned_meshes Target skinned meshes to validate against
   * @param skeleton_scale Scale factor to apply to position keyframes
   * @returns Promise that resolves with the loaded animation clips
   * @throws {NoAnimationsError} If no animations found in file
   * @throws {IncompatibleSkeletonError} If animation bones don't match target skeleton
   * @throws {LoadError} If file cannot be loaded
   */
  public async load_animations_from_file (
    file: File,
    skinned_meshes: SkinnedMesh[],
    skeleton_scale: number = 1.0
  ): Promise<TransformedAnimationClipPair[]> {
    const file_url = URL.createObjectURL(file)
    const file_total = file.size > 0 ? file.size : 1

    this.file_progress_map.clear()
    this.completed_files = 0
    this.total_files = 1
    this.file_progress_map.set(file.name, { loaded: 0, total: file_total })
    this.emit_enhanced_progress(file.name, 0, file_total)

    return await new Promise((resolve, reject) => {
      this.gltf_loader.load(
        file_url,
        (gltf: any) => {
          URL.revokeObjectURL(file_url)

          try {
            const animations = gltf.animations as AnimationClip[]
            if (animations === null || animations === undefined || animations.length === 0) {
              this.file_progress_map.set(file.name, { loaded: file_total, total: file_total })
              this.completed_files = 1
              this.emit_enhanced_progress(file.name, file_total, file_total)
              throw new NoAnimationsError('No animations found in the GLB file.')
            }

            // Validate bones match target skeleton
            this.validate_animation_bones_match(animations, skinned_meshes)

            this.file_progress_map.set(file.name, { loaded: file_total, total: file_total })
            this.completed_files = 1
            this.emit_enhanced_progress(file.name, file_total, file_total)

            const processed_clips = this.process_loaded_animations(animations, skeleton_scale)
            resolve(processed_clips)
          } catch (error) {
            const error_message = error instanceof Error ? error.message : String(error)
            if (error instanceof NoAnimationsError || error instanceof IncompatibleSkeletonError) {
              reject(error)
            } else {
              reject(new LoadError(`Failed to process animations from ${file.name}: ${error_message}`))
            }
          }
        },
        (progress_event) => {
          if (progress_event.lengthComputable) {
            const total_bytes = progress_event.total > 0 ? progress_event.total : file_total
            this.file_progress_map.set(file.name, { loaded: progress_event.loaded, total: total_bytes })
            this.emit_enhanced_progress(file.name, progress_event.loaded, total_bytes)
          }
        },
        (error) => {
          URL.revokeObjectURL(file_url)
          const error_message = error instanceof Error ? error.message : String(error)
          reject(new LoadError(`Failed to load animation file ${file.name}: ${error_message}`))
        }
      )
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
      case SkeletonType.Kaiju:
        return [`${base_path}kaiju-animations.glb`]
      default:
        console.error('Unknown skeleton type for loading animations:', skeleton_type)
        return []
    }
  }

  /**
   * Processes raw animation clips from GLTF file
   */
  public process_loaded_animations (
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
    return cloned_animations.map(clip => ({
      original_animation_clip: clip,
      display_animation_clip: AnimationUtility.deep_clone_animation_clip(clip)
    }))
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
