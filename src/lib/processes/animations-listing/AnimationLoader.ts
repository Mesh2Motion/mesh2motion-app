import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { type AnimationClip, type Group, type Object3D } from 'three'
import { FBXLoader } from '../../io/FBXLoader.ts'
import { AnimationUtility } from './AnimationUtility.ts'
import { type SkeletonType } from '../../enums/SkeletonType.ts'
import { RigConfig } from '../../RigConfig.ts'
import { type AnimationClipMetadata, type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { LoadError, NoAnimationsError } from './AnimationImportErrors.ts'

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

export interface LoadedAnimationSource {
  animations: AnimationClip[]
  // scene the animations came with. Holds the rig they were authored on
  scene: Object3D
}

export class AnimationLoader extends EventTarget {
  // animation GLBs from the asset library are meshopt compressed
  private readonly gltf_loader: GLTFLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  // custom imports can also come in as FBX, which is what Mixamo hands out
  private readonly fbx_loader: FBXLoader = new FBXLoader()
  // prefix that points from the current page to the static root, e.g. '../' for pages in a sub-folder
  private static_root_path: string = ''
  private readonly file_progress_map = new Map<string, { loaded: number, total: number }>()
  private completed_files: number = 0
  private total_files: number = 0

  private skeleton_type: SkeletonType | null = null

  private create_default_metadata (): AnimationClipMetadata {
    return {
      source_type: 'default-library',
      tags: []
    }
  }

  /**
   * Sets the path from the current page to the static root. Animation file paths are relative to the static root.
   */
  public set_static_root_path (path: string): void {
    this.static_root_path = path
  }

  /**
   * Sets the rig that loaded animations are processed for (position tracking bone, etc.)
   */
  public set_skeleton_type (skeleton_type: SkeletonType): void {
    this.skeleton_type = skeleton_type
  }

  /**
   * Loads one animation GLB from the asset library. Each library GLB holds a single clip.
   * @param file_path GLB file path relative to the static root
   * @param skeleton_scale Scale factor to apply to position keyframes
   * @returns Promise that resolves with the processed animation clips
   */
  public async load_animation_file (
    file_path: string,
    skeleton_scale: number,
    metadata_override: Partial<AnimationClipMetadata> = {}
  ): Promise<TransformedAnimationClipPair[]> {
    const gltf = await this.gltf_loader.loadAsync(`${this.static_root_path}${file_path}`)
    return this.process_loaded_animations(gltf.animations, skeleton_scale, metadata_override)
  }

  /**
   * Loads the raw animations from a local GLB or FBX file, along with the scene they were
   * authored on. The scene holds the source rig, which is needed when the animations have
   * to be retargeted onto our skeleton. Nothing is processed or validated here.
   * @param file The GLB or FBX file to load
   * @returns Promise that resolves with the unprocessed clips and their scene
   * @throws {NoAnimationsError} If no animations found in file
   * @throws {LoadError} If file cannot be loaded
   */
  public async load_animation_source_file (file: File): Promise<LoadedAnimationSource> {
    const file_url = URL.createObjectURL(file)
    const file_total = file.size > 0 ? file.size : 1
    const is_fbx: boolean = file.name.toLowerCase().endsWith('.fbx')

    this.file_progress_map.clear()
    this.completed_files = 0
    this.total_files = 1
    this.file_progress_map.set(file.name, { loaded: 0, total: file_total })
    this.emit_enhanced_progress(file.name, 0, file_total)

    const finish_progress = (): void => {
      // Emit final progress to hide the loader UI
      this.file_progress_map.set(file.name, { loaded: file_total, total: file_total })
      this.completed_files = 1
      this.emit_enhanced_progress(file.name, file_total, file_total)
    }

    return await new Promise((resolve, reject) => {
      const on_load = (scene: Object3D, animations: AnimationClip[] | undefined): void => {
        URL.revokeObjectURL(file_url)
        finish_progress()

        if (animations === undefined || animations.length === 0) {
          reject(new NoAnimationsError('No animations found in the file.'))
          return
        }

        resolve({ animations, scene })
      }

      const on_progress = (progress_event: ProgressEvent): void => {
        if (progress_event.lengthComputable) {
          const total_bytes = progress_event.total > 0 ? progress_event.total : file_total
          this.file_progress_map.set(file.name, { loaded: progress_event.loaded, total: total_bytes })
          this.emit_enhanced_progress(file.name, progress_event.loaded, total_bytes)
        }
      }

      const on_error = (error: unknown): void => {
        URL.revokeObjectURL(file_url)
        finish_progress()
        const error_message = error instanceof Error ? error.message : String(error)
        reject(new LoadError(`Failed to load animation file ${file.name}: ${error_message}`))
      }

      if (is_fbx) {
        this.fbx_loader.load(file_url, (fbx: Group) => { on_load(fbx, fbx.animations) }, on_progress, on_error)
      } else {
        this.gltf_loader.load(file_url, (gltf: GLTF) => { on_load(gltf.scene, gltf.animations) }, on_progress, on_error)
      }
    })
  }

  /**
   * Processes raw animation clips from GLTF file
   */
  public process_loaded_animations (
    raw_animations: AnimationClip[],
    skeleton_scale: number,
    metadata_override: Partial<AnimationClipMetadata> = {}
  ): TransformedAnimationClipPair[] {

    if(this.skeleton_type === null) {
      throw new Error('Skeleton type is not set (process_loaded_animations). Cannot process animations.')
    }

    // Deep clone the animations to avoid modifying originals
    const cloned_animations = AnimationUtility.deep_clone_animation_clips(raw_animations)

    const position_tracking_bone_name: string | undefined = 
    RigConfig.by_skeleton_type(this.skeleton_type)?.position_tracking_bone_name

    // Clean track data (remove position tracks except for specific cases)
    AnimationUtility.clean_track_data(cloned_animations, position_tracking_bone_name)

    // Apply skeleton scaling to position keyframes
    AnimationUtility.apply_skeleton_scale_to_position_keyframes(cloned_animations, skeleton_scale)

    // Create the transformed pairs
    return cloned_animations.map(clip => ({
      original_animation_clip: clip,
      display_animation_clip: AnimationUtility.deep_clone_animation_clip(clip),
      metadata: {
        ...this.create_default_metadata(),
        ...metadata_override
      }
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
