import { type AnimationClip, type Bone, type Object3D, Skeleton, type SkinnedMesh } from 'three'
import { BoneAutoMapper } from '../../../retarget/bone-automap/BoneAutoMapper.ts'
import { type TargetBoneMappingType } from '../../../retarget/bone-automap/TargetBoneMappingType.ts'
import { HumanChainConfig } from '../../../retarget/human-retargeting/HumanChainConfig.ts'
import { HumanClipRetargeter } from '../../../retarget/human-retargeting/HumanClipRetargeter.ts'
import { Rig } from '../../../retarget/human-retargeting/Rig.ts'
import { RetargetUtils, type BoneRestTransform } from '../../../retarget/RetargetUtils.ts'
import { IncompatibleSkeletonError } from './AnimationImportErrors.ts'

/**
 * Retargets animations authored on another humanoid rig (Mixamo, Rigify, etc) onto the
 * Mesh2Motion human skeleton the user is animating.
 *
 * This is the retarget page run backwards: there, Mesh2Motion animations drive an
 * uploaded rig. Here, the imported file's rig drives the Mesh2Motion rig. Bone mapping
 * and swing-twist retargeting are shared with the retarget page; only the direction differs.
 */
export class ImportedAnimationRetargeter {
  // chains that have to map completely before a retarget is worth showing. Without
  // these the character would be missing a limb or its hips
  private static readonly REQUIRED_CHAINS: string[] = ['pelvis', 'armL', 'armR', 'legL', 'legR']

  private readonly source_skeleton: Skeleton
  private readonly source_rest_transforms: BoneRestTransform[]
  private readonly source_config: Record<string, string[]>

  private readonly target_skinned_mesh: SkinnedMesh
  private readonly target_rest_transforms: BoneRestTransform[]
  private readonly target_config: Record<string, string[]>

  public readonly mapping_type: TargetBoneMappingType

  private constructor (
    source_skeleton: Skeleton,
    source_config: Record<string, string[]>,
    target_skinned_mesh: SkinnedMesh,
    target_config: Record<string, string[]>,
    mapping_type: TargetBoneMappingType
  ) {
    this.source_skeleton = source_skeleton
    this.source_config = source_config
    this.target_skinned_mesh = target_skinned_mesh
    this.target_config = target_config
    this.mapping_type = mapping_type

    // the file was just loaded and nothing has played on it, so its bones are at rest
    this.source_rest_transforms = RetargetUtils.capture_bone_rest_transforms(source_skeleton)

    // our skeleton is probably mid-animation, so recover its rest pose from the bind matrices
    this.target_rest_transforms = RetargetUtils.capture_bind_pose_rest_transforms(target_skinned_mesh)
  }

  /**
   * Map the imported file's rig onto the Mesh2Motion skeleton
   * @param source_scene - scene that came with the imported animations, holding their rig
   * @param target_skinned_mesh - any skinned mesh bound to the Mesh2Motion skeleton
   * @throws {IncompatibleSkeletonError} If the file has no rig or it does not map onto a human
   */
  public static create (source_scene: Object3D, target_skinned_mesh: SkinnedMesh): ImportedAnimationRetargeter {
    // bones come out parents-first, which Pose relies on
    const source_bones: Bone[] = RetargetUtils.collect_bones(source_scene)
    if (source_bones.length === 0) {
      throw new IncompatibleSkeletonError('The file has no skeleton, so its animations can\'t be retargeted.')
    }

    const target_bones: Bone[] = target_skinned_mesh.skeleton.bones

    // the bone mapper calls the Mesh2Motion rig the source. Ours is the receiving end here,
    // so the file's rig goes in as the mapper's "target"
    const mapping_type: TargetBoneMappingType = BoneAutoMapper.detect_mapping_type(
      target_bones.map(bone => bone.name),
      source_bones.map(bone => bone.name)
    )
    const bone_mapping: Map<string, string> = BoneAutoMapper.map_bones(target_bones, source_bones, mapping_type)

    const { mesh2motion_config, other_rig_config } = HumanChainConfig.build_mapped_chain_configs(bone_mapping)
    ImportedAnimationRetargeter.validate_required_chains(mesh2motion_config)

    source_scene.updateMatrixWorld(true)
    const source_skeleton = new Skeleton(source_bones)

    return new ImportedAnimationRetargeter(
      source_skeleton, other_rig_config, target_skinned_mesh, mesh2motion_config, mapping_type)
  }

  /**
   * Bake one clip from the imported rig onto the Mesh2Motion skeleton
   * @param clip - clip authored on the imported rig
   * @param clip_name - name for the baked clip
   * @returns new clip with tracks named after the Mesh2Motion bones. Positions are already
   *          in the final skeleton's space, so skeleton scale must not be applied again
   */
  public retarget (clip: AnimationClip, clip_name: string): AnimationClip {
    // a previous clip leaves the source bones mid-animation. Bones the next clip never
    // touches would keep that pose, and the rig has to be built from rest anyway
    this.source_skeleton.bones.forEach((bone, index) => {
      bone.position.copy(this.source_rest_transforms[index].position)
      bone.quaternion.copy(this.source_rest_transforms[index].quaternion)
      bone.scale.copy(this.source_rest_transforms[index].scale)
    })
    this.source_skeleton.bones[0].parent?.updateMatrixWorld(true)

    const source_rig: Rig = new Rig(this.source_skeleton).fromConfig(this.source_config)

    // baking poses the target skeleton, so work on a detached copy of ours
    const target_skeleton: Skeleton = RetargetUtils.clone_skeleton(
      this.target_skinned_mesh.skeleton, this.target_rest_transforms)
    const target_rig: Rig = new Rig(target_skeleton).fromConfig(this.target_config)

    return HumanClipRetargeter.retarget(clip, source_rig, target_rig, { clip_name })
  }

  private static validate_required_chains (mesh2motion_config: Record<string, string[]>): void {
    const missing_bones: string[] = ImportedAnimationRetargeter.REQUIRED_CHAINS
      .flatMap(chain_name => HumanChainConfig.mesh2motion_config[chain_name]
        .filter((_bone_name, index) => mesh2motion_config[chain_name][index] === ''))

    if (missing_bones.length > 0) {
      throw new IncompatibleSkeletonError(
        'We couldn\'t match this animation\'s skeleton to the Mesh2Motion human rig.\n' +
        'Mesh2Motion and Mixamo rigs are supported. Other humanoid rigs work when their bone names are recognizable.\n\n' +
        'No match found for: ' + missing_bones.join(', '))
    }
  }
}
