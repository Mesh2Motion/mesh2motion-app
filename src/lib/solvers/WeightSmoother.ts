import {
  Bone,
  type BufferAttribute,
  type BufferGeometry,
  Vector3
} from 'three'

import { BoneClassifier } from './BoneClassifier.js'
import { Utility } from '../Utilities.js'

/**
 * Smooths skin weight boundaries between bone influences using vertex adjacency.
 * Applies different smoothing strategies based on bone category:
 * - Torso: wider multi-ring gradient for voluminous areas
 * - Limbs: directional smoothing toward child bone only
 * - Extremities: minimal single-ring smoothing
 */
export class WeightSmoother {
  private readonly geometry: BufferGeometry
  private readonly bones: Bone[]
  private readonly classifier: BoneClassifier

  constructor (geometry: BufferGeometry, bones: Bone[]) {
    this.geometry = geometry
    this.bones = bones
    this.classifier = new BoneClassifier(bones)
  }

  private geometry_vertex_count (): number {
    return this.geometry.attributes.position.array.length / 3
  }

  /**
   * Smooths skin weights at bone boundaries with category-aware behavior.
   * - Torso boundaries get multi-ring gradient smoothing (3 rings, tapering weights)
   * - Limb boundaries get directional child-only smoothing
   * - Other boundaries get standard single-ring 50/50 blending
   */
  public smooth_bone_weight_boundaries (skin_indices: number[], skin_weights: number[]): void {
    const adjacency = this.build_vertex_adjacency()
    const position_to_indices = this.build_position_map()

    // Pass 1: Identify all boundary vertex pairs and classify them
    const boundary_pairs = this.find_boundary_pairs(skin_indices, skin_weights, adjacency)

    // Pass 2: Apply torso multi-ring smoothing
    this.apply_torso_smoothing(skin_indices, skin_weights, adjacency, position_to_indices, boundary_pairs)

    // Pass 3: Apply limb directional smoothing
    this.apply_limb_smoothing(skin_indices, skin_weights, position_to_indices, boundary_pairs)

    // Pass 4: Apply standard smoothing for remaining boundaries
    this.apply_standard_smoothing(skin_indices, skin_weights, adjacency, position_to_indices, boundary_pairs)

    // Pass 4.5: Add an extra blend through the central pelvis basin so
    // buttocks/glute vertices stay connected to both pelvis and upper thighs.
    this.apply_pelvis_basin_smoothing(skin_indices, skin_weights, position_to_indices)

    // Pass 5: Apply an along-the-bone gradient so joints stay soft,
    // while the center of each bone remains dominant.
    this.apply_axial_gradient_smoothing(skin_indices, skin_weights, position_to_indices)
  }

  private apply_axial_gradient_smoothing (
    skin_indices: number[],
    skin_weights: number[],
    position_to_indices: Map<string, number[]>
  ): void {
    const vertex_count = this.geometry_vertex_count()
    const processed_vertices = new Set<number>()

    for (let vertex = 0; vertex < vertex_count; vertex++) {
      if (processed_vertices.has(vertex)) {
        continue
      }

      const offset = vertex * 4
      const primary_bone = skin_indices[offset]
      if (primary_bone === undefined || primary_bone === 0 && this.bones[0]?.name === 'root') {
        continue
      }

      const gradient_data = this.get_axial_gradient_data(primary_bone)
      if (gradient_data === null) {
        continue
      }

      const shared_vertices = this.get_shared_vertices(vertex, position_to_indices)
      shared_vertices.forEach((shared_vertex) => processed_vertices.add(shared_vertex))

      for (const shared_vertex of shared_vertices) {
        if (!this.can_apply_axial_gradient_to_vertex(shared_vertex, skin_indices, skin_weights, gradient_data)) {
          continue
        }

        const target_weights = this.calculate_axial_gradient_weights(shared_vertex, gradient_data)
        if (target_weights === null) {
          continue
        }

        this.set_vertex_weights(
          skin_indices,
          skin_weights,
          shared_vertex,
          target_weights.primary_bone,
          target_weights.secondary_bone,
          target_weights.primary_weight,
          target_weights.secondary_weight
        )
      }
    }
  }

