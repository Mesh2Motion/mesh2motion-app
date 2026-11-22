import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MCP_CLIENT_CONFIG,
  MCP_EXPECTED_ENDPOINT,
  MCP_READ_TOOLS,
  mount_mcp_settings
} from './McpSettingsPanel.ts'
import { reset_publisher_status, update_publisher_status } from './publisherStatus.ts'

function set_tauri (available: boolean): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: available ? { invoke: vi.fn() } : undefined,
    configurable: true,
    writable: true
  })
}

function set_opt_in (enabled: boolean): void {
  Object.defineProperty(window, '__M2M_MCP_ENABLED__', {
    value: enabled,
    configurable: true,
    writable: true
  })
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => key === 'm2m-control-enabled' && enabled ? '1' : null,
      setItem: vi.fn()
    },
    configurable: true,
    writable: true
  })
}

let container: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  set_tauri(false)
  set_opt_in(false)
  reset_publisher_status()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  set_tauri(false)
  set_opt_in(false)
  reset_publisher_status()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('MCP settings panel', () => {
  it('states accurately that MCP is unavailable in web builds', () => {
    const handle = mount_mcp_settings(container)
    expect(container.textContent).toContain('unavailable in web builds')
    expect(container.querySelector('[data-mcp="availability"]')).toBeNull()
    expect(container.textContent).not.toContain(MCP_EXPECTED_ENDPOINT)
    handle.refresh()
  })

  it('shows prerequisites and the five read-only tools on desktop without claiming a host', () => {
    set_tauri(true)
    mount_mcp_settings(container)

    const text = container.textContent ?? ''
    expect(text).toContain('Desktop bridge detected')
    expect(text).toContain('publisher opt-in disabled')
    expect(text).toContain('--features mcp-host')
    expect(text).toContain('M2M_MCP_ENABLE=1')
    expect(text).toContain(MCP_EXPECTED_ENDPOINT)
    for (const tool of MCP_READ_TOOLS) {
      expect(text).toContain(`${tool} (read-only)`)
    }
    expect(container.querySelector('[data-mcp="host-state"]')?.textContent).toContain('Not reported by frontend')
    // No fabricated client telemetry.
    expect(text.toLowerCase()).not.toContain('connected clients')
  })

  it('shows real publisher status and last publish error from the registry', () => {
    set_tauri(true)
    set_opt_in(true)
    const handle = mount_mcp_settings(container)
    update_publisher_status({
      attached: true,
      published_count: 7,
      sequence: 12,
      phase: 'ready',
      last_publish_epoch_ms: 1000,
      last_error: 'IPC command rejected'
    })
    handle.refresh()

    const publisher = container.querySelector('[data-mcp="publisher"]')?.textContent ?? ''
    expect(publisher).toContain('Active')
    expect(publisher).toContain('published 7')
    expect(publisher).toContain('sequence 12')
    expect(publisher).toContain('phase ready')
    expect(container.querySelector('.mcp-settings-error')?.textContent).toContain('IPC command rejected')
    expect(container.querySelector('[data-mcp="availability"]')?.textContent).toContain('publisher opt-in enabled')
  })

  it('copies a safe client config and reports the real clipboard outcome', async () => {
    set_tauri(true)
    mount_mcp_settings(container)
    const write_text = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write_text },
      configurable: true,
      writable: true
    })

    const button = container.querySelector<HTMLButtonElement>('.mcp-settings-copy')
    expect(button).not.toBeNull()
    button?.click()
    await Promise.resolve()
    await Promise.resolve()

    expect(write_text).toHaveBeenCalledOnce()
    expect(write_text.mock.calls[0][0]).toBe(MCP_CLIENT_CONFIG)
    expect(JSON.parse(MCP_CLIENT_CONFIG).mcpServers.mesh2motion.command).toContain('<path-to-built')
    expect(container.querySelector('.mcp-settings-copy-result')?.textContent).toContain('copied')
  })

  it('reports a failed copy without pretending it succeeded', async () => {
    set_tauri(true)
    mount_mcp_settings(container)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
      writable: true
    })
    const exec = vi.fn().mockReturnValue(false)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true, writable: true })

    container.querySelector<HTMLButtonElement>('.mcp-settings-copy')?.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(exec).toHaveBeenCalled()
    expect(container.querySelector('.mcp-settings-copy-result')?.textContent).toContain('Copy failed')
  })
})
