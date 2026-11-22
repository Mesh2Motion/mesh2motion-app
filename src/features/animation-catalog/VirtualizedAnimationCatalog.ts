export interface VirtualizedCatalogOptions<T> {
  get_id: (item: T) => string
  render_item: (item: T) => HTMLElement
  item_width: number
  item_height: number
  gap: number
  overscan_rows?: number
  focus_target?: (element: HTMLElement) => HTMLElement | null
  on_window_change?: (viewport: HTMLElement) => void
}

const MAX_OVERSCAN_ROWS = 4

/** Renders only the fixed-size animation tiles near the scroll viewport. */
export class VirtualizedAnimationCatalog<T> {
  private readonly content: HTMLDivElement
  private readonly footer: HTMLDivElement
  private readonly mounted = new Map<string, HTMLElement>()
  private items: T[] = []
  private columns = 1
  private disposed = false
  private resize_observer: ResizeObserver | null = null
  private render_frame: number | null = null
  private readonly overscan_rows: number

  constructor (
    private readonly viewport: HTMLElement,
    private readonly options: VirtualizedCatalogOptions<T>
  ) {
    this.overscan_rows = Math.max(0, Math.min(options.overscan_rows ?? 2, MAX_OVERSCAN_ROWS))
    this.content = document.createElement('div')
    this.content.className = 'virtualized-catalog-content'
    this.footer = document.createElement('div')
    this.footer.className = 'virtualized-catalog-footer'
    this.viewport.classList.add('virtualized-animation-catalog')
    this.viewport.replaceChildren(this.content, this.footer)
    this.viewport.addEventListener('scroll', this.on_scroll, { passive: true })
    this.viewport.addEventListener('keydown', this.on_keydown)
    if (typeof ResizeObserver !== 'undefined') {
      this.resize_observer = new ResizeObserver(() => { this.schedule_render() })
      this.resize_observer.observe(this.viewport)
    } else {
      window.addEventListener('resize', this.schedule_render)
    }
    this.render()
  }

  public set_items (items: T[], refresh = false): void {
    const first_visible_id = this.items[this.first_visible_index()]
      ? this.options.get_id(this.items[this.first_visible_index()])
      : undefined
    const previous_scroll_top = this.viewport.scrollTop
    const previous_items = this.items
    this.items = items

    if (refresh) {
      this.clear_mounted()
    } else {
      const valid_ids = new Set(items.map(this.options.get_id))
      for (const [id, element] of this.mounted) {
        if (!valid_ids.has(id)) {
          element.remove()
          this.mounted.delete(id)
        }
      }
    }

    this.measure_columns()
    const anchor_index = first_visible_id === undefined
      ? -1
      : items.findIndex(item => this.options.get_id(item) === first_visible_id)
    if (anchor_index >= 0) {
      this.viewport.scrollTop = Math.floor(anchor_index / this.columns) * this.row_height()
    } else if (previous_items.length > 0 && items.length === 0) {
      this.viewport.scrollTop = 0
    } else {
      this.viewport.scrollTop = Math.min(previous_scroll_top, this.max_scroll_top())
    }
    this.render()
  }

  public set_footer (content: Node | string): void {
    if (typeof content === 'string') {
      this.footer.innerHTML = content
    } else {
      this.footer.replaceChildren(content)
    }
    this.position_footer()
    this.options.on_window_change?.(this.viewport)
  }

  public get_footer (): HTMLElement {
    return this.footer
  }

  public get_element (id: string): HTMLElement | undefined {
    return this.mounted.get(id)
  }

  public mounted_count (): number {
    return this.mounted.size
  }

  public total_count (): number {
    return this.items.length
  }

  public scroll_to_id (id: string, behavior: ScrollBehavior = 'smooth'): boolean {
    const index = this.items.findIndex(item => this.options.get_id(item) === id)
    if (index < 0) return false
    const target = Math.floor(index / this.columns) * this.row_height()
    const bottom = target + this.options.item_height
    if (target < this.viewport.scrollTop) {
      this.viewport.scrollTo({ top: target, behavior })
    } else if (bottom > this.viewport.scrollTop + this.viewport.clientHeight) {
      this.viewport.scrollTo({ top: bottom - this.viewport.clientHeight + this.options.gap, behavior })
    }
    this.render()
    return true
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.viewport.removeEventListener('scroll', this.on_scroll)
    this.viewport.removeEventListener('keydown', this.on_keydown)
    this.resize_observer?.disconnect()
    this.resize_observer = null
    window.removeEventListener('resize', this.schedule_render)
    if (this.render_frame !== null) cancelAnimationFrame(this.render_frame)
    this.render_frame = null
    this.clear_mounted()
    this.viewport.classList.remove('virtualized-animation-catalog')
    this.viewport.replaceChildren()
  }

