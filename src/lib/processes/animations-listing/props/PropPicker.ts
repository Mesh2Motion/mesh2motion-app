import { PropCatalog, type PropDefinition } from './PropCatalog.ts'
import { NO_PROP, type PropId } from './PropId.ts'

/**
 * Custom dropdown for choosing a prop. A native <select> cannot render images
 * inside its options, so this implements the ARIA listbox pattern: a trigger
 * button that shows the current prop, and a popup list with preview images.
 */
export class PropPicker extends EventTarget {
  private readonly id: string
  private readonly trigger: HTMLButtonElement
  private readonly trigger_preview: HTMLElement
  private readonly trigger_name: HTMLElement
  private readonly listbox: HTMLElement
  private readonly options: HTMLElement[] = []
  private current_value: PropId = NO_PROP
  private active_index: number = 0

  constructor (private readonly element: HTMLElement, label: string) {
    super()

    const id = element.id
    this.id = id
    this.element.innerHTML = `
      <span class="prop-picker-label" id="${id}-label">${label}</span>
      <button type="button" class="prop-picker-trigger" id="${id}-trigger"
        aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-listbox"
        aria-labelledby="${id}-label ${id}-trigger">
        <span class="prop-picker-thumb"></span>
        <span class="prop-picker-name"></span>
        <span class="prop-picker-chevron" aria-hidden="true"></span>
      </button>
      <div class="prop-picker-popup" id="${id}-listbox" role="listbox" tabindex="-1"
        aria-labelledby="${id}-label" hidden>
        ${this.options_html()}
      </div>
    `

    this.trigger = this.element.querySelector<HTMLButtonElement>('.prop-picker-trigger') as HTMLButtonElement
    this.trigger_preview = this.element.querySelector<HTMLElement>('.prop-picker-trigger .prop-picker-thumb') as HTMLElement
    this.trigger_name = this.element.querySelector<HTMLElement>('.prop-picker-name') as HTMLElement
    this.listbox = this.element.querySelector<HTMLElement>('.prop-picker-popup') as HTMLElement
    this.options.push(...this.listbox.querySelectorAll<HTMLElement>('[role="option"]'))

    this.add_event_listeners()
    this.render_value()
  }

  public get value (): PropId {
    return this.current_value
  }

  public set value (value: PropId) {
    this.current_value = PropCatalog.find(value) !== undefined ? value : NO_PROP
    this.render_value()
  }

  public set_enabled (is_enabled: boolean, disabled_reason: string = ''): void {
    this.trigger.disabled = !is_enabled
    this.trigger.title = is_enabled ? '' : disabled_reason
    if (!is_enabled) {
      this.close()
    }
  }

  public is_open (): boolean {
    return !this.listbox.hidden
  }

  public open (): void {
    if (this.trigger.disabled || this.is_open()) {
      return
    }

    this.listbox.hidden = false
    this.trigger.setAttribute('aria-expanded', 'true')
    this.set_active(this.index_of(this.current_value))
    this.listbox.focus()
  }

  public close (restore_focus: boolean = false): void {
    if (!this.is_open()) {
      return
    }

    this.listbox.hidden = true
    this.trigger.setAttribute('aria-expanded', 'false')
    if (restore_focus) {
      this.trigger.focus()
    }
  }

  private add_event_listeners (): void {
    this.trigger.addEventListener('click', () => {
      this.is_open() ? this.close() : this.open()
    })

    this.trigger.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        this.open()
      }
    })

    this.listbox.addEventListener('keydown', (event: KeyboardEvent) => {
      this.handle_listbox_key(event)
    })

    this.listbox.addEventListener('click', (event: MouseEvent) => {
      const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]')
      if (option !== null) {
        this.choose(this.options.indexOf(option))
      }
    })

    this.listbox.addEventListener('mousemove', (event: MouseEvent) => {
      const option = (event.target as HTMLElement).closest<HTMLElement>('[role="option"]')
      if (option !== null) {
        this.set_active(this.options.indexOf(option), false)
      }
    })

    // close when focus or a click lands anywhere outside the picker
    this.element.addEventListener('focusout', (event: FocusEvent) => {
      if (!this.element.contains(event.relatedTarget as Node | null)) {
        this.close()
      }
    })
    document.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!this.element.contains(event.target as Node)) {
        this.close()
      }
    })
  }

  private handle_listbox_key (event: KeyboardEvent): void {
    let next_index: number | null = null

    switch (event.key) {
      case 'ArrowDown': next_index = Math.min(this.active_index + 1, this.options.length - 1); break
      case 'ArrowUp': next_index = Math.max(this.active_index - 1, 0); break
      case 'Home': next_index = 0; break
      case 'End': next_index = this.options.length - 1; break
      case 'Enter':
      case ' ':
        event.preventDefault()
        this.choose(this.active_index)
        return
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        this.close(true)
        return
      case 'Tab':
        this.close()
        return
      default:
        return
    }

    event.preventDefault()
    this.set_active(next_index)
  }

  private set_active (index: number, scroll_into_view: boolean = true): void {
    this.options[this.active_index]?.classList.remove('active')
    this.active_index = Math.max(0, index)

    const option = this.options[this.active_index]
    option.classList.add('active')
    this.listbox.setAttribute('aria-activedescendant', option.id)
    if (scroll_into_view) {
      option.scrollIntoView({ block: 'nearest' })
    }
  }

  private choose (index: number): void {
    const value = this.options[index]?.dataset.value
    if (value === undefined) {
      return
    }

    const has_changed = value !== this.current_value
    this.current_value = value
    this.render_value()
    this.close(true)

    if (has_changed) {
      this.dispatchEvent(new Event('change'))
    }
  }

  private render_value (): void {
    const definition = PropCatalog.find(this.current_value)
    this.trigger_preview.innerHTML = this.thumb_html(definition)
    this.trigger_name.textContent = definition?.display_name ?? 'None'

    this.options.forEach((option) => {
      option.setAttribute('aria-selected', String(option.dataset.value === this.current_value))
    })
  }

  private index_of (value: PropId): number {
    return Math.max(0, this.options.findIndex((option) => option.dataset.value === value))
  }

  private thumb_html (definition: PropDefinition | undefined): string {
    if (definition === undefined) {
      return '<span class="prop-picker-empty" aria-hidden="true"></span>'
    }

    return `<img src="${definition.preview_path}" alt="" loading="lazy">`
  }

  private option_html (value: PropId, name: string, definition?: PropDefinition): string {
    return `
      <div class="prop-picker-option" role="option" id="${this.id}-option-${value}"
        data-value="${value}" aria-selected="false" title="${name}">
        <span class="prop-picker-thumb">${this.thumb_html(definition)}</span>
        <span class="prop-picker-option-name">${name}</span>
      </div>
    `
  }

  private options_html (): string {
    const definitions = PropCatalog.all()
    const categories = Array.from(new Set(definitions.map((definition) => definition.category)))

    const groups_html = categories.map((category, category_index) => {
      const header_id = `${this.id}-group-${category_index}`
      const category_options = definitions
        .filter((definition) => definition.category === category)
        .map((definition) => this.option_html(definition.id, definition.display_name, definition))
        .join('')

      return `
        <div class="prop-picker-group" role="group" aria-labelledby="${header_id}">
          <div class="prop-picker-group-label" id="${header_id}" role="presentation">${category}</div>
          <div class="prop-picker-grid">${category_options}</div>
        </div>
      `
    }).join('')

    return `
      <div class="prop-picker-grid">${this.option_html(NO_PROP, 'None')}</div>
      ${groups_html}
    `
  }
}
