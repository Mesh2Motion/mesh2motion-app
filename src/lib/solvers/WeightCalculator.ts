import {
  Vector3, Raycaster, type Bone, Mesh,
  MeshBasicMaterial, DoubleSide,
  type BufferGeometry
} from 'three'

import { Utility } from '../Utilities.js'
import { SkeletonType } from '../enums/SkeletonType.js'

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
  private distance_to_bottom_of_hip: number = 0

  // each index will be a bone index. the value will be a list of vertex indices that belong to that bone
  private readonly bones_vertex_segmentation: number[][] = []

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
    this.cached_median_child_bone_positions = this.bones.map(b => this.midpoint_to_child(b))
    this.bones.forEach((b, idx) => this.bone_object_to_index.set(b, idx))
    this.distance_to_bottom_of_hip = this.calculate_distance_to_bottom_of_hip()
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
        // The root bone is only for global transform changes, so we won't assign it to any vertices
        if (bone.name === 'root') {
          return // skip the root bone and continue to the next bone
        }

        // hip bones should have custom logic for distance. If the distance is too far away we should ignore it
        // This will help with hips when left/right legs could be closer than knee bones
        if (this.skeleton_type === SkeletonType.Human &&
          (bone.name.includes('hips') || bone.name.includes('pelvis'))) {
          // if the intersection point is lower than the vertex position, that means the vertex is below
          // the hips area, and is part of the left or right leg...ignore that result
          if (this.distance_to_bottom_of_hip !== null && this.distance_to_bottom_of_hip < vertex_position.y) {
            return// this vertex is below our crotch area, so it cannot be part of our hips
          }
        }

        const distance: number = this.cached_median_child_bone_positions[idx].distanceTo(vertex_position)
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

  private midpoint_to_child (bone: Bone): Vector3 {
    const bone_position = Utility.world_position_from_object(bone)
    if (bone.children.length === 0) {
      return bone_position.clone()
    }
    // Assume first child is the relevant one
    const child = bone.children[0] as Bone
    const child_position = Utility.world_position_from_object(child)
    return new Vector3().lerpVectors(bone_position, child_position, 0.5)
  }

  // every vertex checks to see if it is below the hips area,
  // so do this calculation once and cache it for the lookup later
  private calculate_distance_to_bottom_of_hip (): number {
    const hip_bone_object: Bone | undefined = this.bones.find(b => {
      const name = b.name.toLowerCase()
      return name.includes('hips') || name.includes('pelvis')
    })
    if (hip_bone_object === undefined) {
      throw new Error('Hip bone not found')
    }
    const intesection_point: Vector3 | null = this.cast_intersection_ray_down_from_bone(hip_bone_object)

    // get the distance from the bone point to the intersection point
    const bone_index = this.bones.findIndex(b => b === hip_bone_object)
    const bone_position: Vector3 = this.cached_median_child_bone_positions[bone_index]

    let distance_to_bottom: number = intesection_point?.distanceTo(bone_position) ?? 0
    distance_to_bottom *= 1.1 // buffer zone to make sure to include vertices at intersection

    return distance_to_bottom
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
