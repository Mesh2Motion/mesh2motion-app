import { type AnimationClip, type SkinnedMesh } from 'three'

export interface ComposerExportData {
  clip: AnimationClip
  skinned_meshes: SkinnedMesh[]
}
