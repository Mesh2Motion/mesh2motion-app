export interface ModelVariation {
  name: string // variation name in the asset manifest, e.g. 'psx-05'
  model_file: string // Model file path relative to the static root, e.g. 'assets/human/variations/psx-05.glb'
  display_name: string // Display name shown in the model dropdown, e.g. 'Human (A-Pose)'
  attribution: string // Free-form attribution text to be shown in the UI when this model variation is selected, e.g. 'Model by Artist Name'
  preview_image: string // Preview image path relative to the static root, e.g. 'variation-previews/human/psx-05.png'
  license: string // License string for this model variation, e.g. 'CC0', 'CC-SA 4.0'
  expandArms: number // Explore page arm expansion value, default 0 for human rigs
  pelvis_position_scale: number
}
