import {
  Vector3, Raycaster, type Bone, Mesh,
  MeshBasicMaterial, DoubleSide,
  type BufferGeometry, type Line3
} from 'three'

import { Utility } from '../Utilities.js'
import { SkeletonType } from '../enums/SkeletonType.js'
import { RigConfig } from '../RigConfig.js'

/**
 * Handles the core bone-to-vertex weight calculation logic.
 * Determines which bone each vertex is closest to using midpoint-to-child distances,
 * with special handling for hip/pelvis regions.
 */
export class WeightCalculator {
  private readonly bones: Bone[]
  private readonly geometry: BufferGeometry
  private readonly skeleton_type: SkeletonType | null

  private cached_median_child_bone_positions: Vector3[] = []
  private readonly bone_object_to_index = new Map<Bone, number>()
  private pelvis_exclusion_bottom_y: number = -Infinity
  private cached_bone_sides: Array<'left' | 'right' | null> = []
  private cached_bone_segments: Line3[] = []
  private readonly segment_point_scratch: Vector3 = new Vector3()
  private mesh_center_x: number = 0
  private side_dead_band: number = 0
  private left_side_sign: number = 0

  // each index will be a bone index. the value will be a list of vertex indices that belong to that bone
  private readonly bones_vertex_segmentation: number[][] = []

  // bone indices that should never receive vertex weights: the root (global
  // transform only) and leaf/orientation bones (finger/toe/tail tips, etc.)
  private readonly skipped_bone_indices = new Set<number>()

  constructor (bones: Bone[], geometry: BufferGeometry, skeleton_type: SkeletonType | null) {
    this.bones = bones
    this.geometry = geometry
    this.skeleton_type = skeleton_type
  }

  /**
   * Pre-computes cached values needed for weight calculations.
   * Must be called before calculate_median_bone_weights.
   */
  public initialize_caches (): void {
    this.cached_median_child_bone_positions = this.bones.map(b => Utility.bone_midpoint_to_child(b))
    this.cached_bone_segments = this.bones.map(b => Utility.bone_segment(b))
    this.bones.forEach((b, idx) => this.bone_object_to_index.set(b, idx))

    // The root bone is only for global transform changes, and leaf/orientation
    // bones exist only to orient their parent — neither should be assigned any
    // vertices. Compute the skip set once instead of checking names per vertex.
    this.bones.forEach((b, idx) => {
      if (b.name === 'root' || Utility.is_leaf_bone(b)) {
        this.skipped_bone_indices.add(idx)
      }
    })

    this.pelvis_exclusion_bottom_y = this.calculate_pelvis_exclusion_bottom_y()

    this.cached_bone_sides = this.bones.map(b => Utility.bone_side(b.name))
    this.geometry.computeBoundingBox()
    const bounding_box = this.geometry.boundingBox
    if (bounding_box !== null) {
      this.mesh_center_x = (bounding_box.min.x + bounding_box.max.x) / 2
      this.side_dead_band = (bounding_box.max.x - bounding_box.min.x) * 0.05
    }

    let left_x_offset_sum = 0
    let left_bone_count = 0
    this.cached_bone_sides.forEach((side, idx) => {
      if (side === 'left') {
        left_x_offset_sum += this.cached_median_child_bone_positions[idx].x - this.mesh_center_x
        left_bone_count++
      }
    })
    this.left_side_sign = left_bone_count > 0 ? Math.sign(left_x_offset_sum) : 0
  }

  public get_cached_median_child_bone_positions (): Vector3[] {
    return this.cached_median_child_bone_positions
  }

