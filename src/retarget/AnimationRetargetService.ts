import {
  AnimationClip, QuaternionKeyframeTrack,
  VectorKeyframeTrack, Scene, Group, type SkinnedMesh,
  type Skeleton
} from 'three'
import { RetargetUtils, type TrackNameParts, type BoneRestTransform } from './RetargetUtils.ts'
import { Utility } from '../lib/Utilities.ts'
import { TargetBoneMappingType } from './steps/StepBoneMapping.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { Retargeter } from './human-retargeting/Retargeter.ts'
import { Rig } from './human-retargeting/Rig.ts'
import { HumanChainConfig } from './human-retargeting/HumanChainConfig.ts'
import { RetargetDiagnostics, type RestPoseSnapshot } from './RetargetDiagnostics.ts'

// AnimationRetargetService - Shared service for retargeting animations from one skeleton to another
// Used by both RetargetAnimationPreview and RetargetAnimationListing
export class AnimationRetargetService {
  private static instance: AnimationRetargetService | null = null

  // #region GETTER/SETTER
  /**
   * Get/set for the skeleton type. This will be the source of truth
   * for other classes to grab this data
   */
  private source_armature: Group = new Group()
  private skeleton_type: SkeletonType = SkeletonType.None
  private target_armature: Scene = new Scene()

  private target_skinned_meshes: SkinnedMesh[] = []

  // rest pose of the target skeleton, captured at load time. The retargeting working copy
  // is restored to this instead of using native Skeleton.pose() - see clone_skeleton
  private target_rest_transforms: BoneRestTransform[] = []

  private target_mapping_type: TargetBoneMappingType = TargetBoneMappingType.Custom
  private bone_mappings: Map<string, string> = new Map<string, string>()

  // corrective X-axis rotation (degrees) applied to the whole target rig during
  // human swing-twist retargeting. Helps rigs that have no root bone and whose
  // pelvis rest orientation leaves the character tilted (face planting)
  private root_correction_x_degrees: number = 0

  public set_root_correction_x_degrees (degrees: number): void {
    this.root_correction_x_degrees = degrees
  }

  public get_root_correction_x_degrees (): number {
    return this.root_correction_x_degrees
  }

  public set_bone_mappings (mappings: Map<string, string>): void {
    this.bone_mappings = mappings
  }

  public get_bone_mappings (): Map<string, string> {
    return this.bone_mappings
  }

  public clear_bone_mappings (): void {
    this.bone_mappings.clear()
  }

  public reset_target_mapping_type (): void {
    this.set_target_mapping_type(TargetBoneMappingType.Custom)
  }

  public set_source_armature (armature: Group): void {
    this.source_armature = armature
  }

  public get_source_armature (): Group {
    return this.source_armature
  }

