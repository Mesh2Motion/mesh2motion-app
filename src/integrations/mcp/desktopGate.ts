/**
 * Leaf module for the desktop/MCP activation gate.
 *
 * Kept dependency-free so both attachControl (the lazy bootstrapping module)
 * and ControlPublisher (the lazily loaded publisher chunk) can share the same
 * check without importing each other. This removes the static
 * ControlPublisher -> attachControl edge from the module graph.
 */

const ENABLE_QUERY_PARAM = 'm2m-control'
const ENABLE_STORAGE_KEY = 'm2m-control-enabled'
const ENABLE_GLOBAL = '__M2M_MCP_ENABLED__'

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: { invoke?: unknown }
  __M2M_MCP_ENABLED__?: boolean
}

/** True when a Tauri v2 IPC bridge is present (desktop build). */
export function has_tauri_bridge (): boolean {
  try {
    if (typeof window === 'undefined') {
      return false
    }
    const tauri = (window as TauriWindow).__TAURI_INTERNALS__
    return tauri !== undefined && typeof tauri.invoke === 'function'
  } catch {
    return false
  }
}

/** True only on a desktop bridge that the integrator explicitly enabled. */
export function is_desktop_control_enabled (): boolean {
  try {
    if (typeof window === 'undefined') {
      return false
    }
    const browser = window as TauriWindow
    if (!has_tauri_bridge()) {
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
