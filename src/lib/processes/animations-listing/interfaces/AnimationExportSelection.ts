import { type AnimationClip } from 'three'

export type AnimationMirrorExportMode = 'none' | 'mirrored' | 'both'

export interface AnimationExportSelection {
  animation_id: string // AnimationEntry id
  mirror_export_mode: AnimationMirrorExportMode
}

/** An export selection resolved to the clip that will be exported */
export interface AnimationClipExportSelection {
  clip: AnimationClip
  mirror_export_mode: AnimationMirrorExportMode
}
