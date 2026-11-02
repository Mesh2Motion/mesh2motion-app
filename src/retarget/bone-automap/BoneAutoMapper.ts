import { type Bone, type Object3D, type SkinnedMesh } from 'three'
import { BoneCategoryMapper } from './BoneCategoryMapper'
import { BoneChainResolver, type RawBoneRecord } from './BoneChainResolver'
import { CanonicalSlotMapper } from './CanonicalSlotMapper'
import { Mesh2MotionMapper } from './Mesh2MotionMapper'
import { MixamoMapper } from './MixamoMapper'
import { RigifyMapper } from './RigifyMapper'
import { TargetBoneMappingType } from './TargetBoneMappingType'

// re-exported so existing imports from './BoneAutoMapper' keep working
export { BoneCategory, BoneSide, BoneSlot, type BoneMetadata } from './BoneTypes'
import { type BoneMetadata } from './BoneTypes'

/**
 * BoneAutoMapper - Handles automatic bone mapping between a Mesh2Motion skeleton and another rig
 * Source = Mesh2Motion skeleton
 * Target = the other rig (an uploaded mesh on the retarget page, or the rig an imported
 *          animation was authored on in the main app)
 *
 * Rigs that match a known template (Mixamo, Rigify) go through that template's
 * exact table. Everything else goes through canonical slot resolution, which
 * reduces both skeletons to (joint, side, position-in-chain) and matches on that -
 * see BoneSlotVocabulary and BoneChainResolver.
 *
 * Holds no state, so it works the same whichever direction the animation flows.
 */
export class BoneAutoMapper {
  /**
   * Work out which known template, if any, the target rig follows
   * @param source_bone_names - Mesh2Motion bone names
   * @param target_bone_names - other rig's bone names
   */
  public static detect_mapping_type (source_bone_names: string[], target_bone_names: string[]): TargetBoneMappingType {
    if (MixamoMapper.is_target_valid_skeleton(target_bone_names)) {
      return TargetBoneMappingType.Mixamo
    }

    if (RigifyMapper.is_target_valid_skeleton(target_bone_names)) {
      return TargetBoneMappingType.Rigify
    }

    if (Mesh2MotionMapper.is_source_bones_same_as_target(source_bone_names, target_bone_names)) {
      return TargetBoneMappingType.Mesh2Motion
    }

    return TargetBoneMappingType.Custom
  }

  /**
   * Attempts to automatically map source bones (Mesh2Motion) to target bones (uploaded mesh)
   * @param source_armature - Mesh2Motion armature. A plain Group of Bones, no skinned meshes
   * @param target_armature - other rig. Bones are read off its first SkinnedMesh
   * @param mapping_type - template detected for the target rig
   * @returns Map of target bone name -> source bone name
   */
  public static auto_map_bones (
    source_armature: Object3D, target_armature: Object3D, mapping_type: TargetBoneMappingType
  ): Map<string, string> {
    const source_bones: Bone[] = source_armature.children.length > 0
      ? BoneAutoMapper.collect_armature_bones(source_armature)
      : []

    const target_bones: Bone[] = target_armature.children.length > 0
      ? BoneAutoMapper.collect_skinned_mesh_bones(target_armature)
      : []

    return BoneAutoMapper.map_bones(source_bones, target_bones, mapping_type)
  }

