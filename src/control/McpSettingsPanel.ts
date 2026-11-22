/**
 * Desktop-only Integrations/MCP section for the existing settings dropdown.
 *
 * Everything shown here is either a documented prerequisite or a value actually
 * observed in this webview. It never claims a connected MCP client, an active
 * Rust host, or a live toggle that Rust does not implement.
 */

import { has_tauri_bridge, is_desktop_control_enabled } from './attachControl.ts'
import { get_publisher_status } from './publisherStatus.ts'
import { CONTROL_SCHEMA_VERSION } from './contracts.ts'

export const MCP_READ_TOOLS: readonly string[] = [
  'application_get_status',
  'renderer_get_state',
  'rigs_list',
  'animations_list',
  'scene_inspect'
]

/** Expected Rust host endpoint from M2M-009; not verified by the frontend. */
export const MCP_EXPECTED_ENDPOINT = '$XDG_RUNTIME_DIR/mesh2motion/mcp.sock'

export const MCP_CLIENT_CONFIG = JSON.stringify({
  mcpServers: {
    mesh2motion: {
      command: '<path-to-built-mesh2motion-mcp>',
      env: { M2M_MCP_IPC_ENDPOINT: MCP_EXPECTED_ENDPOINT }
    }
  }
}, null, 2)

export interface McpSettingsRefresh {
  refresh(): void
}

function row (label: string, key: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'mcp-settings-row'
  const name = document.createElement('span')
  name.className = 'mcp-settings-label'
  name.textContent = label
  const value = document.createElement('span')
  value.className = 'mcp-settings-value'
  value.setAttribute('data-mcp', key)
  wrapper.append(name, value)
  return wrapper
}

function add_text (parent: HTMLElement, text: string, className: string): HTMLElement {
  const element = document.createElement('div')
  element.className = className
  element.textContent = text
  parent.appendChild(element)
  return element
}

async function copy_text (text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall back to the legacy selection-based copy below.
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

function describe_publisher (): string {
  const status = get_publisher_status()
  if (!status.attached) {
    return status.disposed ? 'Stopped (page closing)' : 'Not attached'
  }
  const parts = [`Active · schema ${status.schema_version}`]
  parts.push(`published ${status.published_count}`)
  if (status.sequence !== null) {
    parts.push(`sequence ${status.sequence}`)
  }
  if (status.phase !== null) {
    parts.push(`phase ${status.phase}`)
  }
  return parts.join(' · ')
}

/** Mount the MCP settings section into an existing settings dropdown container. */
export function mount_mcp_settings (container: HTMLElement): McpSettingsRefresh {
  container.replaceChildren()
  const section = document.createElement('section')
  section.id = 'mcp-settings-section'
  section.className = 'mcp-settings'
  section.setAttribute('aria-label', 'Integrations - MCP')
  container.appendChild(section)

  add_text(section, 'Integrations / MCP', 'mcp-settings-title')

  const desktop = has_tauri_bridge()
  if (!desktop) {
    add_text(section, 'MCP is unavailable in web builds. It requires the native desktop application.',
      'mcp-settings-note')
    return { refresh: () => {} }
  }

  section.appendChild(row('Availability', 'availability'))
  section.appendChild(row('Host state', 'host-state'))
  section.appendChild(row('Publisher', 'publisher'))
  section.appendChild(row('Endpoint (expected)', 'endpoint'))
  section.appendChild(row('Contract', 'contract'))

  const tools = document.createElement('div')
  tools.className = 'mcp-settings-tools'
  const tools_title = document.createElement('div')
  tools_title.className = 'mcp-settings-subtitle'
  tools_title.textContent = 'Read-only tools'
  tools.appendChild(tools_title)
  const list = document.createElement('ul')
  for (const tool of MCP_READ_TOOLS) {
    const item = document.createElement('li')
    item.textContent = `${tool} (read-only)`
    list.appendChild(item)
  }
  tools.appendChild(list)
  section.appendChild(tools)

  add_text(section,
    'Prerequisites: build the desktop with --features mcp-host and launch it with M2M_MCP_ENABLE=1. ' +
    'Frontend publishing also needs the MCP opt-in. A relaunch is required after changing these; ' +
    'this panel does not enable a host that is not running.',
    'mcp-settings-note')

  const instructions = document.createElement('ol')
  instructions.className = 'mcp-settings-steps'
  for (const step of [
    'Build the desktop with the mcp-host feature enabled.',
    'Start Mesh2Motion with M2M_MCP_ENABLE=1 in its environment.',
    'Configure your MCP client to launch the mesh2motion-mcp stdio sidecar with M2M_MCP_IPC_ENDPOINT set to the endpoint above.',
    'Relaunch the client; no client count is reported because the frontend has no such telemetry.'
  ]) {
    const item = document.createElement('li')
    item.textContent = step
    instructions.appendChild(item)
  }
  section.appendChild(instructions)

  const copy_button = document.createElement('button')
  copy_button.type = 'button'
  copy_button.className = 'mcp-settings-copy'
  copy_button.textContent = 'Copy MCP client config'
  section.appendChild(copy_button)
  const copy_result = add_text(section, '', 'mcp-settings-copy-result')
  copy_button.addEventListener('click', () => {
    void copy_text(MCP_CLIENT_CONFIG).then(copied => {
      copy_result.textContent = copied
        ? 'Client configuration copied. Replace the command placeholder with your built sidecar path.'
        : 'Copy failed. Select the instructions manually.'
    })
  })

  const error_box = add_text(section, '', 'mcp-settings-error')

  const set = (key: string, value: string): void => {
    const node = section.querySelector<HTMLElement>(`[data-mcp="${key}"]`)
    if (node !== null) {
      node.textContent = value
    }
  }

  function refresh (): void {
    const status = get_publisher_status()
    set('availability', is_desktop_control_enabled()
      ? 'Desktop bridge detected · publisher opt-in enabled'
      : 'Desktop bridge detected · publisher opt-in disabled')
    // Host state is deliberately not claimed: Rust exposes no status command to the UI.
    set('host-state', 'Not reported by frontend — requires mcp-host build + M2M_MCP_ENABLE=1')
    set('publisher', describe_publisher())
    set('endpoint', MCP_EXPECTED_ENDPOINT)
    set('contract', `v${CONTROL_SCHEMA_VERSION} · five read-only tools`)
    const error = status.last_error
    error_box.textContent = error === null ? '' : `Last publish error: ${error}`
  }

  refresh()
  return { refresh }
}
