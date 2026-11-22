import { describe, expect, it, vi } from 'vitest'
import { ControlHost, ControlObservation } from './ControlHost.ts'
import { ControlSession } from './ControlSession.ts'
import { CONTROL_ERROR_CODES, CONTROL_SCHEMA_VERSION, SceneInfo } from './contracts.ts'

const scene = (): SceneInfo => ({
  process_step: 'animations-export',
  model: { loaded: true, mesh_count: 2, vertex_count: 1000, triangle_count: 500 },
  skeleton: { loaded: true, type: 'human', bone_count: 60, root_name: 'hips' },
  animations: { loaded_count: 2 },
  camera: { position: [0, 1.7, 15] },
  object_count: 12
})

function observation (overrides: Partial<ControlObservation> = {}): ControlObservation {
  return {
    page: 'explore',
    version: '1.0.0',
    build: 'git:abc-test',
    diagnostics_enabled: false,
    engine_attached: true,
    first_frame_rendered: true,
    has_loaded_model: true,
    renderer_created: true,
    context_lost: false,
    render_loop_stopped: false,
    render_failures: 0,
    canvas_width: 1100,
    canvas_height: 700,
    rigs: [{
      key: 'human',
      display_name: 'Human',
      model_asset: 'models/model-human.glb',
      rig_asset: 'rigs/rig-human.glb',
      animation_assets: ['animations/human-base-animations.glb']
    }],
    animations: [
      { index: 0, name: 'Idle', duration_s: 1, track_count: 2, source_type: 'default-library', tags: [], rig: 'human', origin: 'loaded' },
      { index: 1, name: 'Custom', duration_s: 2, track_count: 1, source_type: 'custom-import', tags: [], rig: 'human', origin: 'loaded' },
      { index: 0, name: 'Walk', duration_s: 0, track_count: 0, source_type: 'default-library', tags: [], rig: 'human', origin: 'manifest' }
    ],
    scene: scene(),
    ...overrides
  }
}

function host_with (obs: ControlObservation): ControlHost {
  return { observe: vi.fn(() => obs) }
}

function ready_session (obs: ControlObservation = observation()): ControlSession {
  const session = new ControlSession(() => 1000)
  session.attach(host_with(obs))
  session.refresh()
  return session
}

describe('ControlSession lifecycle', () => {
  it('reports uninitialized status before a host is attached', () => {
    const session = new ControlSession(() => 1000)
    const result = session.applicationStatus()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.phase).toBe('uninitialized')
      expect(result.meta.schema_version).toBe(CONTROL_SCHEMA_VERSION)
    }
    const rigs = session.rigsList()
    expect(rigs.ok).toBe(false)
    if (!rigs.ok) expect(rigs.error.code).toBe(CONTROL_ERROR_CODES.STATE_UNAVAILABLE)
  })

  it('advances the snapshot sequence only on refresh', () => {
    const session = ready_session()
    const first = session.current()
    expect(first?.meta.sequence).toBe(2) // attach + refresh
    expect(first?.meta.captured_at).toBe(new Date(1000).toISOString())
    const cached = session.applicationStatus()
    expect(cached.ok && cached.meta.sequence).toBe(2)
    session.refresh()
    expect(session.current()?.meta.sequence).toBe(3)
  })

  it('detach and close make inspection unavailable but keep status available', () => {
    const session = ready_session()
    session.detach()
    expect(session.rigsList().ok).toBe(false)

    session.attach(host_with(observation()))
    session.refresh()
    session.close()
    expect(session.is_closed()).toBe(true)
    expect(session.applicationStatus().ok).toBe(true)
    const status = session.applicationStatus()
    expect(status.ok && status.data.phase).toBe('closed')
    expect(session.sceneInspect().ok).toBe(false)
  })
})

