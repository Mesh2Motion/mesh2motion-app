/**
 * Typed adapter for the optional Rust MCP host commands.
 *
 * COORDINATION CONTRACT (to be confirmed by Codex before Rust work):
 *   mcp_host_status   -> { enabled, endpoint?, client_count?, commands[], sidecar_path?, tools? }
 *   mcp_set_enabled   -> ({ enabled: boolean }) -> void
 *   mcp_test_connection -> { ok, message, latency_ms? }
 *   mcp_host_paths    -> { sidecar_path?, socket_path? }
 *
 * None of these commands exists in the reviewed M2M-010 integration (only
 * `mcp_publish_snapshot` is registered). Every call therefore fails closed:
 * the UI displays truthful disabled/unavailable states and never fabricates a
 * host, client count, endpoint or configuration path.
 */

import { CONTROL_READ_TOOLS } from './contracts.ts'

export const MCP_COMMANDS = {
  status: 'mcp_host_status',
  setEnabled: 'mcp_set_enabled',
  testConnection: 'mcp_test_connection',
  hostPaths: 'mcp_host_paths'
} as const

export type McpHostErrorCode =
  | 'NO_BRIDGE'
  | 'UNSUPPORTED'
  | 'HOST_DISABLED'
  | 'INVALID_SNAPSHOT'
  | 'HOST_ERROR'

export interface McpHostError {
  code: McpHostErrorCode
  message: string
}

export type McpResult<T> =
  | { ok: true, data: T }
  | { ok: false, error: McpHostError }

export interface McpHostStatus {
  enabled: boolean
  endpoint: string | null
  /** Only populated when Rust actually reports telemetry; otherwise null. */
  client_count: number | null
  commands: string[]
  sidecar_path: string | null
  tools: string[]
}

export interface McpHostPaths {
  sidecar_path: string | null
  socket_path: string | null
}

export interface McpConnectionTest {
  ok: boolean
  message: string
  latency_ms: number | null
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: {
    invoke?: (command: string, args?: unknown) => Promise<unknown>
  }
}

function map_error (error: unknown): McpHostError {
  const message = error instanceof Error ? error.message : String(error)
  if (/command not found|unknown command|not found/i.test(message)) {
    return { code: 'UNSUPPORTED', message }
  }
  if (/MCP host is disabled|M2M_MCP_ENABLE/i.test(message)) {
    return { code: 'HOST_DISABLED', message }
  }
  if (/snapshot rejected/i.test(message)) {
    return { code: 'INVALID_SNAPSHOT', message }
  }
  return { code: 'HOST_ERROR', message }
}

function as_record (value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

function string_or_null (value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function number_or_null (value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Build a client config only from real absolute paths; never emit a placeholder. */
export function build_client_config (paths: McpHostPaths): string | null {
  if (paths.sidecar_path === null || paths.socket_path === null) {
    return null
  }
  if (!paths.sidecar_path.startsWith('/') || !paths.socket_path.startsWith('/')) {
    return null
  }
  return JSON.stringify({
    mcpServers: {
      mesh2motion: {
        command: paths.sidecar_path,
        env: { M2M_MCP_IPC_ENDPOINT: paths.socket_path }
      }
    }
  }, null, 2)
}

export class McpHostClient {
  public async status (): Promise<McpResult<McpHostStatus>> {
    const invoke = this.invoke_function()
    if (invoke === null) {
      return { ok: false, error: { code: 'NO_BRIDGE', message: 'No Tauri IPC bridge in this build.' } }
    }
    try {
      const raw = await invoke(MCP_COMMANDS.status)
      const record = as_record(raw)
      if (record === null) {
        return { ok: false, error: { code: 'HOST_ERROR', message: 'Malformed status response.' } }
      }
      const commands = Array.isArray(record.commands)
        ? record.commands.filter((entry): entry is string => typeof entry === 'string')
        : []
      const tools = Array.isArray(record.tools)
        ? record.tools.filter((entry): entry is string => typeof entry === 'string')
        : [...CONTROL_READ_TOOLS]
      return {
        ok: true,
        data: {
          enabled: record.enabled === true,
          endpoint: string_or_null(record.endpoint),
          client_count: number_or_null(record.client_count),
          commands,
          sidecar_path: string_or_null(record.sidecar_path),
          tools
        }
      }
    } catch (error) {
      return { ok: false, error: map_error(error) }
    }
  }

  public async set_enabled (enabled: boolean): Promise<McpResult<null>> {
    const status = await this.status()
    if (!status.ok || !status.data.commands.includes(MCP_COMMANDS.setEnabled)) {
      return {
        ok: false,
        error: status.ok
          ? { code: 'UNSUPPORTED', message: 'Rust does not expose mcp_set_enabled.' }
          : status.error
      }
    }
    const result = await this.call(MCP_COMMANDS.setEnabled, { enabled })
    return result.ok ? { ok: true, data: null } : result
  }

  public async test_connection (): Promise<McpResult<McpConnectionTest>> {
    const status = await this.status()
    if (!status.ok || !status.data.commands.includes(MCP_COMMANDS.testConnection)) {
      return {
        ok: false,
        error: status.ok
          ? { code: 'UNSUPPORTED', message: 'Rust does not expose mcp_test_connection.' }
          : status.error
      }
    }
    try {
      const raw = await this.call(MCP_COMMANDS.testConnection)
      if (!raw.ok) {
        return raw
      }
      const record = as_record(raw.data)
      return {
        ok: true,
        data: {
          ok: record?.ok === true,
          message: typeof record?.message === 'string' ? record.message : '',
          latency_ms: number_or_null(record?.latency_ms)
        }
      }
    } catch (error) {
      return { ok: false, error: map_error(error) }
    }
  }

  public async paths (): Promise<McpResult<McpHostPaths>> {
    const status = await this.status()
    if (!status.ok || !status.data.commands.includes(MCP_COMMANDS.hostPaths)) {
      return {
        ok: false,
        error: status.ok
          ? { code: 'UNSUPPORTED', message: 'Rust does not expose mcp_host_paths.' }
          : status.error
      }
    }
    const raw = await this.call(MCP_COMMANDS.hostPaths)
    if (!raw.ok) {
      return raw
    }
    const record = as_record(raw.data)
    return {
      ok: true,
      data: {
        sidecar_path: string_or_null(record?.sidecar_path),
        socket_path: string_or_null(record?.socket_path)
      }
    }
  }

  private async call (command: string, args?: unknown): Promise<McpResult<unknown>> {
    const invoke = this.invoke_function()
    if (invoke === null) {
      return { ok: false, error: { code: 'NO_BRIDGE', message: 'No Tauri IPC bridge.' } }
    }
    try {
      return { ok: true, data: await invoke(command, args) }
    } catch (error) {
      return { ok: false, error: map_error(error) }
    }
  }

  private invoke_function (): ((command: string, args?: unknown) => Promise<unknown>) | null {
    try {
      if (typeof window === 'undefined') {
        return null
      }
      const invoke = (window as TauriWindow).__TAURI_INTERNALS__?.invoke
      return typeof invoke === 'function' ? invoke : null
    } catch {
      return null
    }
  }
}
