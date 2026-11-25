/**
 * Platform-neutral, read-only application-control session.
 *
 * Owns lifecycle (attach/detach/close), snapshot sequencing and tool dispatch.
 * It imports no engine, Tauri or MCP code; a host supplies observations and a
 * sink (if any) is wired by the platform integration.
 */

import { ControlHost, ControlObservation, derive_phase, empty_observation } from './ControlHost.ts'
import { SequenceLedger } from './SequenceLedger.ts'
import {
  AnimationsListData,
  ApplicationStatusData,
  CONTROL_ERROR_CODES,
  CONTROL_SCHEMA_VERSION,
  ControlCommand,
  ControlError,
  ControlErrorCode,
  ControlRequest,
  ControlResult,
  ControlResponseData,
  ControlSnapshot,
  RigsListData,
  RendererInfo,
  SceneInfo,
  SkeletonTypeValue,
  SnapshotMeta,
  TOOL_ALLOWED_PHASES
} from './contracts.ts'

const SKELETON_TYPES: readonly SkeletonTypeValue[] = [
  'human', 'fox', 'bird', 'dragon', 'kaiju', 'spider', 'snake', 'fish', 'horse', 'error', 'none'
]

function failure<T> (
  code: ControlErrorCode,
  message: string,
  retryable: boolean,
  meta?: SnapshotMeta,
  details?: ControlError['details']
): ControlResult<T> {
  return { ok: false, error: { code, message, retryable, details }, meta }
}

export class ControlSession {
  private host: ControlHost | null = null
  private closed = false
  private readonly ledger: SequenceLedger
  private last_snapshot: ControlSnapshot | null = null
  private last_observation: ControlObservation | null = null
  private started_at: number | null = null

  constructor (
    private readonly clock: () => number = () => Date.now(),
    ledger?: SequenceLedger
  ) {
    this.ledger = ledger ?? new SequenceLedger()
  }

  /** Current sequence value without advancing it. */
  public current_sequence (): number {
    return this.ledger.current()
  }

  /** Attach an observation host. Does not mutate the application. */
  public attach (host: ControlHost): void {
    if (this.closed) {
      return
    }
    this.host = host
    if (this.started_at === null) {
      this.started_at = this.clock()
    }
    this.ledger.next()
    this.last_snapshot = null
    this.last_observation = null
  }

  public detach (): void {
    this.host = null
    this.ledger.next()
    this.last_snapshot = null
    this.last_observation = null
  }

  /** Terminal lifecycle event: all inspection except status becomes unavailable. */
  public close (): void {
    this.closed = true
    this.host = null
    this.ledger.next()
    this.last_snapshot = null
    this.last_observation = null
  }

  public is_closed (): boolean {
    return this.closed
  }

  /** Build and store a new snapshot. Returns null when no host is attached. */
  public refresh (): ControlSnapshot | null {
    if (this.host === null) {
      this.last_snapshot = null
      return null
    }
    const observation = this.host.observe()
    this.last_observation = observation
    const meta: SnapshotMeta = {
      schema_version: CONTROL_SCHEMA_VERSION,
      sequence: this.ledger.next(),
      captured_at: new Date(this.clock()).toISOString(),
      age_ms: 0
    }
    const phase = derive_phase(observation, this.closed)
    const info = observation.last_error === undefined ? {} : { last_error: observation.last_error }
    const gl = observation.gl === undefined ? {} : { gl: observation.gl }
    this.last_snapshot = {
      meta,
      application: {
        phase,
        page: observation.page,
        version: observation.version,
        build: observation.build,
        uptime_ms: Math.max(0, this.clock() - (this.started_at ?? this.clock())),
        diagnostics_enabled: observation.diagnostics_enabled,
        phase_inputs: {
          first_frame_rendered: observation.first_frame_rendered,
          has_loaded_model: observation.has_loaded_model,
          engine_attached: observation.engine_attached,
          active_meshes: observation.active_meshes ?? 0,
          vertex_count: observation.vertex_count ?? 0
        },
        ...info
      },
      renderer: {
        created: observation.renderer_created,
        context_lost: observation.context_lost,
        loop: {
          active: !observation.render_loop_stopped,
          stopped: observation.render_loop_stopped,
          consecutive_failures: observation.render_failures
        },
        canvas: { width: observation.canvas_width, height: observation.canvas_height },
        ...gl,
        ...info
      },
      rigs: observation.rigs,
      animations: observation.animations,
      // A missing scene is represented as an empty, explicitly unavailable scene
      // only for phase derivation; scene_inspect rejects it via STATE_UNAVAILABLE.
      scene: observation.scene ?? this.empty_scene(observation)
    }
    return this.last_snapshot
  }

