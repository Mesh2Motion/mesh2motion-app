import { Bone, Box3, Quaternion, Vector3, type BufferGeometry, type Skeleton } from 'three'
import { Utility } from '../Utilities.ts'
import { BoneRules } from '../BoneRules.ts'

/**
 * SkeletonAutoFit
 *
 * Best-effort one-click helper that stretches each limb of the editable skeleton
 * so its tip joint reaches the matching extremity of the mesh ("map bone tips to
 * limb tips"). It is intentionally conservative: each limb is anchored at its
 * first bone (just inside the torso) and the chain out to the tip is rotated and
 * stretched toward the mesh extremity found in that limb's direction. Lateral
 * bends in the chain (e.g. a knee or an A-pose elbow) are preserved, and bones
 * hanging off the tip (fingers / toes) ride along rigidly.
 *
 * This will not produce a perfect rig on every model, but it gets the skeleton
 * far closer than a from-scratch manual placement, and every change is a single
 * undo step.
 */
export class SkeletonAutoFit {
  // accept mesh vertices within this half-angle of a limb's direction as candidates
  private static readonly CONE_COS = Math.cos((42 * Math.PI) / 180)

  // a leaf whose chain from the nearest branch point is shorter than this fraction
  // of the skeleton size is treated as detail (finger / toe / ear): its branching
  // parent (hand / foot) becomes the limb tip instead
  private static readonly MINOR_LEAF_FRACTION = 0.18

  // cap on vertices examined so very dense meshes stay responsive
  private static readonly MAX_SAMPLES = 40000

  /**
   * Fit the skeleton's limb tips to the mesh extremities.
   * @returns the number of limb tips that were moved.
   */
  public static fit (skeleton: Skeleton, geometries: BufferGeometry[]): number {
    const vertices = this.collect_world_vertices(geometries)
    if (vertices.length === 0) {
      return 0
    }

    const bones = skeleton.bones
    if (bones.length === 0) {
      return 0
    }

    const skeleton_size = this.skeleton_size(bones)
    const tips = this.find_limb_tips(bones, skeleton_size)

    let moved_count = 0
    for (const tip of tips) {
      if (this.fit_single_limb(tip, vertices)) {
        moved_count += 1
      }
    }

    if (moved_count > 0) {
      bones[0].updateWorldMatrix(true, true)
    }

    return moved_count
  }

  /** Stretch one limb so its tip reaches the matching mesh extremity. */
  private static fit_single_limb (tip: Bone, vertices: Vector3[]): boolean {
    const chain = this.chain_from_limb_start(tip)
    if (chain.length < 2) {
      return false
    }

    const chain_world = chain.map((bone) => Utility.world_position_from_object(bone))
    const root_world = chain_world[0]
    const tip_world = chain_world[chain_world.length - 1]

    const current_dir = tip_world.clone().sub(root_world)
    if (current_dir.lengthSq() < 1e-10) {
      return false
    }
    current_dir.normalize()

    const extremity = this.farthest_vertex_in_cone(vertices, root_world, current_dir)
    if (extremity === null) {
      return false
    }

    // aim the limb at the extremity, then pull the tip back by the length of any
    // bones hanging off it (fingers/toes) so those land on the extremity instead
    const aim_dir = extremity.clone().sub(root_world)
    const reach_to_extremity = aim_dir.length()
    if (reach_to_extremity < 1e-6) {
      return false
    }
    aim_dir.normalize()

    const subtree_reach = this.subtree_reach(tip)
    const new_tip_distance = Math.max(reach_to_extremity * 0.25, reach_to_extremity - subtree_reach)
    const new_tip_world = root_world.clone().addScaledVector(aim_dir, new_tip_distance)

    this.apply_chain(chain, chain_world, new_tip_world)
    return true
  }

