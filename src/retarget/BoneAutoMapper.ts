/**
 * Bone categories for grouping bones by anatomical area
 */
export enum BoneCategory {
  Torso = 'torso',
  Arms = 'arms',
  Hands = 'hands',
  Legs = 'legs',
  Wings = 'wings',
  Tail = 'tail',
  Unknown = 'unknown'
}

/**
 * Side of the body a bone belongs to
 */
export enum BoneSide {
  Left = 'left',
  Right = 'right',
  Center = 'center',
  Unknown = 'unknown'
}

/**
 * Metadata extracted from a bone name
 */
export interface BoneMetadata {
  name: string // Original bone name
  normalized_name: string // Normalized version for matching
  side: BoneSide // Which side of the body
  category: BoneCategory // Anatomical category
}

/**
 * BoneAutoMapper - Handles automatic bone mapping between source and target skeletons
 * Source = Mesh2Motion skeleton (draggable bones)
 * Target = Uploaded mesh skeleton (drop zones)
 * Uses string comparison and pattern matching to suggest bone mappings
 */
export class BoneAutoMapper {
  /**
   * Attempts to automatically map source bones (Mesh2Motion) to target bones (uploaded mesh)
   * @param source_bone_names - Array of bone names from the Mesh2Motion skeleton (source)
   * @param target_bone_names - Array of bone names from the uploaded mesh skeleton (target)
   * @returns Map of target bone name -> source bone name
   */
  public static auto_map_bones (source_bone_names: string[], target_bone_names: string[]): Map<string, string> {
    const mappings = new Map<string, string>()
    const used_source_bones = new Set<string>()

    // Create metadata for both source and target bones
    console.log('=== SOURCE BONES ===')
    const source_bones_meta = this.categorize_bones(source_bone_names)
    
    console.log('\n=== TARGET BONES ===')
    const target_bones_meta = this.categorize_bones(target_bone_names)

    console.log('\n=== FINAL BONE METADATA ===')
    console.log('Source bones metadata:', source_bones_meta)
    console.log('Target bones metadata:', target_bones_meta)

    // Match bones within each category
    const categories: BoneCategory[] = [
      BoneCategory.Torso,
      BoneCategory.Arms,
      BoneCategory.Hands,
      BoneCategory.Legs,
      BoneCategory.Wings,
      BoneCategory.Tail,
      BoneCategory.Unknown
    ]
    for (const category of categories) {
      const source_bones_in_category = source_bones_meta.filter(b => b.category === category)
      const target_bones_in_category = target_bones_meta.filter(b => b.category === category)

      for (const target_bone_meta of target_bones_in_category) {
        const best_match = this.find_best_match(target_bone_meta, source_bones_in_category, used_source_bones)
        if (best_match !== null) {
          mappings.set(target_bone_meta.name, best_match.name)
          used_source_bones.add(best_match.name)
        }
      }
    }

    return mappings
  }

  /**
   * Create metadata for an array of bone names
   * @param bone_names - Array of bone names to process
   * @returns Array of bone metadata objects
   */
  private static categorize_bones (bone_names: string[]): BoneMetadata[] {
    const bones_metadata: BoneMetadata[] = []

    // console.log('\n--- Bone Categorization ---')
    for (const bone_name of bone_names) {
      const metadata = this.create_bone_metadata(bone_name)
      bones_metadata.push(metadata)
      // console.log(`  "${bone_name}" → ${metadata.category} (${metadata.side})${metadata.normalized_name !== bone_name.toLowerCase() ? ` [normalized: ${metadata.normalized_name}]` : ''}`)
    }

    // Log summary counts
    console.log('\n--- Category Summary ---')
    const categories: BoneCategory[] = [
      BoneCategory.Torso,
      BoneCategory.Arms,
      BoneCategory.Hands,
      BoneCategory.Legs,
      BoneCategory.Wings,
      BoneCategory.Tail,
      BoneCategory.Unknown
    ]
    for (const category of categories) {
      const bones_in_category = bones_metadata.filter(b => b.category === category)
      const count = bones_in_category.length
      if (count > 0) {
        const left_count = bones_in_category.filter(b => b.side === BoneSide.Left).length
        const right_count = bones_in_category.filter(b => b.side === BoneSide.Right).length
        const center_count = bones_in_category.filter(b => b.side === BoneSide.Center).length
        console.log(`  ${category}: ${count} bones (L:${left_count}, R:${right_count}, C:${center_count})`)
      }
    }
    console.log('---\n')

    return bones_metadata
  }

