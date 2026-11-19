import { type SceneSnapshot } from './SceneSnapshot'

/**
 * Before/after pair for one import. `imported` is what came out of the file
 * loader and `processed` is the mesh data the rest of the app actually works
 * with, which makes it possible to see what import processing changed.
 */
export interface ModelImportAnalysis {
  source_name: string
  imported: SceneSnapshot
  processed: SceneSnapshot
}
