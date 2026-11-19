import { type BoneRestRotation } from './BoneRestRotation'

/**
 * Bones needed to keep the upper body upright. Bones without a rotation track in a clip use their rest rotation.
 */
export interface UprightUpperBodyRig {
  upper_body_root: BoneRestRotation // e.g. spine_01
  // bones between the skeleton root and the upper body root, top first (e.g. pelvis)
  parent_chain: BoneRestRotation[]
}
