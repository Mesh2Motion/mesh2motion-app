import { SkeletonType } from './enums/SkeletonType'

export interface RigConfigEntry {
  skeleton_type: SkeletonType // The SkeletonType enum member for this rig
  model_file: string // Model file path relative to the static root, e.g. 'models/model-human.glb'
  rig_file: string // Rig/skeleton GLB file path relative to the static root, e.g. 'rigs/rig-human.glb'
  rig_display_name: string // Display name shown in both the model and skeleton dropdowns
  animation_files: string[] // Animation filenames (no base path) loaded for this rig type
  animation_preview_folder: string // Sub-folder name used when referencing animation preview thumbnails
  has_hand_options: boolean // Only Human has per-finger hand skeleton options
  has_head_weight_correction: boolean // Only Human shows the head weight correction panel
  has_arm_extension: boolean // Only Human shows the arm expand/contract slider
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
      has_hand_options: true,
      has_head_weight_correction: true,
      has_arm_extension: true,
      position_tracking_bone_name: 'pelvis',
      model_variations: [
        {
          model_file: 'models-variation/human-base.glb',
          display_name: 'Mannequin',
          attribution: 'Model by Quaternius, CC0-licensed',
          preview_image: 'models-variation/fox-base.png'
        } satisfies ModelVariation,
        {
          model_file: 'models-variation/human-zombie.glb',
          display_name: 'Zombie',
          attribution: 'Model by Kenney.nl, CC0-licensed',
          preview_image: 'models-variation/fox-base.png'
        } satisfies ModelVariation,
          {
          model_file: 'models-variation/human-sophia.glb',
          display_name: 'Sophia',
          attribution: 'Art by Tysan Tan, CC-SA 4.0',
          preview_image: 'models-variation/fox-base.png'
        } satisfies ModelVariation
      ]
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Fox,
      model_file: 'models/model-fox.glb',
      rig_file: 'rigs/rig-fox.glb',
      rig_display_name: 'Fox',
      animation_files: ['../animations/fox-animations.glb'],
      animation_preview_folder: 'fox',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_arm_extension: false,
      position_tracking_bone_name: 'hips',
      model_variations: [
        {
          model_file: 'models-variation/fox-base.glb',
          display_name: 'Fox',
          attribution: 'None',
          preview_image: 'images/variations/fox-base.png'
        } satisfies ModelVariation,
        {
          model_file: 'models-variation/fox-horse.glb',
          display_name: 'Horse',
          attribution: 'None',
          preview_image: 'images/variations/fox-base.png'
        } satisfies ModelVariation
      ]
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Bird,
      model_file: 'models/model-bird.glb',
      rig_file: 'rigs/rig-bird.glb',
      rig_display_name: 'Bird',
      animation_files: ['../animations/bird-animations.glb'],
      animation_preview_folder: 'bird',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_arm_extension: false,
      position_tracking_bone_name: 'hips',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Dragon,
      model_file: 'models/model-dragon.glb',
      rig_file: 'rigs/rig-dragon.glb',
      rig_display_name: 'Dragon',
      animation_files: ['../animations/dragon-animations.glb'],
      animation_preview_folder: 'dragon',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_arm_extension: false,
      position_tracking_bone_name: 'hips',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Kaiju,
      model_file: 'models/model-kaiju.glb',
      rig_file: 'rigs/rig-kaiju.glb',
      rig_display_name: 'Kaiju',
      animation_files: ['../animations/kaiju-animations.glb'],
      animation_preview_folder: 'kaiju',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_arm_extension: false,
      position_tracking_bone_name: 'hips',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Spider,
      model_file: 'models/model-spider.glb',
      rig_file: 'rigs/rig-spider.glb',
      rig_display_name: 'Spider',
      animation_files: ['../animations/spider-animations.glb'],
      animation_preview_folder: 'spider',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_arm_extension: false,
      position_tracking_bone_name: 'hips',
    } satisfies RigConfigEntry,
    {
      skeleton_type: SkeletonType.Snake,
      model_file: 'models/model-snake.glb',
      rig_file: 'rigs/rig-snake.glb',
      rig_display_name: 'Snake',
      animation_files: ['../animations/snake-animations.glb'],
      animation_preview_folder: 'snake',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_arm_extension: false,
      position_tracking_bone_name: 'head', // snake doesn't have hips, so we track position from the head instead
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

  /**
   * Populate a <select> with one <option> per rig using model display names.
   * Existing options are replaced.
   */
  static populate_model_select (select: HTMLSelectElement): void {
    select.innerHTML = ''

    // also import some custom models that are not the default models for a rig like an A-pose version of human
    const custom_models = [
      {
        model_file: 'test-files/bone-correction-tests/human-a-pose.glb',
        display_name: 'Human (A-Pose)'
      }
    ]

    // combine all the rigs with the custom models needed
    const model_options = [
      ...this.all.map((rig) => {
        return {
          model_file: rig.model_file,
          display_name: rig.rig_display_name
        }
      }),
      ...custom_models
    ]

    // build out HTML options
    for (const custom of model_options) {
      const option = document.createElement('option')
      option.value = custom.model_file
      option.textContent = custom.display_name
      select.appendChild(option)
    }
  }

  /**
   * Populate a <select> with one <option> per rig using skeleton display names.
   * Pass `include_placeholder = false` to omit the "Select a skeleton" entry.
   * Existing options are replaced.
   */
  static populate_skeleton_select (select: HTMLSelectElement, include_placeholder = true): void {
    select.innerHTML = ''
    if (include_placeholder) {
      const placeholder = document.createElement('option')
      placeholder.value = 'select-skeleton'
      placeholder.textContent = 'Select a skeleton'
      select.appendChild(placeholder)
    }
    for (const rig of this.all) {
      const option = document.createElement('option')
      option.value = rig.skeleton_type
      option.textContent = rig.rig_display_name
      select.appendChild(option)
    }
  }

  /** Video Preview HTML generation for Rig selection
   * Populate a <select> with one <option> per animation file across all rigs.
   * A placeholder option is always inserted first.
   */
  static populate_animation_file_select (select: HTMLSelectElement): void {
    // configure the select
    select.innerHTML = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''

    // create first default option as placeholder/instructions
    placeholder.textContent = 'Pick a 3d animation to generate previews'
    select.appendChild(placeholder)

    // create all available animation options from GLB files in rig config
    for (const rig of this.all) {
      for (const file of rig.animation_files) {
        const option = document.createElement('option')
        option.value = file
        // derive a readable label from the filename, e.g. 'human-base-animations.glb' -> 'Human Base Animations'
        const label = file
          .replace(/\.\.\/animations\//i, '')
          .replace(/\.glb$/i, '')
          .split('-')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ')
        option.textContent = label
        select.appendChild(option)
      }
    }
  }
}
