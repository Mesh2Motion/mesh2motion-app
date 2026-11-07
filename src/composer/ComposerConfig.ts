import { SkeletonType } from '../lib/enums/SkeletonType.ts'

/**
 * Settings for the Composer page. The Composer only supports the human rig for now.
 */
export class ComposerConfig {
  static readonly skeleton_type: SkeletonType = SkeletonType.Human

  // model variation (from the asset manifest) shown in the preview. variations are already rigged
  static readonly model_variation_name: string = 'base'

  // clip name of the animation that both slots start with
  static readonly default_animation_name: string = 'Idle_A'

  // this bone and everything below it is the upper half. everything else (root, pelvis, legs) is the lower half
  static readonly upper_body_root_bone_name: string = 'spine_01'

  // path from the composer page to the static root
  static readonly static_root_path: string = '../'
}
