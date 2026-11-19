import { type Bone, type SkinnedMesh } from 'three'

/**
 * Information about a single disconnected bone hierarchy (root bone chain)
 * found inside an imported model.
 */
export interface RootBoneChain {
  root_bone: Bone
  bone_count: number
  skinned_meshes: SkinnedMesh[]
  vertex_count: number
}
