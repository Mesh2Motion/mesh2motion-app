import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attach_control_publisher, ControlEngineLike, ControlPublisherHandle } from './ControlPublisher.ts'
import { CONTROL_ERROR_CODES, ControlSnapshot } from './contracts.ts'
import { REDACTED } from './sanitize.ts'

class FakeTarget {
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()

  public addEventListener (type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  public removeEventListener (type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  public dispatch (type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(new Event(type))
    }
  }
}

interface Harness {
  engine: ControlEngineLike
  canvas: FakeTarget & { width: number, height: number }
  model_step: FakeTarget & { vertex_count: number, triangle_count: number, model_meshes: () => { children: unknown[] } }
  skeleton_step: FakeTarget & { skeleton_type: () => string }
  set_lost: (lost: boolean) => void
  sink: { publish: ReturnType<typeof vi.fn> }
  handle: ControlPublisherHandle
}

function setup (options: { publish_error?: string } = {}): Harness {
  if (options.publish_error !== undefined) {
    const panel = document.createElement('div')
    panel.id = 'm2m-startup-error'
    panel.textContent = options.publish_error
    document.body.appendChild(panel)
  }

  const canvas = Object.assign(new FakeTarget(), { width: 800, height: 600 })
  const model_step = Object.assign(new FakeTarget(), {
    vertex_count: 1000,
    triangle_count: 500,
    model_meshes: () => ({ children: [{}, {}] })
  })
  const skeleton_step = Object.assign(new FakeTarget(), { skeleton_type: () => 'human' })
  let lost = false

  const engine = {
    renderer: { domElement: canvas },
    camera: { position: { x: 0, y: 0, z: 0 } },
    scene: { children: [] },
    process_step: 'animations-export',
    load_model_step: model_step,
    load_skeleton_step: skeleton_step,
    edit_skeleton_step: { skeleton: () => ({ bones: [{ name: 'hips' }] }) },
    animations_listing_step: { animation_clips: () => [], get_animation_metadata: () => null },
    control_state: () => ({
      first_frame_rendered: true,
      context_lost: lost,
      render_loop_stopped: false,
      render_failures: 0
    })
  } as unknown as ControlEngineLike

  const sink = { publish: vi.fn() }
  const handle = attach_control_publisher(engine, { page: 'explore', sink, clock: () => Date.now() })
  return {
    engine,
    canvas,
    model_step,
    skeleton_step,
    set_lost: value => { lost = value },
    sink,
    handle
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('ControlPublisher', () => {
  it('never publishes a fabricated snapshot when no host is attached', () => {
    const h = setup()
    expect(h.sink.publish).toHaveBeenCalledTimes(1) // one real initial observation

    h.handle.session.detach()
    expect(h.handle.publish_now()).toBe(false)
    expect(h.sink.publish).toHaveBeenCalledTimes(1)
    const published = h.sink.publish.mock.calls[0][0] as ControlSnapshot
    expect(published.meta.schema_version).toBe('1.0')
    expect(published.application.phase).toBe('ready')
  })

  it('coalesces events into bounded refreshes and never runs per frame', async () => {
    const h = setup()

    for (let i = 0; i < 20; i += 1) {
      h.model_step.dispatch('modelLoaded')
    }
    expect(h.sink.publish).toHaveBeenCalledTimes(1) // trailing refresh not yet fired

    await vi.advanceTimersByTimeAsync(250)
    expect(h.sink.publish).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(750)
    expect(h.sink.publish).toHaveBeenCalledTimes(3) // 1 Hz heartbeat

    await vi.advanceTimersByTimeAsync(1000)
    expect(h.sink.publish).toHaveBeenCalledTimes(4)

    h.handle.dispose()
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.sink.publish).toHaveBeenCalledTimes(4)
  })

  it('publishes renderer loss and restoration from canvas events', async () => {
    const h = setup()

    h.set_lost(true)
    h.canvas.dispatch('webglcontextlost')
    await vi.advanceTimersByTimeAsync(250)
    let last = h.sink.publish.mock.calls[h.sink.publish.mock.calls.length - 1][0] as ControlSnapshot
    expect(last.renderer.context_lost).toBe(true)
    expect(last.application.phase).toBe('degraded')

    h.set_lost(false)
    h.canvas.dispatch('webglcontextrestored')
    await vi.advanceTimersByTimeAsync(1000)
    last = h.sink.publish.mock.calls[h.sink.publish.mock.calls.length - 1][0] as ControlSnapshot
    expect(last.renderer.context_lost).toBe(false)
  })

  it('closes the session on shutdown and stops publishing', async () => {
    const h = setup()
    window.dispatchEvent(new Event('pagehide'))

    expect(h.handle.is_disposed).toBe(true)
    const status = h.handle.session.applicationStatus()
    expect(status.ok && status.data.phase).toBe('closed')

    h.model_step.dispatch('modelLoaded')
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.sink.publish).toHaveBeenCalledTimes(1)
  })

  it('reports unavailable state with stable error codes', async () => {
    const h = setup()
    h.model_step.vertex_count = 0
    h.handle.request_publish()
    await vi.advanceTimersByTimeAsync(250)

    const status = h.handle.session.applicationStatus()
    expect(status.ok && status.data.phase).toBe('loading')
    const scene = h.handle.session.sceneInspect()
    expect(!scene.ok && scene.error.code).toBe(CONTROL_ERROR_CODES.NOT_READY)

    const panel = document.createElement('div')
    panel.id = 'm2m-startup-error'
    panel.textContent = 'renderer failed'
    document.body.appendChild(panel)
    h.handle.request_publish()
    await vi.advanceTimersByTimeAsync(1000)
    const fatal = h.handle.session.sceneInspect()
    expect(!fatal.ok && fatal.error.code).toBe(CONTROL_ERROR_CODES.ENGINE_FATAL)
  })

  it('redacts filesystem paths from published snapshots', () => {
    const h = setup({ publish_error: 'renderer failed at /home/user/secret.glb' })
    const published = h.sink.publish.mock.calls[0][0] as ControlSnapshot
    const json = JSON.stringify(published)

    expect(json).not.toContain('/home/')
    expect(published.application.last_error).toBe(REDACTED)
    expect(published.meta.schema_version).toBe('1.0')
  })
})
