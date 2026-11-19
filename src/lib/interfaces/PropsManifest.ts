import { type ManifestProp } from './ManifestProp'

export interface PropsManifest {
  version: number
  generated: string
  categories: string[]
  props: ManifestProp[]
}
