import { Bone, Group, Object3D, Scene, SkinnedMesh } from 'three'
import { BoneCategoryMapper } from './BoneCategoryMapper'
import { MixamoMapper } from './MixamoMapper'
import { TargetBoneMappingType } from '../steps/StepBoneMapping'

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
  parent_name: string | null // Name of parent bone, null if root
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
   * @param source_armature - Source skeleton armature (Mesh2Motion skeleton)
   * @param target_skeleton_data - Target skeleton data (uploaded mesh)
   * @returns Map of target bone name -> source bone name
   */
  public static auto_map_bones (
    source_armature: Group,
    target_skeleton_data: Scene,
    target_bone_mapping_type: TargetBoneMappingType
  ): Map<string, string> {
    // mappings: final output mapping of target bone name to source bone name
    let mappings = new Map<string, string>()

    // Extract bone data from both skeletons
    // this also contains the parent bone relationship
    // which will help us later when doing auto-mapping calculations
    const source_parent_map: Map<string, string | null> = this.extract_source_bone_parent_map(source_armature)
    const target_parent_map: Map<string, string | null> = this.extract_target_bone_parent_map(target_skeleton_data)

    // Create metadata for both source and target bones
    const source_bones_meta: BoneMetadata[] = this.create_all_bone_metadata(source_parent_map)
    const target_bones_meta: BoneMetadata[] = this.create_all_bone_metadata(target_parent_map)

    console.log('\n=== FINAL BONE METADATA ===')
    console.log('Source bones metadata:', source_bones_meta)
    console.log('Target bones metadata:', target_bones_meta)

    // if the target is a mixamo rig and our skeleton type is human, we can do a direct name mapping
    // without worrying about guessing
    if (target_bone_mapping_type === TargetBoneMappingType.Mixamo) {
      console.log('Target skeleton appears to be a Mixamo rig, performing direct name mapping...')
      mappings = MixamoMapper.map_mixamo_bones(source_bones_meta, target_bones_meta)
      return mappings
    }

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
      const source_bones_in_category: BoneMetadata[] = source_bones_meta.filter(b => b.category === category)
      const target_bones_in_category: BoneMetadata[] = target_bones_meta.filter(b => b.category === category)

      switch (category) {
        case BoneCategory.Torso: {
          const torso_mappings = BoneCategoryMapper.map_torso_bones(source_bones_in_category, target_bones_in_category)
          mappings = new Map([...mappings, ...torso_mappings])
          break
        }
        case BoneCategory.Arms: {
          const arm_mappings = BoneCategoryMapper.map_arm_bones(source_bones_in_category, target_bones_in_category)
          mappings = new Map([...mappings, ...arm_mappings])
          break
        }
        case BoneCategory.Hands: {
          const hand_mappings = BoneCategoryMapper.map_hand_bones(source_bones_in_category, target_bones_in_category)
          mappings = new Map([...mappings, ...hand_mappings])
          break
        }
        case BoneCategory.Legs: {
          const leg_mappings = BoneCategoryMapper.map_leg_bones(source_bones_in_category, target_bones_in_category)
          mappings = new Map([...mappings, ...leg_mappings])
          break
        }
        case BoneCategory.Wings: {
          const wing_mappings = BoneCategoryMapper.map_wing_bones(source_bones_in_category, target_bones_in_category)
          mappings = new Map([...mappings, ...wing_mappings])
          break
        }
        case BoneCategory.Tail: {
          const tail_mappings = BoneCategoryMapper.map_tail_bones(source_bones_in_category, target_bones_in_category)
          mappings = new Map([...mappings, ...tail_mappings])
          break
        }
        case BoneCategory.Unknown: {
          const unknown_mappings = BoneCategoryMapper.map_unknown_bones(source_bones_in_category, target_bones_in_category)
          mappings = new Map([...mappings, ...unknown_mappings])
          break
        }
      }
    }

    console.log('\n=== Auto-mapped bones summary ===')
    console.log('Final mappings:', mappings)

    return mappings
  }

  /**
   * Extract parent relationships for source skeleton (Mesh2Motion armature)
   * @param source_armature - Source skeleton armature
   * @returns Map of bone name -> parent bone name (or null if root)
   */
  private static extract_source_bone_parent_map (source_armature: Group): Map<string, string | null> {
    const parent_map = new Map<string, string | null>()

    // Traverse source skeleton to build parent-child relationships
    source_armature.traverse((child: Object3D) => {
      if (child.type === 'Bone') {
        const bone = child
        const parent_name = (bone.parent != null && bone.parent.type === 'Bone') ? bone.parent.name : null
        parent_map.set(bone.name, parent_name)
      }
    })

    return parent_map
  }

  /**
   * Extract parent relationships for target skeleton (uploaded mesh)
   * @param target_skeleton_data - Target skeleton data
   * @returns Map of bone name -> parent bone name (or null if root)
   */
  private static extract_target_bone_parent_map (target_skeleton_data: Scene): Map<string, string | null> {
    const parent_map = new Map<string, string | null>()

    // Traverse all SkinnedMesh objects in the target skeleton data
    target_skeleton_data.traverse((child: Object3D) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh

        // For each bone in the skeleton, record parent relationship
        for (const bone of skinned_mesh.skeleton.bones) {
          const parent_name = (bone.parent != null && bone.parent.type === 'Bone') ? bone.parent.name : null
          parent_map.set(bone.name, parent_name)
        }
      }
    })

    return parent_map
  }

  /**
   * Create metadata objects for all bones from a parent map
   * @param parent_map - Map of bone name -> parent bone name
   * @returns Array of BoneMetadata for all bones
   */
  private static create_all_bone_metadata (parent_map: Map<string, string | null>): BoneMetadata[] {
    const metadata_list: BoneMetadata[] = []

    for (const [bone_name, parent_name] of parent_map.entries()) {
      const normalized_name: string = this.normalize_bone_name(bone_name)
      const side: BoneSide = this.detect_bone_side(bone_name)
      const category: BoneCategory = this.detect_bone_category(normalized_name)

      const metadata: BoneMetadata = {
        name: bone_name,
        normalized_name,
        side,
        category,
        parent_name
      }

      metadata_list.push(metadata)
    }

    return metadata_list
  }

  /**
   * Normalize bone names to simplify matching
   * - Lowercase
   * - Remove spaces and underscores
   * - Remove common prefixes and suffixes
   */
  private static normalize_bone_name (bone_name: string): string {
    let name = bone_name.toLowerCase()

    // Remove spaces and underscores
    name = name.replace(/\s+/g, '')
    name = name.replace(/_/g, '')

    // Remove common prefixes
    name = name.replace(/^def-/g, '') // Blender DEF prefix
    name = name.replace(/^mixamorig/g, '') // Mixamo prefix

    // Remove common suffixes
    name = name.replace(/\.\d+$/g, '') // Blender numeric suffixes (e.g., ".001")

    // Remove L/R identifiers (we use side detection instead)
    name = name.replace(/l$/g, '')
    name = name.replace(/r$/g, '')

    // Remove number identifiers (we use order detection instead)
    name = name.replace(/\d+$/g, '')

    return name
  }

  /**
   * Detect which side of the body a bone belongs to
   * Based on common naming conventions (L/R, Left/Right)
   */
  private static detect_bone_side (bone_name: string): BoneSide {
    const lower_name = bone_name.toLowerCase()

    if (lower_name.includes('left') || lower_name.endsWith('l')) return BoneSide.Left
    if (lower_name.includes('right') || lower_name.endsWith('r')) return BoneSide.Right

    return BoneSide.Center
  }

  /**
   * Detect anatomical category based on normalized bone name and parent relationships
   */
  private static detect_bone_category (normalized_name: string): BoneCategory {
    if (normalized_name.includes('spine') || normalized_name.includes('chest') || normalized_name.includes('neck') || normalized_name.includes('head') || normalized_name.includes('hips')) {
      return BoneCategory.Torso
    }

    if (normalized_name.includes('shoulder') || normalized_name.includes('upperarm') || normalized_name.includes('forearm') || normalized_name.includes('hand') || normalized_name.includes('wrist')) {
      return BoneCategory.Arms
    }

    if (normalized_name.includes('thumb') || normalized_name.includes('index') || normalized_name.includes('middle') || normalized_name.includes('ring') || normalized_name.includes('pinky')) {
      return BoneCategory.Hands
    }

    if (normalized_name.includes('thigh') || normalized_name.includes('shin') || normalized_name.includes('knee') || normalized_name.includes('foot') || normalized_name.includes('toe') || normalized_name.includes('calf')) {
      return BoneCategory.Legs
    }

    if (normalized_name.includes('wing') || normalized_name.includes('feather') || normalized_name.includes('pinion')) {
      return BoneCategory.Wings
    }

    if (normalized_name.includes('tail')) {
      return BoneCategory.Tail
    }

    return BoneCategory.Unknown
  }
}
