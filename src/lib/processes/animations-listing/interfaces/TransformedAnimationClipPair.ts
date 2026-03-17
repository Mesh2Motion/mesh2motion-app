import { type AnimationClip } from 'three'

export type AnimationSourceType = 'default-library' | 'custom-import'

export interface AnimationClipMetadata {
  source_type: AnimationSourceType
  tags: string[]
}

export interface BoneRotationCorrectionData {
  bone_name: string
  reference_rest_quaternion: [number, number, number, number]
  target_bind_quaternion: [number, number, number, number]
  correction_quaternion: [number, number, number, number]
}

export interface TransformedAnimationClipPair {
  /**
   * The original version of the animation clip, without any transformations
   * applied to it.
   *
   * This allows for simple non-destructive modification of the animation,
   * since we can always reset to the original.
   */
  original_animation_clip: AnimationClip
  /**
   * The warped version of the animation clip, which is what will be displayed
   * and downloaded by the user.
   */
  display_animation_clip: AnimationClip

  /**
   * Extendable metadata for this animation clip.
   */
  metadata: AnimationClipMetadata

  /**
   * Per-bone rotation delta data used to align animation tracks from
   * The goal is to fix things like A-Pose vs T-Pose mismatches
   * but it also goes further with corrections to more bones if needed.
   * the reference rest pose to the edited bind pose.
   */
  rotation_correction_data: BoneRotationCorrectionData[]
}
