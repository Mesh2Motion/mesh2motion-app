import { type Vector3 } from 'three'
import { type AnalyzedObject } from './AnalyzedObject'

/** Everything we can say about one scene graph at one moment. */
export interface SceneSnapshot {
  objects: AnalyzedObject[]
  type_counts: Record<string, number>
  mesh_count: number
  skinned_mesh_count: number
  vertex_count: number
  triangle_count: number
  world_size: Vector3
  world_min: Vector3
  world_max: Vector3
}