  /**
   * Assigns the closest bone to each vertex.
   * Modifies the skin_indices and skin_weights arrays in place.
   */
  public calculate_median_bone_weights (skin_indices: number[], skin_weights: number[]): void {
    const vertex_count = this.geometry.attributes.position.array.length / 3

    for (let i = 0; i < vertex_count; i++) {
      const vertex_position: Vector3 = new Vector3().fromBufferAttribute(this.geometry.attributes.position, i)
      let closest_bone_distance: number = 1000 // arbitrary large number to start with
      let closest_bone_index: number = 0

      this.bones.forEach((bone, idx) => {
        // Skip the root bone (global transform only) and leaf/orientation bones.
        // See skipped_bone_indices, computed once in initialize_caches.
        if (this.skipped_bone_indices.has(idx)) {
          return
        }

        // vertices below the crotch belong to the left or right leg, so the
        // hip/pelvis bone should not compete for them
        if (this.skeleton_type === SkeletonType.Human &&
          (bone.name.includes('hips') || bone.name.includes('pelvis'))) {
          if (vertex_position.y < this.pelvis_exclusion_bottom_y) {
            return
          }
        }

        // a sided bone (thigh_l, hand_r, ...) can never claim a vertex that is
        // clearly on the other half of the body
        const bone_side = this.cached_bone_sides[idx]
        if (bone_side !== null && this.left_side_sign !== 0) {
          const vertex_offset_x = vertex_position.x - this.mesh_center_x
          if (Math.abs(vertex_offset_x) > this.side_dead_band) {
            const vertex_on_left = Math.sign(vertex_offset_x) === this.left_side_sign
            if (vertex_on_left !== (bone_side === 'left')) {
              return
            }
          }
        }

        const distance: number = this.cached_bone_segments[idx]
          .closestPointToPoint(vertex_position, true, this.segment_point_scratch)
          .distanceTo(vertex_position)
        if (distance < closest_bone_distance) {
          closest_bone_distance = distance
          closest_bone_index = idx
        }
      })

      this.bones_vertex_segmentation[closest_bone_index] ??= [] // Initialize the array if it doesn't exist
      this.bones_vertex_segmentation[closest_bone_index].push(i)

      // assign to final weights. closest bone is always 100% weight
      skin_indices.push(closest_bone_index, 0, 0, 0)
      skin_weights.push(1.0, 0, 0, 0)
    }
  }

  // every vertex checks to see if it is below the hips area,
  // so do this calculation once and cache it for the lookup later
  private calculate_pelvis_exclusion_bottom_y (): number {

    const position_tracking_bone_name: string = RigConfig.by_skeleton_type(this.skeleton_type as SkeletonType)?.position_tracking_bone_name || 'UNKNOWN POSITION BONE'

    let position_tracking_bone_object: Bone | undefined = this.bones.find(b => {
      const name = b.name.toLowerCase()
      return name.includes(position_tracking_bone_name.toLowerCase())
    })

    if (position_tracking_bone_object === undefined) {
        throw new Error('Position tracking bone not found')
    }

    const intesection_point: Vector3 | null = this.cast_intersection_ray_down_from_bone(position_tracking_bone_object)

    if (intesection_point === null) {
      return -Infinity
    }

    const bone_index = this.bones.findIndex(b => b === position_tracking_bone_object)
    const bone_position: Vector3 = this.cached_median_child_bone_positions[bone_index]

    // buffer zone to make sure to include vertices at intersection
    const buffer: number = (bone_position.y - intesection_point.y) * 0.1

    return intesection_point.y - buffer
  }

  private cast_intersection_ray_down_from_bone (bone: Bone): Vector3 | null {
    const raycaster = new Raycaster()

    // Set the ray's origin to the bone's world position
    const bone_index = this.bones.findIndex(b => b === bone)
    const bone_position = this.cached_median_child_bone_positions[bone_index]

    // Direction is straight down to find the pevlis "gap"
    raycaster.set(bone_position, new Vector3(0, -1, 0))

    // Create a temporary mesh from this.geometry for raycasting
    const temp_mesh = new Mesh(this.geometry, new MeshBasicMaterial())
    temp_mesh.material.side = DoubleSide // DoubleSide is a THREE.js constant

    // Perform the intersection test
    const recursive_check_child_objects: boolean = false
    const intersections = raycaster.intersectObject(temp_mesh, recursive_check_child_objects)

    if (intersections.length > 0) {
      // Return the position of the first intersection
      return intersections[0].point
    }

    // Return null if no intersection is found
    return null
  }
}
