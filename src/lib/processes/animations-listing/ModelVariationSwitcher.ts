import { RigConfig, type RigConfigEntry } from '../../RigConfig'
import { type SkeletonType } from '../../enums/SkeletonType'

/**
 * Manages the model variation dropdown on the Explore page.
 * When a rig type is selected that has model_variations in its RigConfig,
 * the dropdown is populated and shown. Otherwise it is hidden.
 *
 * Dispatches 'variation-changed' with the new model file path when the user
 * picks a different variation.
 */
export class ModelVariationSwitcher extends EventTarget {
  private readonly dom_switcher: HTMLElement | null = document.querySelector('#model-variation-switcher')
  private readonly dom_select: HTMLSelectElement | null = document.querySelector('#model-variation-selection')
  private current_rig: RigConfigEntry | undefined
  private added_event_listeners = false

  /**
   * Call this whenever the active rig type changes.
   * Populates the variation dropdown if the rig has variations, otherwise hides it.
   */
  public update_for_rig (skeleton_type: SkeletonType): void {
    this.current_rig = RigConfig.by_skeleton_type(skeleton_type)
    this.populate_select()
    this.add_event_listeners()
  }

  private populate_select (): void {
    const switcher = this.dom_switcher
    const select = this.dom_select
    if (switcher === null || select === null) return

    const variations = this.current_rig?.model_variations
    if (variations === undefined || variations.length === 0) {
      switcher.style.display = 'none'
      return
    }

    // clear any previous options and rebuild from RigConfig
    select.innerHTML = ''
    for (const variation of variations) {
      const option = document.createElement('option')
      option.value = variation.model_file
      option.textContent = variation.display_name
      select.appendChild(option)
    }

    switcher.style.display = '' // use default display style by removing inline style
  }

  private add_event_listeners (): void {
    if (this.added_event_listeners) return
    this.added_event_listeners = true

    const select = this.dom_select
    if (select === null) return

    select.addEventListener('change', () => {
      const model_file = select.value
      this.dispatchEvent(new CustomEvent('variation-changed', { detail: { model_file } }))
    })
  }
}
