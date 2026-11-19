import { type SkinnedMesh } from 'three'
import { type SkeletonType } from '../../../enums/SkeletonType'

export interface AnimationImportContext {
  skinned_meshes_to_animate: SkinnedMesh[]
  skeleton_scale: number
  skeleton_type: SkeletonType
}
