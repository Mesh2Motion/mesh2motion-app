import { afterEach, describe, expect, it, vi } from 'vitest'
import { VirtualizedAnimationCatalog } from './VirtualizedAnimationCatalog'

interface Entry {
  id: string
  name: string
}

function make_viewport (): HTMLDivElement {
  const viewport = document.createElement('div')
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 360 },
    clientHeight: { configurable: true, value: 320 },
    scrollTo: { configurable: true, value: ({ top }: ScrollToOptions) => { viewport.scrollTop = top ?? 0 } }
  })
  document.body.append(viewport)
  return viewport
}

function make_entries (count: number): Entry[] {
  return Array.from({ length: count }, (_, index) => ({ id: `animation-${index}`, name: `Animation ${index}` }))
}

function make_catalog (viewport: HTMLElement): VirtualizedAnimationCatalog<Entry> {
  return new VirtualizedAnimationCatalog(viewport, {
    get_id: entry => entry.id,
    render_item: entry => {
      const tile = document.createElement('button')
      tile.type = 'button'
      tile.textContent = entry.name
      return tile
    },
    item_width: 103,
    item_height: 160,
    gap: 4,
    overscan_rows: 2
  })
}

describe('VirtualizedAnimationCatalog', () => {
  let catalog: VirtualizedAnimationCatalog<Entry> | undefined
  let viewport: HTMLElement | undefined

  afterEach(() => {
    catalog?.dispose()
    viewport?.remove()
    catalog = undefined
    viewport = undefined
  })

  it.each([234, 1000, 10000])('bounds mounted DOM for %i catalog entries', (count) => {
    viewport = make_viewport()
    catalog = make_catalog(viewport)
    const started = performance.now()
    catalog.set_items(make_entries(count))
    const elapsed = performance.now() - started

    expect(catalog.total_count()).toBe(count)
    expect(catalog.mounted_count()).toBeLessThanOrEqual(18)
    expect(viewport.querySelectorAll('[data-animation-id]')).toHaveLength(catalog.mounted_count())
    expect(elapsed).toBeLessThan(500)
  })

  it('keeps the stable visible item near the same scroll position after filtering', () => {
    viewport = make_viewport()
    catalog = make_catalog(viewport)
    const entries = make_entries(1000)
    catalog.set_items(entries)
    catalog.scroll_to_id('animation-300', 'auto')
    const previous_top = viewport.scrollTop
    catalog.set_items(entries.slice(290, 400))

    expect(catalog.get_element('animation-300')).toBeDefined()
    expect(viewport.scrollTop).toBeLessThan(previous_top)
  })

  it('supports keyboard movement across the virtualized window', () => {
    viewport = make_viewport()
    catalog = make_catalog(viewport)
    catalog.set_items(make_entries(100))
    const current = catalog.get_element('animation-0')
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    current?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(catalog.get_element('animation-1')).toBeDefined()
  })

  it('removes scroll and resize listeners when disposed', () => {
    viewport = make_viewport()
    const remove = vi.spyOn(viewport, 'removeEventListener')
    catalog = make_catalog(viewport)
    catalog.dispose()
    catalog = undefined

    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
  })
})
