import type { BufferGeometry } from 'three'

const adjacency_cache = new WeakMap<BufferGeometry, number[][]>()

/**
 * Connected vertex indices per vertex, built from the geometry's triangles and
 * cached per geometry. Treat the result as read-only: it is shared by callers.
 */
export function vertex_adjacency (geometry: BufferGeometry): number[][] {
  const cached = adjacency_cache.get(geometry)
  if (cached !== undefined) { return cached }

  const vertex_count = geometry.attributes.position?.count ?? 0
  const neighbors: Array<Set<number>> = Array.from({ length: vertex_count }, () => new Set<number>())
  const connect = (a: number, b: number): void => {
    if (a === b || a < 0 || b < 0 || a >= vertex_count || b >= vertex_count) { return }
    neighbors[a].add(b)
    neighbors[b].add(a)
  }

  const index = geometry.index
  const index_count = index !== null ? index.count : vertex_count
  for (let i = 0; i + 2 < index_count; i += 3) {
    const a = index !== null ? index.getX(i) : i
    const b = index !== null ? index.getX(i + 1) : i + 1
    const c = index !== null ? index.getX(i + 2) : i + 2
    connect(a, b)
    connect(b, c)
    connect(c, a)
  }

  const result = neighbors.map(set => [...set])
  adjacency_cache.set(geometry, result)
  return result
}