  /** Last snapshot without advancing the sequence. */
  public current (): ControlSnapshot | null {
    return this.last_snapshot
  }

  private empty_scene (observation: ControlObservation): SceneInfo {
    return {
      process_step: 'load-model',
      model: { loaded: false, mesh_count: 0, vertex_count: 0, triangle_count: 0 },
      skeleton: { loaded: false, type: this.as_skeleton_type(observation.rigs[0]?.key), bone_count: 0 },
      animations: { loaded_count: 0 },
      camera: { position: [0, 0, 0] },
      object_count: 0
    }
  }

  private as_skeleton_type (value: SkeletonTypeValue | undefined): SkeletonTypeValue {
    return value !== undefined && SKELETON_TYPES.includes(value) ? value : 'none'
  }

  private status_snapshot (): ControlSnapshot {
    const observation = empty_observation()
    if (this.closed) {
      observation.closed = true
    }
    const meta: SnapshotMeta = {
      schema_version: CONTROL_SCHEMA_VERSION,
      sequence: this.ledger.current(),
      captured_at: new Date(this.clock()).toISOString(),
      age_ms: 0
    }
    return {
      meta,
      application: {
        phase: derive_phase(observation, this.closed),
        page: 'unknown',
        version: 'unknown',
        build: 'unknown',
        uptime_ms: 0,
        diagnostics_enabled: false
      },
      renderer: {
        created: false,
        context_lost: false,
        loop: { active: false, stopped: false, consecutive_failures: 0 },
        canvas: { width: 0, height: 0 }
      },
      rigs: [],
      animations: [],
      scene: this.empty_scene(observation)
    }
  }

  private snapshot_for (command: ControlCommand): ControlSnapshot {
    const snapshot = this.last_snapshot ?? (command === 'application_get_status' ? this.status_snapshot() : null)
    if (snapshot === null) {
      throw new Error('snapshot unavailable')
    }
    return snapshot
  }

  private gate (command: ControlCommand, snapshot: ControlSnapshot): ControlResult<never> | null {
    const allowed = TOOL_ALLOWED_PHASES[command]
    if (!allowed.includes(snapshot.application.phase)) {
      if (snapshot.application.phase === 'fatal' &&
          (command === 'animations_list' || command === 'scene_inspect')) {
        return failure(
          CONTROL_ERROR_CODES.ENGINE_FATAL,
          `${command} is unavailable after a fatal startup failure`,
          false,
          snapshot.meta,
          { phase: snapshot.application.phase, command }
        )
      }
      return failure(
        CONTROL_ERROR_CODES.NOT_READY,
        `${command} requires phase ${allowed.join('|')}`,
        true,
        snapshot.meta,
        { phase: snapshot.application.phase, command }
      )
    }
    return null
  }

  private require_snapshot (command: ControlCommand): { snapshot: ControlSnapshot } | ControlResult<never> {
    if (this.last_snapshot === null && command !== 'application_get_status') {
      return failure(
        CONTROL_ERROR_CODES.STATE_UNAVAILABLE,
        `no observation available for ${command}; attach a host and refresh first`,
        true,
        undefined,
        { command, reason: 'no-snapshot' }
      )
    }
    try {
      return { snapshot: this.snapshot_for(command) }
    } catch {
      return failure(CONTROL_ERROR_CODES.STATE_UNAVAILABLE, 'state unavailable', true, undefined, { command })
    }
  }

