interface VariationSpec {
  variant: string
  displayName: string
  attribution?: string
  license?: string
}

export interface ModelVariation {
  model_file: string // Model file path relative to the static root, e.g. 'models/model-human-a-pose.glb'
  display_name: string // Display name shown in the model dropdown, e.g. 'Human (A-Pose)'
  attribution: string // Free-form attribution text to be shown in the UI when this model variation is selected, e.g. 'Model by Artist Name'
  preview_image: string // Preview image path relative to the static root, shown in the variation selection dialog
  license: string // License string for this model variation, e.g. 'CC0', 'CC-SA 4.0'

}

function createVariation(type: string, spec: VariationSpec): ModelVariation {
  return {
    model_file: `models-variation/${type}-${spec.variant}.glb`, // all variations are in the same folder for now
    display_name: spec.displayName,
    attribution: spec.attribution ?? '', // attribution only needed for CC-SA and CC-BY
    license: spec.license ?? 'CC0', // defaults to CC0 unless otherwise specified
    preview_image: `models-variation/profiles/${spec.variant}.png` // all preview images are stored in the profiles folder
  }
}

const HUMAN_TYPE = 'human'
export const humanVariations: ModelVariation[] = [
  createVariation(HUMAN_TYPE, { variant: 'base', displayName: 'Mannequin', attribution: 'Quaternius', license: 'CC0' }),
  createVariation(HUMAN_TYPE, { variant: 'female', displayName: 'Female Mannequin', attribution: 'Quaternius', license: 'CC0' }),
  createVariation(HUMAN_TYPE, { variant: 'zombie', displayName: 'Zombie', attribution: 'Kenney.nl', license: 'CC0' }),
  createVariation(HUMAN_TYPE, { variant: 'sophia', displayName: 'Sophia', attribution: 'Tysan Tan', license: 'CC-SA 4.0' }),
  createVariation(HUMAN_TYPE, { variant: 'jay', displayName: 'Jay', attribution: 'Blender Studio', license: 'CC-BY' }),
  createVariation(HUMAN_TYPE, { variant: 'sintel', displayName: 'Sintel', attribution: 'Blender Studio', license: 'CC-BY' }),
  createVariation(HUMAN_TYPE, { variant: 'bunny', displayName: 'Bunny', attribution: 'Blender Studio', license: 'CC-BY' }),
]

const FOX_TYPE = 'fox'
export const foxVariations: ModelVariation[] = [
  createVariation(FOX_TYPE, { variant: 'fox', displayName: 'Fox' }),
  createVariation(FOX_TYPE, { variant: 'dog', displayName: 'Dog' }),
  createVariation(FOX_TYPE, { variant: 'horse', displayName: 'Horse' }),
  createVariation(FOX_TYPE, { variant: 'cat', displayName: 'Carrot', attribution: 'David Revoy', license: 'CC-BY' }),
  createVariation(FOX_TYPE, { variant: 'panda', displayName: 'Panda' }),
]

const BIRD_TYPE = 'bird'
export const birdVariations: ModelVariation[] = [
  createVariation(BIRD_TYPE, { variant: 'seagull', displayName: 'Seagull' }),
  createVariation(BIRD_TYPE, { variant: 'eagle', displayName: 'Bald Eagle' }),
]

const KAIJU_TYPE = 'kaiju'
export const kaijuVariations: ModelVariation[] = [
  createVariation(KAIJU_TYPE, { variant: 'kaiju', displayName: 'Kaiju' }),
  createVariation(KAIJU_TYPE, { variant: 't-rex', displayName: 'T-Rex' }),
]

const FISH_TYPE = 'fish'
export const fishVariations: ModelVariation[] = [
  createVariation(FISH_TYPE, { variant: 'shark', displayName: 'Shark' }),
  createVariation(FISH_TYPE, { variant: 'whale', displayName: 'Whale' }),
]
