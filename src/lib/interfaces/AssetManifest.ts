import { type ManifestRig } from './ManifestRig'

export interface AssetManifest {
  version: number
  generated: string
  rigs: Record<string, ManifestRig>
}
