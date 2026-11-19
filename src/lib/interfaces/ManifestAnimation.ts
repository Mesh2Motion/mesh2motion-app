import { type ManifestFile } from './ManifestFile'

export interface ManifestAnimation extends ManifestFile {
  name: string // clip name inside the GLB, e.g. 'Walk'
  tags: string[]
  loop: boolean
  root_motion: boolean
  frame_count: number
  duration: number // seconds
  source: string
}
