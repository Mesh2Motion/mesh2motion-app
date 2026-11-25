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
  it('keeps panel layout CSS-managed without drawer buttons', () => {
    DOMUtilities.populate_header_controls(mount)
    expect(mount.querySelectorAll('.layout-toggle')).toHaveLength(0)
    expect(document.body.classList.contains('layout-left-open')).toBe(false)
    expect(document.body.classList.contains('layout-right-open')).toBe(false)
  })

  it('does not add panel controls when the header is repopulated', () => {
    DOMUtilities.populate_header_controls(mount)
    DOMUtilities.populate_header_controls(mount)
    expect(mount.querySelectorAll('.layout-toggle')).toHaveLength(0)
    expect(mount.querySelectorAll('#header-ui')).toHaveLength(1)
  })
})
