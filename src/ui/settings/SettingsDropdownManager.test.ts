import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMUtilities } from '../../lib/DOMUtilities.ts'
import { UI } from '../UI.ts'
import { SettingsDropdownManager } from './SettingsDropdownManager.ts'

describe('SettingsDropdownManager binding', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="settings-dropdown-mount"></div>'
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('binds the toggle when re-initialized after the nav markup is injected', () => {
    // The engine constructs the manager before DOMUtilities injects the dropdown.
    const manager = new SettingsDropdownManager()
    const toggle_before = document.querySelector<HTMLButtonElement>('#settings-toggle')
    expect(toggle_before).toBeNull()

    const mount = document.querySelector<HTMLElement>('#settings-dropdown-mount')
    expect(mount).not.toBeNull()
    DOMUtilities.populate_settings_dropdown(mount as HTMLElement)
    UI.getInstance().initialize_dom_elements()
    manager.initialize()

    const toggle = document.querySelector<HTMLButtonElement>('#settings-toggle')
    const content = document.querySelector<HTMLElement>('#settings-dropdown-content')
    expect(toggle).not.toBeNull()
    expect(content?.hidden).toBe(true)

    toggle?.click()
    expect(content?.hidden).toBe(false)
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')

    toggle?.click()
    expect(content?.hidden).toBe(true)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
  })
})
