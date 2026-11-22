import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount_mcp_settings } from './McpSettingsPanel.ts'
import { reset_publisher_status, update_publisher_status } from './publisherStatus.ts'
import { CONTROL_READ_TOOLS } from './contracts.ts'
import { build_client_config, MCP_COMMANDS } from './McpHostApi.ts'

function set_tauri (invoke?: (command: string, args?: unknown) => Promise<unknown>): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: invoke === undefined ? undefined : { invoke },
    configurable: true,
    writable: true
  })
}

function set_opt_in (enabled: boolean): void {
  Object.defineProperty(window, '__M2M_MCP_ENABLED__', { value: enabled, configurable: true, writable: true })
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
  set_tauri()
  set_opt_in(false)
  reset_publisher_status()
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  set_tauri()
  set_opt_in(false)
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('MCP settings panel', () => {
  it('is truthfully unavailable in browser mode', async () => {
    const handle = mount_mcp_settings(container)
    await handle.refresh()
    expect(container.textContent).toContain('MCP is unavailable here')
    expect(container.querySelector('[data-mcp="host-state"]')).toBeNull()
  })

  it('disables every interactive control when Rust commands do not exist', async () => {
    set_tauri(vi.fn().mockRejectedValue(new Error('command mcp_host_status not found')))
    set_opt_in(true)
    const handle = mount_mcp_settings(container)
    await handle.refresh()

    expect(container.querySelector('[data-mcp="host-state"]')?.textContent).toContain('Rust command not available')
    expect(container.querySelector('[data-mcp="clients"]')?.textContent).toBe('Not reported')
    container.querySelectorAll<HTMLButtonElement>('.mcp-button').forEach(button => {
      expect(button.disabled).toBe(true)
    })
    expect(container.textContent).not.toContain('$XDG_RUNTIME_DIR')
    expect(container.querySelector('.mcp-diagnostics')?.textContent).toContain('UNSUPPORTED')
  })

  it('shows real host/publisher state and enables actions when Rust reports capabilities', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === MCP_COMMANDS.status) {
        return {
          enabled: true,
          endpoint: '/run/user/1000/mesh2motion/mcp.sock',
          client_count: null,
          commands: [MCP_COMMANDS.setEnabled, MCP_COMMANDS.testConnection, MCP_COMMANDS.hostPaths]
        }
      }
      if (command === MCP_COMMANDS.hostPaths) {
        return {
          sidecar_path: '/opt/mesh2motion/bin/mesh2motion-mcp',
          socket_path: '/run/user/1000/mesh2motion/mcp.sock'
        }
      }
      if (command === MCP_COMMANDS.testConnection) {
        return { ok: true, message: 'Endpoint reachable', latency_ms: 3 }
      }
      if (command === MCP_COMMANDS.setEnabled) {
        return null
      }
      throw new Error(`unexpected command ${command}`)
    })
    set_tauri(invoke)
    set_opt_in(true)
    update_publisher_status({ attached: true, published_count: 5, sequence: 9, last_error: 'write refused' })
    const handle = mount_mcp_settings(container)
    await handle.refresh()

    expect(container.querySelector('[data-mcp="host-state"]')?.textContent).toBe('Enabled')
    expect(container.querySelector('[data-mcp="ipc"]')?.textContent).toContain('/run/user/1000/mesh2motion/mcp.sock')
    expect(container.querySelector('[data-mcp="publisher"]')?.textContent).toContain('5 published')
    expect(container.querySelector('[data-mcp="last-status"]')?.textContent).toContain('write refused')
    for (const tool of CONTROL_READ_TOOLS) {
      expect(container.querySelector('[data-mcp="tools"]')?.textContent).toContain(tool)
    }
    const buttons = container.querySelectorAll<HTMLButtonElement>('.mcp-button')
    buttons.forEach(button => expect(button.disabled).toBe(false))

    container.querySelector<HTMLButtonElement>('.mcp-button:nth-child(3)')?.click()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.querySelector('.mcp-action-result')?.textContent).toContain('Endpoint reachable')
  })

  it('copies a config built from real absolute paths only', async () => {
    const write_text = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write_text }, configurable: true, writable: true })
    const invoke = vi.fn(async (command: string) => {
      if (command === MCP_COMMANDS.status) {
        return { enabled: true, commands: [MCP_COMMANDS.hostPaths], endpoint: '/run/user/1000/mesh2motion/mcp.sock' }
      }
      if (command === MCP_COMMANDS.hostPaths) {
        return { sidecar_path: '/opt/mesh2motion/bin/mesh2motion-mcp', socket_path: '/run/user/1000/mesh2motion/mcp.sock' }
      }
      throw new Error('unexpected')
    })
    set_tauri(invoke)
    set_opt_in(true)
    const handle = mount_mcp_settings(container)
    await handle.refresh()

    const copy = container.querySelector<HTMLButtonElement>('.mcp-button:last-child')
    expect(copy?.disabled).toBe(false)
    copy?.click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(write_text).toHaveBeenCalledOnce()
    const config = JSON.parse(write_text.mock.calls[0][0])
    expect(config.mcpServers.mesh2motion.command).toBe('/opt/mesh2motion/bin/mesh2motion-mcp')
    expect(config.mcpServers.mesh2motion.env.M2M_MCP_IPC_ENDPOINT).toBe('/run/user/1000/mesh2motion/mcp.sock')
    expect(write_text.mock.calls[0][0]).not.toContain('$XDG_RUNTIME_DIR')
  })

  it('refuses to generate a config from placeholders or relative paths', () => {
    expect(build_client_config({ sidecar_path: null, socket_path: null })).toBeNull()
    expect(build_client_config({ sidecar_path: 'mesh2motion-mcp', socket_path: '/run/user/1000/x.sock' })).toBeNull()
    expect(build_client_config({ sidecar_path: '/opt/bin/mesh2motion-mcp', socket_path: '$XDG_RUNTIME_DIR/x.sock' })).toBeNull()
  })
})
