/**
 * M2M-028B — Tauri event/invoke adapter for authoring-bridge/v1.
 *
 * Rust emits typed requests on `m2m-authoring-request`; the correlated response
 * is returned through the Tauri command `mcp_authoring_respond`. Cancellation,
 * peer disconnect, permission disable and shutdown arrive as
 * `m2m-authoring-cancel`. The browser CustomEvent interface is kept only for
 * tests/internal compatibility and is not a substitute for this adapter.
 */

import type { AuthoringResponse } from './types'

export const TAURI_REQUEST_EVENT = 'm2m-authoring-request'
export const TAURI_CANCEL_EVENT = 'm2m-authoring-cancel'
export const TAURI_RESPOND_COMMAND = 'mcp_authoring_respond'

interface TauriInternals {
  invoke?: (command: string, args: unknown) => Promise<unknown>
  transformCallback?: (handler: (event: { event: string, payload: unknown }) => void, once?: boolean) => number
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals
}

export interface TauriAuthoringAdapter {
  /** Detach both listeners. */
  dispose (): Promise<void>
  listening (): boolean
}

/** Synchronize the native write permission; returns false outside Tauri. */
export async function set_tauri_authoring_enabled (enabled: boolean): Promise<boolean> {
  const internals = (window as TauriWindow).__TAURI_INTERNALS__
  if (internals?.invoke === undefined) return false
  await internals.invoke('mcp_authoring_set_enabled', { enabled })
  return true
}

/** Install the adapter. Returns an inert handle in non-Tauri builds. */
export async function attachTauriAuthoringAdapter (
  handle: (request: unknown) => Promise<AuthoringResponse>,
  handle_cancel: (payload: unknown) => void
): Promise<TauriAuthoringAdapter> {
  const internals = (window as TauriWindow).__TAURI_INTERNALS__
  if (internals?.invoke === undefined || internals.transformCallback === undefined) {
    return { dispose: async () => {}, listening: () => false }
  }

  const request_handler = internals.transformCallback((event) => {
    void handle(event.payload).then((response) => {
      void internals.invoke?.(TAURI_RESPOND_COMMAND, { response })
    })
  })
  const cancel_handler = internals.transformCallback((event) => {
    handle_cancel(event.payload)
  })

  await internals.invoke('plugin:event|listen', { event: TAURI_REQUEST_EVENT, handler: request_handler })
  await internals.invoke('plugin:event|listen', { event: TAURI_CANCEL_EVENT, handler: cancel_handler })

  let active = true
  return {
    listening: () => active,
    dispose: async () => {
      if (!active) return
      active = false
      await internals.invoke?.('plugin:event|unlisten', { event: TAURI_REQUEST_EVENT, handlerId: request_handler })
      await internals.invoke?.('plugin:event|unlisten', { event: TAURI_CANCEL_EVENT, handlerId: cancel_handler })
    }
  }
}