  private apply_pelvis_basin_smoothing (
    skin_indices: number[],
    skin_weights: number[],
    position_to_indices: Map<string, number[]>
  ): void {
    const pelvis_data = this.get_pelvis_basin_data()
    if (pelvis_data === null) {
      return
    }

    const processed_vertices = new Set<number>()
    const vertex_count = this.geometry_vertex_count()

    for (let vertex = 0; vertex < vertex_count; vertex++) {
      if (processed_vertices.has(vertex)) {
        continue
      }

      const shared_vertices = this.get_shared_vertices(vertex, position_to_indices)
      shared_vertices.forEach((shared_vertex) => processed_vertices.add(shared_vertex))

      for (const shared_vertex of shared_vertices) {
        const basin_blend = this.calculate_pelvis_basin_blend(shared_vertex, skin_indices, pelvis_data)
        if (basin_blend === null) {
          continue
        }

        this.merge_vertex_weights(
          skin_indices,
          skin_weights,
          shared_vertex,
          basin_blend.primary_bone,
          basin_blend.secondary_bone,
          basin_blend.secondary_weight
        )
      }
    }
  }

  /**
   * A boundary pair tracks two adjacent vertices assigned to different bones.
   */
  private find_boundary_pairs (
    skin_indices: number[],
    skin_weights: number[],
    adjacency: Array<Set<number>>
  ): BoundaryPair[] {
    const vertex_count = this.geometry_vertex_count()
    const visited = new Set<string>()
    const pairs: BoundaryPair[] = []

    for (let i = 0; i < vertex_count; i++) {
      const offset_a = i * 4
      const bone_a = skin_indices[offset_a]
      const weight_a = skin_weights[offset_a]
      if (weight_a !== 1.0) continue

      for (const j of adjacency[i]) {
        const offset_b = j * 4
        const bone_b = skin_indices[offset_b]
        const weight_b = skin_weights[offset_b]
        if (bone_a === bone_b || weight_b !== 1.0) continue

        const key = i < j ? `${i},${j}` : `${j},${i}`
        if (visited.has(key)) continue
        visited.add(key)

        let smoothing_type: SmoothingType = SmoothingType.Standard
        if (this.is_special_socket_boundary(bone_a, bone_b)) {
          smoothing_type = SmoothingType.Socket
        } else if (this.classifier.is_torso_boundary(bone_a, bone_b)) {
          smoothing_type = SmoothingType.Torso
        } else if (this.classifier.is_limb_boundary(bone_a, bone_b)) {
          smoothing_type = SmoothingType.Limb
        }

        pairs.push({ vertex_a: i, vertex_b: j, bone_a, bone_b, smoothing_type })
      }
    }

    return pairs
  }