  // ---- Typed accessors -------------------------------------------------

  public applicationStatus (params?: { includeDiagnostics?: boolean }): ControlResult<ApplicationStatusData> {
    const resolved = this.require_snapshot('application_get_status')
    if (!('snapshot' in resolved)) {
      return resolved
    }
    if (params?.includeDiagnostics !== undefined && typeof params.includeDiagnostics !== 'boolean') {
      return failure(CONTROL_ERROR_CODES.INVALID_PARAMS, 'includeDiagnostics must be a boolean', false, resolved.snapshot.meta)
    }
    const snapshot = resolved.snapshot
    const data: ApplicationStatusData = {
      ...snapshot.application,
      snapshot: {
        sequence: snapshot.meta.sequence,
        captured_at: snapshot.meta.captured_at,
        age_ms: snapshot.meta.age_ms
      }
    }
    if (params?.includeDiagnostics === true) {
      data.last_markers = []
    }
    return { ok: true, data, meta: snapshot.meta }
  }

  public rendererState (): ControlResult<RendererInfo> {
    const resolved = this.require_snapshot('renderer_get_state')
    if (!('snapshot' in resolved)) {
      return resolved
    }
    const gate_error = this.gate('renderer_get_state', resolved.snapshot)
    if (gate_error !== null) {
      return gate_error
    }
    return { ok: true, data: resolved.snapshot.renderer, meta: resolved.snapshot.meta }
  }

  public rigsList (params?: { includeAssetPaths?: boolean }): ControlResult<RigsListData> {
    const resolved = this.require_snapshot('rigs_list')
    if (!('snapshot' in resolved)) {
      return resolved
    }
    const gate_error = this.gate('rigs_list', resolved.snapshot)
    if (gate_error !== null) {
      return gate_error
    }
    if (params?.includeAssetPaths === true) {
      // Reserved for a desktop-only debug permission (MCP-001 §6.3).
      return failure(
        CONTROL_ERROR_CODES.UNSUPPORTED_CAPABILITY,
        'includeAssetPaths requires the desktop debug capability and is not supported by the frontend API',
        false,
        resolved.snapshot.meta,
        { command: 'rigs_list', reason: 'includeAssetPaths' }
      )
    }
    if (params?.includeAssetPaths !== undefined && typeof params.includeAssetPaths !== 'boolean') {
      return failure(CONTROL_ERROR_CODES.INVALID_PARAMS, 'includeAssetPaths must be a boolean', false, resolved.snapshot.meta)
    }
    const data: RigsListData = { rigs: resolved.snapshot.rigs, count: resolved.snapshot.rigs.length }
    return { ok: true, data, meta: resolved.snapshot.meta }
  }

  public animationsList (params?: {
    rig?: SkeletonTypeValue
    includeCustom?: boolean
    includeManifest?: boolean
  }): ControlResult<AnimationsListData> {
    const resolved = this.require_snapshot('animations_list')
    if (!('snapshot' in resolved)) {
      return resolved
    }
    const gate_error = this.gate('animations_list', resolved.snapshot)
    if (gate_error !== null) {
      return gate_error
    }
    if (params?.rig !== undefined && !SKELETON_TYPES.includes(params.rig)) {
      return failure(CONTROL_ERROR_CODES.INVALID_PARAMS, 'unknown rig value', false, resolved.snapshot.meta)
    }
    if (params?.includeCustom !== undefined && typeof params.includeCustom !== 'boolean') {
      return failure(CONTROL_ERROR_CODES.INVALID_PARAMS, 'includeCustom must be a boolean', false, resolved.snapshot.meta)
    }
    if (params?.includeManifest !== undefined && typeof params.includeManifest !== 'boolean') {
      return failure(CONTROL_ERROR_CODES.INVALID_PARAMS, 'includeManifest must be a boolean', false, resolved.snapshot.meta)
    }

    const loaded = resolved.snapshot.animations.filter(animation => animation.origin === 'loaded')
    const manifest = params?.includeManifest === true && loaded.length === 0
      ? resolved.snapshot.animations.filter(animation => animation.origin === 'manifest')
      : []
    const filtered = [...loaded, ...manifest].filter(animation => {
      if (params?.includeCustom !== true && animation.source_type === 'custom-import') {
        return false
      }
      if (params?.rig !== undefined && animation.rig !== params.rig) {
        return false
      }
      return true
    })
    const data: AnimationsListData = { animations: filtered, count: filtered.length }
    return { ok: true, data, meta: resolved.snapshot.meta }
  }

