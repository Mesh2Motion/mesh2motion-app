import { UI } from '../../../UI.ts'
import { PropPicker } from './PropPicker.ts'
import { PropSide } from './PropSide.ts'
import { NO_PROP } from './PropId.ts'
import { type PropSelection } from './PropSelection.ts'

export class PropsPanel extends EventTarget {
  private readonly ui: UI = UI.getInstance()
  private left_picker: PropPicker | null = null
  private right_picker: PropPicker | null = null
  private added_event_listeners: boolean = false

  public initialize (): void {
    if (this.added_event_listeners) {
      return
    }

    const dom_left_hand = document.querySelector<HTMLElement>('#props-left-hand')
    const dom_right_hand = document.querySelector<HTMLElement>('#props-right-hand')
    if (dom_left_hand === null || dom_right_hand === null) {
      return
    }

    this.left_picker = new PropPicker(dom_left_hand, 'Left')
    this.right_picker = new PropPicker(dom_right_hand, 'Right')
    this.left_picker.addEventListener('change', () => { this.dispatch_selection_changed() })
    this.right_picker.addEventListener('change', () => { this.dispatch_selection_changed() })

    // the toggle only shows while collapsed; the close button inside the panel collapses it
    this.ui.dom_props_toggle_button?.addEventListener('click', () => {
      this.set_expanded(true)
      this.ui.dom_props_close_button?.focus()
    })
    this.ui.dom_props_close_button?.addEventListener('click', () => {
      this.set_expanded(false)
      this.ui.dom_props_toggle_button?.focus()
    })

    // keep the floating panel docked beside the tool panel as its width changes
    const tool_panel = document.querySelector<HTMLElement>('#tool-panel')
    const dock = this.ui.dom_props_dock
    if (tool_panel !== null && dock !== null) {
      new ResizeObserver(() => {
        dock.style.right = `calc(${tool_panel.offsetWidth}px + 0.5rem)`
      }).observe(tool_panel)
    }

    this.added_event_listeners = true
  }

  public set_visible (is_visible: boolean): void {
    if (this.ui.dom_props_dock !== null) {
      this.ui.dom_props_dock.style.display = is_visible ? '' : 'none'
    }

    if (!is_visible) {
      this.set_expanded(false)
    }
  }

  public set_side_enabled (side: PropSide, is_enabled: boolean): void {
    const picker = side === PropSide.Left ? this.left_picker : this.right_picker
    picker?.set_enabled(is_enabled, 'No hand bone was found for this side')
  }

  public set_selection (selection: PropSelection): void {
    if (this.left_picker !== null) { this.left_picker.value = selection.left }
    if (this.right_picker !== null) { this.right_picker.value = selection.right }
  }

  private set_expanded (is_expanded: boolean): void {
    if (this.ui.dom_props_panel !== null) {
      this.ui.dom_props_panel.hidden = !is_expanded
    }

    const toggle_button = this.ui.dom_props_toggle_button
    if (toggle_button !== null) {
      toggle_button.setAttribute('aria-expanded', String(is_expanded))
      toggle_button.hidden = is_expanded
    }

    if (!is_expanded) {
      this.left_picker?.close()
      this.right_picker?.close()
    }
  }

  private dispatch_selection_changed (): void {
    const selection: PropSelection = {
      left: this.left_picker?.value ?? NO_PROP,
      right: this.right_picker?.value ?? NO_PROP
    }

    this.dispatchEvent(new CustomEvent<PropSelection>('props-selection-changed', { detail: selection }))
  }
}
