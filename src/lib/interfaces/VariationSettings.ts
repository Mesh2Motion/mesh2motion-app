/**
 * App-specific settings for a model variation. The model file itself comes from the asset manifest.
 * Variations in the manifest without settings are still shown, using their manifest name and a CC0 license.
 */
export interface VariationSettings {
  display_name: string // Display name shown in the model dropdown, e.g. 'Police Female'
  attribution?: string // only needed for CC-SA and CC-BY
  license?: string // defaults to CC0
  expand_arms?: number // Explore page arm expansion value, defaults to 0
  // Multiplier applied to the position keyframes of the rig's position tracking bone (e.g. pelvis/hips).
  // Taller variations need a value above 1.0 so their feet stay on the ground instead of sinking below it.
  pelvis_position_scale?: number
}
