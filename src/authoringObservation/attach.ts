/**
 * M2M-030A — attach the internal observation service to the live rig.
 *
 * No DOM controls, overlays or scene objects are created. The service is only
 * reachable through its module API (and the optional Tauri adapter) and follows
 * rig unload/replacement through the same lifecycle watcher the authoring bridge
 * uses. Every page bootstrap can call this safely; it is idempotent.
 */

import { get_active_authoring_bridge } from '../authoringBridge/attach'
import { live_skeleton_from_engine } from '../authoringBridge/rigCatalog'
import { compute_rig_fingerprint } from '../animation-document/rigIdentity'
import { watch_rig_lifecycle, type RigLifecycleEngine, type RigSnapshot } from '../authoringBridge/rigLifecycle'
import { PoseObservationService, type ObservationEngine, set_pose_observation_service } from './service'
import { attachTauriPoseObservationAdapter, type TauriPoseObservationAdapter } from './tauriAdapter'
import { OBSERVATION_PROTOCOL, type ObservationPoseSource, type ObservationView, type PoseObservationResponse } from './types'

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
let adapter_promise: Promise<TauriPoseObservationAdapter> | null = null
let clear_timer: ReturnType<typeof setTimeout> | null = null

/**
 * Stable transport dispatch. The Tauri adapter is installed once and always
 * resolves the CURRENT service, so a rig watcher teardown/reattach can never
 * leave a stale listener calling a disposed service.
 */
function unavailable_response (request: unknown): PoseObservationResponse {
  const value = request !== null && typeof request === 'object' ? request as Record<string, unknown> : {}
  return {
    protocol: OBSERVATION_PROTOCOL,
    request_id: typeof value.request_id === 'string' ? value.request_id : '',
    session_id: typeof value.session_id === 'string' ? value.session_id : '',
    sequence: typeof value.sequence === 'number' ? value.sequence : 0,
    ok: false,
    error: { code: 'RIG_UNAVAILABLE', message: 'observation service is not attached' }
  }
}

function dispatch_request (request: unknown): Promise<PoseObservationResponse> {
  return install?.service !== undefined
    ? install.service.handle(request)
    : Promise.resolve(unavailable_response(request))
}

function dispatch_cancel (payload: unknown): void {
  const data = payload as { capture_id?: unknown, request_id?: unknown } | null
  if (data === null || typeof data !== 'object') return
  const id = typeof data.capture_id === 'string' ? data.capture_id
    : typeof data.request_id === 'string' ? data.request_id : ''
  if (id !== '') install?.service.cancel(id)
}

function dispatch_image (capture_id: string, view: ObservationView) {
  return install?.service.getCaptureImage(capture_id, view) ?? null
}

async function ensure_adapter (): Promise<TauriPoseObservationAdapter> {
  if (adapter_promise === null) {
    adapter_promise = attachTauriPoseObservationAdapter(dispatch_request, dispatch_cancel, dispatch_image)
  }
  return adapter_promise
}

async function clear_install (): Promise<void> {
  if (installing !== null) await installing.catch(() => {})
  const previous = install
  install = null
  // The adapter is shared and dispatches dynamically; only the service is
  // rig-specific and must be disposed here.
  previous?.service.dispose()
  set_pose_observation_service(null)
}

function apply_snapshot (engine: ObservationAttachEngine, snapshot: RigSnapshot): Promise<void> {
  if (install !== null && install.snapshot.fingerprint === snapshot.fingerprint &&
      install.snapshot.identifier === snapshot.identifier) {
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
      // Re-read the live skeleton on every capture. The rig watcher snapshot can
      // be an early fallback (edit/helper) skeleton taken before the rendered
      // SkinnedMesh received its bones; rendering that mesh with a different
      // skeleton object produces pixels that disagree with joint metadata.
      const skeleton = live_skeleton_from_engine(engine)
      if (skeleton === null || skeleton.bones.length === 0) return null
      if (compute_rig_fingerprint(skeleton) !== current.fingerprint) return null
      return {
        document,
        skeleton,
        rig_identifier: current.identifier,
        fingerprint: current.fingerprint
      }
    }
    const service = new PoseObservationService({ engine, source_provider })
    const adapter = await ensure_adapter()
    install = { service, snapshot, adapter }
    window.m2mPoseObservationAdapter = adapter
    set_pose_observation_service(service)
  })().finally(() => { installing = null })
  return installing
}

/** Install the rig watcher. Idempotent across all page bootstraps. */
export function attachPoseObservation (engine: ObservationAttachEngine): void {
  if (window.m2mPoseObservationWatch !== undefined) return
  window.m2mPoseObservationWatch = watch_rig_lifecycle(engine, (snapshot) => {
    if (snapshot === null) {
      // Rig snapshots can briefly disappear during model swaps and preview
      // transitions. Debounce teardown so a transient null cannot dispose a
      // perfectly good service and break an in-flight observation.
      if (clear_timer !== null) clearTimeout(clear_timer)
      clear_timer = setTimeout(() => {
        clear_timer = null
        void clear_install().catch((error: unknown) => {
          console.error('M2M pose observation teardown failed', error)
        })
      }, 750)
      return
    }
    if (clear_timer !== null) { clearTimeout(clear_timer); clear_timer = null }
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
  if (clear_timer !== null) { clearTimeout(clear_timer); clear_timer = null }
  await clear_install()
  const adapter = await adapter_promise?.catch(() => null) ?? null
  if (adapter !== null) await adapter.dispose()
  adapter_promise = null
  if (window.m2mPoseObservationAdapter === adapter) window.m2mPoseObservationAdapter = undefined
}
