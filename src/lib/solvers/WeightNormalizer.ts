import { type BufferGeometry } from 'three'

/**
 * Handles weight normalization to ensure all vertex skin weights sum to 1.0.
 * After initial weight assignment and smoothing, some vertices may have weights
 * that don't sum correctly. This normalizer detects and corrects those cases.
 */
export class WeightNormalizer {
  private readonly geometry: BufferGeometry

  constructor (geometry: BufferGeometry) {
    this.geometry = geometry
  }

  private geometry_vertex_count (): number {
    return this.geometry.attributes.position.array.length / 3
  }

  /**
   * Returns an array of vertex indices whose weights do not sum to 1.0 (within a small epsilon).
   */
  public find_vertices_with_incorrect_weight_sum (skin_weights: number[]): number[] {
    const epsilon: number = 1e-4 // very small number to signify close enough to 0
    const incorrect_vertices: number[] = []
    const vertex_count = this.geometry_vertex_count()
    for (let i = 0; i < vertex_count; i++) {
      const offset = i * 4
      const sum = skin_weights[offset] + skin_weights[offset + 1] + skin_weights[offset + 2] + skin_weights[offset + 3]
      if (Math.abs(sum - 1.0) > epsilon) {
        incorrect_vertices.push(i)
      }
    }
    return incorrect_vertices
  }

  /**
   * Normalizes weights for vertices that don't sum to 1.0.
   * Distributes the remaining weight across non-zero influence slots.
   */
  public normalize_weights (all_skin_weights: number[]): void {
    const vertices_that_do_not_have_influences_adding_to_one: number[] = this.find_vertices_with_incorrect_weight_sum(all_skin_weights)
    for (const vertex_index of vertices_that_do_not_have_influences_adding_to_one) {
      const offset = vertex_index * 4

      // if the weight is 0.00, then we can assign the remaining weights to the other bones
      const weights = [
        all_skin_weights[offset],
        all_skin_weights[offset + 1],
        all_skin_weights[offset + 2],
        all_skin_weights[offset + 3]
      ]
      const weight_sum = weights.reduce((a, b) => a + b, 0)
      const weight_per_index: number = (1 - weight_sum) / 3.0
      console.log(weight_per_index)

      // assign the weights all at once
      for (let i = 0; i < 4; i++) {
        if (weights[i] !== 0) {
          all_skin_weights[offset + i] += weight_per_index
        }
      }
    }
  }
}
