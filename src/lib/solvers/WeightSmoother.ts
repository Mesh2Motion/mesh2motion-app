import {
  type BufferAttribute,
  type BufferGeometry
} from 'three'

/**
 * Smooths skin weight boundaries between bone influences using vertex adjacency.
 * When a joint change occurs, the first skinning pass assigns 100% to one bone,
 * creating a sharp transition. This smoother blends weights at those boundaries.
 */
export class WeightSmoother {
  private readonly geometry: BufferGeometry

  constructor (geometry: BufferGeometry) {
    this.geometry = geometry
  }

  private geometry_vertex_count (): number {
    return this.geometry.attributes.position.array.length / 3
  }

  /**
   * Smooths skin weights at the boundary between bone influences using spatial adjacency.
   * For each vertex, if a (spatial) neighbor has a different primary bone and both have 100% influence,
   * blend their weights to 50/50 between the two bones.
   */
  public smooth_bone_weight_boundaries (skin_indices: number[], skin_weights: number[]): void {
    const vertex_count = this.geometry_vertex_count()
    const adjacency = this.build_vertex_adjacency()
    const visited = new Set<string>()

    // Build a map of shared vertices (those with identical positions)
    const position_to_indices = new Map<string, number[]>()
    for (let i = 0; i < vertex_count; i++) {
      const pos = this.geometry.attributes.position
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i)
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`
      if (!position_to_indices.has(key)) position_to_indices.set(key, [])
      position_to_indices.get(key)!.push(i)
    }

    // Iterate through each vertex and its neighbors
    // looking for rigid 100% weight vertices that are next to other rigid 100% weight vertices
    // and blend their weights to 50/50 between the two bones
    // poor man's blending by the joint areas so it is less rigid
    for (let i = 0; i < vertex_count; i++) {
      const offsetA = i * 4
      const boneA = skin_indices[offsetA]
      const weightA = skin_weights[offsetA]
      if (weightA !== 1.0) continue
      for (const j of adjacency[i]) {
        const offsetB = j * 4
        const boneB = skin_indices[offsetB]
        const weightB = skin_weights[offsetB]
        if (boneA === boneB || weightB !== 1.0) continue
        // Only blend once per pair
        const key = i < j ? `${i},${j}` : `${j},${i}`
        if (visited.has(key)) continue
        visited.add(key)

        // Find all shared vertices for i and j
        const posA = this.geometry.attributes.position
        const xA = posA.getX(i); const yA = posA.getY(i); const zA = posA.getZ(i)
        const shared_keyA = `${xA.toFixed(6)},${yA.toFixed(6)},${zA.toFixed(6)}`
        const sharedA = position_to_indices.get(shared_keyA) || [i]

        const xB = posA.getX(j); const yB = posA.getY(j); const zB = posA.getZ(j)
        const shared_keyB = `${xB.toFixed(6)},${yB.toFixed(6)},${zB.toFixed(6)}`
        const sharedB = position_to_indices.get(shared_keyB) || [j]

        // Blend all shared vertices for i and j
        for (const idx of sharedA) {
          const off = idx * 4
          skin_indices[off + 0] = boneA
          skin_indices[off + 1] = boneB
          skin_weights[off + 0] = 0.5
          skin_weights[off + 1] = 0.5
          skin_indices[off + 2] = 0
          skin_indices[off + 3] = 0
          skin_weights[off + 2] = 0
          skin_weights[off + 3] = 0
        }
        for (const idx of sharedB) {
          const off = idx * 4
          skin_indices[off + 0] = boneB
          skin_indices[off + 1] = boneA
          skin_weights[off + 0] = 0.5
          skin_weights[off + 1] = 0.5
          skin_indices[off + 2] = 0
          skin_indices[off + 3] = 0
          skin_weights[off + 2] = 0
          skin_weights[off + 3] = 0
        }
      }
    }
  }

  /**
   * Builds a spatial adjacency map for the mesh vertices using geometry's index (faces).
   * Returns an array of Sets, where each Set contains the indices of neighboring vertices.
   */
  private build_vertex_adjacency (): Array<Set<number>> {
    const vertex_count = this.geometry_vertex_count()

    // Initialize adjacency list
    // Each vertex will have a set of neighboring vertices
    const adjacency: Array<Set<number>> = Array.from({ length: vertex_count }, () => new Set<number>())

    const index_attribute: BufferAttribute | null = this.geometry.index // This contains list of a faces
    if (index_attribute === null) return adjacency // No faces, fallback to empty adjacency

    const indices = index_attribute.array
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i]; const b = indices[i + 1]; const c = indices[i + 2]
      adjacency[a].add(b); adjacency[a].add(c)
      adjacency[b].add(a); adjacency[b].add(c)
      adjacency[c].add(a); adjacency[c].add(b)
    }
    return adjacency
  }
}