  /**
   * Torso smoothing: expands the blend region outward from the boundary
   * by multiple rings, applying tapering weight gradients.
   * This creates a wider, more natural transition for voluminous areas.
   */
  private apply_torso_smoothing (
    skin_indices: number[],
    skin_weights: number[],
    adjacency: Array<Set<number>>,
    position_to_indices: Map<string, number[]>,
    pairs: BoundaryPair[]
  ): void {
    const torso_pairs = pairs.filter(p => p.smoothing_type === SmoothingType.Torso || p.smoothing_type === SmoothingType.Socket)
    if (torso_pairs.length === 0) return

    // Collect all boundary vertices and their bone assignments
    const boundary_vertices = new Set<number>()
    for (const pair of torso_pairs) {
      boundary_vertices.add(pair.vertex_a)
      boundary_vertices.add(pair.vertex_b)
    }

    const processed = new Set<number>()

    // Apply blending ring by ring outward from the boundary
    let current_ring_vertices = new Set<number>()

    // First, blend the direct boundary pairs (ring 0)
    for (const pair of torso_pairs) {
      const ring_weights = this.get_torso_ring_weights(pair)
      this.blend_vertex_pair(skin_indices, skin_weights, position_to_indices,
        pair.vertex_a, pair.vertex_b, pair.bone_a, pair.bone_b, ring_weights[0])

      if (pair.smoothing_type === SmoothingType.Socket) {
        this.expand_boundary_side_multiple_rings(
          skin_indices,
          skin_weights,
          adjacency,
          position_to_indices,
          pair.vertex_a,
          pair.bone_a,
          pair.bone_b,
          ring_weights.slice(1)
        )
        this.expand_boundary_side_multiple_rings(
          skin_indices,
          skin_weights,
          adjacency,
          position_to_indices,
          pair.vertex_b,
          pair.bone_b,
          pair.bone_a,
          ring_weights.slice(1)
        )
      }

      processed.add(pair.vertex_a)
      processed.add(pair.vertex_b)
      current_ring_vertices.add(pair.vertex_a)
      current_ring_vertices.add(pair.vertex_b)
    }

    const max_ring_count = torso_pairs.reduce((max_count, pair) => {
      return Math.max(max_count, this.get_torso_ring_weights(pair).length)
    }, 0)

    for (let ring = 1; ring < max_ring_count; ring++) {
      const next_ring_vertices = new Set<number>()

      for (const pair of torso_pairs) {
        const ring_weights = this.get_torso_ring_weights(pair)
        const secondary_weight = ring_weights[ring]
        if (secondary_weight === undefined) {
          continue
        }

        const pair_vertices = [pair.vertex_a, pair.vertex_b]
        for (const vertex_idx of pair_vertices) {
          if (!current_ring_vertices.has(vertex_idx)) {
            continue
          }

          const offset = vertex_idx * 4
          const primary_bone = skin_indices[offset]

          for (const neighbor of adjacency[vertex_idx]) {
            if (processed.has(neighbor)) continue

            const neighbor_offset = neighbor * 4
            const neighbor_bone = skin_indices[neighbor_offset]

            if (neighbor_bone !== primary_bone) continue
            if (skin_weights[neighbor_offset] !== 1.0) continue

            const other_bone = this.find_neighbor_bone_from_boundary(vertex_idx, skin_indices, primary_bone)
            if (other_bone === -1) continue

            const shared = this.get_shared_vertices(neighbor, position_to_indices)
            for (const idx of shared) {
              this.merge_vertex_weights(skin_indices, skin_weights, idx, neighbor_bone, other_bone, secondary_weight)
            }

            processed.add(neighbor)
            next_ring_vertices.add(neighbor)
          }
        }
      }

      current_ring_vertices = next_ring_vertices
    }
  }

  /**
   * Limb smoothing: only blends in the direction of the child bone.
   * When bone A is the parent of bone B, only vertices on the B side
   * get blended. This prevents elbow movement from deforming the bicep.
   */
  private apply_limb_smoothing (
    skin_indices: number[],
    skin_weights: number[],
    position_to_indices: Map<string, number[]>,
    pairs: BoundaryPair[]
  ): void {
    const limb_pairs = pairs.filter(p => p.smoothing_type === SmoothingType.Limb)

    for (const pair of limb_pairs) {
      // Determine parent→child relationship
      const a_is_parent = this.is_parent_of(pair.bone_a, pair.bone_b)
      const b_is_parent = this.is_parent_of(pair.bone_b, pair.bone_a)

      if (a_is_parent) {
        // bone_a is parent, bone_b is child
        // Only blend the child-side vertex (vertex_b) toward parent
        // The parent-side vertex (vertex_a) stays at 100%
        this.blend_single_side(skin_indices, skin_weights, position_to_indices,
          pair.vertex_b, pair.bone_b, pair.bone_a, 0.5)
      } else if (b_is_parent) {
        // bone_b is parent, bone_a is child
        this.blend_single_side(skin_indices, skin_weights, position_to_indices,
          pair.vertex_a, pair.bone_a, pair.bone_b, 0.5)
      } else {
        // No clear parent-child (e.g. shoulder↔spine), fall back to standard
        this.blend_vertex_pair(skin_indices, skin_weights, position_to_indices,
          pair.vertex_a, pair.vertex_b, pair.bone_a, pair.bone_b, 0.5)
      }
    }
  }

