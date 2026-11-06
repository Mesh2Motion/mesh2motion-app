import {
  Vector3,
  type Bone,
  type BufferGeometry
} from 'three'

import { Utility } from '../Utilities.js'
import { BoneClassifier, BoneCategory } from './BoneClassifier.js'

/**
 * Reassigns "parent-side" vertices away from extremity bones.
 *
 * Extremity bones (fingers, toes) are short, so the closest-midpoint weight
 * assignment can grab vertices that actually sit *behind* the bone's start
 * joint — e.g. knuckle/palm vertices getting pulled onto a finger bone. When
 * that finger bends, those vertices deform along with it, which looks wrong.
 *
 * For each vertex owned by an extremity bone, this checks whether the vertex
 * lies on the parent side of the bone's start joint (a negative projection
 * along the bone's axis toward its child). If so, the vertex is reassigned to
 * the bone's parent, so the knuckle stays with the hand instead of the finger.
 */
export class ExtremityWeightCorrector {
  private readonly geometry: BufferGeometry
  private readonly bones: Bone[]
  private readonly classifier: BoneClassifier
  private readonly bone_to_index = new Map<Bone, number>()

  constructor (geometry: BufferGeometry, bones: Bone[]) {
    this.geometry = geometry
    this.bones = bones
    this.classifier = new BoneClassifier(bones)
    bones.forEach((bone, idx) => this.bone_to_index.set(bone, idx))
  }

  /**
   * Walks every vertex assigned to an extremity bone and reassigns it to the
   * bone's parent when it sits behind the bone's start joint.
   * Modifies skin_indices in place. Runs before smoothing so the corrected
   * assignments are what the smoother sees.
   */
  public apply_extremity_weight_correction (skin_indices: number[], skin_weights: number[]): void {
    const vertex_count = this.geometry.attributes.position.array.length / 3

    // Cache the bone axis (start joint + direction toward child) for each
    // extremity bone so we don't recompute it per vertex.
    const bone_axes = this.build_extremity_bone_axes()

    for (let i = 0; i < vertex_count; i++) {
      const offset = i * 4
      const bone_index = skin_indices[offset]

      const axis = bone_axes.get(bone_index)
      if (axis === undefined) continue // not an extremity bone (or has no valid parent)

      const vertex_position = new Vector3().fromBufferAttribute(this.geometry.attributes.position, i)
      const to_vertex = vertex_position.sub(axis.head)

      // Negative projection means the vertex is behind the start joint, on the
      // parent's side of the bone — reassign it to the parent.
      if (to_vertex.dot(axis.direction) < 0) {
        skin_indices[offset] = axis.parent_index
      }
    }
  }

  /**
   * Builds, for each extremity bone that has a parent bone in our list, the
   * start-joint position, the axis pointing toward its child, and the parent
   * bone index. Leaf extremity bones (no child) fall back to the direction
   * coming from the parent joint.
   */
  private build_extremity_bone_axes (): Map<number, { head: Vector3, direction: Vector3, parent_index: number }> {
    const axes = new Map<number, { head: Vector3, direction: Vector3, parent_index: number }>()

    this.bones.forEach((bone, idx) => {
      if (this.classifier.get_category(idx) !== BoneCategory.Extremity) return

      const parent = bone.parent
      if (parent === null) return
      const parent_index = this.bone_to_index.get(parent as Bone)
      if (parent_index === undefined) return // parent isn't a skinning bone (e.g. armature root)

      const head = Utility.world_position_from_object(bone)

      // Axis points from the start joint toward the child (down the finger).
      // For leaf bones with no child, use the direction away from the parent.
      let direction: Vector3
      const primary_child = Utility.primary_child_bone(bone)
      if (primary_child !== undefined) {
        const child_head = Utility.world_position_from_object(primary_child)
        direction = Utility.direction_between_points(head, child_head)
      } else {
        const parent_head = Utility.world_position_from_object(parent as Bone)
        direction = Utility.direction_between_points(parent_head, head)
      }

      axes.set(idx, { head, direction, parent_index })
    })

    return axes
  }
}
