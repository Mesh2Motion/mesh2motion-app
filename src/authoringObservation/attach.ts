/**
 * M2M-030A — attach the internal observation service to the live rig.
 *
 * No DOM controls, overlays or scene objects are created. The service is only
 * reachable through its module API (and the optional Tauri adapter) and follows
 * rig unload/replacement through the same lifecycle watcher the authoring bridge
 * uses. Every page bootstrap can call this safely; it is idempotent.
 */

import { get_active_authoring_bridge } from '../authoringBridge/attach'
import { watch_rig_lifecycle, type RigLifecycleEngine, type RigSnapshot } from '../authoringBridge/rigLifecycle'
import { PoseObservationService, type ObservationEngine, set_pose_observation_service } from './service'
import { attachTauriPoseObservationAdapter, type TauriPoseObservationAdapter } from './tauriAdapter'
import type { ObservationPoseSource } from './types'

export type ObservationAttachEngine = ObservationEngine & RigLifecycleEngine

declare global {
  interface Window {
    m2mPoseObservationWatch?: { dispose: () => void }
    m2mPoseObservationAdapter?: TauriPoseObservationAdapter
  }
}

interface Install {
  service: PoseObservationService
  snapshot: RigSnapshot
  adapter: TauriPoseObservationAdapter | null
}

let install: Install | null = null
let installing: Promise<void> | null = null

async function clear_install (): Promise<void> {
  if (installing !== null) await installing.catch(() => {})
  const previous = install
  install = null
  await previous?.adapter?.dispose()
  previous?.service.dispose()
  set_pose_observation_service(null)
  if (window.m2mPoseObservationAdapter === previous?.adapter) window.m2mPoseObservationAdapter = undefined
}

function apply_snapshot (engine: ObservationAttachEngine, snapshot: RigSnapshot): Promise<void> {
  if (install !== null && install.snapshot.fingerprint === snapshot.fingerprint &&
      install.snapshot.identifier === snapshot.identifier &&
      install.snapshot.skeleton === snapshot.skeleton) {
    return Promise.resolve()
  }
  if (installing !== null) return installing
  installing = (async () => {
    await clear_install()
    const source_provider = (): ObservationPoseSource | null => {
      const current = install?.snapshot
      const bridge = get_active_authoring_bridge()
      const document = bridge?.current_document()
      if (current === null || current === undefined || document === undefined || document === null) return null
      return {
        document,
        skeleton: current.skeleton,
        rig_identifier: current.identifier,
        fingerprint: current.fingerprint
      }
    }
    const service = new PoseObservationService({ engine, source_provider })
    const adapter = await attachTauriPoseObservationAdapter(
      (request) => service.handle(request),
      (payload) => {
        const data = payload as { capture_id?: string, request_id?: string } | null
        if (data === null || typeof data !== 'object') return
        service.cancel(data.capture_id ?? data.request_id)
      },
      (capture_id, view) => service.getCaptureImage(capture_id, view)
    )
    window.m2mPoseObservationAdapter = adapter
    install = { service, snapshot, adapter }
    set_pose_observation_service(service)
  })().finally(() => { installing = null })
  return installing
}

/** Install the rig watcher. Idempotent across all page bootstraps. */
export function attachPoseObservation (engine: ObservationAttachEngine): void {
  if (window.m2mPoseObservationWatch !== undefined) return
  window.m2mPoseObservationWatch = watch_rig_lifecycle(engine, (snapshot) => {
    if (snapshot === null) {
      void clear_install().catch((error: unknown) => {
        console.error('M2M pose observation teardown failed', error)
      })
      return
    }
    void apply_snapshot(engine, snapshot).catch((error: unknown) => {
      console.error('M2M pose observation attachment failed', error)
    })
  })
  window.addEventListener('pagehide', () => {
    void teardown_pose_observation()
  }, { once: true })
}

export async function teardown_pose_observation (): Promise<void> {
  window.m2mPoseObservationWatch?.dispose()
  window.m2mPoseObservationWatch = undefined
  await clear_install()
}