  public set_target_armature (new_armature: Scene): void {
    this.target_armature = new_armature

    // re-calculate skinned meshes from target armature scene
    this.target_skinned_meshes = []
    this.target_armature.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        this.target_skinned_meshes.push(child as SkinnedMesh)
      }
    })

    // Capture the rest pose now, while the model is freshly loaded and nothing has played
    // it. This is the only reliable moment: once a preview animation runs, the bone locals
    // are gone and they cannot be recovered from boneInverses without also reintroducing
    // the import scale applied in StepLoadTargetModel.
    this.target_rest_transforms = this.target_skinned_meshes.length > 0
      ? RetargetUtils.capture_bone_rest_transforms(this.target_skinned_meshes[0].skeleton)
      : []
  }

  public get_target_skinned_meshes (): SkinnedMesh[] {
    return this.target_skinned_meshes
  }

  public get_target_armature (): Scene {
    return this.target_armature
  }

  public set_skeleton_type (type: SkeletonType): void {
    this.skeleton_type = type
  }

  public get_skeleton_type (): SkeletonType {
    return this.skeleton_type
  }

  public set_target_mapping_type (type: TargetBoneMappingType): void {
    this.target_mapping_type = type
  }

  public get_target_mapping_type (): TargetBoneMappingType {
    return this.target_mapping_type
  }

  // #endregion

  private constructor () {}

  // #region PUBLIC METHODS

  public static getInstance (): AnimationRetargetService {
    if (AnimationRetargetService.instance === null) {
      AnimationRetargetService.instance = new AnimationRetargetService()
    }
    return AnimationRetargetService.instance
  }

  /**
   * Retarget an animation clip using bone mappings
   * @param source_clip - The original animation clip from the source skeleton
   * @returns A new animation clip retargeted for the target skeleton
   */
  public retarget_animation_clip (source_clip: AnimationClip): AnimationClip {
    const new_tracks: Array<QuaternionKeyframeTrack | VectorKeyframeTrack> = [] // store new retargeted tracks

    // if there are no bone mappings, return the source clip as there is nothing to retarget
    if (this.bone_mappings.size === 0) {
      console.warn('No bone mappings available for retargeting. Returning source clip clone.')
      return source_clip.clone()
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // if the source skeleton is of type human, try tuse the human retargeting system
    // we ignore Mesh2Motion type since that is identical to the source and does not need retargeting
    if (this.skeleton_type === SkeletonType.Human && this.target_mapping_type !== TargetBoneMappingType.Mesh2Motion) {
      console.log('Using Human Retargeter for retargeting animation clip:', source_clip.name, this.target_mapping_type)
      return this.apply_human_swing_twist_retargeting(source_clip)
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Besides the above special case, the standard retargeting will just be bone mapping applied
    // Maybe in the future we can do other more advanced things.

    const reverse_mappings = RetargetUtils.reverse_bone_mapping(this.bone_mappings)

    // even a same-named rig (a re-imported Mesh2Motion export) is usually a
    // scaled copy of the reference skeleton, so root motion and hip height in
    // the position tracks have to be rescaled to the target's proportions
    const position_scale_delta = this.calculate_position_scale_delta()

    // Process each track in the source animation
    source_clip.tracks.forEach((track) => {
      // Parse the track name to get the bone name and property
      // Track names are typically in format: "boneName.property" or ".bones[boneName].property"
      const track_parts: TrackNameParts | null = RetargetUtils.parse_track_name_for_metadata(track.name)
      if (track_parts === null) {
        return
      }

      const source_bone_name = String(track_parts.bone_name)
      const track_property = String(track_parts.property)

      // Check if this bone is mapped to any target bones
      const target_bone_names = reverse_mappings.get(source_bone_name)
      if (target_bone_names === undefined || target_bone_names.length === 0) {
        return // Skip unmapped bones
      }

      // Create a track for each target bone this source bone maps to. Will mostly just rename
      // a bone with the mapping
      target_bone_names.forEach((target_bone_name) => {
        // track name is in the format of "boneName.property"
        const new_track_name = `${target_bone_name}.${track_property}`

        const times_copy = Float32Array.from(track.times as ArrayLike<number>)
        const values_copy = Float32Array.from(track.values as ArrayLike<number>)

        if (track_property === 'quaternion') {
          const new_track = new QuaternionKeyframeTrack(new_track_name, times_copy, values_copy)
          new_tracks.push(new_track)
        } else if (track_property === 'position' || track_property === 'scale') {
          if (track_property === 'position' && position_scale_delta !== 1) {
            for (let i = 0; i < values_copy.length; i++) {
              values_copy[i] *= position_scale_delta
            }
          }
          const new_track = new VectorKeyframeTrack(new_track_name, times_copy, values_copy)
          new_tracks.push(new_track)
        } else {
          console.warn('This track contains unsupported property for retargeting:', track_property)
        }
      })
    })

    // Create the retargeted animation clip
    const retargeted_clip = new AnimationClip(`${source_clip.name}`, source_clip.duration, new_tracks)

    console.log(`Retargeted animation: ${source_clip.name} (${new_tracks.length} tracks)`)
    return retargeted_clip
  }

  // #endregion

  // #region PRIVATE METHODS

  private calculate_position_scale_delta (): number {
    if (this.target_skinned_meshes.length === 0) {
      return 1
    }

    const source_skeleton: Skeleton | null = RetargetUtils.create_skeleton_from_group_object(this.source_armature)
    if (source_skeleton === null) {
      return 1
    }

    const target_rest_skeleton: Skeleton =
      RetargetUtils.clone_skeleton(this.target_skinned_meshes[0].skeleton, this.target_rest_transforms)

    const source_height = AnimationRetargetService.hips_rest_height(source_skeleton)
    const target_height = AnimationRetargetService.hips_rest_height(target_rest_skeleton)

    if (!Number.isFinite(source_height) || !Number.isFinite(target_height) ||
      source_height <= 0 || target_height <= 0) {
      return 1
    }

    return target_height / source_height
  }

  private static hips_rest_height (skeleton: Skeleton): number {
    const hips_bone = skeleton.bones.find((bone) => {
      const name = bone.name.toLowerCase()
      return name.includes('hips') || name.includes('pelvis')
    })

    if (hips_bone !== undefined) {
      return Math.abs(Utility.world_position_from_object(hips_bone).y)
    }

    let min_y = Infinity
    let max_y = -Infinity
    skeleton.bones.forEach((bone) => {
      const world_y = Utility.world_position_from_object(bone).y
      min_y = Math.min(min_y, world_y)
      max_y = Math.max(max_y, world_y)
    })
    return max_y - min_y
  }

  private apply_human_swing_twist_retargeting (source_clip: AnimationClip): AnimationClip {
    // the retargeter needs Skeleton inputs for both source and target.
    // the source armature is a Group, so we need to convert to a THREE.Skeleton before we can continue
    const source_skeleton: Skeleton | null = RetargetUtils.create_skeleton_from_group_object(this.source_armature)
    if (source_skeleton === null) {
      console.error('Failed to extract source skeleton from source armature for Human Retargeter.')
      return source_clip.clone()
    }

    if (this.target_skinned_meshes.length === 0) {
      console.error('No target skinned meshes available for Human Retargeter.')
      return source_clip.clone()
    }

    // snapshot the REAL target rest pose before anything clones or drives it. Every
    // consistency check below is measured against this reference
    const target_rest_snapshot: RestPoseSnapshot =
      RetargetDiagnostics.capture_rest_snapshot(this.target_skinned_meshes[0].skeleton, this.target_rest_transforms)
    const source_rest_snapshot: RestPoseSnapshot =
      RetargetDiagnostics.capture_rest_snapshot(source_skeleton)

    // we don't want to mutate/modify the original target skeleton since it is shared
    // across the app and will create issues as we change animations for retargeting later.
    const detached_target_skeleton: Skeleton = RetargetUtils.clone_skeleton(
      this.target_skinned_meshes[0].skeleton, this.target_rest_transforms)

    // create a custom "Rig" for the source and the target skeletons
    const source_rig: Rig = new Rig(source_skeleton)
    const target_rig: Rig = new Rig(detached_target_skeleton)

    // Build the chain configs from the bone mapping we actually have, whatever rig
    // type was detected. There used to be a shortcut here that fed the Mixamo rig a
    // hardcoded config, but that config spells every bone with a "mixamorig" prefix,
    // so a Mixamo rig exported without the prefix resolved to no joints at all and
    // came out as an empty rig. The bone mapping already encodes the same chains
    // using the target's real bone names, so there is nothing to shortcut.
    const custom_source_config = HumanChainConfig.build_custom_source_config(this.get_bone_mappings())
    const custom_target_config = HumanChainConfig.build_custom_target_config(custom_source_config, this.get_bone_mappings())

    source_rig.fromConfig(custom_source_config)
    target_rig.fromConfig(custom_target_config)

    // instrumentation. Runs before the retargeter drives anything, so the rigs are still
    // holding the rest pose they captured. See RetargetDiagnostics for why each check exists
    RetargetDiagnostics.report_skeleton_structure('TARGET', this.target_skinned_meshes[0].skeleton)
    RetargetDiagnostics.report_skeleton_structure('SOURCE', source_skeleton)
    RetargetDiagnostics.report_pose_fidelity('TARGET', target_rest_snapshot, target_rig)
    RetargetDiagnostics.report_pose_fidelity('SOURCE', source_rest_snapshot, source_rig)
    RetargetDiagnostics.report_source_consistency(source_rig, source_skeleton)

    const retargeter: Retargeter = new Retargeter(source_rig, target_rig, source_clip)

    // apply any global rig correction the user has set (fixes tilted rigs that
    // have no root bone, only a pelvis bone at the top of the hierarchy)
    retargeter.set_root_correction_x(this.root_correction_x_degrees)

    // TODO: experiment with the additives later with T-pose correction
    // retargeter.additives.push(
    //     (Ref.addAxis  = new AxisAdditive( 'armL', 'y', 0 * Math.PI / 180 )),
    //     (Ref.addTwist = new ChainTwistAdditive( 'armR', 0 * Math.PI / 180 )),
    // );

    // Initialize the retargeter with a small delta
    retargeter.update(0.001)

    // Bake the retargeted animation into keyframe tracks
    // 30 fps for input animations is usually sufficient for now
    const retargeted_tracks: Array<QuaternionKeyframeTrack | VectorKeyframeTrack> = retargeter.bake_animation_to_tracks(30)

    // the decisive check: any UNMAPPED bone that moves off its rest pose on frame 0 is
    // carrying a corrupted rest pose out of the cloned skeleton
    RetargetDiagnostics.report_baked_frame_zero(retargeted_tracks, target_rest_snapshot, target_rig)

    // Create and return the new retargeted animation clip
    const retargeted_clip = new AnimationClip(
      `${source_clip.name} RT`, // RT means retargeted
      source_clip.duration,
      retargeted_tracks
    )

    console.log(`Swing-Twist retargeting complete: ${source_clip.name} -> ${retargeted_clip.name}`)
    console.log('getting source clip before bone correction:', source_clip.tracks)
    console.log('getting retargeted clip:', retargeted_clip.tracks)

    return retargeted_clip
  }

  // #endregion
}
