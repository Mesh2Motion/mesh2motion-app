import {
  type Bone,
  type BufferGeometry
} from 'three'

import { Utility } from '../Utilities.js'
import { ArmWeightCorrector } from './ArmWeightCorrector.js'
import { ArmWeightTransfer } from './ArmWeightTransfer.js'

/**
 * Pulls hair (and anything else standing off the front or back of the body) off
 * the arm bones.
 *
 * The closest-midpoint pass measures straight-line distance, so a ponytail
 * hanging down the back or long bangs down the chest can end up nearer to an
 * upperarm bone than to any spine bone. Raising the arm then drags the hair
 * along with it.
 *
 * {@link ArmWeightCorrector} does not catch this: the hair hangs at roughly the
 * same X as the arm, so it is outboard of the arm plane and reads as genuine arm
 * territory. What separates the two is *depth* - arms hang beside the ribcage at
 * about the same Z as the spine, while the hair sits well in front of or behind
 * it. So this puts a pair of planes at a fixed distance either side of the
 * shoulder joint's Z, and any vertex beyond them that was given to an arm bone
 * has that weight taken away and handed to its nearest non-arm bone.
 *
 * That nearest non-arm bone is the head or neck for hair around the shoulders,
 * and a spine bone for hair that reaches further down - which is how hair
 * without its own bones is usually weighted by hand anyway.
 */
export class DepthWeightCorrector {
  private readonly geometry: BufferGeometry
  private readonly bones: Bone[]
  private readonly depth_plane_distance: number

  constructor (geometry: BufferGeometry, bones_master_data: Bone[], depth_plane_distance: number) {
    this.geometry = geometry
    this.bones = bones_master_data
    this.depth_plane_distance = depth_plane_distance
  }

  /**
   * The depth the front and back planes are measured out from, which is the
   * shoulder joint's Z - the depth the arms actually hang at.
   *
   * Shared with the edit-skeleton preview so the planes the user sees and the
   * planes the solver uses are derived the same way, exactly as
   * {@link ArmWeightCorrector.shoulder_anchor_x} is for the arm plane.
   *
   * @returns the world Z of the shoulder joint, or null if no arm bone was found
   */
  public static shoulder_anchor_z (bones: Bone[]): number | null {
    const shoulder_bone = ArmWeightCorrector.find_shoulder_bone(bones)
    if (shoulder_bone === undefined) {
      return null
    }
    return Utility.world_position_from_object(shoulder_bone).z
  }

  /**
   * Reassign arm-bone weights on vertices in front of the front plane or behind
   * the back plane. Modifies skin_indices and skin_weights in place. Runs before
   * smoothing so the smoother blends the new boundary instead of leaving a seam.
   */
  public apply_depth_weight_correction (skin_indices: number[], skin_weights: number[]): void {
    if (this.depth_plane_distance <= 0) { return } // planes collapsed onto the body, would strip both arms entirely

    const anchor_z = DepthWeightCorrector.shoulder_anchor_z(this.bones)
    if (anchor_z === null) { return } // no arm bones on this rig, nothing to correct

    const arm_bone_indices = ArmWeightTransfer.find_arm_bone_indices(this.bones)
    if (arm_bone_indices.size === 0) { return }

    const fallback_bones = ArmWeightTransfer.build_fallback_bone_candidates(this.bones, arm_bone_indices)
    if (fallback_bones.length === 0) { return }

    ArmWeightTransfer.strip_arm_weights(
      this.geometry,
      skin_indices,
      skin_weights,
      arm_bone_indices,
      fallback_bones,
      // One slider drives both planes, so a model with hair on only one side
      // still gets a symmetric, predictable boundary.
      (vertex_position) => Math.abs(vertex_position.z - anchor_z) > this.depth_plane_distance
    )
  }
}
