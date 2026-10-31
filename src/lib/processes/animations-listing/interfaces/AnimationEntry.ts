import { type AnimationClipMetadata, type TransformedAnimationClipPair } from './TransformedAnimationClipPair'

export type AnimationEntryState = 'unloaded' | 'loading' | 'loaded' | 'error'

/**
 * One animation in the listing. Library animations are listed from the asset manifest
 * before their GLB file is downloaded, so the clip is only available once state is 'loaded'.
 */
export interface AnimationEntry {
  /** Stable id: the GLB file path for library animations, generated for custom imports */
  id: string
  name: string
  metadata: AnimationClipMetadata
  /** GLB file path relative to the static root. Undefined for custom imports, which start out loaded */
  file?: string
  state: AnimationEntryState
  clip_pair: TransformedAnimationClipPair | null
}
