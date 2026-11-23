/**
 * M2M-028A/028B — install the frontend authoring bridge in the real application.
 *
 * The Rust side emits Tauri events; this module wires them to the actual bridge
 * and returns responses via `mcp_authoring_respond`. The browser CustomEvent
 * path is retained only for internal compatibility/tests.
 */

import './confirmationPanel.css'
import type { AuthoringBridgeApp, FrontendAuthoringBridge } from './service'
import { live_rig_identifier, live_skeleton_from_engine } from './rigCatalog'
import { attachTauriAuthoringAdapter, type TauriAuthoringAdapter } from './tauriAdapter'
import type { AuthoringRequest, AuthoringResponse } from './types'

export const AUTHORING_REQUEST_EVENT = 'm2m-authoring-request'
export const AUTHORING_RESPONSE_EVENT = 'm2m-authoring-response'

declare global {
  interface Window {
    m2mAuthoringBridge?: FrontendAuthoringBridge
    m2mAuthoringAdapter?: TauriAuthoringAdapter
  }
}

export function attachAuthoringBridge (engine: AuthoringBridgeApp['engine']): void {
  const identifier = live_rig_identifier(engine)
  const skeleton = live_skeleton_from_engine(engine)
  if (identifier === null || skeleton === null) return

  const app: AuthoringBridgeApp = { engine, skeleton, rig_identifier: identifier }
  const load = async (): Promise<void> => {
    const { FrontendAuthoringBridge: Bridge } = await import('./service')
    const { AuthoringPermission } = await import('./permission')
    if (window.m2mAuthoringBridge !== undefined) return
    const permission = new AuthoringPermission()
    const bridge = new Bridge(app, undefined, permission)
    window.m2mAuthoringBridge = bridge

    // Native Tauri path (authoritative).
    window.m2mAuthoringAdapter = await attachTauriAuthoringAdapter(
      (request: unknown) => bridge.handle(request),
      (payload: unknown) => bridge.handle_cancel(payload)
    )

    // Browser compatibility path for tests/dev only.
    window.addEventListener(AUTHORING_REQUEST_EVENT, (event: Event) => {
      const request = (event as CustomEvent<AuthoringRequest>).detail
      void bridge.handle(request).then((response: AuthoringResponse) => {
        window.dispatchEvent(new CustomEvent(AUTHORING_RESPONSE_EVENT, { detail: response }))
      })
    })
    window.addEventListener('pagehide', () => {
      void window.m2mAuthoringAdapter?.dispose()
      bridge.dispose()
    }, { once: true })
  }
  void load()
}
