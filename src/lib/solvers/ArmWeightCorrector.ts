import {
  type Bone,
  type BufferGeometry
} from 'three'

import { Utility } from '../Utilities.js'
import { ArmWeightTransfer } from './ArmWeightTransfer.js'

/**
 * Pulls torso vertices back off the arm bones.
 *
 * When a character's arms hang down (A-pose or lower) the upperarm/lowerarm
 * bones run close to the ribcage and hips, so the closest-midpoint assignment
 * hands chest vertices to an arm bone. Lifting the arm then drags part of the
 * torso with it.
 *
 * This defines a vertical plane anchored at the shoulder joint's X position
 * (nudged in or out by the user's offset) and mirrored to both sides. Any
 * vertex *inboard* of that plane (|x| < plane_x) that was given to an arm bone
 * has that weight taken away and handed to its nearest non-arm bone.
 *
 * The "arm" set is the upperarm bone and everything below it. The clavicle is
 * deliberately excluded — it sits inboard of the shoulder joint and legitimately
 * covers part of the chest.
 *
 * See {@link DepthWeightCorrector} for the front/back counterpart, which catches
 * hair and clothing instead of torso.
 */
export class ArmWeightCorrector {
  private readonly geometry: BufferGeometry
  private readonly bones: Bone[]
  private readonly arm_plane_offset: number

  constructor (geometry: BufferGeometry, bones_master_data: Bone[], arm_plane_offset: number) {
    this.geometry = geometry
    this.bones = bones_master_data
    this.arm_plane_offset = arm_plane_offset
  }

  /**
   * Distance from the model's center line to the shoulder joint, which is where
   * the arm plane sits when the user's offset is zero.
   *
   * Shared with the edit-skeleton preview so the plane the user sees and the
   * plane the solver uses are derived the same way. The solver runs against a
   * clone of the edited armature, so both recompute this from bones rather than
   * passing an absolute coordinate around.
   *
   * @returns the absolute world X of the shoulder joint, or null if no arm bone was found
   */
  public static shoulder_anchor_x (bones: Bone[]): number | null {
    const shoulder_bone = ArmWeightCorrector.find_shoulder_bone(bones)
    if (shoulder_bone === undefined) {
      return null
    }
    return Math.abs(Utility.world_position_from_object(shoulder_bone).x)
  }

  /**
   * The bone the arm plane is anchored to. Human rigs name it `upperarm_l`;
   * the fallbacks cover rigs that use other conventions.
   */
  public static find_shoulder_bone (bones: Bone[]): Bone | undefined {
    const name_priority = ['upperarm', 'shoulder', 'arm']
    for (const keyword of name_priority) {
      const match = bones.find(bone => bone.name.toLowerCase().includes(keyword))
      if (match !== undefined) {
        return match
      }
    }
    return undefined
  }

  /**
   * Reassign arm-bone weights on vertices inboard of the arm plane.
   * Modifies skin_indices and skin_weights in place. Runs before smoothing so
   * the smoother blends the new torso/arm boundary instead of leaving a seam.
   */
  public apply_arm_weight_correction (skin_indices: number[], skin_weights: number[]): void {
    const anchor_x = ArmWeightCorrector.shoulder_anchor_x(this.bones)
    if (anchor_x === null) { return } // no arm bones on this rig, nothing to correct

    const plane_x = anchor_x + this.arm_plane_offset
    if (plane_x <= 0) { return } // plane pushed past the center line, would strip both arms entirely

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
      // Math.abs is what makes this symmetric: one slider drives both arms,
      // regardless of which side of the model is +X.
      (vertex_position) => Math.abs(vertex_position.x) < plane_x
    )
  }
}
