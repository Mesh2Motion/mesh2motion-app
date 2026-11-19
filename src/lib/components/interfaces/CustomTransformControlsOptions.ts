// ─── Options interface ────────────────────────────────────────────────────────

export interface CustomTransformControlsOptions {
  /** Length of each axis arm. Default: 0.25 (stock three.js: 0.5) */
  armLength?: number
  /** Base radius of the arrow cone tip. Default: 0.035 (stock: 0.04) */
  arrowBaseRadius?: number
  /** Height of the arrow cone tip. Default: 0.065 (stock: 0.1) */
  arrowHeight?: number
  /** Radius of invisible picker cylinders along each axis arm. Default: 0.1 (stock: 0.2) */
  pickerCylinderRadius?: number
  /** Height of invisible picker cylinders along each axis arm. Default: 0.35 (stock: 0.6) */
  pickerCylinderHeight?: number
  /** Tube radius of invisible torus pickers for rotation rings. Default: 0.05 (stock: 0.1) */
  pickerTorusTube?: number
  /** Radius of invisible sphere picker for free-rotate. Default: 0.15 (stock: 0.25) */
  pickerSphereRadius?: number
  /** Side length of invisible box pickers for plane handles. Default: 0.13 (stock: 0.2) */
  pickerBox?: number
  /** Radius of the arm shaft cylinder. Default: 0.012 (stock three.js: 0.0075) */
  armCylinderRadius?: number
  /** Size and offset of the visible plane handle squares (XY/YZ/XZ). Default: 0.1 (stock three.js: 0.15) */
  planeSize?: number
}