  /**
   * Standard smoothing: simple 50/50 blend at boundaries (original behavior).
   */
  private apply_standard_smoothing (
    skin_indices: number[],
    skin_weights: number[],
    adjacency: Array<Set<number>>,
    position_to_indices: Map<string, number[]>,
    pairs: BoundaryPair[]
  ): void {
    const standard_pairs = pairs.filter(p => p.smoothing_type === SmoothingType.Standard)
    for (const pair of standard_pairs) {
      this.blend_vertex_pair(skin_indices, skin_weights, position_to_indices,
        pair.vertex_a, pair.vertex_b, pair.bone_a, pair.bone_b, 0.5)

      this.expand_boundary_side(skin_indices, skin_weights, adjacency, position_to_indices,
        pair.vertex_a, pair.bone_a, pair.bone_b, 0.2)

      this.expand_boundary_side(skin_indices, skin_weights, adjacency, position_to_indices,
        pair.vertex_b, pair.bone_b, pair.bone_a, 0.2)
    }
  }

  /**
   * Blends both vertices of a boundary pair symmetrically.
   * secondary_weight is how much influence the "other" bone gets (e.g., 0.5 = 50/50).
   */
  private blend_vertex_pair (
    skin_indices: number[],
    skin_weights: number[],
    position_to_indices: Map<string, number[]>,
    vertex_a: number,
    vertex_b: number,
    bone_a: number,
    bone_b: number,
    secondary_weight: number
  ): void {
    const shared_a = this.get_shared_vertices(vertex_a, position_to_indices)
    for (const idx of shared_a) {
      this.merge_vertex_weights(skin_indices, skin_weights, idx, bone_a, bone_b, secondary_weight)
    }

    const shared_b = this.get_shared_vertices(vertex_b, position_to_indices)
    for (const idx of shared_b) {
      this.merge_vertex_weights(skin_indices, skin_weights, idx, bone_b, bone_a, secondary_weight)
    }
  }

  /**
   * Blends only one side of a boundary — used for directional limb smoothing.
   * The vertex gets a blend, but its counterpart on the other side stays rigid.
   */
  private blend_single_side (
    skin_indices: number[],
    skin_weights: number[],
    position_to_indices: Map<string, number[]>,
    vertex: number,
    primary_bone: number,
    secondary_bone: number,
    secondary_weight: number
  ): void {
    const shared = this.get_shared_vertices(vertex, position_to_indices)
    for (const idx of shared) {
      this.merge_vertex_weights(skin_indices, skin_weights, idx, primary_bone, secondary_bone, secondary_weight)
    }
  }

  private expand_boundary_side (
    skin_indices: number[],
    skin_weights: number[],
    adjacency: Array<Set<number>>,
    position_to_indices: Map<string, number[]>,
    boundary_vertex: number,
    primary_bone: number,
    secondary_bone: number,
    secondary_weight: number
  ): void {
    for (const neighbor of adjacency[boundary_vertex]) {
      const offset = neighbor * 4
      if (skin_indices[offset] !== primary_bone) continue
      if (skin_weights[offset] !== 1.0) continue

      const shared = this.get_shared_vertices(neighbor, position_to_indices)
      for (const idx of shared) {
        this.merge_vertex_weights(skin_indices, skin_weights, idx, primary_bone, secondary_bone, secondary_weight)
      }
    }
  }

  private expand_boundary_side_multiple_rings (
    skin_indices: number[],
    skin_weights: number[],
    adjacency: Array<Set<number>>,
    position_to_indices: Map<string, number[]>,
    boundary_vertex: number,
    primary_bone: number,
    secondary_bone: number,
    secondary_weights: number[]
  ): void {
    let current_frontier = new Set<number>([boundary_vertex])
    const visited = new Set<number>([boundary_vertex])

    for (const secondary_weight of secondary_weights) {
      const next_frontier = new Set<number>()

      for (const frontier_vertex of current_frontier) {
        for (const neighbor of adjacency[frontier_vertex]) {
          if (visited.has(neighbor)) {
            continue
          }

          const offset = neighbor * 4
          if (skin_indices[offset] !== primary_bone) {
            continue
          }

          if (skin_weights[offset] !== 1.0) {
            continue
          }

          const shared = this.get_shared_vertices(neighbor, position_to_indices)
          for (const idx of shared) {
            this.merge_vertex_weights(skin_indices, skin_weights, idx, primary_bone, secondary_bone, secondary_weight)
          }

          visited.add(neighbor)
          next_frontier.add(neighbor)
        }
      }

      current_frontier = next_frontier
      if (current_frontier.size === 0) {
        return
      }
    }
  }

