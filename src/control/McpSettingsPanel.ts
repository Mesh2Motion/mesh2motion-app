/**
 * Compact Integrations/MCP section for the settings dropdown.
 *
 * All host state comes from the typed McpHostClient adapter. When Rust does not
 * expose a command, controls are disabled and the panel says so; it never
 * pretends a host is running, connected, or reporting client telemetry.
 */

import { is_desktop_control_enabled } from './attachControl.ts'
import { get_publisher_status } from './publisherStatus.ts'
import { CONTROL_SCHEMA_VERSION, CONTROL_READ_TOOLS, type ControlCommand } from './contracts.ts'
import {
  build_client_config,
  McpHostClient,
  MCP_COMMANDS,
  type McpHostError,
  type McpHostPaths,
  type McpHostStatus
} from './McpHostApi.ts'

export interface McpSettingsRefresh {
  refresh(): Promise<void>
}

function element<K extends keyof HTMLElementTagNameMap> (
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

function row (label: string, key: string): HTMLElement {
  const wrapper = element('div', 'mcp-row')
  wrapper.appendChild(element('span', 'mcp-label', label))
  const value = element('span', 'mcp-value')
  value.setAttribute('data-mcp', key)
  wrapper.appendChild(value)
  return wrapper
}

function error_text (error: McpHostError): string {
  switch (error.code) {
    case 'NO_BRIDGE':
      return 'No Tauri bridge (browser mode).'
    case 'UNSUPPORTED':
      return 'Rust command not available in this build.'
    case 'HOST_DISABLED':
      return 'Host disabled: build with --features mcp-host and set M2M_MCP_ENABLE=1.'
    case 'INVALID_SNAPSHOT':
      return 'Snapshot rejected by Rust validation.'
    default:
      return error.message
  }
}

async function copy_text (text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to selection-based copy.
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textarea)
    return copied
  } catch {
    return false
  }
}

