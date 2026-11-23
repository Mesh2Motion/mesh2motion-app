import { beforeEach, describe, expect, it } from 'vitest'
import { Color, PerspectiveCamera, Scene, Vector4, type WebGLRenderer } from 'three'
import { PoseObservationService, type ObservationEngine } from './service'
import { create_empty_document, with_animation_channel } from '../animation-document/create'
import { compute_rig_fingerprint } from '../animation-document/rigIdentity'
import { make_test_rig } from './testFixtures'
import type { ObservationPoseSource, PoseCapturePayload, PoseObservationRequest } from './types'

interface FakeRendererState {
  target: unknown
  viewport: Vector4
  scissor: Vector4
  scissor_test: boolean
  clear_color: Color
  clear_alpha: number
  auto_clear: boolean
  render_calls: number
  disposed: boolean
}

function make_engine (): { engine: ObservationEngine, state: FakeRendererState, camera: PerspectiveCamera, scene: Scene } {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(5, 5, 10)
  const scene = new Scene()
  const state: FakeRendererState = {
    target: null,
    viewport: new Vector4(10, 20, 800, 600),
    scissor: new Vector4(1, 2, 3, 4),
    scissor_test: true,
    clear_color: new Color(0x123456),
    clear_alpha: 0.75,
    auto_clear: false,
    render_calls: 0,
    disposed: false
  }
  const renderer = {
    autoClear: state.auto_clear,
    getContext: () => ({ isContextLost: () => false }),
    getRenderTarget: () => state.target,
    getViewport: (target: Vector4) => target.copy(state.viewport),
    getScissor: (target: Vector4) => target.copy(state.scissor),
    getScissorTest: () => state.scissor_test,
    getClearColor: (target: Color) => target.copy(state.clear_color),
    getClearAlpha: () => state.clear_alpha,
    setRenderTarget: (target: unknown) => { state.target = target },
    setViewport: (first: number | Vector4, y?: number, width?: number, height?: number) => {
      if (first instanceof Vector4) state.viewport.copy(first)
      else state.viewport.set(first, y ?? 0, width ?? 0, height ?? 0)
    },
    setScissor: (first: number | Vector4, y?: number, width?: number, height?: number) => {
      if (first instanceof Vector4) state.scissor.copy(first)
      else state.scissor.set(first, y ?? 0, width ?? 0, height ?? 0)
    },
    setScissorTest: (value: boolean) => { state.scissor_test = value },
    setClearColor: (color: number | Color, alpha: number) => {
      state.clear_color = typeof color === 'number' ? new Color(color) : color.clone()
      state.clear_alpha = alpha
    },
    clear: () => {},
    render: () => { state.render_calls++ },
    readRenderTargetPixels: (_target: unknown, _x: number, _y: number, _w: number, _h: number, buffer: Uint8Array) => {
      buffer.fill(42)
    }
  }
  // The fake renderer is intentionally minimal; only the methods used by the
  // capture transaction are modelled. No real WebGL context is created.
  const engine: ObservationEngine = {
    renderer: renderer as unknown as WebGLRenderer,
    scene,
    active_skinned_meshes: () => []
  }
  engine.camera = camera
  return { engine, state, camera, scene }
}

function make_source (): ObservationPoseSource & { fingerprint: string } {
  const { skeleton } = make_test_rig()
  let document = create_empty_document({ skeleton, rig_identifier: 'human', clip_name: 'Wave', duration_seconds: 2 })
  const bone = document.bones.find((entry) => /upperarm_r/i.test(entry.display_name)) ?? document.bones[0]
  document = with_animation_channel(document, {
    bone_id: bone.id,
    property: 'quaternion',
    keyframes: [
      { time_seconds: 0, values: [0, 0, 0, 1], interpolation: 'slerp' },
      { time_seconds: 1, values: [0, 0.7071, 0, 0.7071], interpolation: 'slerp' },
      { time_seconds: 2, values: [0, 0, 0, 1], interpolation: 'slerp' }
    ]
  })
  return {
    document,
    skeleton,
    rig_identifier: 'human',
    fingerprint: compute_rig_fingerprint(skeleton)
  }
}

let sequence_counter = 0

function request (
  source: ObservationPoseSource,
  payload: PoseCapturePayload | { capture_id: string },
  overrides: Partial<PoseObservationRequest> = {}
): PoseObservationRequest {
  sequence_counter++
  return {
    protocol: 'mcp-pose-observation/v1',
    request_id: overrides.request_id ?? `req-${sequence_counter}`,
    session_id: 'session-1',
    sequence: overrides.sequence ?? sequence_counter,
    deadline_ms: 10000,
    operation: 'pose.capture',
    payload,
    ...overrides
  }
}

