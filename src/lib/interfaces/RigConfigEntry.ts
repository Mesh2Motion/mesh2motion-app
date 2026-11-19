import { type RigSettings } from './RigSettings'
import { type RigAnimation } from './RigAnimation'
import { type ModelVariation } from './ModelVariation'

export interface RigConfigEntry extends Omit<RigSettings, 'variations'> {
  model_file: string // Model file path relative to the static root, e.g. 'assets/human/model.glb'
  rig_file: string // Rig/skeleton GLB file path relative to the static root, e.g. 'assets/human/skeleton.glb'
  fps: number
  animations: RigAnimation[]
  model_variations: ModelVariation[] // similar models (human, zombie, etc)
}
