/**
 * M2M-028A addendum — install/reinstall the authoring bridge with the live rig.
 *
 * The bridge is created as soon as a real rig finishes loading and is disposed
 * when the rig is unloaded, replaced or the model switches. Re-entering a page
 * is not required. Tauri events are the authoritative transport; the browser
 * CustomEvent path exists only for tests/internal compatibility and is not an
 * authorization or confirmation boundary.
 */

import './confirmationPanel.css'
import type { AuthoringBridgeApp, FrontendAuthoringBridge } from './service'
import { watch_rig_lifecycle, type RigLifecycleEngine, type RigLifecycleHandle } from './rigLifecycle'
import { attachTauriAuthoringAdapter, type TauriAuthoringAdapter } from './tauriAdapter'
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
    const permission = new AuthoringPermission()
    const bridge = new Bridge(app, undefined, permission)
    window.m2mAuthoringBridge = bridge

    const adapter = await attachTauriAuthoringAdapter(
      (request: unknown) => bridge.handle(request),
      (payload: unknown) => bridge.handle_cancel(payload)
    )
    window.m2mAuthoringAdapter = adapter
    install = { bridge, adapter, fingerprint, identifier: app.rig_identifier }
  })().finally(() => { installing = null })
  return installing
}

/** Install a rig watcher. Safe to call from every page bootstrap. */
export function attachAuthoringBridge (engine: RigLifecycleEngine): void {
  if (window.m2mAuthoringRigWatch !== undefined) return

  const on_change = (snapshot: import('./rigLifecycle').RigSnapshot | null): void => {
    if (snapshot === null) {
      void teardown()
      return
    }
    const app: AuthoringBridgeApp = {
      engine: engine as unknown as AuthoringBridgeApp['engine'],
      skeleton: snapshot.skeleton,
      rig_identifier: snapshot.identifier
    }
    void apply_app(app, snapshot.fingerprint)
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
  await window.m2mAuthoringAdapter?.dispose()
  window.m2mAuthoringBridge?.dispose()
  window.m2mAuthoringAdapter = undefined
  window.m2mAuthoringBridge = undefined
  install = null
}
