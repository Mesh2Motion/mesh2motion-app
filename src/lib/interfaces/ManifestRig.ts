import { type ManifestFile } from './ManifestFile'
import { type ManifestVariation } from './ManifestVariation'
import { type ManifestAnimation } from './ManifestAnimation'

export interface ManifestRig {
  fps: number
  model: ManifestFile
  skeleton: ManifestFile
  variations: ManifestVariation[]
  animations: ManifestAnimation[]
}