  public sceneInspect (params?: { includeCounts?: boolean, maxBones?: number }): ControlResult<SceneInfo> {
    const resolved = this.require_snapshot('scene_inspect')
    if (!('snapshot' in resolved)) {
      return resolved
    }
    const gate_error = this.gate('scene_inspect', resolved.snapshot)
    if (gate_error !== null) {
      return gate_error
    }
    const snapshot = resolved.snapshot
    if (this.last_observation === null || this.last_observation.scene === null) {
      return failure(CONTROL_ERROR_CODES.STATE_UNAVAILABLE, 'no model or skeleton loaded', true, snapshot.meta, {
        command: 'scene_inspect', reason: 'no-scene'
      })
    }
    if (params?.includeCounts !== undefined && typeof params.includeCounts !== 'boolean') {
      return failure(CONTROL_ERROR_CODES.INVALID_PARAMS, 'includeCounts must be a boolean', false, snapshot.meta)
    }
    if (params?.maxBones !== undefined &&
        (!Number.isInteger(params.maxBones) || params.maxBones < 1)) {
      return failure(CONTROL_ERROR_CODES.INVALID_PARAMS, 'maxBones must be a positive integer', false, snapshot.meta)
    }
    const scene: SceneInfo = {
      ...snapshot.scene,
      model: { ...snapshot.scene.model },
      skeleton: { ...snapshot.scene.skeleton },
      animations: { ...snapshot.scene.animations },
      camera: { position: [...snapshot.scene.camera.position] as [number, number, number] }
    }
    if (params?.maxBones !== undefined && scene.skeleton.bone_count > params.maxBones) {
      scene.skeleton.bone_count = params.maxBones
      scene.skeleton.truncated = true
    } else {
      scene.skeleton.truncated = false
    }
    if (params?.includeCounts === false) {
      scene.model.vertex_count = 0
      scene.model.triangle_count = 0
    }
    return { ok: true, data: scene, meta: snapshot.meta }
  }

  // ---- Generic dispatch for transport adapters ------------------------

  public dispatch (request: ControlRequest): ControlResult<ControlResponseData> {
    if (typeof request !== 'object' || request === null || typeof (request as { kind?: unknown }).kind !== 'string') {
      return failure(CONTROL_ERROR_CODES.INVALID_REQUEST, 'request must be an object with a string kind', false)
    }
    switch (request.kind) {
      case 'application_get_status':
        return this.applicationStatus(request.params)
      case 'renderer_get_state':
        return this.rendererState()
      case 'rigs_list':
        return this.rigsList(request.params)
      case 'animations_list':
        return this.animationsList(request.params)
      case 'scene_inspect':
        return this.sceneInspect(request.params)
      default:
        return failure(CONTROL_ERROR_CODES.UNKNOWN_COMMAND, 'unknown control command', false, undefined, {
          command: (request as ControlRequest).kind
        })
    }
  }
}

/** Convenience factory for platform integrations and tests. */
export function create_control_session (clock?: () => number, ledger?: SequenceLedger): ControlSession {
  return new ControlSession(clock, ledger)
}
