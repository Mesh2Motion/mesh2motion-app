import { ComposerLibraryList } from './ComposerLibraryList.ts'

export type ComposerSlotName = 'upper' | 'lower'

export interface SlotAnimationDroppedDetail {
  slot: ComposerSlotName
  animation_id: string
}

export interface SlotDisplay {
  animation_name: string
  is_loading: boolean
}

/**
 * The upper body and lower body slots on the Composer page. Library tiles are dropped onto them.
 *
 * Dispatches 'slot-animation-dropped' (SlotAnimationDroppedDetail).
 */
export class ComposerSlots extends EventTarget {
  static readonly slot_names: ComposerSlotName[] = ['upper', 'lower']

  private readonly slot_elements = new Map<ComposerSlotName, HTMLElement>()

  constructor () {
    super()

    ComposerSlots.slot_names.forEach((slot) => {
      const element = document.querySelector<HTMLElement>(`#composer-${slot}-slot`)
      if (element === null) {
        console.error(`Composer slot element for '${slot}' is missing from the page`)
        return
      }

      this.slot_elements.set(slot, element)
      this.add_slot_event_listeners(slot, element)
    })
  }

  public show (slot: ComposerSlotName, display: SlotDisplay): void {
    const element = this.slot_elements.get(slot)
    if (element === undefined) {
      return
    }

    const display_name: string = ComposerLibraryList.display_name(display.animation_name)
    const name_element = element.querySelector('.composer-slot-animation-name')
    if (name_element !== null) {
      name_element.textContent = display_name
    }

    // names can be cut off in the narrow slots, so the full name shows on hover
    const half_label: string = slot === 'upper' ? 'Upper body' : 'Lower body'
    element.title = `${half_label}: ${display_name}. Drop an animation here to replace it.`
    element.classList.toggle('is-loading', display.is_loading)
  }

  private add_slot_event_listeners (slot: ComposerSlotName, element: HTMLElement): void {
    // dragenter/dragleave also fire when moving over child elements, so count them to know when the cursor really left
    let drag_depth: number = 0

    element.addEventListener('dragenter', (event: DragEvent) => {
      if (!this.is_animation_drag(event)) {
        return
      }
      event.preventDefault()
      drag_depth++
      element.classList.add('is-drag-over')
    })

    // dropping is only allowed when dragover is cancelled
    element.addEventListener('dragover', (event: DragEvent) => {
      if (!this.is_animation_drag(event)) {
        return
      }
      event.preventDefault()
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = 'copy'
      }
    })

    element.addEventListener('dragleave', () => {
      drag_depth = Math.max(0, drag_depth - 1)
      if (drag_depth === 0) {
        element.classList.remove('is-drag-over')
      }
    })

    element.addEventListener('drop', (event: DragEvent) => {
      drag_depth = 0
      element.classList.remove('is-drag-over')

      const animation_id = event.dataTransfer?.getData(ComposerLibraryList.drag_data_type) ?? ''
      if (animation_id === '') {
        return
      }

      event.preventDefault()
      this.dispatchEvent(new CustomEvent<SlotAnimationDroppedDetail>('slot-animation-dropped', { detail: { slot, animation_id } }))
    })
  }

  // the data itself can only be read on drop, but the types are visible while dragging
  private is_animation_drag (event: DragEvent): boolean {
    return event.dataTransfer?.types.includes(ComposerLibraryList.drag_data_type) ?? false
  }
}
