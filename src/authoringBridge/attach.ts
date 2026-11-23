/**
 * M2M-028A/028B — install the frontend authoring bridge in the real application.
 *
 * The native event listener is installed before the rig is ready. A bounded
 * identity poll attaches and replaces the application owner as the live
 * skeleton changes, so early MCP requests receive RIG_UNAVAILABLE instead of
 * hanging and a later model load becomes authorable without re-entering a page.
 */

import './confirmationPanel.css'
import type { Skeleton } from 'three'
import type { AuthoringBridgeApp, FrontendAuthoringBridge } from './service'
import { live_rig_identifier, live_skeleton_from_engine } from './rigCatalog'
import {
  attachTauriAuthoringAdapter,
  set_tauri_authoring_enabled,
  type TauriAuthoringAdapter
} from './tauriAdapter'
import {
  AUTHORING_BRIDGE_PROTOCOL,
  is_authoring_request,
  type AuthoringRequest,
  type AuthoringResponse
} from './types'

export const AUTHORING_REQUEST_EVENT = 'm2m-authoring-request'
export const AUTHORING_RESPONSE_EVENT = 'm2m-authoring-response'

const RIG_POLL_INTERVAL_MS = 250
const attached_engines = new WeakSet<object>()

declare global {
  interface Window {
    m2mAuthoringBridge?: FrontendAuthoringBridge
    m2mAuthoringAdapter?: TauriAuthoringAdapter
  }
}

function rig_unavailable_response (input: unknown): AuthoringResponse {
  if (!is_authoring_request(input)) {
    return {
      protocol: AUTHORING_BRIDGE_PROTOCOL,
      request_id: '',
      session_id: '',
      sequence: 0,
      ok: false,
      error: { code: 'BAD_PROTOCOL', message: 'request does not match authoring-bridge/v1' }
    }
  }
  const request: AuthoringRequest = input
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: request.request_id,
    session_id: request.session_id,
    sequence: request.sequence,
    ok: false,
    error: { code: 'RIG_UNAVAILABLE', message: 'the live Three.js rig is not ready' }
  }
}

export function attachAuthoringBridge (engine: AuthoringBridgeApp['engine']): void {
  const engine_identity = engine as object
  if (attached_engines.has(engine_identity)) return
  attached_engines.add(engine_identity)

  let active_bridge: FrontendAuthoringBridge | null = null
  let active_skeleton: Skeleton | null = null
  let active_identifier: string | null = null
  let adapter: TauriAuthoringAdapter | null = null
  let refresh_promise: Promise<void> | null = null

  const handle_request = (request: unknown): Promise<AuthoringResponse> => {
    if (active_bridge !== null) return active_bridge.handle(request)
    return refresh_live_rig().then(() => active_bridge?.handle(request) ?? rig_unavailable_response(request))
  }
  const handle_cancel = (payload: unknown): void => {
    active_bridge?.handle_cancel(payload)
  }

  const refresh_live_rig = async (): Promise<void> => {
    if (refresh_promise !== null) return refresh_promise
    refresh_promise = (async () => {
      const identifier = live_rig_identifier(engine)
      const skeleton = live_skeleton_from_engine(engine)
      if (identifier === active_identifier && skeleton === active_skeleton) return

      if (active_bridge !== null) {
        active_bridge.dispose()
        active_bridge = null
        window.m2mAuthoringBridge = undefined
      }
      active_identifier = null
      active_skeleton = null

      if (identifier === null || skeleton === null) return
      const { FrontendAuthoringBridge: Bridge } = await import('./service')
      const { AuthoringPermission } = await import('./permission')
      let bridge: FrontendAuthoringBridge | null = null
      const permission = new AuthoringPermission(document.body, set_tauri_authoring_enabled, (enabled) => {
        if (!enabled) bridge?.permission_revoked()
      })
      const app: AuthoringBridgeApp = {
        engine,
        skeleton,
        rig_identifier: identifier
      }
      const next_bridge = new Bridge(app, undefined, permission)
      bridge = next_bridge
      active_identifier = identifier
      active_skeleton = skeleton
      active_bridge = next_bridge
      window.m2mAuthoringBridge = next_bridge
    })()
    try {
      await refresh_promise
    } finally {
      refresh_promise = null
    }
  }

  const load = async (): Promise<void> => {
    adapter = await attachTauriAuthoringAdapter(handle_request, handle_cancel)
    window.m2mAuthoringAdapter = adapter

    // Browser compatibility is test/dev only; native requests use Tauri events.
    window.addEventListener(AUTHORING_REQUEST_EVENT, (event: Event) => {
      const request = (event as CustomEvent<AuthoringRequest>).detail
      void handle_request(request).then((response) => {
        window.dispatchEvent(new CustomEvent(AUTHORING_RESPONSE_EVENT, { detail: response }))
      })
    })

    await refresh_live_rig()
    const timer = window.setInterval(() => { void refresh_live_rig() }, RIG_POLL_INTERVAL_MS)
    window.addEventListener('pagehide', () => {
      window.clearInterval(timer)
      void adapter?.dispose()
      active_bridge?.dispose()
      active_bridge = null
      window.m2mAuthoringBridge = undefined
      window.m2mAuthoringAdapter = undefined
      attached_engines.delete(engine_identity)
    }, { once: true })
  }
  void load().catch((error: unknown) => {
    console.error('M2M authoring bridge attachment failed', error)
    attached_engines.delete(engine_identity)
  })
}
