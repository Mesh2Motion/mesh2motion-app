import { type SkeletonType } from '../../enums/SkeletonType.ts'
import { RigConfig } from '../../RigConfig.ts'
import { type AnimationLoader } from './AnimationLoader.ts'
import { AnimationUtility } from './AnimationUtility.ts'
import { type AnimationEntry } from './interfaces/AnimationEntry.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

export interface AnimationLibraryLoadProgress {
  loaded: number
  total: number
}

/**
 * Every animation available for the current rig. Library animations are listed from the
 * asset manifest right away, and each GLB file is only downloaded the first time that
 * animation is played or exported. Custom imports are added already loaded.
 *
 * The owner provides the display transform (mirroring, arm extension, etc.), so clips that
 * load later are warped the same way as clips that were already loaded.
 */
export class AnimationLibrary extends EventTarget {
  private static readonly max_concurrent_loads: number = 6

  private entries: AnimationEntry[] = []
  private readonly loads_in_flight = new Map<string, Promise<AnimationEntry>>()
  private skeleton_scale: number = 1.0
  private custom_import_count: number = 0
  private display_transform: (clip_pairs: TransformedAnimationClipPair[]) => void = () => {}

  constructor (private readonly animation_loader: AnimationLoader) {
    super()
  }

  /**
   * Lists every animation for the rig from the asset manifest. Nothing is downloaded yet.
   * @param skeleton_scale Scale factor applied to position keyframes as each clip loads
   */
  public reset (skeleton_type: SkeletonType, skeleton_scale: number): void {
    this.clear()
    this.skeleton_scale = skeleton_scale
    this.animation_loader.set_skeleton_type(skeleton_type)

    this.entries = RigConfig.animations_for(skeleton_type).map((animation): AnimationEntry => ({
      id: animation.file,
      name: animation.name,
      file: animation.file,
      metadata: { source_type: 'default-library', tags: animation.tags },
      state: 'unloaded',
      clip_pair: null
    }))
    this.sort_entries()
  }

  public clear (): void {
    this.entries = []
    this.loads_in_flight.clear()
    this.custom_import_count = 0
  }

  /** All animations sorted by name, loaded or not */
  public all (): AnimationEntry[] {
    return this.entries
  }

  public find (id: string): AnimationEntry | undefined {
    return this.entries.find(entry => entry.id === id)
  }

  public set_display_transform (transform: (clip_pairs: TransformedAnimationClipPair[]) => void): void {
    this.display_transform = transform
  }

  /**
   * Resets every loaded display clip to its original clip, then re-applies the display transform.
   * Call this whenever a setting used by the display transform changes.
   */
  public rebuild_display_clips (): void {
    const clip_pairs = this.entries.flatMap(entry => entry.clip_pair !== null ? [entry.clip_pair] : [])
    clip_pairs.forEach((clip_pair) => {
      clip_pair.display_animation_clip = AnimationUtility.deep_clone_animation_clip(clip_pair.original_animation_clip)
    })
    this.display_transform(clip_pairs)
  }

  /**
   * Adds clips that are already loaded, like custom imports.
   * @returns the new entries
   */
  public add_loaded_clips (clip_pairs: TransformedAnimationClipPair[]): AnimationEntry[] {
    const new_entries = clip_pairs.map((clip_pair): AnimationEntry => {
      this.custom_import_count++
      return {
        id: `custom-import-${this.custom_import_count}`,
        name: clip_pair.display_animation_clip.name,
        metadata: clip_pair.metadata,
        state: 'loaded',
        clip_pair
      }
    })

    // the loader hands back display clips that are untransformed copies of the original
    this.display_transform(clip_pairs)
    this.entries.push(...new_entries)
    this.sort_entries()
    return new_entries
  }

  /**
   * Downloads the animation if it is not loaded yet. Loading the same animation
   * again while it is still downloading reuses the same request.
   */
  public async load (id: string): Promise<AnimationEntry> {
    const entry = this.find(id)
    if (entry === undefined) {
      throw new Error(`Unknown animation: ${id}`)
    }

    if (entry.state === 'loaded') {
      return entry
    }

    let load_promise = this.loads_in_flight.get(id)
    if (load_promise === undefined) {
      load_promise = this.load_entry(entry)
      this.loads_in_flight.set(id, load_promise)
    }

    try {
      return await load_promise
    } finally {
      // the library may have been reset and started a new load for the same id
      if (this.loads_in_flight.get(id) === load_promise) {
        this.loads_in_flight.delete(id)
      }
    }
  }

  /**
   * Downloads several animations, a few at a time. Dispatches 'progress'
   * events with AnimationLibraryLoadProgress as each one finishes.
   * @returns the entries in the same order as the ids
   */
  public async load_many (ids: string[]): Promise<AnimationEntry[]> {
    const queue = [...ids]
    let loaded_count = 0
    this.dispatch_progress(loaded_count, ids.length)

    const load_next = async (): Promise<void> => {
      let id = queue.shift()
      while (id !== undefined) {
        await this.load(id)
        loaded_count++
        this.dispatch_progress(loaded_count, ids.length)
        id = queue.shift()
      }
    }

    const worker_count = Math.min(AnimationLibrary.max_concurrent_loads, ids.length)
    await Promise.all(Array.from({ length: worker_count }, async () => { await load_next() }))

    return ids.map(id => this.find(id)).filter((entry): entry is AnimationEntry => entry !== undefined)
  }

  private async load_entry (entry: AnimationEntry): Promise<AnimationEntry> {
    if (entry.file === undefined) {
      throw new Error(`Animation ${entry.name} has no file to load`)
    }

    entry.state = 'loading'
    try {
      const clip_pairs = await this.animation_loader.load_animation_file(entry.file, this.skeleton_scale, entry.metadata)
      if (clip_pairs.length === 0) {
        throw new Error(`No animation found in ${entry.file}`)
      }

      entry.clip_pair = clip_pairs[0]
      this.display_transform([entry.clip_pair])
      entry.state = 'loaded'
      return entry
    } catch (error) {
      entry.state = 'error'
      throw error
    }
  }

  private sort_entries (): void {
    this.entries.sort((a: AnimationEntry, b: AnimationEntry) => {
      if (a.name < b.name) { return -1 }
      if (a.name > b.name) { return 1 }
      return 0
    })
  }

  private dispatch_progress (loaded: number, total: number): void {
    this.dispatchEvent(new CustomEvent<AnimationLibraryLoadProgress>('progress', { detail: { loaded, total } }))
  }
}