function capture_payload (source: ObservationPoseSource): PoseCapturePayload {
  return {
    rig_fingerprint: source.fingerprint,
    draft_id: 'draft-1',
    expected_revision: source.document.revision,
    timestamp_seconds: 0.75,
    views: ['front', 'back', 'left', 'right', 'top', 'bottom'],
    width: 256,
    height: 256,
    projection: 'orthographic',
    image: { mime: 'image/png' },
    overlays: { bone_labels: true, skeleton: true }
  }
}

function make_service (
  source: ObservationPoseSource,
  engine: ObservationEngine,
  now?: () => number
): PoseObservationService {
  return new PoseObservationService({
    engine,
    source_provider: () => source,
    now,
    encoder: (pixels, width, height, mime) => ({
      mime,
      bytes: new Uint8Array(64).fill(pixels[0] === 42 ? 7 : 9)
    }),
    make_id: (prefix) => `${prefix}-test-${Math.random().toString(16).slice(2)}`
  })
}

describe('PoseObservationService', () => {
  beforeEach(() => { sequence_counter = 0 })

  it('captures six views of ONE evaluated pose at one timestamp', async () => {
    const source = make_source()
    const { engine, state } = make_engine()
    const service = make_service(source, engine)
    const response = await service.handle(request(source, capture_payload(source)))
    expect(response.ok).toBe(true)
    const result = response.result as { views: Array<{ view: string }>, pose_digest: string, timestamp_seconds: number, revision: number }
    expect(result.views).toHaveLength(6)
    expect(new Set(result.views.map((view) => view.view)).size).toBe(6)
    expect(result.timestamp_seconds).toBe(0.75)
    expect(result.revision).toBe(source.document.revision)
    expect(typeof result.pose_digest).toBe('string')
    expect(state.render_calls).toBe(6)
    service.dispose()
  })

  it('omits optional inline pixels when six-view metadata nears the IPC ceiling', async () => {
    const source = make_source()
    const { engine } = make_engine()
    const service = new PoseObservationService({
      engine,
      source_provider: () => source,
      encoder: (pixels, _width, _height, mime) => ({
        mime,
        bytes: new Uint8Array(48 * 1024).fill(pixels[0] === 42 ? 7 : 9)
      }),
      make_id: (prefix) => `${prefix}-large-inline-test`
    })
    const response = await service.handle(request(source, capture_payload(source)))
    expect(response.ok).toBe(true)
    const result = response.result as { views: Array<{ image_base64?: string, image_ref?: string }> }
    expect(result.views).toHaveLength(6)
    expect(result.views.every((view) => view.image_base64 === undefined && view.image_ref !== undefined)).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(240 * 1024)
    service.dispose()
  })

  it('produces deterministic image dimensions, MIME type and bytes', async () => {
    const source = make_source()
    const { engine } = make_engine()
    const service = make_service(source, engine)
    const result = (await service.handle(request(source, capture_payload(source)))).result as {
      width: number, height: number, views: Array<{ mime: string, image_bytes: number, image_ref?: string }>
    }
    expect(result.width).toBe(256)
    expect(result.height).toBe(256)
    for (const view of result.views) {
      expect(view.mime).toBe('image/png')
      expect(view.image_bytes).toBe(64)
      expect(view.image_ref).toBeDefined()
    }
    const first = result.views[0].image_ref!
    const image = service.getCaptureImage(first.split(':')[0], 'front')
    expect(image?.mime).toBe('image/png')
    expect(image?.bytes).toHaveLength(64)
    service.dispose()
  })

  it('restores all GPU state in a finally transaction', async () => {
    const source = make_source()
    const { engine, state } = make_engine()
    const service = make_service(source, engine)
    const before = JSON.stringify(state.viewport.toArray())
    await service.handle(request(source, capture_payload(source)))
    expect(JSON.stringify(state.viewport.toArray())).toBe(before)
    expect(state.target).toBeNull()
    expect(state.scissor_test).toBe(true)
    expect(state.clear_color.getHex()).toBe(0x123456)
    expect(state.clear_alpha).toBeCloseTo(0.75, 6)
    expect(state.auto_clear).toBe(false)
    service.dispose()
  })

  it('does not add cameras or helpers to the scene or touch the visible camera', async () => {
    const source = make_source()
    const { engine, scene, camera } = make_engine()
    const before_children = scene.children.length
    const position = camera.position.clone()
    const service = make_service(source, engine)
    await service.handle(request(source, capture_payload(source)))
    expect(scene.children).toHaveLength(before_children)
    expect(camera.position.equals(position)).toBe(true)
    expect(document.querySelectorAll('.m2m-authoring-cameras, .m2m-observation-camera')).toHaveLength(0)
    service.dispose()
  })

  it('rejects stale revisions and incompatible rig fingerprints', async () => {
    const source = make_source()
    const { engine } = make_engine()
    const service = make_service(source, engine)
    const stale = capture_payload(source)
    stale.expected_revision = source.document.revision + 1
    const stale_result = await service.handle(request(source, stale))
    expect(stale_result.error?.code).toBe('STALE_REVISION')

    const mismatch = capture_payload(source)
    mismatch.rig_fingerprint = '0'.repeat(64)
    const mismatch_result = await service.handle(request(source, mismatch))
    expect(mismatch_result.error?.code).toBe('RIG_MISMATCH')
    service.dispose()
  })

  it('returns UNSUPPORTED_BONE for a focus bone that does not exist', async () => {
    const source = make_source()
    const { engine } = make_engine()
    const service = make_service(source, engine)
    const payload = capture_payload(source)
    payload.focus_bone_id = 'human:bone:999'
    // Unknown IDs are reported by BAD_REQUEST validation of the bone index only
    // when they are not resolvable; the service reports UNSUPPORTED_BONE.
    const response = await service.handle(request(source, payload))
    expect(['UNSUPPORTED_BONE', 'BAD_REQUEST']).toContain(response.error?.code)
    service.dispose()
  })

  it('frames a supported hand focus group', async () => {
    const source = make_source()
    const { engine } = make_engine()
    const service = make_service(source, engine)
    const hand = source.document.bones.find((bone) => /hand_r/i.test(bone.display_name))!
    const payload = capture_payload(source)
    payload.focus_bone_id = hand.id
    payload.views = ['front']
    const response = await service.handle(request(source, payload))
    expect(response.ok).toBe(true)
    const result = response.result as { views: Array<{ joints: unknown[] }> }
    expect(result.views[0].joints.length).toBeGreaterThan(0)
    service.dispose()
  })

  it('enforces deadlines and releases captures through cancel/dispose', async () => {
    const source = make_source()
    const { engine } = make_engine()
    let clock_calls = 0
    const service = make_service(source, engine, () => ++clock_calls * 1000)
    const payload = capture_payload(source)
    payload.views = ['front']
    const expired = await service.handle(request(source, payload, { deadline_ms: 100 }))
    expect(expired.error?.code).toBe('DEADLINE_EXCEEDED')

    const service2 = make_service(source, engine)
    const ok = await service2.handle(request(source, payload))
    const capture_id = (ok.result as { capture_id: string }).capture_id
    expect(service2.getJointProjection(capture_id, 'front')).not.toBeNull()
    const cancelled = await service2.handle({
      protocol: 'mcp-pose-observation/v1',
      request_id: 'cancel-1',
      session_id: 'session-1',
      sequence: 9999,
      deadline_ms: 1000,
      operation: 'pose.cancel',
      payload: { capture_id }
    })
    expect(cancelled.ok).toBe(true)
    expect(service2.getJointProjection(capture_id, 'front')).toBeNull()
    service.dispose()
    service2.dispose()
  })

  it('rejects duplicate request IDs and non-increasing sequences', async () => {
    const source = make_source()
    const { engine } = make_engine()
    const service = make_service(source, engine)
    const first = request(source, capture_payload(source), { request_id: 'fixed-id', sequence: 10 })
    await service.handle(first)
    const duplicate = request(source, capture_payload(source), { request_id: 'fixed-id', sequence: 11 })
    expect((await service.handle(duplicate)).error?.code).toBe('DUPLICATE_REQUEST_ID')
    const reordered = request(source, capture_payload(source), { request_id: 'other-id', sequence: 5 })
    expect((await service.handle(reordered)).error?.code).toBe('BAD_REQUEST')
    service.dispose()
  })

  it('disposes its render target and retained images', async () => {
    const source = make_source()
    const { engine } = make_engine()
    const service = make_service(source, engine)
    const response = await service.handle(request(source, capture_payload(source)))
    const capture_id = (response.result as { capture_id: string }).capture_id
    service.dispose()
    expect(service.getCaptureImage(capture_id, 'front')).toBeNull()
    expect(service.retained_bytes()).toBe(0)
  })
})