/** Mount the responsive MCP section into an existing container. */
export function mount_mcp_settings (container: HTMLElement): McpSettingsRefresh {
  container.replaceChildren()
  const section = element('section', 'mcp-settings')
  section.id = 'mcp-settings-section'
  section.setAttribute('aria-label', 'Integrations - MCP')
  container.appendChild(section)

  if (!is_desktop_control_enabled()) {
    section.appendChild(element('div', 'mcp-note',
      'MCP is unavailable here. It requires the native desktop build with the MCP opt-in enabled.'))
    return { refresh: async () => {} }
  }

  const header = element('div', 'mcp-header')
  header.appendChild(element('strong', '', 'Integrations / MCP'))
  const badge = element('span', 'mcp-badge', 'Checking…')
  badge.setAttribute('data-mcp', 'host-state')
  header.appendChild(badge)
  section.appendChild(header)

  section.appendChild(row('IPC', 'ipc'))
  section.appendChild(row('Publisher', 'publisher'))
  section.appendChild(row('Tools', 'tools'))
  section.appendChild(row('Clients', 'clients'))
  section.appendChild(row('Last status', 'last-status'))

  const actions = element('div', 'mcp-actions')
  const enable = element('button', 'mcp-button', 'Enable') as HTMLButtonElement
  const disable = element('button', 'mcp-button', 'Disable') as HTMLButtonElement
  const test = element('button', 'mcp-button', 'Test connection') as HTMLButtonElement
  const copy = element('button', 'mcp-button', 'Copy config') as HTMLButtonElement
  enable.type = disable.type = test.type = copy.type = 'button'
  for (const button of [enable, disable, test, copy]) {
    button.disabled = true
    actions.appendChild(button)
  }
  section.appendChild(actions)

  const action_result = element('div', 'mcp-action-result')
  section.appendChild(action_result)

  const details = element('details', 'mcp-details')
  details.appendChild(element('summary', '', 'Advanced diagnostics'))
  const diagnostics = element('pre', 'mcp-diagnostics')
  diagnostics.setAttribute('data-mcp', 'diagnostics')
  details.appendChild(diagnostics)
  section.appendChild(details)

  let host_status: McpHostStatus | null = null
  let host_error: McpHostError | null = null
  let host_paths: McpHostPaths | null = null
  let generation = 0

  const set = (key: string, value: string): void => {
    const node = section.querySelector<HTMLElement>(`[data-mcp="${key}"]`)
    if (node !== null) {
      node.textContent = value
    }
  }

  function render (): void {
    const publisher = get_publisher_status()
    badge.textContent = host_status === null
      ? (host_error === null ? 'Not supported' : error_text(host_error))
      : (host_status.enabled ? 'Enabled' : 'Disabled')
    badge.classList.toggle('is-enabled', host_status?.enabled === true)

    const endpoint = host_status?.endpoint
    set('ipc', endpoint === null || endpoint === undefined
      ? 'Endpoint not reported'
      : `Endpoint ${endpoint}`)
    const publish_parts = [`schema ${CONTROL_SCHEMA_VERSION}`]
    publish_parts.push(publisher.attached ? 'publisher active' : 'publisher inactive')
    publish_parts.push(`${publisher.published_count} published`)
    if (publisher.sequence !== null) {
      publish_parts.push(`seq ${publisher.sequence}`)
    }
    set('publisher', publish_parts.join(' · '))

    const tools = host_status?.tools ?? [...CONTROL_READ_TOOLS] as ControlCommand[]
    set('tools', tools.join(', '))

    set('clients', host_status?.client_count === null || host_status?.client_count === undefined
      ? 'Not reported'
      : String(host_status.client_count))

    const errors: string[] = []
    if (publisher.last_error !== null) {
      errors.push(`publish: ${publisher.last_error}`)
    }
    if (host_error !== null) {
      errors.push(`host: ${error_text(host_error)}`)
    }
    set('last-status', errors.length === 0 ? 'No errors reported' : errors.join(' | '))

    const commands = host_status?.commands ?? []
    enable.disabled = !commands.includes(MCP_COMMANDS.setEnabled)
    disable.disabled = enable.disabled
    test.disabled = !commands.includes(MCP_COMMANDS.testConnection)
    copy.disabled = build_client_config(host_paths ?? { sidecar_path: null, socket_path: null }) === null
    copy.title = copy.disabled
      ? 'Requires Rust mcp_host_paths with absolute executable and socket paths'
      : 'Copy configuration with real absolute paths'

    diagnostics.textContent = JSON.stringify({
      host_status,
      host_error,
      host_paths,
      publisher: get_publisher_status()
    }, null, 2)
  }

  async function refresh (): Promise<void> {
    const current = ++generation
    const client = new McpHostClient()
    const status = await client.status()
    if (current !== generation) {
      return
    }
    if (status.ok) {
      host_status = status.data
      host_error = null
      if (status.data.commands.includes(MCP_COMMANDS.hostPaths)) {
        const paths = await client.paths()
        if (current === generation && paths.ok) {
          host_paths = paths.data
        }
      }
    } else {
      host_status = null
      host_error = status.error
      host_paths = null
    }
    if (current === generation) {
      render()
    }
  }

  enable.addEventListener('click', () => {
    void (async () => {
      const result = await new McpHostClient().set_enabled(true)
      action_result.textContent = result.ok ? 'Enable command accepted by Rust.' : error_text(result.error)
      await refresh()
    })()
  })
  disable.addEventListener('click', () => {
    void (async () => {
      const result = await new McpHostClient().set_enabled(false)
      action_result.textContent = result.ok ? 'Disable command accepted by Rust.' : error_text(result.error)
      await refresh()
    })()
  })
  test.addEventListener('click', () => {
    void (async () => {
      const result = await new McpHostClient().test_connection()
      action_result.textContent = result.ok
        ? `${result.data.ok ? 'Connected' : 'Not connected'}: ${result.data.message}`
        : error_text(result.error)
    })()
  })
  copy.addEventListener('click', () => {
    void (async () => {
      const config = build_client_config(host_paths ?? { sidecar_path: null, socket_path: null })
      if (config === null) {
        action_result.textContent = 'No absolute host paths reported by Rust.'
        return
      }
      action_result.textContent = await copy_text(config)
        ? 'Configuration copied with real absolute paths.'
        : 'Copy failed; select the diagnostics text manually.'
    })()
  })

  render()
  return { refresh }
}
