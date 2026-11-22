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
  /** False in web builds; callers should leave the control plane inert then. */
  public is_available (): boolean {
    const tauri = internals()
    return tauri !== null && typeof tauri.invoke === 'function'
  }

  /** No-op without Tauri; failures never propagate into the application. */
  public publish (snapshot: ControlSnapshot): void {
    const tauri = internals()
    if (tauri === null || typeof tauri.invoke !== 'function') {
      return
    }
    try {
      void tauri.invoke(MCP_PUBLISH_COMMAND, { snapshot })
    } catch {
      // Control-plane publication must never disturb the running application.
    }
  }
}