describe('ControlSession read-only tools', () => {
  it('returns renderer, rigs and scene state from the observation', () => {
    const session = ready_session()
    const renderer = session.rendererState()
    expect(renderer.ok && renderer.data.loop.active).toBe(true)
    expect(renderer.ok && renderer.data.context_lost).toBe(false)

    const rigs = session.rigsList()
    expect(rigs.ok && rigs.data.count).toBe(1)

    const inspected = session.sceneInspect()
    expect(inspected.ok && inspected.data.skeleton.bone_count).toBe(60)
    expect(inspected.ok && inspected.data.camera.position).toEqual([0, 1.7, 15])
  })

  it('reports NOT_READY while the application is still loading a model', () => {
    const session = ready_session(observation({ has_loaded_model: false, scene: null }))
    const status = session.applicationStatus()
    expect(status.ok && status.data.phase).toBe('loading')
    const result = session.sceneInspect()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(CONTROL_ERROR_CODES.NOT_READY)
  })

  it('returns STATE_UNAVAILABLE when a ready session has no scene observation', () => {
    const session = ready_session(observation({ has_loaded_model: true, scene: null }))
    const result = session.sceneInspect()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(CONTROL_ERROR_CODES.STATE_UNAVAILABLE)
  })

  it('reports renderer loss as degraded without stopping animation tools', () => {
    const session = ready_session(observation({ context_lost: true }))
    const status = session.applicationStatus()
    expect(status.ok && status.data.phase).toBe('degraded')
    expect(session.animationsList().ok).toBe(true)
    const renderer = session.rendererState()
    expect(renderer.ok && renderer.data.context_lost).toBe(true)
  })

  it('reports ENGINE_FATAL for stateful tools after a fatal startup', () => {
    const session = ready_session(observation({ fatal: true, last_error: 'renderer init failed' }))
    const result = session.sceneInspect()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe(CONTROL_ERROR_CODES.ENGINE_FATAL)
    expect(session.applicationStatus().ok).toBe(true)
  })

  it('filters custom and manifest animations', () => {
    const session = ready_session()
    const defaults = session.animationsList()
    expect(defaults.ok && defaults.data.count).toBe(1)

    const with_custom = session.animationsList({ includeCustom: true })
    expect(with_custom.ok && with_custom.data.count).toBe(2)

    const no_loaded = ready_session(observation({
      animations: [observation().animations[2]]
    }))
    const manifest = no_loaded.animationsList({ includeManifest: true })
    expect(manifest.ok && manifest.data.count).toBe(1)

    const wrong_rig = session.animationsList({ rig: 'fox' })
    expect(wrong_rig.ok && wrong_rig.data.count).toBe(0)
  })

  it('caps bone counts and supports includeCounts=false', () => {
    const session = ready_session()
    const capped = session.sceneInspect({ maxBones: 10 })
    expect(capped.ok && capped.data.skeleton.bone_count).toBe(10)
    expect(capped.ok && capped.data.skeleton.truncated).toBe(true)

    const lean = session.sceneInspect({ includeCounts: false })
    expect(lean.ok && lean.data.model.vertex_count).toBe(0)
  })

  it('uses stable error codes for invalid requests and unsupported capabilities', () => {
    const session = ready_session()

    const unknown = session.dispatch({ kind: 'not_a_tool' } as never)
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error.code).toBe(CONTROL_ERROR_CODES.UNKNOWN_COMMAND)

    const malformed = session.dispatch(null as never)
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) expect(malformed.error.code).toBe(CONTROL_ERROR_CODES.INVALID_REQUEST)

    const bad_param = session.sceneInspect({ maxBones: 0 })
    expect(bad_param.ok).toBe(false)
    if (!bad_param.ok) expect(bad_param.error.code).toBe(CONTROL_ERROR_CODES.INVALID_PARAMS)

    const unsupported = session.rigsList({ includeAssetPaths: true })
    expect(unsupported.ok).toBe(false)
    if (!unsupported.ok) expect(unsupported.error.code).toBe(CONTROL_ERROR_CODES.UNSUPPORTED_CAPABILITY)
  })

  it('dispatches by tool name for transport adapters', () => {
    const session = ready_session()
    const result = session.dispatch({ kind: 'renderer_get_state' })
    expect(result.ok).toBe(true)
    expect(result.meta?.sequence).toBe(2)
  })
})
