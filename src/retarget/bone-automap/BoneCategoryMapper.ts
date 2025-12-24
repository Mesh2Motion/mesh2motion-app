import { BoneCategory, BoneMetadata, BoneSide } from './BoneAutoMapper'

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
   * Performs exact name matching between source and target bones
   * @param source_bones - Array of source bone metadata
   * @param target_bones - Array of target bone metadata
   * @param category_mappings - Map to store the bone name mappings
   */
  private static perform_exact_name_matching (source_bones: BoneMetadata[],
    target_bones: BoneMetadata[], category_mappings: Map<string, string>): void {

    for (const target_bone_meta of target_bones) {
      // Skip if already mapped
      if (category_mappings.has(target_bone_meta.name)) continue

      for (const source_bone_meta of source_bones) {
        if (source_bone_meta.name === target_bone_meta.name) {
          category_mappings.set(target_bone_meta.name, source_bone_meta.name)
          break
        }
      }
    }
  }
}
