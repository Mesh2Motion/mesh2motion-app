import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOMUtilities } from './DOMUtilities.ts'

let mount: HTMLElement

beforeEach(() => {
  document.body.className = ''
  document.body.innerHTML = ''
  mount = document.createElement('div')
  mount.id = 'header-ui-mount'
  document.body.appendChild(mount)
})

afterEach(() => {
  document.body.className = ''
  document.body.innerHTML = ''
})

describe('responsive layout controls', () => {
  it('mounts panel toggles with correct accessible state', () => {
    DOMUtilities.populate_header_controls(mount)
    const toggles = mount.querySelectorAll<HTMLButtonElement>('.layout-toggle')
    expect(toggles).toHaveLength(2)
    toggles.forEach(button => expect(button.getAttribute('aria-expanded')).toBe('false'))
  })

  it('toggles a single drawer at a time', () => {
    DOMUtilities.populate_header_controls(mount)
    const left = mount.querySelector<HTMLButtonElement>('[data-layout-panel="left"]')!
    const right = mount.querySelector<HTMLButtonElement>('[data-layout-panel="right"]')!

    left.click()
    expect(document.body.classList.contains('layout-left-open')).toBe(true)
    expect(left.getAttribute('aria-expanded')).toBe('true')

    right.click()
    expect(document.body.classList.contains('layout-left-open')).toBe(false)
    expect(document.body.classList.contains('layout-right-open')).toBe(true)
    expect(left.getAttribute('aria-expanded')).toBe('false')
    expect(right.getAttribute('aria-expanded')).toBe('true')

    right.click()
    expect(document.body.classList.contains('layout-right-open')).toBe(false)
  })

  it('does not duplicate listeners when the header is repopulated', () => {
    DOMUtilities.populate_header_controls(mount)
    DOMUtilities.populate_header_controls(mount)
    const left = mount.querySelector<HTMLButtonElement>('[data-layout-panel="left"]')!
    left.click()
    expect(document.body.classList.contains('layout-left-open')).toBe(true)
  })
})