  /**
   * Categorize a single bone based on keywords in its name
   * @param bone_name - Bone name to categorize
   * @returns The category this bone belongs to
   */
  private static categorize_bone (bone_name: string): BoneCategory {
    const normalized = bone_name.toLowerCase()

    // Torso keywords
    const torso_keywords = ['spine', 'chest', 'neck', 'head', 'hips', 'pelvis', 'root', 'cog', 'center', 'torso', 'back', 'ribcage']
    if (torso_keywords.some(keyword => normalized.includes(keyword))) {
      return BoneCategory.Torso
    }

    // Arm keywords
    const arm_keywords = ['shoulder', 'arm', 'elbow', 'wrist', 'clavicle', 'scapula', 'upperarm', 'forearm']
    if (arm_keywords.some(keyword => normalized.includes(keyword))) {
      return BoneCategory.Arms
    }

    // Hand keywords
    const hand_keywords = ['hand', 'finger', 'thumb', 'index', 'middle', 'ring', 'pinky', 'palm', 'knuckle', 'metacarpal', 'phalanx']
    if (hand_keywords.some(keyword => normalized.includes(keyword))) {
      return BoneCategory.Hands
    }

    // Leg keywords
    const leg_keywords = ['leg', 'thigh', 'knee', 'ankle', 'foot', 'toe', 'heel', 'hip', 'upperleg', 'lowerleg', 'shin', 'calf']
    if (leg_keywords.some(keyword => normalized.includes(keyword))) {
      return BoneCategory.Legs
    }

    // Wing keywords
    const wing_keywords = ['wing', 'feather', 'pinion']
    if (wing_keywords.some(keyword => normalized.includes(keyword))) {
      return BoneCategory.Wings
    }

    // Tail keywords
    const tail_keywords = ['tail']
    if (tail_keywords.some(keyword => normalized.includes(keyword))) {
      return BoneCategory.Tail
    }

    // If no category matched, return unknown
    return BoneCategory.Unknown
  }

  /**
   * Create metadata for a bone including category, side, and normalized name
   * @param bone_name - Original bone name
   * @returns BoneMetadata object
   */
  private static create_bone_metadata (bone_name: string): BoneMetadata {
    const category: BoneCategory = this.categorize_bone(bone_name)
    const side: BoneSide = this.determine_bone_side(bone_name, category)
    const normalized_name: string = this.normalize_bone_name(bone_name)

    return {
      name: bone_name,
      normalized_name,
      side,
      category
    }
  }

  /**
   * Determine which side of the body a bone belongs to
   * @param bone_name - Bone name to analyze
   * @param category - The bone's category (used to determine if it should be center)
   * @returns The side this bone belongs to
   */
  private static determine_bone_side (bone_name: string, category: BoneCategory): BoneSide {
    const normalized = bone_name.toLowerCase()

    // Torso bones or bones with no clear side indicator default to center
    if (category === BoneCategory.Torso) {
      return BoneSide.Center
    }

    // Check for left indicators
    // ^l_ means starts with l_
    // _left$ means ends with _left
    const left_patterns = ['left$', '^left', '^l_', '_l$']
    if (left_patterns.some(pattern => new RegExp(pattern).test(normalized))) {
      return BoneSide.Left
    }

    // Check for right indicators
    // ^r_ means starts with r_
    const right_patterns = ['right$', '^right', '^r_', '_r$']
    if (right_patterns.some(pattern => new RegExp(pattern).test(normalized))) {
      return BoneSide.Right
    }

    // if those don't match, let's fall back to see if the last character is L or R
    // this is common in Blender rigs (e.g., "arm_L", "leg_R")
    const last_char = normalized.charAt(normalized.length - 1)
    if (last_char.toLowerCase() === 'l') {
      return BoneSide.Left
    } else if (last_char.toLowerCase() === 'r') {
      return BoneSide.Right
    }

    return BoneSide.Unknown // mark as unknown to help us develop this more later
  }

