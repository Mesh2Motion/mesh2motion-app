import { afterEach, describe, expect, it } from 'vitest'
import { SkeletonType } from '../lib/enums/SkeletonType'
import { ThemeManager } from '../lib/ThemeManager'
import type { AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry'
import { ComposerLibraryList } from './ComposerLibraryList'

function entries (count: number): AnimationEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `composer-animation-${index}`,
    name: `Composer Animation ${index}`,
    metadata: { source_type: 'default-library', tags: index % 2 === 0 ? ['walk'] : ['run'] },
    state: 'unloaded',
    clip_pair: null
  }))
}

describe('ComposerLibraryList virtualized catalogue', () => {
  let library: ComposerLibraryList | undefined

  afterEach(() => {
    library?.dispose()
    library = undefined
    document.body.replaceChildren()
  })

  it('keeps mounted tiles bounded and preserves filtering, slot markers, and ID navigation', () => {
    document.body.innerHTML = '<input id="filter"><div id="count"></div><div id="library"></div>'
    const container = document.querySelector<HTMLElement>('#library')!
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 360 },
      clientHeight: { configurable: true, value: 320 },
      scrollTo: { configurable: true, value: ({ top }: ScrollToOptions) => { container.scrollTop = top ?? 0 } }
    })
    library = new ComposerLibraryList(
      container,
      document.querySelector<HTMLInputElement>('#filter'),
      document.querySelector<HTMLElement>('#count'),
      new ThemeManager(),
      SkeletonType.Human
    )
    library.set_animations(entries(1000))

    expect(container.querySelectorAll('.composer-library-item').length).toBeLessThan(1000)
    library.set_slot_markers('composer-animation-100', 'composer-animation-101')
    library.scroll_to_animation('composer-animation-100')

    const filter = document.querySelector<HTMLInputElement>('#filter')!
    filter.value = 'Composer Animation 100'
    filter.dispatchEvent(new Event('input'))
    expect(container.querySelectorAll('.composer-library-item')).toHaveLength(1)
    expect(container.querySelector('.composer-library-item')?.classList.contains('in-upper-slot')).toBe(true)
    expect(document.querySelector('#count')?.textContent).toBe('1 result')
  })
})
