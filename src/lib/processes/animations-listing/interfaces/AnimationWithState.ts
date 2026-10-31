import { type AnimationClipMetadata } from './TransformedAnimationClipPair'
import { type AnimationMirrorExportMode } from './AnimationExportSelection'

export interface AnimationWithState {
  id: string // AnimationEntry id
  isChecked?: boolean
  mirror_export_mode?: AnimationMirrorExportMode
  name: string
  metadata: AnimationClipMetadata
}
