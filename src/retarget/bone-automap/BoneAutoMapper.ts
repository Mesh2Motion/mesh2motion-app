import { Bone, Group, Object3D, Scene, SkinnedMesh } from 'three'
import { BoneCategoryMapper } from './BoneCategoryMapper'
import { MixamoMapper } from './MixamoMapper'
import { RigifyMapper } from './RigifyMapper'
import { TargetBoneMappingType } from '../steps/StepBoneMapping'
import { AnimationRetargetService } from '../AnimationRetargetService'

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
   * @param target_armature - Target skeleton armature (uploaded mesh)
   * @returns Map of target bone name -> source bone name
   */
  public static auto_map_bones (): Map<string, string> {
    // mappings: final output mapping of target bone name to source bone name
    let mappings = new Map<string, string>()

    // Traverse source skeleton to build parent-child relationships
    const source_armature: Group | null = AnimationRetargetService.getInstance().get_source_armature()
    if (source_armature === null) {
      console.error('Source armature is null while extracting bone parent map.')
      return new Map<string, string>()
    }

    // Create metadata for both source and target bones
    const retarget_service: AnimationRetargetService = AnimationRetargetService.getInstance()
    let source_bones_meta: BoneMetadata[] = []
    let target_bones_meta: BoneMetadata[] = []

    if (retarget_service.get_source_armature().children.length > 0) {
      source_bones_meta = BoneAutoMapper.create_all_bone_metadata(retarget_service.get_source_armature(), true)
    }

    if (retarget_service.get_target_armature().children.length > 0) {
      target_bones_meta = BoneAutoMapper.create_all_bone_metadata(retarget_service.get_target_armature(), false)
    }

    console.log('\n=== FINAL BONE METADATA ===')
    console.log('Source bones metadata:', source_bones_meta)
    console.log('Target bones metadata:', target_bones_meta)

    // if the target is a mixamo rig and our skeleton type is human, we can do a direct name mapping
    // without worrying about guessing
    if (retarget_service.get_target_mapping_type() === TargetBoneMappingType.Mixamo) {
      console.log('Target skeleton appears to be a Mixamo rig, performing direct name mapping...')
      mappings = MixamoMapper.map_mixamo_bones(source_bones_meta, target_bones_meta)
      return mappings
    }

    if (retarget_service.get_target_mapping_type() === TargetBoneMappingType.Rigify) {
      console.log('Target skeleton appears to be a Rigify rig, performing direct name mapping...')
      mappings = RigifyMapper.map_rigify_bones(source_bones_meta, target_bones_meta)
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
   * Create metadata objects for all bones from a parent map
   * @param parent_map - Map of bone name -> parent bone name
   * @returns Array of BoneMetadata for all bones
   */
  private static create_all_bone_metadata (armature: Group | Scene, is_source_skeleton: boolean): BoneMetadata[] {
    const metadata_list: BoneMetadata[] = []
    const bones: Bone[] = []

    // the source M2M skeleton is a Group that contains a lot of bones...but no Skinned Meshes, 
    // so just traverse the tree and build the bone list directly
    if (is_source_skeleton) {
      armature.traverse((child: Object3D) => {
        if (child.type === 'Bone') {
          bones.push(child as Bone)
        }
      })
    } else {
      // if we find multiple skinned meshes, we will log a warning. Probably won't be an issue, but just putting
      // this in there for now
      let skinned_mesh_found: boolean = false
      let skinned_mesh: SkinnedMesh | null = null
      armature.traverse((child: Object3D) => {
        if (child.type === 'SkinnedMesh') {
          if (skinned_mesh_found) {
            console.log('create_all_bone_metadata(): Multiple SkinnedMesh objects found in armature. Only processing the first one.')
            return
          }
          skinned_mesh_found = true
          skinned_mesh = child as SkinnedMesh
        }
      })

      if (skinned_mesh !== null) {
        bones.push(...(skinned_mesh as SkinnedMesh).skeleton.bones)
      }
    }

    // create metadata for each bone
    for (const bone of bones) {
      const bone_name: string = bone.name
      const parent_name: string | null = (bone.parent !== null) ? bone.parent.name : null
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

    // Remove common prefixes
    name = name.replace(/^def-/g, '') // Blender DEF prefix
    name = name.replace(/^org-/g, '') // Rigify ORG prefix
    name = name.replace(/^mixamorig:?/g, '') // Mixamo prefix (with optional colon)

    // Remove spaces, underscores, dots, hyphens, colons
    name = name.replace(/[\s_.\-:]/g, '')

    // Remove L/R identifiers (we use side detection instead)
    name = name.replace(/l$/g, '')
    name = name.replace(/r$/g, '')

    // Remove trailing numbers (segment indices like ".001" or "01")
    name = name.replace(/\d+$/g, '')

    // Strip another trailing l/r in case digits sat between letter and number (e.g. "thumb01l")
    name = name.replace(/l$/g, '')
    name = name.replace(/r$/g, '')

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
    if (normalized_name.includes('spine') || normalized_name.includes('chest') || normalized_name.includes('neck') ||
      normalized_name.includes('head') || normalized_name.includes('hips') || normalized_name.includes('pelvis')) {
      return BoneCategory.Torso
    }

    if (normalized_name.includes('shoulder') || normalized_name.includes('upperarm') ||
      normalized_name.includes('forearm') || normalized_name.includes('hand') || normalized_name.includes('wrist')) {
      return BoneCategory.Arms
    }

    if (normalized_name.includes('thumb') || normalized_name.includes('index') || normalized_name.includes('middle') ||
      normalized_name.includes('ring') || normalized_name.includes('pinky')) {
      return BoneCategory.Hands
    }

    if (normalized_name.includes('thigh') || normalized_name.includes('shin') || normalized_name.includes('knee') ||
      normalized_name.includes('foot') || normalized_name.includes('toe') || normalized_name.includes('calf')) {
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
