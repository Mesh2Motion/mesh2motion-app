/**
 * M2M-028A — install the frontend authoring bridge in the real application.
 *
 * The native/MCP layer (Codex) can dispatch a CustomEvent named
 * `m2m-authoring-request` with a typed AuthoringRequest as `detail`; the bridge
 * answers with `m2m-authoring-response`. This keeps the frontend side testable
 * and independent of Rust while Codex implements the concrete IPC transport.
 */

import './confirmationPanel.css'
import type { AuthoringBridgeApp, FrontendAuthoringBridge } from './service'
import { live_rig_identifier, live_skeleton_from_engine } from './rigCatalog'
import type { AuthoringRequest, AuthoringResponse } from './types'

export const AUTHORING_REQUEST_EVENT = 'm2m-authoring-request'
export const AUTHORING_RESPONSE_EVENT = 'm2m-authoring-response'

declare global {
  interface Window {
    m2mAuthoringBridge?: FrontendAuthoringBridge
  }
}

export function attachAuthoringBridge (engine: AuthoringBridgeApp['engine']): void {
  const identifier = live_rig_identifier(engine)
  const skeleton = live_skeleton_from_engine(engine)
  if (identifier === null || skeleton === null) return

  // Lazy import avoids coupling the four page bootstraps to the domain bundle
  // until a live rig actually exists.
  const app: AuthoringBridgeApp = { engine, skeleton, rig_identifier: identifier }
  const load = async (): Promise<void> => {
    const { FrontendAuthoringBridge: Bridge } = await import('./service')
    if (window.m2mAuthoringBridge !== undefined) return
    const bridge = new Bridge(app)
    window.m2mAuthoringBridge = bridge
    window.addEventListener(AUTHORING_REQUEST_EVENT, (event: Event) => {
      const request = (event as CustomEvent<AuthoringRequest>).detail
      void bridge.handle(request).then((response: AuthoringResponse) => {
        window.dispatchEvent(new CustomEvent(AUTHORING_RESPONSE_EVENT, { detail: response }))
      })
    })
    window.addEventListener('pagehide', () => bridge.dispose(), { once: true })
  }
  void load()
}
