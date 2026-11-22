import { afterEach, describe, expect, it } from 'vitest'
import { ThemeManager } from '../../ThemeManager'
import { SkeletonType } from '../../enums/SkeletonType'
import { AnimationSearch } from './AnimationSearch'
import type { AnimationEntry } from './interfaces/AnimationEntry'

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
})
