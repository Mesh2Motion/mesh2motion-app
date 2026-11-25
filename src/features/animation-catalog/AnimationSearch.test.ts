import { afterEach, describe, expect, it } from 'vitest'
import { ThemeManager } from '../../lib/ThemeManager.ts'
import { SkeletonType } from '../../lib/enums/SkeletonType.ts'
import { AnimationSearch } from './AnimationSearch'
import { set_authored_preview_frames } from '../../animation-document/authoredLibrary.ts'
import type { AnimationEntry } from '../../lib/processes/animations-listing/interfaces/AnimationEntry.ts'

function entries (count: number): AnimationEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `animation-${index}`,
    name: `Animation ${index}`,
    metadata: { source_type: 'default-library', tags: index % 2 === 0 ? ['walk'] : ['run'] },
    state: 'unloaded',
    clip_pair: null
  }))
}

describe('AnimationSearch virtualized catalogue integration', () => {
  let search: AnimationSearch | undefined

  afterEach(() => {
    search?.dispose()
    search = undefined
    document.body.replaceChildren()
  })

  it('keeps selection in model state while filtering recycles tile DOM', () => {
    document.body.innerHTML = '<input id="filter"><div id="catalog"></div>'
    search = new AnimationSearch('filter', 'catalog', new ThemeManager(), SkeletonType.Human)
    search.initialize_animations(entries(300))
    const viewport = document.querySelector<HTMLElement>('#catalog')!

    expect(viewport.querySelectorAll('[data-animation-id]').length).toBeLessThan(300)
    const checkbox = viewport.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    expect(search.get_selected_animation_ids()).toContain(checkbox.value)

    const filter = document.querySelector<HTMLInputElement>('#filter')!
    filter.value = 'Animation 1'
    filter.dispatchEvent(new Event('input'))
    expect(search.filtered_animations().every(entry => entry.name.includes('Animation 1'))).toBe(true)

    filter.value = ''
    filter.dispatchEvent(new Event('input'))
    const selected = viewport.querySelector<HTMLInputElement>(`input[value="${checkbox.value}"]`)
    expect(selected?.checked).toBe(true)
  })

  it('renders poster paths as data attributes on bundled animation tiles', () => {
    document.body.innerHTML = '<input id="filter"><div id="catalog"></div>'
    search = new AnimationSearch('filter', 'catalog', new ThemeManager(), SkeletonType.Human)
    search.initialize_animations(entries(1))

    const tile = document.querySelector<HTMLElement>('.anim-preview-placeholder')
    expect(tile).not.toBeNull()
    expect(tile?.classList.contains('anim-preview-placeholder--no-poster')).toBe(false)
    expect(tile?.dataset.posterSrc).toMatch(/^\.\.\/animpreviews\/human\/dark_.*\.webp$/)
    expect(tile?.querySelector('img.anim-preview-poster')).not.toBeNull()
    expect(tile?.dataset.src).toMatch(/^\.\.\/animpreviews\/human\/dark_.*\.mp4$/)
  })

  it('shows generated authored previews instead of the No preview overlay', () => {
    document.body.innerHTML = '<input id="filter"><div id="catalog"></div>'
    search = new AnimationSearch('filter', 'catalog', new ThemeManager(), SkeletonType.Human)
    const custom: AnimationEntry = {
      id: 'custom-import-1',
      name: 'Agent Authored',
      metadata: { source_type: 'custom-import', tags: ['authored-animation-document'] },
      state: 'loaded',
      clip_pair: null
    }
    set_authored_preview_frames(custom.id, ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'])
    search.initialize_animations([custom])

    const placeholder = document.querySelector<HTMLElement>('.anim-preview-placeholder')
    expect(placeholder?.classList.contains('anim-preview-placeholder--no-poster')).toBe(false)
    expect(placeholder?.querySelector<HTMLImageElement>('img.anim-preview-poster')?.getAttribute('src'))
      .toBe('data:image/png;base64,AAAA')
  })
})