  /**
   * Find the best matching source bone (Mesh2Motion) for a given target bone (uploaded mesh)
   * @param target_bone_meta - Target bone metadata to match (uploaded mesh)
   * @param source_bones_meta - Array of source bone metadata to search (Mesh2Motion skeleton)
   * @param used_source_bones - Set of source bone names that have already been mapped
   * @returns Best matching source bone metadata, or null if no good match found
   */
  private static find_best_match (target_bone_meta: BoneMetadata, source_bones_meta: BoneMetadata[], used_source_bones: Set<string>): BoneMetadata | null {
    let best_match: BoneMetadata | null = null
    let best_score = 0

    for (const source_bone_meta of source_bones_meta) {
      // Skip if this source bone has already been used
      if (used_source_bones.has(source_bone_meta.name)) {
        continue
      }

      const score = this.calculate_similarity(target_bone_meta.normalized_name, source_bone_meta.normalized_name)

      // Boost score if sides match
      let adjusted_score = score
      if (target_bone_meta.side === source_bone_meta.side) {
        adjusted_score *= 1.2 // 20% bonus for matching sides
      } else if (target_bone_meta.side !== BoneSide.Center && source_bone_meta.side !== BoneSide.Center) {
        // Penalize if sides don't match (unless one is center)
        adjusted_score *= 0.7
      }

      // Require a minimum threshold for matching
      if (adjusted_score > best_score && score >= 0.6) {
        best_score = adjusted_score
        best_match = source_bone_meta
      }
    }

    return best_match
  }

  /**
   * Normalize bone names for comparison by:
   * - Converting to lowercase
   * - Removing common prefixes/suffixes
   * - Standardizing separators
   */
  private static normalize_bone_name (bone_name: string): string {
    let normalized = bone_name.toLowerCase()

    // Replace various separators with underscores
    normalized = normalized.replace(/[-.\s]/g, '_')

    // Remove common prefixes
    normalized = normalized.replace(/^(mixamorig|mixamorig_|rig_|bone_|jnt_|joint_|def_)/i, '')

    // Standardize left/right notation
    normalized = normalized.replace(/\bleft\b/g, 'l')
    normalized = normalized.replace(/\bright\b/g, 'r')
    normalized = normalized.replace(/^l_/g, 'left_')
    normalized = normalized.replace(/^r_/g, 'right_')
    normalized = normalized.replace(/_l$/g, '_left')
    normalized = normalized.replace(/_r$/g, '_right')

    return normalized
  }

  /**
   * Calculate similarity score between two normalized bone names
   * Uses a combination of exact match, contains, and Levenshtein distance
   */
  private static calculate_similarity (name1: string, name2: string): number {
    // Exact match
    if (name1 === name2) {
      return 1.0
    }

    // One contains the other
    if (name1.includes(name2) || name2.includes(name1)) {
      const longer = Math.max(name1.length, name2.length)
      const shorter = Math.min(name1.length, name2.length)
      return 0.8 + (shorter / longer) * 0.2
    }

    // Use Levenshtein distance for fuzzy matching
    const distance = this.levenshtein_distance(name1, name2)
    const max_length = Math.max(name1.length, name2.length)
    const similarity = 1 - (distance / max_length)

    return similarity
  }

  /**
   * Calculate Levenshtein distance between two strings
   * (minimum number of single-character edits required to change one string into another)
   */
  private static levenshtein_distance (str1: string, str2: string): number {
    const len1 = str1.length
    const len2 = str2.length
    const matrix: number[][] = []

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost // substitution
        )
      }
    }

    return matrix[len1][len2]
  }
}