  private merge_vertex_weights (
    skin_indices: number[],
    skin_weights: number[],
    vertex: number,
    primary_bone: number,
    secondary_bone: number,
    secondary_weight: number
  ): void {
    const offset = vertex * 4
    const existing_entries: Array<{ bone: number, weight: number }> = []

    for (let slot = 0; slot < 4; slot++) {
      const weight = skin_weights[offset + slot]
      if (weight <= 0) continue
      existing_entries.push({ bone: skin_indices[offset + slot], weight })
    }

    if (existing_entries.length === 0) {
      existing_entries.push({ bone: primary_bone, weight: 1.0 })
    }

    const merged_by_bone = new Map<number, number>()
    for (const entry of existing_entries) {
      merged_by_bone.set(entry.bone, (merged_by_bone.get(entry.bone) ?? 0) + entry.weight * (1.0 - secondary_weight))
    }

    merged_by_bone.set(secondary_bone, (merged_by_bone.get(secondary_bone) ?? 0) + secondary_weight)

    if (!merged_by_bone.has(primary_bone)) {
      merged_by_bone.set(primary_bone, 0)
    }

    const sorted_entries = [...merged_by_bone.entries()]
      .map(([bone, weight]) => ({ bone, weight }))
      .filter((entry) => entry.weight > 1e-6)
      .sort((left, right) => right.weight - left.weight)
      .slice(0, 4)

    const weight_sum = sorted_entries.reduce((sum, entry) => sum + entry.weight, 0)
    const normalized_entries = weight_sum > 0
      ? sorted_entries.map((entry) => ({ bone: entry.bone, weight: entry.weight / weight_sum }))
      : [{ bone: primary_bone, weight: 1.0 }]

    for (let slot = 0; slot < 4; slot++) {
      const entry = normalized_entries[slot]
      skin_indices[offset + slot] = entry?.bone ?? 0
      skin_weights[offset + slot] = entry?.weight ?? 0
    }
  }

  /**
   * Checks if bone at index_a is a direct parent of bone at index_b
   * by walking up the bone hierarchy.
   */
  private is_parent_of (parent_index: number, child_index: number): boolean {
    const parent_bone = this.bones[parent_index]
    const child_bone = this.bones[child_index]
    if (parent_bone === undefined || child_bone === undefined) return false
    return child_bone.parent === parent_bone
  }

  /**
   * Finds the secondary bone index from a vertex that was already blended,
   * used when expanding torso rings outward.
   */
  private find_neighbor_bone_from_boundary (
    vertex_idx: number,
    skin_indices: number[],
    primary_bone: number
  ): number {
    const offset = vertex_idx * 4
    // Check the secondary influence slot
    const secondary_bone = skin_indices[offset + 1]
    if (secondary_bone !== primary_bone && secondary_bone !== 0) {
      return secondary_bone
    }
    return -1
  }

