import { type ManifestFile } from './ManifestFile'

export interface ManifestProp extends ManifestFile {
  name: string
  display_name: string
  preview: ManifestFile
  category: string
  tags: string[]
  dimensions: { width: number, depth: number, height: number }
  vertices: number
  triangles: number
  materials: string[]
}
