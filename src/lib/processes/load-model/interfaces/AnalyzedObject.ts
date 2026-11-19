import { type Vector3 } from 'three'
import { type MaterialInfo } from './MaterialInfo'

/**
 * Snapshot of a single mesh-bearing object, taken at a point in time so later
 * processing steps cannot change the numbers we are reporting on.
 */
export interface AnalyzedObject {
  name: string
  type: string
  parent_name: string
  depth: number
  position: Vector3
  rotation_degrees: Vector3
  scale: Vector3
  world_scale: Vector3
  world_size: Vector3
  // parent objects between this mesh and the scene root that carry their own transform
  transformed_ancestors: string[]
  vertex_count: number
  triangle_count: number
  materials: MaterialInfo[]
  has_uvs: boolean
  has_normals: boolean
  has_skin_weights: boolean
  warnings: string[]
}