  private readonly on_scroll = (): void => { this.schedule_render() }

  private readonly schedule_render = (): void => {
    if (this.disposed || this.render_frame !== null) return
    this.render_frame = requestAnimationFrame(() => {
      this.render_frame = null
      this.render()
    })
  }

  private readonly on_keydown = (event: KeyboardEvent): void => {
    const target = event.target
    if (!(target instanceof Element) || target.closest('[data-animation-id]') === null) return
    const keys: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -this.columns,
      ArrowDown: this.columns
    }
    const offset = keys[event.key]
    if (offset === undefined) return
    const tile = target.closest<HTMLElement>('[data-animation-id]')
    const id = tile?.dataset.animationId
    if (id === undefined) return
    const index = this.items.findIndex(item => this.options.get_id(item) === id)
    const next_index = index + offset
    if (index < 0 || next_index < 0 || next_index >= this.items.length) return
    event.preventDefault()
    const next_id = this.options.get_id(this.items[next_index])
    this.scroll_to_id(next_id, 'auto')
    const focus = (): void => {
      const next = this.mounted.get(next_id)
      const focus_target = next === undefined ? null : this.options.focus_target?.(next) ?? next
      focus_target?.focus()
    }
    if (this.render_frame === null) focus()
    else requestAnimationFrame(focus)
  }

  private first_visible_index (): number {
    const row = Math.max(0, Math.floor(this.viewport.scrollTop / this.row_height()))
    return Math.min(row * this.columns, Math.max(0, this.items.length - 1))
  }

  private measure_columns (): void {
    const style = getComputedStyle(this.viewport)
    const horizontal_padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    const width = Math.max(0, this.viewport.clientWidth - horizontal_padding)
    this.columns = Math.max(1, Math.floor((width + this.options.gap) / (this.options.item_width + this.options.gap)))
  }

  private row_height (): number {
    return this.options.item_height + this.options.gap
  }

  private total_height (): number {
    const rows = Math.ceil(this.items.length / this.columns)
    return Math.max(0, rows * this.row_height() - (rows > 0 ? this.options.gap : 0))
  }

  private max_scroll_top (): number {
    return Math.max(0, this.total_height() - this.viewport.clientHeight)
  }

  private render (): void {
    if (this.disposed) return
    this.measure_columns()
    const total_height = this.total_height()
    this.content.style.height = `${total_height}px`
    this.content.style.width = '100%'

    const row_height = this.row_height()
    const first_row = Math.max(0, Math.floor(this.viewport.scrollTop / row_height) - this.overscan_rows)
    const visible_rows = Math.ceil(this.viewport.clientHeight / row_height) + this.overscan_rows * 2
    const first_index = first_row * this.columns
    const last_index = Math.min(this.items.length, first_index + visible_rows * this.columns)
    const wanted = new Set<string>()

    for (let index = first_index; index < last_index; index++) {
      const item = this.items[index]
      if (item === undefined) continue
      const id = this.options.get_id(item)
      wanted.add(id)
      let element = this.mounted.get(id)
      if (element === undefined) {
        element = this.options.render_item(item)
        element.dataset.animationId = id
        element.style.position = 'absolute'
        element.style.width = `${this.options.item_width}px`
        element.style.height = `${this.options.item_height}px`
        this.content.append(element)
        this.mounted.set(id, element)
      }
      const column = index % this.columns
      const row = Math.floor(index / this.columns)
      element.style.left = `${column * (this.options.item_width + this.options.gap)}px`
      element.style.top = `${row * row_height}px`
    }

    for (const [id, element] of this.mounted) {
      if (!wanted.has(id)) {
        element.remove()
        this.mounted.delete(id)
      }
    }
    this.position_footer()
  }

  private position_footer (): void {
    this.footer.style.position = 'absolute'
    this.footer.style.top = `${this.total_height()}px`
    this.footer.style.left = '0'
    this.footer.style.width = '100%'
  }

  private clear_mounted (): void {
    this.mounted.forEach(element => element.remove())
    this.mounted.clear()
    this.content.replaceChildren()
  }
}
