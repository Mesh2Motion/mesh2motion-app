/**
 * Optional desktop-only transport adapter.
 *
 * Contains no MCP library and no @tauri-apps imports; it calls the single
 * IPC command proposed in MCP-001 through the Tauri v2 global that is present
 * when the app enables `withGlobalTauri`. Nothing imports this module from an
 * application entry point, so web builds are unaffected.
 */

import type { ControlSnapshot } from '../contracts.ts'
import type { SnapshotSink } from './SnapshotSink.ts'

/** Command name shared with the Rust bridge (MCP-001 §9). */
export const MCP_PUBLISH_COMMAND = 'mcp_publish_snapshot' as const

interface TauriInternals {
  invoke?: (command: string, args: unknown) => unknown
}

function internals (): TauriInternals | null {
  try {
    if (typeof window === 'undefined') {
      return null
    }
    const candidate = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__
    return candidate ?? null
  } catch {
    return null
  }
}

export class TauriSnapshotSink implements SnapshotSink {
  private last_error_value: string | null = null

  constructor (
    private readonly on_error?: (error: unknown) => void,
    private readonly on_success?: () => void
  ) {}

  /** False in web builds; callers should leave the control plane inert then. */
  public is_available (): boolean {
    const tauri = internals()
    return tauri !== null && typeof tauri.invoke === 'function'
  }

  /** Last IPC failure observed from this sink, if any. */
  public last_error (): string | null {
    return this.last_error_value
  }

  private report_error (error: unknown): void {
    this.last_error_value = error instanceof Error ? error.message : String(error)
    try {
      this.on_error?.(error)
    } catch {
      // Reporting must never disturb the application.
    }
  }

  /**
   * No-op without Tauri. With the bridge, resolves to `true` only when Rust
   * acknowledged the command; transport failures are reported through the
   * error callback and resolve to `false`, never propagating into the app.
   */
  public publish (snapshot: ControlSnapshot): void | Promise<boolean> {
    const tauri = internals()
    if (tauri === null || typeof tauri.invoke !== 'function') {
      return
    }
    let result: unknown
    try {
      result = tauri.invoke(MCP_PUBLISH_COMMAND, { snapshot })
    } catch (error) {
      this.report_error(error)
      return Promise.resolve(false)
    }
    const maybe_promise = result as { then?: (ok?: (value: unknown) => void, fail?: (error: unknown) => void) => unknown } | null
    if (maybe_promise != null && typeof maybe_promise.then === 'function') {
      return maybe_promise.then(
        () => {
          this.last_error_value = null
          try { this.on_success?.() } catch { /* ignore */ }
          return true
        },
        (error: unknown) => {
          this.report_error(error)
          return false
        }
      ) as Promise<boolean>
    }
    // A synchronous invoke that did not throw is the only other accepted case.
    this.last_error_value = null
    try { this.on_success?.() } catch { /* ignore */ }
    return Promise.resolve(true)
  }
}