  /**
   * Re-place the joints of a chain so the tip lands at new_tip_world. The first
   * bone stays fixed; the chain is rotated from its current axis onto the new
   * axis and uniformly stretched, preserving each joint's perpendicular offset
   * (so bends survive). World targets are converted to local space top-down.
   */
  private static apply_chain (chain: Bone[], chain_world: Vector3[], new_tip_world: Vector3): void {
    const root_world = chain_world[0]
    const old_tip_world = chain_world[chain_world.length - 1]

    const old_dir = old_tip_world.clone().sub(root_world)
    const old_length = old_dir.length()
    if (old_length < 1e-8) {
      return
    }
    old_dir.normalize()

    const new_axis = new_tip_world.clone().sub(root_world)
    const new_length = new_axis.length()
    if (new_length < 1e-8) {
      return
    }
    new_axis.normalize()

    const stretch = new_length / old_length
    const rotate_to_new = new Quaternion().setFromUnitVectors(old_dir, new_axis)

    // desired world position for each joint past the fixed root
    const desired_world: Vector3[] = [root_world.clone()]
    for (let i = 1; i < chain.length; i++) {
      const offset = chain_world[i].clone().sub(root_world)
      const along = offset.dot(old_dir)
      const axis_point = root_world.clone().addScaledVector(old_dir, along)
      const perpendicular = offset.clone().sub(axis_point.clone().sub(root_world))

      const new_point = root_world.clone()
        .addScaledVector(new_axis, along * stretch)
        .add(perpendicular.applyQuaternion(rotate_to_new))
      desired_world.push(new_point)
    }

    // write positions top-down so each parent's world matrix is current when we
    // convert the child's world target into local space
    chain[0].updateWorldMatrix(true, false)
    for (let i = 1; i < chain.length; i++) {
      const bone = chain[i]
      const parent = bone.parent
      if (parent === null) {
        continue
      }
      const local_position = parent.worldToLocal(desired_world[i].clone())
      bone.position.copy(local_position)
      bone.updateWorldMatrix(false, false)
    }
  }

  /**
   * Walk up from the tip to the first bone below the nearest branch point. That
   * bone (the limb start) anchors the limb. Returns [limb_start, ..., tip].
   */
  private static chain_from_limb_start (tip: Bone): Bone[] {
    const chain: Bone[] = [tip]
    let current = tip

    while (true) {
      const parent = current.parent
      if (parent === null || !this.is_deforming_bone(parent)) {
        break
      }
      // stop once the parent is a branch point: `current` is the limb start and
      // becomes the fixed anchor (chain[0]); the branch point is not included
      if (this.child_bones(parent).length >= 2) {
        break
      }
      chain.unshift(parent)
      current = parent
    }

    return chain
  }

  /**
   * Identify the limb-tip joints. Long terminal chains keep their leaf as the
   * tip; short detail chains (fingers/toes/ears) promote their branching parent
   * (hand/foot/head) to be the tip instead.
   */
  private static find_limb_tips (bones: Bone[], skeleton_size: number): Bone[] {
    const minor_threshold = skeleton_size * this.MINOR_LEAF_FRACTION
    const tips = new Set<Bone>()

    for (const bone of bones) {
      if (!this.is_deforming_bone(bone) || bone.name.toLowerCase() === 'root') {
        continue
      }
      if (this.child_bones(bone).length > 0) {
        continue // not a leaf
      }

      const branch = this.nearest_branch_ancestor(bone)
      const chain_length = this.world_distance_along_parents(bone, branch)

      if (branch !== null && chain_length < minor_threshold) {
        // detail leaf: use the branching parent (hand/foot) as the tip
        tips.add(branch)
      } else {
        tips.add(bone)
      }
    }

    return Array.from(tips)
  }

  /** Nearest ancestor with two or more deforming bone children, or null. */
  private static nearest_branch_ancestor (bone: Bone): Bone | null {
    let current: Bone | null = bone.parent as Bone | null
    while (current !== null && this.is_deforming_bone(current)) {
      if (this.child_bones(current).length >= 2) {
        return current
      }
      current = current.parent as Bone | null
    }
    return null
  }

