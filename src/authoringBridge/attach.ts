/**
 * M2M-028A/028B — install/reinstall the authoring bridge with the live rig.
 *
 * The engine watcher survives unloads and model switches. A native Tauri
 * adapter is attached only while a real supported rig exists; it is disposed
 * when that rig goes away. MCP authoring requests enable the new bridge's
 * in-memory permission state.
 */

import './confirmationPanel.css'
import type { AuthoringBridgeApp, FrontendAuthoringBridge } from './service'
import { watch_rig_lifecycle, type RigLifecycleEngine, type RigLifecycleHandle } from './rigLifecycle'
import {
  attachTauriAuthoringAdapter,
  type TauriAuthoringAdapter
} from './tauriAdapter'
import type { AuthoringRequest, AuthoringResponse } from './types'

export const AUTHORING_REQUEST_EVENT = 'm2m-authoring-request'
export const AUTHORING_RESPONSE_EVENT = 'm2m-authoring-response'

declare global {
  interface Window {
    m2mAuthoringAdapter?: TauriAuthoringAdapter
    m2mAuthoringRigWatch?: RigLifecycleHandle
  }
}

interface AuthoringInstall {
  bridge: FrontendAuthoringBridge
  adapter: TauriAuthoringAdapter
  fingerprint: string
  identifier: string
  skeleton: AuthoringBridgeApp['skeleton']
}

let install: AuthoringInstall | null = null
let installing: Promise<void> | null = null
let adapter_promise: Promise<TauriAuthoringAdapter> | null = null

function unavailable_response (value: unknown): AuthoringResponse {
  const request = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    protocol: 'authoring-bridge/v1',
    request_id: typeof request.request_id === 'string' ? request.request_id : '',
    session_id: typeof request.session_id === 'string' ? request.session_id : '',
    sequence: typeof request.sequence === 'number' ? request.sequence : 0,
    ok: false,
    error: { code: 'RIG_UNAVAILABLE', message: 'authoring bridge has no live rig' }
  }
}

function dispatch_request (request: unknown): Promise<AuthoringResponse> {
  return install?.bridge !== undefined
    ? install.bridge.handle_mcp_request(request)
    : Promise.resolve(unavailable_response(request))
}

function dispatch_cancel (payload: unknown): void {
  install?.bridge.handle_cancel(payload)
}

async function ensure_adapter (): Promise<TauriAuthoringAdapter> {
  if (adapter_promise === null) {
    adapter_promise = attachTauriAuthoringAdapter(dispatch_request, dispatch_cancel)
  }
  return adapter_promise
}

async function clear_install (): Promise<void> {
  if (installing !== null) await installing.catch(() => {})
  const previous = install
  install = null
  // The transport is stable for the page lifetime and resolves the current
  // bridge dynamically. Dispose only rig-specific bridge state on model swaps.
  previous?.bridge.dispose()
}

function apply_app (app: AuthoringBridgeApp, fingerprint: string): Promise<void> {
  if (install !== null && install.fingerprint === fingerprint &&
      install.identifier === app.rig_identifier && install.skeleton === app.skeleton) {
    return Promise.resolve()
  }
  if (installing !== null) return installing
  installing = (async () => {
    const previous = install
    install = null
    previous?.bridge.dispose()

    const { FrontendAuthoringBridge: Bridge } = await import('./service')
    const { AuthoringPermission } = await import('./permission')
    const permission = new AuthoringPermission()
    const active_bridge = new Bridge(app, undefined, permission)

    const adapter = await ensure_adapter()
    window.m2mAuthoringAdapter = adapter
    install = { bridge: active_bridge, adapter, fingerprint, identifier: app.rig_identifier, skeleton: app.skeleton }
  })().finally(() => { installing = null })
  return installing
}

/** Install a rig watcher. Safe to call from every page bootstrap. */
export function attachAuthoringBridge (engine: RigLifecycleEngine): void {
  if (window.m2mAuthoringRigWatch !== undefined) return

  const on_change = (snapshot: import('./rigLifecycle').RigSnapshot | null): void => {
    if (snapshot === null) {
      void clear_install()
      return
    }
    const app: AuthoringBridgeApp = {
      engine: engine as unknown as AuthoringBridgeApp['engine'],
      skeleton: snapshot.skeleton,
      rig_identifier: snapshot.identifier
    }
    void apply_app(app, snapshot.fingerprint).catch((error: unknown) => {
      console.error('M2M authoring bridge rig attachment failed', error)
    })
  }

  window.m2mAuthoringRigWatch = watch_rig_lifecycle(engine, on_change)

  // Browser compatibility path (tests/dev only). Not an approval boundary.
  window.addEventListener(AUTHORING_REQUEST_EVENT, (event: Event) => {
    const request = (event as CustomEvent<AuthoringRequest>).detail
    const bridge = install?.bridge
    if (bridge === undefined) return
    void bridge.handle(request).then((response: AuthoringResponse) => {
      window.dispatchEvent(new CustomEvent(AUTHORING_RESPONSE_EVENT, { detail: response }))
    })
  })
  window.addEventListener('pagehide', () => { void teardown() }, { once: true })
}

/**
 * Same-origin access for trusted application modules (New Animation workspace
 * and MCP pose observations). Never exposed on `window`; browser CustomEvents
 * and page scripts still cannot reach it.
 */
export function get_active_authoring_bridge (): FrontendAuthoringBridge | undefined {
  return install?.bridge
}

/** @internal Test-only inspection; the bridge is not exposed on `window`. */
export function get_authoring_bridge_for_testing (): FrontendAuthoringBridge | undefined {
  return install?.bridge
}

export async function teardown (): Promise<void> {
  window.m2mAuthoringRigWatch?.dispose()
  window.m2mAuthoringRigWatch = undefined
  await clear_install()
  const adapter = await adapter_promise?.catch(() => null) ?? null
  if (adapter !== null) await adapter.dispose()
  adapter_promise = null
  if (window.m2mAuthoringAdapter === adapter) window.m2mAuthoringAdapter = undefined
}
