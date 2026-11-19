import { type Vector3, type Quaternion } from 'three'

/** A single bone's local transform, captured while the skeleton is known to be at rest. */
export interface BoneRestTransform {
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}
