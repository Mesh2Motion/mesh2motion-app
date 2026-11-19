import { type Quaternion } from 'three'

/**
 * Rest-pose snapshot of a live skeleton, taken before any cloning or retargeting
 * happens. Used as the reference every consistency check is measured against.
 */
export interface RestPoseSnapshot {
  bone_names: string[]
  local_rotations: Quaternion[]
  world_rotations: Quaternion[]
}
