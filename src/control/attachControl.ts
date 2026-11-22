/**
 * Tiny desktop-only activation gate.
 *
 * Statically imported by the three page bootstraps; it contains no MCP or
 * Tauri library import and loads the publisher chunk only when a Tauri IPC
 * bridge AND an explicit opt-in are present. Web builds therefore do not load
 * the publisher at all.
 */

import type { ControlEngineLike, ControlPublisherHandle, ControlPublisherOptions } from './ControlPublisher.ts'

const ENABLE_QUERY_PARAM = 'm2m-control'
const ENABLE_STORAGE_KEY = 'm2m-control-enabled'
const ENABLE_GLOBAL = '__M2M_MCP_ENABLED__'

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: { invoke?: unknown }
  __M2M_MCP_ENABLED__?: boolean
}

/** True only on a desktop bridge that the integrator explicitly enabled. */
export function is_desktop_control_enabled (): boolean {
  try {
    if (typeof window === 'undefined') {
      return false
    }
    const browser = window as TauriWindow
    const tauri = browser.__TAURI_INTERNALS__
    if (tauri === undefined || typeof tauri.invoke !== 'function') {
      return false
    }
    if (browser[ENABLE_GLOBAL] === true) {
      return true
    }
    if (new URLSearchParams(browser.location.search).get(ENABLE_QUERY_PARAM) === '1') {
      return true
    }
    return browser.localStorage.getItem(ENABLE_STORAGE_KEY) === '1'
  } catch {
    // Restrictive webviews must never break application startup.
    return false
  }
}

/**
 * Attach the publisher when enabled. No-op otherwise. Failures are swallowed
 * because application-control is strictly auxiliary.
 */
export function maybe_attach_desktop_control (
  engine: ControlEngineLike,
  options: ControlPublisherOptions = {}
): Promise<ControlPublisherHandle | null> {
  if (!is_desktop_control_enabled()) {
    return Promise.resolve(null)
  }
  return import('./ControlPublisher.ts')
    .then(({ attach_control_publisher }) => attach_control_publisher(engine, options))
    .catch(() => null) // diagnostics are optional; never propagate
}