  /** Summed world-space length of bone segments from `bone` up to `ancestor`. */
  private static world_distance_along_parents (bone: Bone, ancestor: Bone | null): number {
    let total = 0
    let current: Bone = bone
    while (current.parent !== null && current !== ancestor) {
      const parent = current.parent as Bone
      total += Utility.world_position_from_object(current)
        .distanceTo(Utility.world_position_from_object(parent))
      if (parent === ancestor || !this.is_deforming_bone(parent)) {
        break
      }
      current = parent
    }
    return total
  }

  /** Longest world-space distance from a bone to any of its descendant bones. */
  private static subtree_reach (bone: Bone): number {
    const origin = Utility.world_position_from_object(bone)
    let max_distance = 0
    bone.traverse((descendant) => {
      if (descendant === bone || !this.is_deforming_bone(descendant)) {
        return
      }
      const distance = origin.distanceTo(Utility.world_position_from_object(descendant as Bone))
      if (distance > max_distance) {
        max_distance = distance
      }
    })
    return max_distance
  }

  /**
   * Among the mesh vertices, return the one farthest from `apex` whose direction
   * is within the acceptance cone around `direction`. This is the tip of the limb
   * lying in that direction. Returns null if no vertex falls inside the cone.
   */
  private static farthest_vertex_in_cone (vertices: Vector3[], apex: Vector3, direction: Vector3): Vector3 | null {
    let best: Vector3 | null = null
    let best_projection = -Infinity

    for (const vertex of vertices) {
      const to_vertex = vertex.clone().sub(apex)
      const length = to_vertex.length()
      if (length < 1e-6) {
        continue
      }
      const projection = to_vertex.dot(direction)
      if (projection <= 0) {
        continue
      }
      // cosine of the angle between the vertex direction and the limb direction
      if (projection / length < this.CONE_COS) {
        continue
      }
      if (projection > best_projection) {
        best_projection = projection
        best = vertex
      }
    }

    return best === null ? null : best.clone()
  }

  /** Gather mesh vertex world positions, sampling with a stride for dense meshes. */
  private static collect_world_vertices (geometries: BufferGeometry[]): Vector3[] {
    let total_vertices = 0
    for (const geometry of geometries) {
      const position = geometry.getAttribute('position')
      if (position !== undefined) {
        total_vertices += position.count
      }
    }

    const stride = total_vertices > this.MAX_SAMPLES ? Math.ceil(total_vertices / this.MAX_SAMPLES) : 1
    const vertices: Vector3[] = []

    for (const geometry of geometries) {
      const position = geometry.getAttribute('position')
      if (position === undefined) {
        continue
      }
      // geometry from the load-model step is already in world space (identity
      // mesh transforms), so attribute values are world coordinates
      for (let i = 0; i < position.count; i += stride) {
        vertices.push(new Vector3().fromBufferAttribute(position, i))
      }
    }

    return vertices
  }

  /** Bounding-box diagonal of all bone world positions; a stable size estimate. */
  private static skeleton_size (bones: Bone[]): number {
    const box = new Box3()
    bones.forEach((bone) => {
      box.expandByPoint(Utility.world_position_from_object(bone))
    })
    const size = box.getSize(new Vector3())
    const diagonal = size.length()
    return diagonal > 1e-6 ? diagonal : 1
  }

  private static child_bones (bone: Bone): Bone[] {
    return bone.children.filter((child) => this.is_deforming_bone(child)) as Bone[]
  }

  /** A bone that is part of the visible deforming skeleton (not an IK/pole control). */
  private static is_deforming_bone (object: unknown): object is Bone {
    if (typeof object !== 'object' || object === null) {
      return false
    }
    if ((object as { isBone?: boolean }).isBone !== true) {
      return false
    }
    return !BoneRules.is_non_deforming_control_bone(object as Bone)
  }
}
