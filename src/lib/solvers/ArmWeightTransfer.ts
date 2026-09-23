import { Vector3, Bone, type BufferGeometry } from 'three'

import { Utility } from '../Utilities.js'

/** A bone a stripped vertex can be handed to, with the point distance is measured from. */
export interface FallbackBone {
  index: number
  midpoint: Vector3
}

/**
 * The machinery shared by the plane-based arm corrections.
 *
 * Both {@link ArmWeightCorrector} and {@link DepthWeightCorrector} do the same
 * thing - take weight away from arm bones on vertices that are not really arm,
 * and hand it to the nearest bone that is not part of an arm. They differ only
 * in which side of a plane counts as "not really arm", so that predicate is the
 * one thing passed in.
 */
export class ArmWeightTransfer {
  /**
   * Every upperarm bone plus all of its descendants (lowerarm, hand, fingers),
   * on both sides. Walking the hierarchy rather than matching a keyword list
   * gives exactly "upperarm and below" without needing to enumerate every
   * finger bone name, and it leaves the clavicle alone.
   */
  public static find_arm_bone_indices (bones: Bone[]): Set<number> {
    const bone_to_index = new Map<Bone, number>()
    bones.forEach((bone, idx) => bone_to_index.set(bone, idx))

    const arm_bone_indices = new Set<number>()

    bones.forEach((bone) => {
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
  public static build_fallback_bone_candidates (bones: Bone[], arm_bone_indices: Set<number>): FallbackBone[] {
    const candidates: FallbackBone[] = []

    bones.forEach((bone, idx) => {
      if (arm_bone_indices.has(idx)) { return }
      if (bone.name === 'root' || Utility.is_leaf_bone(bone)) { return }
      candidates.push({ index: idx, midpoint: Utility.bone_midpoint_to_child(bone) })
    })

    return candidates
  }

  /**
   * Takes arm-bone weight off every vertex the predicate selects and gives it to
   * that vertex's nearest fallback bone. Modifies skin_indices and skin_weights
   * in place.
   *
   * @param is_outside_arm_territory decides, from a vertex's position, whether it
   * should have been given to an arm bone at all
   */
  public static strip_arm_weights (
    geometry: BufferGeometry,
    skin_indices: number[],
    skin_weights: number[],
    arm_bone_indices: Set<number>,
    fallback_bones: FallbackBone[],
    is_outside_arm_territory: (vertex_position: Vector3) => boolean
  ): void {
    const vertex_count = geometry.attributes.position.array.length / 3

    for (let i = 0; i < vertex_count; i++) {
      const vertex_position = new Vector3().fromBufferAttribute(geometry.attributes.position, i)

      if (!is_outside_arm_territory(vertex_position)) { continue } // genuinely arm territory

      const offset = i * 4

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

      const replacement_bone_index = this.find_closest_fallback_bone(vertex_position, fallback_bones)

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

  private static find_closest_fallback_bone (vertex_position: Vector3, fallback_bones: FallbackBone[]): number {
    let closest_distance = Infinity
    let closest_index = fallback_bones[0].index

    for (const candidate of fallback_bones) {
      const distance = candidate.midpoint.distanceTo(vertex_position)
      if (distance < closest_distance) {
        closest_distance = distance
        closest_index = candidate.index
      }
    }

    return closest_index
  }

  /**
   * Normalize weights for a single vertex to ensure they sum to 1.0
   */
  public static normalize_vertex_weights (skin_weights: number[], offset: number): void {
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
