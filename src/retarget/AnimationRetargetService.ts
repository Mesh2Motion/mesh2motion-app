import {
  AnimationClip, Euler, type Object3D, Quaternion, QuaternionKeyframeTrack, Vector3,
  VectorKeyframeTrack, Scene, Group, type SkinnedMesh,
  Skeleton,
  type Bone
} from 'three'
import { RetargetUtils } from './RetargetUtils.ts'
import { TargetBoneMappingType } from './steps/StepBoneMapping.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { Retargeter } from './human-retargeting/Retargeter.ts'
import { Rig } from './human-retargeting/Rig.ts'

/**
 * Parsed animation track name containing bone name and property type
 */
export interface TrackNameParts {
  bone_name: string
  property: string
}
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
  private target_mapping_type: TargetBoneMappingType = TargetBoneMappingType.None
  private bone_mappings: Map<string, string> = new Map<string, string>()

  public set_bone_mappings (mappings: Map<string, string>): void {
    this.bone_mappings = mappings
  }

  public get_bone_mappings (): Map<string, string> {
    return this.bone_mappings
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
    const new_tracks: any[] = [] // store new retargeted tracks

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // if the source skeleton is of type human and the target mapping is Mixamo,
    // we can try to apply the new Human Retarger system to do the retargeting
    if (this.skeleton_type === SkeletonType.Human && this.target_mapping_type === TargetBoneMappingType.Mixamo) {
      console.log('Using Human Retargeter for retargeting animation clip:', source_clip.name)
      return this.apply_swing_twist_retargeting(source_clip)
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Besides the above special case, the standard retargeting will just be bone mapping applied
    // Maybe in the future we can do other more advanced things.

    // Process each track in the source animation
    source_clip.tracks.forEach((track) => {
      // Parse the track name to get the bone name and property
      // Track names are typically in format: "boneName.property" or ".bones[boneName].property"
      const track_parts: TrackNameParts | null = this.parse_track_name_for_metadata(track.name)
      if (track_parts === null) {
        return
      }

      // Check if this bone is mapped to any target bones
      const target_bone_names = this.reverse_bone_mapping(this.bone_mappings).get(track_parts.bone_name)
      if (target_bone_names === undefined || target_bone_names.length === 0) {
        return // Skip unmapped bones
      }

      // Create a track for each target bone this source bone maps to. Will mostly just rename
      // a bone with the mapping
      target_bone_names.forEach((target_bone_name) => {
        const new_track_name = RetargetUtils.create_track_name(target_bone_name, track_parts.property)

        if (track_parts.property === 'quaternion') {
          const new_track = new QuaternionKeyframeTrack(new_track_name, track.times.slice(), track.values.slice())
          new_tracks.push(new_track)
        } else if (track_parts.property === 'position' || track_parts.property === 'scale') {
          const new_track = new VectorKeyframeTrack(new_track_name, track.times.slice(), track.values.slice())
          new_tracks.push(new_track)
        } else {
          console.warn('This track contains unsupported property for retargeting:', track_parts.property)
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

  private apply_swing_twist_retargeting (source_clip: AnimationClip): AnimationClip {
    // the retargeter needs Skeleton inputs fot both source and target.
    // the source armature is a Group, so we need to convert to a THREE.Skeleton before we can continue
    const source_skeleton: Skeleton | null = this.create_skeleton_from_source(this.source_armature)
    if (source_skeleton === null) {
      console.error('Failed to extract source skeleton from source armature for Human Retargeter.')
      return source_clip
    }

    // create a custom "Rig" for the source and the target skeletons
    const source_rig: Rig = new Rig(source_skeleton)
    const source_chain_config: Record<string, string[]> = {
      pelvis: ['DEF-hips'],
      spine: ['DEF-spine001', 'DEF-spine002', 'DEF-spine003'],
      head: ['DEF-neck', 'DEF-head'],
      armL: ['DEF-upper_armL', 'DEF-forearmL', 'DEF-handL'],
      armR: ['DEF-upper_armR', 'DEF-forearmR', 'DEF-handR'],
      legL: ['DEF-thighL', 'DEF-shinL', 'DEF-footL'],
      legR: ['DEF-thighR', 'DEF-shinR', 'DEF-footR'],
      fingersThumbL: ['DEF-thumb01L', 'DEF-thumb02L', 'DEF-thumb03L', 'DEF-thumb04_tipL'],
      fingersThumbR: ['DEF-thumb01R', 'DEF-thumb02R', 'DEF-thumb03R', 'DEF-thumb04_tipR'],
      fingersIndexL: ['DEF-f_index01L', 'DEF-f_index02L', 'DEF-f_index03L', 'DEF-f_index04_tipL'],
      fingersIndexR: ['DEF-f_index01R', 'DEF-f_index02R', 'DEF-f_index03R', 'DEF-f_index04_tipR'],
      fingersMiddleL: ['DEF-f_middle01L', 'DEF-f_middle02L', 'DEF-f_middle03L', 'DEF-f_middle04_tipL'],
      fingersMiddleR: ['DEF-f_middle01R', 'DEF-f_middle02R', 'DEF-f_middle03R', 'DEF-f_middle04_tipR'],
      fingersRingL: ['DEF-f_ring01L', 'DEF-f_ring02L', 'DEF-f_ring03L', 'DEF-f_ring04_tipL'],
      fingersRingR: ['DEF-f_ring01R', 'DEF-f_ring02R', 'DEF-f_ring03R', 'DEF-f_ring04_tipR'],
      fingersPinkyL: ['DEF-f_pinky01L', 'DEF-f_pinky02L', 'DEF-f_pinky03L', 'DEF-f_pinky04_tipL'],
      fingersPinkyR: ['DEF-f_pinky01R', 'DEF-f_pinky02R', 'DEF-f_pinky03R', 'DEF-f_pinky04_tipR']
    }
    source_rig.fromConfig(source_chain_config)

    //  maybe convert this from the bone map?
    const target_rig: Rig = new Rig(this.target_skinned_meshes[0].skeleton)
    const target_chain_config: Record<string, string[]> = {
      pelvis: ['mixamorigHips'],
      spine: ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2'],
      head: ['mixamorigNeck', 'mixamorigHead'],
      armL: ['mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand'],
      armR: ['mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand'],
      legL: ['mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot'],
      legR: ['mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot'],
      fingersThumbL: ['mixamorigLeftHandThumb1', 'mixamorigLeftHandThumb2', 'mixamorigLeftHandThumb3', 'mixamorigLeftHandThumb4'],
      fingersThumbR: ['mixamorigRightHandThumb1', 'mixamorigRightHandThumb2', 'mixamorigRightHandThumb3', 'mixamorigRightHandThumb4'],
      fingersIndexL: ['mixamorigLeftHandIndex1', 'mixamorigLeftHandIndex2', 'mixamorigLeftHandIndex3', 'mixamorigLeftHandIndex4'],
      fingersIndexR: ['mixamorigRightHandIndex1', 'mixamorigRightHandIndex2', 'mixamorigRightHandIndex3', 'mixamorigRightHandIndex4'],
      fingersMiddleL: ['mixamorigLeftHandMiddle1', 'mixamorigLeftHandMiddle2', 'mixamorigLeftHandMiddle3', 'mixamorigLeftHandMiddle4'],
      fingersMiddleR: ['mixamorigRightHandMiddle1', 'mixamorigRightHandMiddle2', 'mixamorigRightHandMiddle3', 'mixamorigRightHandMiddle4'],
      fingersRingL: ['mixamorigLeftHandRing1', 'mixamorigLeftHandRing2', 'mixamorigLeftHandRing3', 'mixamorigLeftHandRing4'],
      fingersRingR: ['mixamorigRightHandRing1', 'mixamorigRightHandRing2', 'mixamorigRightHandRing3', 'mixamorigRightHandRing4'],
      fingersPinkyL: ['mixamorigLeftHandPinky1', 'mixamorigLeftHandPinky2', 'mixamorigLeftHandPinky3', 'mixamorigLeftHandPinky4'],
      fingersPinkyR: ['mixamorigRightHandPinky1', 'mixamorigRightHandPinky2', 'mixamorigRightHandPinky3', 'mixamorigRightHandPinky4']
    }
    target_rig.fromConfig(target_chain_config)

    const retargeter: Retargeter = new Retargeter(source_rig, target_rig, source_clip)

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

    // Create and return the new retargeted animation clip
    const retargeted_clip = new AnimationClip(
      `${source_clip.name}_retargeted`,
      source_clip.duration,
      retargeted_tracks
    )

    console.log(`Swing-Twist retargeting complete: ${source_clip.name} -> ${retargeted_clip.name}`)
    console.log('getting source clip before bone correction:', source_clip.tracks)
    console.log('getting retargeted clip:', retargeted_clip.tracks)

    return retargeted_clip
  }

  /**
   * Utility: Convert a Group (with Armature and Bone hierarchy) to a THREE.Skeleton
   * @param group - The root Group containing the Armature and Bone hierarchy
   * @returns Skeleton or null if not found
   */
  private create_skeleton_from_source (group: Group): Skeleton | null {
    // Find the Armature child
    const armature = group.children.find(child => child.type === 'Object3D' &&
      child.name.toLowerCase().includes('armature'))

    if (armature === undefined) return null

    // Find the root Bone under the Armature
    const root_bone = armature.children.find(child => child.type === 'Bone') as Bone | undefined

    if (root_bone === undefined) return null

    const bones = this.collect_bones(root_bone)

    if (bones.length === 0) return null

    const skeleton = new Skeleton(bones)
    skeleton.calculateInverses()
    return skeleton
  }

  // Recursively collect all bones. part of extract_skeleton_from_group()
  private collect_bones (object: Object3D, bones: Bone[] = []): Bone[] {
    if (object.type === 'Bone') bones.push(object as Bone)
    object.children.forEach(child => this.collect_bones(child, bones))
    return bones
  }

  /**
   * Create a reverse mapping: source bone name -> array of target bone names
   */
  private reverse_bone_mapping (bone_mappings: Map<string, string>): Map<string, string[]> {
    const reverse_mappings = new Map<string, string[]>()
    bone_mappings.forEach((source_bone_name, target_bone_name) => {
      if (!reverse_mappings.has(source_bone_name)) {
        reverse_mappings.set(source_bone_name, [])
      }
      const target_list = reverse_mappings.get(source_bone_name)
      if (target_list !== undefined) {
        target_list.push(target_bone_name)
      }
    })
    return reverse_mappings
  }

  /**
   * Parse a track name to extract bone name and property (e.g., "quaternion", "position", "scale")
   * Handles various formats like "boneName.property" or ".bones[boneName].property"
   */
  private parse_track_name_for_metadata (track_name: string): TrackNameParts | null {
    // Try format: "boneName.property"
    const simple_match = track_name.match(/^([^.]+)\.(.+)$/)
    if (simple_match !== null) {
      return {
        bone_name: simple_match[1],
        property: simple_match[2]
      }
    }

    // Try format: ".bones[boneName].property"
    const bones_match = track_name.match(/\.bones\[([^\]]+)\]\.(.+)$/)
    if (bones_match !== null) {
      return {
        bone_name: bones_match[1],
        property: bones_match[2]
      }
    }

    return null
  }
  // #endregion
}