  private get_shared_vertices (vertex: number, position_to_indices: Map<string, number[]>): number[] {
    const pos = this.geometry.attributes.position
    const x = pos.getX(vertex); const y = pos.getY(vertex); const z = pos.getZ(vertex)
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`
    return position_to_indices.get(key) || [vertex]
  }

  private build_position_map (): Map<string, number[]> {
    const vertex_count = this.geometry_vertex_count()
    const position_to_indices = new Map<string, number[]>()
    for (let i = 0; i < vertex_count; i++) {
      const pos = this.geometry.attributes.position
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i)
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`
      if (!position_to_indices.has(key)) position_to_indices.set(key, [])
      position_to_indices.get(key)!.push(i)
    }
    return position_to_indices
  }

  /**
   * Builds a spatial adjacency map for the mesh vertices using geometry's index (faces).
   * Returns an array of Sets, where each Set contains the indices of neighboring vertices.
   */
  private build_vertex_adjacency (): Array<Set<number>> {
    const vertex_count = this.geometry_vertex_count()
    const adjacency: Array<Set<number>> = Array.from({ length: vertex_count }, () => new Set<number>())

    const index_attribute: BufferAttribute | null = this.geometry.index
    if (index_attribute === null) return adjacency

    const indices = index_attribute.array
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]; const b = indices[i + 1]; const c = indices[i + 2]
      adjacency[a].add(b); adjacency[a].add(c)
      adjacency[b].add(a); adjacency[b].add(c)
      adjacency[c].add(a); adjacency[c].add(b)
    }
    return adjacency
  }

  private get_axial_gradient_data (bone_index: number): AxialGradientData | null {
    const bone = this.bones[bone_index]
    if (bone === undefined || bone.name === 'root') {
      return null
    }

    const parent_bone = bone.parent instanceof Bone ? bone.parent : null
    const child_bones = bone.children.filter((child): child is Bone => child instanceof Bone)
    if (child_bones.length > 1) {
      return null
    }

    const child_bone = child_bones[0] ?? null

    if (parent_bone === null && child_bone === null) {
      return null
    }

    const bone_world_position = Utility.world_position_from_object(bone)
    const start_point = parent_bone !== null
      ? Utility.world_position_from_object(parent_bone)
      : bone_world_position.clone()

    const end_point = child_bone !== null
      ? Utility.world_position_from_object(child_bone)
      : bone_world_position.clone()

    if (start_point.distanceToSquared(end_point) < 1e-8) {
      return null
    }

    return {
      primary_bone: bone_index,
      parent_bone: parent_bone !== null ? this.bones.indexOf(parent_bone) : null,
      child_bone: child_bone !== null ? this.bones.indexOf(child_bone) : null,
      start_point,
      end_point
    }
  }

  private get_torso_ring_weights (pair: BoundaryPair): number[] {
    if (this.is_pelvis_thigh_boundary(pair.bone_a, pair.bone_b)) {
      return [0.5, 0.48, 0.38, 0.28, 0.18, 0.1]
    }

    if (this.is_shoulder_spine_boundary(pair.bone_a, pair.bone_b)) {
      return [0.5, 0.5, 0.42, 0.32, 0.22, 0.12]
    }

    if (this.is_clavicle_upperarm_boundary(pair.bone_a, pair.bone_b)) {
      return [0.5, 0.5, 0.42, 0.32, 0.22]
    }

    return [0.5, 0.25, 0.10]
  }

  private is_special_socket_boundary (bone_index_a: number, bone_index_b: number): boolean {
    return this.is_pelvis_thigh_boundary(bone_index_a, bone_index_b) ||
      this.is_shoulder_spine_boundary(bone_index_a, bone_index_b) ||
      this.is_clavicle_upperarm_boundary(bone_index_a, bone_index_b)
  }

  private is_pelvis_thigh_boundary (bone_index_a: number, bone_index_b: number): boolean {
    const bone_a_name = this.bones[bone_index_a]?.name.toLowerCase() ?? ''
    const bone_b_name = this.bones[bone_index_b]?.name.toLowerCase() ?? ''

    const is_pelvis_name = (name: string): boolean => /(pelvis|hips)/.test(name)
    const is_thigh_name = (name: string): boolean => /(thigh|upleg|upperleg|leg)/.test(name)

    return (is_pelvis_name(bone_a_name) && is_thigh_name(bone_b_name)) ||
      (is_pelvis_name(bone_b_name) && is_thigh_name(bone_a_name))
  }

  private is_shoulder_spine_boundary (bone_index_a: number, bone_index_b: number): boolean {
    const bone_a_name = this.bones[bone_index_a]?.name.toLowerCase() ?? ''
    const bone_b_name = this.bones[bone_index_b]?.name.toLowerCase() ?? ''

    const is_spine_chain_name = (name: string): boolean => /(spine|chest|torso|body|neck)/.test(name)
    const is_shoulder_chain_name = (name: string): boolean => /(clavicle|shoulder|upperarm|arm)/.test(name)

    return (is_spine_chain_name(bone_a_name) && is_shoulder_chain_name(bone_b_name)) ||
      (is_spine_chain_name(bone_b_name) && is_shoulder_chain_name(bone_a_name))
  }

  private is_clavicle_upperarm_boundary (bone_index_a: number, bone_index_b: number): boolean {
    const bone_a_name = this.bones[bone_index_a]?.name.toLowerCase() ?? ''
    const bone_b_name = this.bones[bone_index_b]?.name.toLowerCase() ?? ''

    const is_clavicle_name = (name: string): boolean => /(clavicle|shoulder)/.test(name) && !/(spine|chest|neck|torso|body)/.test(name)
    const is_upperarm_name = (name: string): boolean => /(upperarm|arm)/.test(name) && !/(forearm|lowerarm)/.test(name)

    return (is_clavicle_name(bone_a_name) && is_upperarm_name(bone_b_name)) ||
      (is_clavicle_name(bone_b_name) && is_upperarm_name(bone_a_name))
  }

  private can_apply_axial_gradient_to_vertex (
    vertex: number,
    skin_indices: number[],
    skin_weights: number[],
    gradient_data: AxialGradientData
  ): boolean {
    const offset = vertex * 4
    const allowed_bones = new Set<number>([
      gradient_data.primary_bone,
      gradient_data.parent_bone ?? -1,
      gradient_data.child_bone ?? -1
    ])

    let non_zero_influence_count = 0

    for (let slot = 0; slot < 4; slot++) {
      const weight = skin_weights[offset + slot]
      if (weight <= 1e-6) {
        continue
      }

      non_zero_influence_count++
      const bone_index = skin_indices[offset + slot]
      if (!allowed_bones.has(bone_index) && bone_index !== 0) {
        return false
      }
    }

    return non_zero_influence_count <= 2
  }

  private calculate_axial_gradient_weights (
    vertex: number,
    gradient_data: AxialGradientData
  ): AxialGradientWeights | null {
    const position = new Vector3().fromBufferAttribute(this.geometry.attributes.position, vertex)
    const segment = gradient_data.end_point.clone().sub(gradient_data.start_point)
    const segment_length_squared = segment.lengthSq()
    if (segment_length_squared < 1e-8) {
      return null
    }

    const segment_t = position.clone().sub(gradient_data.start_point).dot(segment) / segment_length_squared
    const clamped_t = Math.max(0, Math.min(1, segment_t))
    const center_falloff = Math.abs((clamped_t * 2) - 1)
    const primary_weight = 0.2 + (0.8 * (1 - center_falloff))

    const secondary_bone = clamped_t <= 0.5
      ? gradient_data.parent_bone ?? gradient_data.child_bone
      : gradient_data.child_bone ?? gradient_data.parent_bone

    if (secondary_bone === null) {
      return {
        primary_bone: gradient_data.primary_bone,
        secondary_bone: 0,
        primary_weight: 1,
        secondary_weight: 0
      }
    }

    return {
      primary_bone: gradient_data.primary_bone,
      secondary_bone,
      primary_weight,
      secondary_weight: Math.max(0, 1 - primary_weight)
    }
  }

  private set_vertex_weights (
    skin_indices: number[],
    skin_weights: number[],
    vertex: number,
    primary_bone: number,
    secondary_bone: number,
    primary_weight: number,
    secondary_weight: number
  ): void {
    const offset = vertex * 4
    skin_indices[offset] = primary_bone
    skin_weights[offset] = primary_weight
    skin_indices[offset + 1] = secondary_bone
    skin_weights[offset + 1] = secondary_weight
    skin_indices[offset + 2] = 0
    skin_weights[offset + 2] = 0
    skin_indices[offset + 3] = 0
    skin_weights[offset + 3] = 0
  }

  private get_pelvis_basin_data (): PelvisBasinData | null {
    const pelvis_bone_index = this.bones.findIndex((bone) => /(pelvis|hips)/.test(bone.name.toLowerCase()))
    if (pelvis_bone_index === -1) {
      return null
    }

    const pelvis_bone = this.bones[pelvis_bone_index]
    const thigh_bones = this.bones
      .map((bone, bone_index) => ({ bone, bone_index }))
      .filter(({ bone }) => /(thigh|upleg|upperleg|leg)/.test(bone.name.toLowerCase()))

    if (thigh_bones.length === 0) {
      return null
    }

    const pelvis_position = Utility.world_position_from_object(pelvis_bone)
    const thigh_positions = thigh_bones.map(({ bone }) => Utility.world_position_from_object(bone))

    let average_thigh_position = new Vector3()
    thigh_positions.forEach((position) => {
      average_thigh_position.add(position)
    })
    average_thigh_position.divideScalar(thigh_positions.length)

    const pelvis_to_thigh_distance = Math.max(0.0001, pelvis_position.distanceTo(average_thigh_position))

    return {
      pelvis_bone_index,
      pelvis_position,
      thigh_bones,
      average_thigh_position,
      pelvis_to_thigh_distance
    }
  }

  private calculate_pelvis_basin_blend (
    vertex: number,
    skin_indices: number[],
    pelvis_data: PelvisBasinData
  ): PelvisBasinBlend | null {
    const offset = vertex * 4
    const primary_bone = skin_indices[offset]
    const thigh_bone_indices = new Set(pelvis_data.thigh_bones.map(({ bone_index }) => bone_index))

    if (primary_bone !== pelvis_data.pelvis_bone_index && !thigh_bone_indices.has(primary_bone)) {
      return null
    }

    const vertex_position = new Vector3().fromBufferAttribute(this.geometry.attributes.position, vertex)
    const thigh_center_distance = vertex_position.distanceTo(pelvis_data.average_thigh_position)
    const pelvis_distance = vertex_position.distanceTo(pelvis_data.pelvis_position)

    if (pelvis_distance > pelvis_data.pelvis_to_thigh_distance * 1.45) {
      return null
    }

    const vertical_min = Math.min(pelvis_data.pelvis_position.y, pelvis_data.average_thigh_position.y) - (pelvis_data.pelvis_to_thigh_distance * 0.35)
    const vertical_max = pelvis_data.pelvis_position.y + (pelvis_data.pelvis_to_thigh_distance * 0.2)
    if (vertex_position.y < vertical_min || vertex_position.y > vertical_max) {
      return null
    }

    const basin_center_distance = vertex_position.distanceTo(
      pelvis_data.pelvis_position.clone().lerp(pelvis_data.average_thigh_position, 0.45)
    )
    const influence_radius = pelvis_data.pelvis_to_thigh_distance * 1.15
    if (basin_center_distance > influence_radius) {
      return null
    }

    const normalized_distance = Math.min(1, basin_center_distance / influence_radius)
    const secondary_weight = 0.12 + ((1 - normalized_distance) * 0.18)

    if (primary_bone === pelvis_data.pelvis_bone_index) {
      const nearest_thigh = pelvis_data.thigh_bones.reduce((closest, candidate) => {
        const candidate_distance = vertex_position.distanceTo(Utility.world_position_from_object(candidate.bone))
        if (candidate_distance < closest.distance) {
          return { bone_index: candidate.bone_index, distance: candidate_distance }
        }
        return closest
      }, { bone_index: pelvis_data.thigh_bones[0].bone_index, distance: Number.POSITIVE_INFINITY })

      return {
        primary_bone,
        secondary_bone: nearest_thigh.bone_index,
        secondary_weight
      }
    }

    return {
      primary_bone,
      secondary_bone: pelvis_data.pelvis_bone_index,
      secondary_weight
    }
  }
}

interface PelvisBasinData {
  pelvis_bone_index: number
  pelvis_position: Vector3
  thigh_bones: Array<{ bone: Bone, bone_index: number }>
  average_thigh_position: Vector3
  pelvis_to_thigh_distance: number
}

interface PelvisBasinBlend {
  primary_bone: number
  secondary_bone: number
  secondary_weight: number
}

interface AxialGradientData {
  primary_bone: number
  parent_bone: number | null
  child_bone: number | null
  start_point: Vector3
  end_point: Vector3
}

interface AxialGradientWeights {
  primary_bone: number
  secondary_bone: number
  primary_weight: number
  secondary_weight: number
}

interface BoundaryPair {
  vertex_a: number
  vertex_b: number
  bone_a: number
  bone_b: number
  smoothing_type: SmoothingType
}

enum SmoothingType {
  Socket = 'socket',
  Torso = 'torso',
  Limb = 'limb',
  Standard = 'standard'
}
