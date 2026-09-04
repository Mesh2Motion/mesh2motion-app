import {
  Vector3,
  Bone,
  type BufferGeometry, type Line3
} from 'three'

import { Utility } from '../Utilities.js'

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
 */
export class ArmWeightCorrector {
  private readonly geometry: BufferGeometry
  private readonly bones: Bone[]
  private readonly arm_plane_offset: number
  private left_side_sign: number = 0
  private max_plausible_distance: number = Infinity
  private readonly segment_point_scratch: Vector3 = new Vector3()

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

    const arm_bone_indices = this.find_arm_bone_indices()
    if (arm_bone_indices.size === 0) { return }

    const fallback_bones = this.build_fallback_bone_candidates(arm_bone_indices)
    if (fallback_bones.length === 0) { return }

    this.left_side_sign = this.calculate_left_side_sign(fallback_bones)

    this.geometry.computeBoundingSphere()
    const bounding_sphere = this.geometry.boundingSphere
    if (bounding_sphere !== null && bounding_sphere.radius > 0) {
      this.max_plausible_distance = bounding_sphere.radius * 0.75
    }

    this.correct_vertex_weights(skin_indices, skin_weights, plane_x, arm_bone_indices, fallback_bones)
  }

  /**
   * Every upperarm bone plus all of its descendants (lowerarm, hand, fingers),
   * on both sides. Walking the hierarchy rather than matching a keyword list
   * gives exactly "upperarm and below" without needing to enumerate every
   * finger bone name, and it leaves the clavicle alone.
   */
  private find_arm_bone_indices (): Set<number> {
    const bone_to_index = new Map<Bone, number>()
    this.bones.forEach((bone, idx) => bone_to_index.set(bone, idx))

    const arm_bone_indices = new Set<number>()

    this.bones.forEach((bone) => {
      if (!bone.name.toLowerCase().includes('upperarm')) { return }

      bone.traverse((descendant) => {
        if (!(descendant instanceof Bone)) { return }
        const index = bone_to_index.get(descendant)
        if (index !== undefined) {
          arm_bone_indices.add(index)
        }
      })
    })

    return arm_bone_indices
  }

  /**
   * Bones a stripped vertex can be handed to: everything that isn't an arm bone,
   * minus the root (global transform only) and leaf/orientation bones, which the
   * solver never assigns vertices to.
   */
  private build_fallback_bone_candidates (arm_bone_indices: Set<number>): Array<{ index: number, midpoint: Vector3, segment: Line3, side: 'left' | 'right' | null }> {
    const candidates: Array<{ index: number, midpoint: Vector3, segment: Line3, side: 'left' | 'right' | null }> = []

    this.bones.forEach((bone, idx) => {
      if (arm_bone_indices.has(idx)) { return }
      if (bone.name === 'root' || Utility.is_leaf_bone(bone)) { return }
      candidates.push({ index: idx, midpoint: Utility.bone_midpoint_to_child(bone), segment: Utility.bone_segment(bone), side: Utility.bone_side(bone.name) })
    })

    return candidates
  }

  private calculate_left_side_sign (candidates: Array<{ index: number, midpoint: Vector3, segment: Line3, side: 'left' | 'right' | null }>): number {
    let left_x_sum = 0
    let left_count = 0
    for (const candidate of candidates) {
      if (candidate.side === 'left') {
        left_x_sum += candidate.midpoint.x
        left_count++
      }
    }
    return left_count > 0 ? Math.sign(left_x_sum) : 0
  }

  private correct_vertex_weights (
    skin_indices: number[],
    skin_weights: number[],
    plane_x: number,
    arm_bone_indices: Set<number>,
    fallback_bones: Array<{ index: number, midpoint: Vector3, segment: Line3, side: 'left' | 'right' | null }>
  ): void {
    const vertex_count = this.geometry.attributes.position.array.length / 3

    for (let i = 0; i < vertex_count; i++) {
      const vertex_position = new Vector3().fromBufferAttribute(this.geometry.attributes.position, i)

      // Math.abs is what makes this symmetric: one slider drives both arms,
      // regardless of which side of the model is +X.
      if (Math.abs(vertex_position.x) >= plane_x) { continue } // outboard of the plane, genuinely arm territory

      const offset = i * 4

      let has_arm_weight = false
      for (let j = 0; j < 4; j++) {
        if (arm_bone_indices.has(skin_indices[offset + j]) && skin_weights[offset + j] > 0) {
          has_arm_weight = true
          break
        }
      }
      if (!has_arm_weight) { continue }

      // no plausible replacement in range means the vertex keeps its arm
      // weight rather than being handed to something absurdly far away
      const replacement_bone_index = this.find_closest_fallback_bone(vertex_position, fallback_bones)
      if (replacement_bone_index === -1) { continue }

      // Take the weight away from every arm bone influencing this vertex.
      // Index 0 is the root bone, which never receives weights, so it doubles
      // as the "empty slot" marker (same convention as HeadWeightCorrector).
      let stolen_weight = 0
      let first_freed_slot = -1
      for (let j = 0; j < 4; j++) {
        if (!arm_bone_indices.has(skin_indices[offset + j])) { continue }
        if (skin_weights[offset + j] <= 0) { continue }

        stolen_weight += skin_weights[offset + j]
        skin_weights[offset + j] = 0
        skin_indices[offset + j] = 0
        if (first_freed_slot === -1) {
          first_freed_slot = j
        }
      }

      if (stolen_weight <= 0) { continue }

      // Merge into the replacement bone's existing slot if it already influences
      // this vertex, otherwise reuse one of the slots we just emptied.
      let target_slot = -1
      for (let j = 0; j < 4; j++) {
        if (skin_indices[offset + j] === replacement_bone_index && skin_weights[offset + j] > 0) {
          target_slot = j
          break
        }
      }

      if (target_slot === -1) {
        target_slot = first_freed_slot
        skin_indices[offset + target_slot] = replacement_bone_index
      }

      skin_weights[offset + target_slot] += stolen_weight

      this.normalize_vertex_weights(skin_weights, offset)
    }
  }

  private find_closest_fallback_bone (
    vertex_position: Vector3,
    fallback_bones: Array<{ index: number, midpoint: Vector3, segment: Line3, side: 'left' | 'right' | null }>
  ): number {
    const left_side_sign = this.left_side_sign
    const vertex_on_left = left_side_sign !== 0 && Math.sign(vertex_position.x) === left_side_sign

    let closest_distance = Infinity
    let closest_index = -1

    for (const candidate of fallback_bones) {
      if (candidate.side !== null && left_side_sign !== 0 && vertex_position.x !== 0) {
        if (vertex_on_left !== (candidate.side === 'left')) { continue }
      }

      const distance = candidate.segment
        .closestPointToPoint(vertex_position, true, this.segment_point_scratch)
        .distanceTo(vertex_position)
      if (distance < closest_distance) {
        closest_distance = distance
        closest_index = candidate.index
      }
    }

    if (closest_index === -1) {
      for (const candidate of fallback_bones) {
        const distance = candidate.segment
          .closestPointToPoint(vertex_position, true, this.segment_point_scratch)
          .distanceTo(vertex_position)
        if (distance < closest_distance) {
          closest_distance = distance
          closest_index = candidate.index
        }
      }
    }

    if (closest_distance > this.max_plausible_distance) {
      return -1
    }

    return closest_index
  }

  /**
   * Normalize weights for a single vertex to ensure they sum to 1.0
   */
  private normalize_vertex_weights (skin_weights: number[], offset: number): void {
    const total_weight =
      skin_weights[offset] +
      skin_weights[offset + 1] +
      skin_weights[offset + 2] +
      skin_weights[offset + 3]

    if (total_weight > 0) {
      skin_weights[offset] /= total_weight
      skin_weights[offset + 1] /= total_weight
      skin_weights[offset + 2] /= total_weight
      skin_weights[offset + 3] /= total_weight
    }
  }
}
