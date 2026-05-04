import { BoneMetadata, BoneSide } from './BoneAutoMapper'

/**
 * BoneCategoryMapper - Handles category-specific bone mapping logic
 * Contains the actual matching algorithms for each anatomical category
 */
export class BoneCategoryMapper {
  /**
   * Map torso bones (spine, chest, neck, head, hips, pelvis)
   */
  static map_torso_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    // if target or source torso bones are empty, return empty mapping
    if (source_bones === null || target_bones === null) {
      console.error('map_torso_bones(): No source or target bones found. This should not be reached.')
      return new Map<string, string>()
    }

    const category_mappings = new Map<string, string>()

    console.log('DEVELOPING THE TORSO MAPPER')
    console.log('Source Bones:', source_bones)
    console.log('Target Bones:', target_bones)

    // Perform exact name matching first
    this.perform_exact_name_matching(source_bones, target_bones, category_mappings)

    return category_mappings
  }

  /**
   * Map arm bones (shoulder, upper arm, elbow, forearm, wrist)
   */
  static map_arm_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    const category_mappings = new Map<string, string>()

    // Perform exact name matching first
    this.perform_exact_name_matching(source_bones, target_bones, category_mappings)

    // TODO: Add category-specific matching logic here

    return category_mappings
  }

  /**
   * Map hand bones (hands, fingers, thumbs)
   */
  static map_hand_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    const category_mappings = new Map<string, string>()

    // Perform exact name matching first
    this.perform_exact_name_matching(source_bones, target_bones, category_mappings)

    // TODO: Add category-specific matching logic here

    return category_mappings
  }

  /**
   * Map leg bones (hips, thighs, knees, calves, ankles, feet, toes)
   */
  static map_leg_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    const category_mappings = new Map<string, string>()

    // Perform exact name matching first
    this.perform_exact_name_matching(source_bones, target_bones, category_mappings)

    // TODO: Add category-specific matching logic here

    return category_mappings
  }

  /**
   * Map wing bones (wings, feathers, pinions)
   */
  static map_wing_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    const category_mappings = new Map<string, string>()

    // Perform exact name matching first
    this.perform_exact_name_matching(source_bones, target_bones, category_mappings)

    // TODO: Add category-specific matching logic here

    return category_mappings
  }

  /**
   * Map tail bones
   */
  static map_tail_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    const category_mappings = new Map<string, string>()

    // Perform exact name matching first
    this.perform_exact_name_matching(source_bones, target_bones, category_mappings)

    // TODO: Add category-specific matching logic here

    return category_mappings
  }

  /**
   * Map unknown/uncategorized bones
   */
  static map_unknown_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    const category_mappings = new Map<string, string>()

    // Perform exact name matching first
    this.perform_exact_name_matching(source_bones, target_bones, category_mappings)

    // TODO: Add category-specific matching logic here

    return category_mappings
  }

  /**
   * Match target bones to source bones by normalized name + compatible side.
   * Each source bone may only be used once.
   * @param source_bones - Array of source bone metadata
   * @param target_bones - Array of target bone metadata
   * @param category_mappings - Map to store the bone name mappings
   */
  private static perform_exact_name_matching (source_bones: BoneMetadata[],
    target_bones: BoneMetadata[], category_mappings: Map<string, string>): void {

    const used_source_names = new Set<string>(category_mappings.values())

    for (const target_bone_meta of target_bones) {
      if (category_mappings.has(target_bone_meta.name)) continue

      // Prefer same-side, exact-normalized match first
      let match: BoneMetadata | undefined = source_bones.find(sb =>
        !used_source_names.has(sb.name) &&
        sb.normalized_name === target_bone_meta.normalized_name &&
        BoneCategoryMapper.sides_compatible(sb.side, target_bone_meta.side)
      )

      // Fallback: raw-name match (preserves prior behavior for identical names)
      if (match === undefined) {
        match = source_bones.find(sb =>
          !used_source_names.has(sb.name) &&
          sb.name === target_bone_meta.name
        )
      }

      if (match !== undefined) {
        category_mappings.set(target_bone_meta.name, match.name)
        used_source_names.add(match.name)
      }
    }
  }

  private static sides_compatible (a: BoneSide, b: BoneSide): boolean {
    if (a === b) return true
    if (a === BoneSide.Unknown || b === BoneSide.Unknown) return true
    if (a === BoneSide.Center || b === BoneSide.Center) {
      return a === BoneSide.Center && b === BoneSide.Center
    }
    return false
  }
}
