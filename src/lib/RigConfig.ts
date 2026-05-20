import { SkeletonType } from './enums/SkeletonType'
import { humanVariations, foxVariations, birdVariations, kaijuVariations, fishVariations } from './ModelVariations'

export interface RigConfigEntry {
  skeleton_type: SkeletonType // The SkeletonType enum member for this rig
  model_file: string // Model file path relative to the static root, e.g. 'models/model-human.glb'
  rig_file: string // Rig/skeleton GLB file path relative to the static root, e.g. 'rigs/rig-human.glb'
  rig_display_name: string // Display name shown in both the model and skeleton dropdowns
  animation_files: string[] // Animation filenames (no base path) loaded for this rig type
  animation_preview_folder: string // Sub-folder name used when referencing animation preview thumbnails
  // The bone used for position tracking (e.g., 'hips' or 'head').
  // we only have one bone per rig that we allow position keyframes (besides root)
  position_tracking_bone_name: string 
  model_variations?: ModelVariation[] // similar models (human, zombie, etc)
}

export interface ModelVariation {
  model_file: string // Model file path relative to the static root, e.g. 'models/model-human-a-pose.glb'
  display_name: string // Display name shown in the model dropdown, e.g. 'Human (A-Pose)'
  attribution: string // Free-form attribution text to be shown in the UI when this model variation is selected, e.g. 'Model by Artist Name'
  preview_image: string // Preview image path relative to the static root, shown in the variation selection dialog
  license: string // License string for this model variation, e.g. 'CC0', 'CC-SA 4.0'

}

/**
 * Single source of truth for every supported rig type.
 * To add a new rig, append one entry to `RigConfig.all` and add the
 * corresponding GLB/rig files — no other TypeScript changes are required.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RigConfig {
  static readonly all: RigConfigEntry[] = [
    {
      skeleton_type: SkeletonType.Human,
      model_file: 'models/model-human.glb',
      rig_file: 'rigs/rig-human.glb',
      rig_display_name: 'Human',
      animation_files: ['../animations/human-base-animations.glb', '../animations/human-addon-animations.glb'],
      animation_preview_folder: 'human',
      position_tracking_bone_name: 'pelvis',
      model_variations: humanVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Fox,
      model_file: 'models/model-fox.glb',
      rig_file: 'rigs/rig-fox.glb',
      rig_display_name: 'Fox',
      animation_files: ['../animations/fox-animations.glb'],
      animation_preview_folder: 'fox',
      position_tracking_bone_name: 'hips',
      model_variations: foxVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Bird,
      model_file: 'models/model-bird.glb',
      rig_file: 'rigs/rig-bird.glb',
      rig_display_name: 'Bird',
      animation_files: ['../animations/bird-animations.glb'],
      animation_preview_folder: 'bird',
      position_tracking_bone_name: 'hips',
      model_variations: birdVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Dragon,
      model_file: 'models/model-dragon.glb',
      rig_file: 'rigs/rig-dragon.glb',
      rig_display_name: 'Dragon',
      animation_files: ['../animations/dragon-animations.glb'],
      animation_preview_folder: 'dragon',
      position_tracking_bone_name: 'hips',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Kaiju,
      model_file: 'models/model-kaiju.glb',
      rig_file: 'rigs/rig-kaiju.glb',
      rig_display_name: 'Kaiju',
      animation_files: ['../animations/kaiju-animations.glb'],
      animation_preview_folder: 'kaiju',
      position_tracking_bone_name: 'hips',
      model_variations: kaijuVariations
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Spider,
      model_file: 'models/model-spider.glb',
      rig_file: 'rigs/rig-spider.glb',
      rig_display_name: 'Spider',
      animation_files: ['../animations/spider-animations.glb'],
      animation_preview_folder: 'spider',
      position_tracking_bone_name: 'hips',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Snake,
      model_file: 'models/model-snake.glb',
      rig_file: 'rigs/rig-snake.glb',
      rig_display_name: 'Snake',
      animation_files: ['../animations/snake-animations.glb'],
      animation_preview_folder: 'snake',
      position_tracking_bone_name: 'head', // snake doesn't have hips, so we track position from the head instead
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Fish,
      model_file: 'models/model-shark.glb',
      rig_file: 'rigs/rig-shark.glb',
      rig_display_name: 'Fish',
      animation_files: ['../animations/shark-animations.glb'],
      animation_preview_folder: 'shark',
      position_tracking_bone_name: 'pelvis',
      model_variations: fishVariations
    } satisfies RigConfigEntry
  ]

  /** Look up a rig by its SkeletonType enum value (which is also used as the key). */
  static by_key (rig_key: string): RigConfigEntry | undefined {
    return this.all.find(r => r.skeleton_type === rig_key as SkeletonType)
  }

  /** Look up a rig by its SkeletonType enum value. */
  static by_skeleton_type (skeleton_type: SkeletonType): RigConfigEntry | undefined {
    return this.all.find(r => r.skeleton_type === skeleton_type)
  }

  /** Get the rig GLB file path for a given skeleton type. Returns undefined for Error/None. */
  static rig_file_for (skeleton_type: SkeletonType): string | undefined {
    return this.by_skeleton_type(skeleton_type)?.rig_file
  }

  /**
   * Get all configured animation file paths for a skeleton type.
   * @param skeleton_type The skeleton type to retrieve animation files for
   * @returns Array of animation file paths, empty array if no files configured
   */
  static get_animation_file_paths (skeleton_type: SkeletonType): string[] {
    const config = this.by_skeleton_type(skeleton_type)
    if (config === undefined || config.animation_files.length === 0) return []

    return config.animation_files
  }

}
