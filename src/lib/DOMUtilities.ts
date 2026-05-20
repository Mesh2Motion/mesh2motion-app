import { RigConfig } from './RigConfig.ts'

export class DOMUtilities {
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
      ...RigConfig.all.map((rig) => {
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
    for (const rig of RigConfig.all) {
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
    for (const rig of RigConfig.all) {
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
