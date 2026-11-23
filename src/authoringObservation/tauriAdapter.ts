/**
 * M2M-030A — optional Tauri transport adapter for pose observations.
 *
 * Transport names are PROVISIONAL in the shared contract and must be confirmed
 * by Codex. The callable service API never depends on this adapter, so a browser
 * or JSDOM caller can use the service directly.
 */

import type { PoseObservationResponse } from './types'

export const OBSERVATION_REQUEST_EVENT = 'm2m-pose-observation-request'
export const OBSERVATION_CANCEL_EVENT = 'm2m-pose-observation-cancel'
export const OBSERVATION_RESPOND_COMMAND = 'mcp_pose_observation_respond'

interface TauriInternals {
  invoke?: (command: string, args: unknown) => Promise<unknown>
  transformCallback?: (handler: (event: { event: string, payload: unknown }) => void, once?: boolean) => number
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals
}

export interface TauriPoseObservationAdapter {
  dispose: () => Promise<void>
  listening: () => boolean
}

/** Installs listeners only when the real Tauri bridge is present. */
export async function attachTauriPoseObservationAdapter (
  handle: (request: unknown) => Promise<PoseObservationResponse>,
  handle_cancel: (payload: unknown) => void
): Promise<TauriPoseObservationAdapter> {
  const internals = (window as TauriWindow).__TAURI_INTERNALS__
  if (internals?.invoke === undefined || internals.transformCallback === undefined) {
    return { dispose: async () => {}, listening: () => false }
  }
  const request_handler = internals.transformCallback((event) => {
    void handle(event.payload).then((response) => {
      void internals.invoke?.(OBSERVATION_RESPOND_COMMAND, { response }).catch((error: unknown) => {
        console.error('M2M pose observation response acknowledgement failed', error)
      })
    })
  })
  const cancel_handler = internals.transformCallback((event) => { handle_cancel(event.payload) })
  try {
    await internals.invoke('plugin:event|listen', {
      event: OBSERVATION_REQUEST_EVENT,
      target: { kind: 'Any' },
      handler: request_handler
    })
    await internals.invoke('plugin:event|listen', {
      event: OBSERVATION_CANCEL_EVENT,
      target: { kind: 'Any' },
      handler: cancel_handler
    })
  } catch (error) {
    await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_REQUEST_EVENT, eventId: request_handler }).catch(() => {})
    await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_CANCEL_EVENT, eventId: cancel_handler }).catch(() => {})
    throw error
  }
  let active = true
  return {
    listening: () => active,
    dispose: async () => {
      if (!active) return
      active = false
      await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_REQUEST_EVENT, eventId: request_handler })
      await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_CANCEL_EVENT, eventId: cancel_handler })
    }
  }
}
