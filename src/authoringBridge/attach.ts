/**
 * M2M-028A/028B — install/reinstall the authoring bridge with the live rig.
 *
 * The engine watcher survives unloads and model switches. A native Tauri
 * adapter is attached only while a real supported rig exists; it is disposed
 * when that rig goes away. Permission remains native-click-only and disabled
 * on each new bridge instance.
 */

import './confirmationPanel.css'
import type { AuthoringBridgeApp, FrontendAuthoringBridge } from './service'
import { watch_rig_lifecycle, type RigLifecycleEngine, type RigLifecycleHandle } from './rigLifecycle'
import {
  attachTauriAuthoringAdapter,
  set_tauri_authoring_enabled,
  type TauriAuthoringAdapter
} from './tauriAdapter'
import type { AuthoringRequest, AuthoringResponse } from './types'

export const AUTHORING_REQUEST_EVENT = 'm2m-authoring-request'
export const AUTHORING_RESPONSE_EVENT = 'm2m-authoring-response'

declare global {
  interface Window {
    m2mAuthoringBridge?: FrontendAuthoringBridge
    m2mAuthoringAdapter?: TauriAuthoringAdapter
    m2mAuthoringRigWatch?: RigLifecycleHandle
  }
}

interface AuthoringInstall {
  bridge: FrontendAuthoringBridge
  adapter: TauriAuthoringAdapter
  fingerprint: string
  identifier: string
}

let install: AuthoringInstall | null = null
let installing: Promise<void> | null = null

async function clear_install (): Promise<void> {
  if (installing !== null) await installing.catch(() => {})
  const previous = install
  install = null
  await previous?.adapter.dispose()
  previous?.bridge.dispose()
  if (window.m2mAuthoringBridge === previous?.bridge) window.m2mAuthoringBridge = undefined
  if (window.m2mAuthoringAdapter === previous?.adapter) window.m2mAuthoringAdapter = undefined
}

function apply_app (app: AuthoringBridgeApp, fingerprint: string): Promise<void> {
  if (install !== null && install.fingerprint === fingerprint &&
      install.identifier === app.rig_identifier) {
    return Promise.resolve()
  }
  if (installing !== null) return installing
  installing = (async () => {
    const previous = install
    install = null
    await previous?.adapter.dispose()
    previous?.bridge.dispose()

    const { FrontendAuthoringBridge: Bridge } = await import('./service')
    const { AuthoringPermission } = await import('./permission')
    let bridge: FrontendAuthoringBridge | null = null
    const permission = new AuthoringPermission(document.body, set_tauri_authoring_enabled, (enabled) => {
      if (!enabled) bridge?.permission_revoked()
    })
    const active_bridge = new Bridge(app, undefined, permission)
    bridge = active_bridge
    window.m2mAuthoringBridge = active_bridge

    const adapter = await attachTauriAuthoringAdapter(
      (request: unknown) => active_bridge.handle(request),
      (payload: unknown) => active_bridge.handle_cancel(payload)
    )
    window.m2mAuthoringAdapter = adapter
    install = { bridge: active_bridge, adapter, fingerprint, identifier: app.rig_identifier }
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
    const bridge = window.m2mAuthoringBridge
    if (bridge === undefined) return
    void bridge.handle(request).then((response: AuthoringResponse) => {
      window.dispatchEvent(new CustomEvent(AUTHORING_RESPONSE_EVENT, { detail: response }))
    })
  })
  window.addEventListener('pagehide', () => { void teardown() }, { once: true })
}

export async function teardown (): Promise<void> {
  window.m2mAuthoringRigWatch?.dispose()
  window.m2mAuthoringRigWatch = undefined
  await clear_install()
}
