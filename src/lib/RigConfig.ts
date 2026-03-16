import { SkeletonType } from './enums/SkeletonType'

export interface RigConfigEntry {
  // String key used as the HTML select option value, e.g. 'human', 'fox'
  key: string
  // The SkeletonType enum member for this rig
  skeleton_type: SkeletonType
  // Model file path relative to the static root, e.g. 'models/model-human.glb'
  model_file: string
  // Display name shown in both the model and skeleton dropdowns
  rig_display_name: string
  // Animation filenames (no base path) loaded for this rig type
  animation_files: string[]
  // Sub-folder name used when referencing animation preview thumbnails
  animation_preview_folder: string
  // Only Human has per-finger hand skeleton options
  has_hand_options: boolean
  // Only Human shows the head weight correction panel
  has_head_weight_correction: boolean
  // Only Human shows the A-pose arm-extension correction slider
  has_a_pose_correction: boolean
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
      key: 'human',
      skeleton_type: SkeletonType.Human,
      model_file: 'models/model-human.glb',
      rig_display_name: 'Human',
      animation_files: ['human-base-animations.glb', 'human-addon-animations.glb'],
      animation_preview_folder: 'human',
      has_hand_options: true,
      has_head_weight_correction: true,
      has_a_pose_correction: true
    },
    {
      key: 'fox',
      skeleton_type: SkeletonType.Fox,
      model_file: 'models/model-fox.glb',
      rig_display_name: 'Fox',
      animation_files: ['fox-animations.glb'],
      animation_preview_folder: 'fox',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_a_pose_correction: false
    },
    {
      key: 'bird',
      skeleton_type: SkeletonType.Bird,
      model_file: 'models/model-bird.glb',
      rig_display_name: 'Bird',
      animation_files: ['bird-animations.glb'],
      animation_preview_folder: 'bird',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_a_pose_correction: false
    },
    {
      key: 'dragon',
      skeleton_type: SkeletonType.Dragon,
      model_file: 'models/model-dragon.glb',
      rig_display_name: 'Dragon',
      animation_files: ['dragon-animations.glb'],
      animation_preview_folder: 'dragon',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_a_pose_correction: false
    },
    {
      key: 'kaiju',
      skeleton_type: SkeletonType.Kaiju,
      model_file: 'models/model-kaiju.glb',
      rig_display_name: 'Kaiju',
      animation_files: ['kaiju-animations.glb'],
      animation_preview_folder: 'kaiju',
      has_hand_options: false,
      has_head_weight_correction: false,
      has_a_pose_correction: false
    }
  ]

  /** Look up a rig by its HTML select option value. */
  static by_key (key: string): RigConfigEntry | undefined {
    return this.all.find(r => r.key === key)
  }

  /** Look up a rig by its SkeletonType enum value. */
  static by_skeleton_type (skeleton_type: SkeletonType): RigConfigEntry | undefined {
    return this.all.find(r => r.skeleton_type === skeleton_type)
  }

  /**
   * Populate a <select> with one <option> per rig using model display names.
   * Existing options are replaced.
   */
  static populate_model_select (select: HTMLSelectElement): void {
    select.innerHTML = ''
    for (const rig of this.all) {
      const option = document.createElement('option')
      option.value = rig.model_file
      option.textContent = rig.rig_display_name
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
      option.value = rig.key
      option.textContent = rig.rig_display_name
      select.appendChild(option)
    }
  }

  /** Video Preview HTML generation for Rig selection
   * Populate a <select> with one <option> per animation file across all rigs.
   * base_path is prepended to each filename, e.g. '../animations/'.
   * A placeholder option is always inserted first.
   */
  static populate_animation_file_select (select: HTMLSelectElement, base_path: string): void {
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
        option.value = `${base_path}${file}`
        // derive a readable label from the filename, e.g. 'human-base-animations.glb' -> 'Human Base Animations'
        const label = file
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