  /**
   * Map Mesh2Motion bones to another rig's bones
   * @param source_bones - Mesh2Motion bones
   * @param target_bones - other rig's bones
   * @param mapping_type - template detected for the target rig
   * @returns Map of target bone name -> source bone name
   */
  public static map_bones (
    source_bones: Bone[], target_bones: Bone[], mapping_type: TargetBoneMappingType
  ): Map<string, string> {
    const source_bones_meta: BoneMetadata[] = BoneAutoMapper.create_bone_metadata(source_bones)
    const target_bones_meta: BoneMetadata[] = BoneAutoMapper.create_bone_metadata(target_bones)

    // known templates get a direct name mapping without worrying about guessing
    if (mapping_type === TargetBoneMappingType.Mixamo) {
      console.log('Target skeleton appears to be a Mixamo rig, performing direct name mapping...')
      return MixamoMapper.map_mixamo_bones(source_bones_meta, target_bones_meta)
    }

    if (mapping_type === TargetBoneMappingType.Rigify) {
      console.log('Target skeleton appears to be a Rigify rig, performing direct name mapping...')
      return RigifyMapper.map_rigify_bones(source_bones_meta, target_bones_meta)
    }

    return BoneAutoMapper.map_by_canonical_slots(source_bones_meta, target_bones_meta)
  }

  /**
   * Map an arbitrarily named rig in three passes.
   *
   * Exact names go first: if two rigs literally agree on a bone name, nothing the
   * vocabulary infers should overrule that. Canonical slots handle the rest of the
   * humanoid skeleton, and a final loose-name pass picks up anything anatomical the
   * vocabulary has no word for - custom animal chains, accessory bones.
   *
   * Each pass carries the accumulated map forward, so a source bone claimed by one
   * pass can never be handed out again by a later one.
   *
   * Kept separate from auto_map_bones so it can be unit tested without a three.js scene.
   */
  public static map_by_canonical_slots (
    source_bones_meta: BoneMetadata[], target_bones_meta: BoneMetadata[]
  ): Map<string, string> {
    const exact_mappings = BoneCategoryMapper.match_exact_names(
      source_bones_meta, target_bones_meta, new Map()
    )

    const slot_mappings = CanonicalSlotMapper.map_bones(
      source_bones_meta, target_bones_meta, exact_mappings
    )

    const mappings = BoneCategoryMapper.match_loose_names(
      source_bones_meta, target_bones_meta, slot_mappings
    )

    console.log(`Auto-mapped ${mappings.size} bones ` +
      `(${exact_mappings.size} by exact name, ` +
      `${slot_mappings.size - exact_mappings.size} by canonical slot, ` +
      `${mappings.size - slot_mappings.size} by loose name)`)

    return mappings
  }

  /**
   * the source M2M skeleton is a Group that contains a lot of bones...but no Skinned Meshes,
   * so just traverse the tree and build the bone list directly
   */
  private static collect_armature_bones (armature: Object3D): Bone[] {
    const bones: Bone[] = []
    armature.traverse((child: Object3D) => {
      if (child.type === 'Bone') {
        bones.push(child as Bone)
      }
    })
    return bones
  }

  /**
   * target bones come off a SkinnedMesh's skeleton. If we find multiple skinned meshes,
   * we will log a warning. Probably won't be an issue, but just putting this in there for now
   */
  private static collect_skinned_mesh_bones (armature: Object3D): Bone[] {
    let skinned_mesh: SkinnedMesh | null = null
    armature.traverse((child: Object3D) => {
      if (child.type === 'SkinnedMesh') {
        if (skinned_mesh !== null) {
          console.log('collect_skinned_mesh_bones(): Multiple SkinnedMesh objects found in armature. Only processing the first one.')
          return
        }
        skinned_mesh = child as SkinnedMesh
      }
    })

    return skinned_mesh !== null ? [...(skinned_mesh as SkinnedMesh).skeleton.bones] : []
  }

  /**
   * Build resolved metadata for every bone.
   * BoneChainResolver works on plain records, so it can be tested without a scene.
   * A bone's parent is often the armature node rather than another bone; the
   * resolver treats any parent outside the bone list as no parent.
   */
  private static create_bone_metadata (bones: Bone[]): BoneMetadata[] {
    const bone_records: RawBoneRecord[] = bones.map(bone => ({
      name: bone.name,
      parent_name: bone.parent !== null ? bone.parent.name : null
    }))

    return BoneChainResolver.build_metadata(bone_records)
  }
}
