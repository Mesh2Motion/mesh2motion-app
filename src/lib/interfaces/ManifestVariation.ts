import { type ManifestFile } from './ManifestFile'

export interface ManifestVariation extends ManifestFile {
  name: string // unique per rig, e.g. 'psx-05'
  source: string
}
