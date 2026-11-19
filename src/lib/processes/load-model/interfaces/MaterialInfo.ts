/**
 * What one material on one mesh looked like at import time. Emissive gets its
 * own fields because it is the property most likely to come in wrong from an
 * FBX and then follow the model all the way out to a GLB export.
 */
export interface MaterialInfo {
  name: string
  type: string
  color_hex: string | null
  emissive_hex: string | null
  emissive_intensity: number
  /**
   * Brightest channel of the emissive color on its own. A GLB export writes the
   * color straight into emissiveFactor whenever this is above zero, so this is
   * the number that decides whether the exported model glows.
   */
  emissive_strength: number
  /**
   * Whether emissive intensity survives an export. Only MeshStandardMaterial
   * carries it, through the KHR_materials_emissive_strength extension. FBX files
   * usually load as MeshPhongMaterial, where the intensity dims the model in the
   * viewport but is dropped on export, leaving the full emissive color behind.
   */
  exports_emissive_intensity: boolean
  specular_hex: string | null
  metalness: number | null
  roughness: number | null
  shininess: number | null
  opacity: number
  transparent: boolean
  vertex_colors: boolean
  side: string
  texture_slots: string[]
}
