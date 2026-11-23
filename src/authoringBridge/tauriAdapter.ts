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

  await internals.invoke('mcp_authoring_frontend_set_ready', { ready: false })

  const request_handler = internals.transformCallback((event) => {
    void handle(event.payload).then((response) => {
      void internals.invoke?.(TAURI_RESPOND_COMMAND, { response }).catch((error: unknown) => {
        console.error('M2M authoring response acknowledgement failed', error)
      })
    })
  })
  const cancel_handler = internals.transformCallback((event) => {
    handle_cancel(event.payload)
  })

  try {
    await internals.invoke('mcp_authoring_frontend_stage', { stage: 'listener_start' })
    await internals.invoke('plugin:event|listen', {
      event: TAURI_REQUEST_EVENT,
      target: { kind: 'Any' },
      handler: request_handler
    })
    await internals.invoke('mcp_authoring_frontend_stage', { stage: 'request_listener_ok' })
    await internals.invoke('plugin:event|listen', {
      event: TAURI_CANCEL_EVENT,
      target: { kind: 'Any' },
      handler: cancel_handler
    })
    await internals.invoke('mcp_authoring_frontend_stage', { stage: 'cancel_listener_ok' })
    await internals.invoke('mcp_authoring_frontend_set_ready', { ready: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    await internals.invoke('mcp_authoring_frontend_stage', { stage: 'ready_failed', detail }).catch(() => {})
    await internals.invoke('mcp_authoring_frontend_set_ready', { ready: false }).catch(() => {})
    throw error
  }

  let active = true
  return {
    listening: () => active,
    dispose: async () => {
      if (!active) return
      active = false
      await internals.invoke?.('plugin:event|unlisten', { event: TAURI_REQUEST_EVENT, eventId: request_handler })
      await internals.invoke?.('plugin:event|unlisten', { event: TAURI_CANCEL_EVENT, eventId: cancel_handler })
      await internals.invoke?.('mcp_authoring_frontend_set_ready', { ready: false })
    }
  }
}
