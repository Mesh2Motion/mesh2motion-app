import { afterEach, describe, expect, it, vi } from 'vitest'
import { ControlSnapshot, CONTROL_SCHEMA_VERSION } from '../contracts.ts'
import { MCP_PUBLISH_COMMAND, TauriSnapshotSink } from './TauriSnapshotSink.ts'

const snapshot = (): ControlSnapshot => ({
  meta: { schema_version: CONTROL_SCHEMA_VERSION, sequence: 1, captured_at: new Date(0).toISOString(), age_ms: 0 },
  application: {
    phase: 'ready', page: 'explore', version: '1', build: 'test', uptime_ms: 10, diagnostics_enabled: false
  },
  renderer: {
    created: true,
    context_lost: false,
    loop: { active: true, stopped: false, consecutive_failures: 0 },
    canvas: { width: 1, height: 1 }
  },
  rigs: [],
  animations: [],
  scene: {
    process_step: 'load-model',
    model: { loaded: false, mesh_count: 0, vertex_count: 0, triangle_count: 0 },
    skeleton: { loaded: false, type: 'none', bone_count: 0 },
    animations: { loaded_count: 0 },
    camera: { position: [0, 0, 0] },
    object_count: 0
  }
})

function set_tauri (value: unknown): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value, configurable: true, writable: true })
}

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('TauriSnapshotSink', () => {
  it('is inert in web builds without Tauri', () => {
    const sink = new TauriSnapshotSink()
    expect(sink.is_available()).toBe(false)
    expect(() => sink.publish(snapshot())).not.toThrow()
  })

  it('publishes to the single shared command when Tauri is present', () => {
    const invoke = vi.fn()
    set_tauri({ invoke })
    const sink = new TauriSnapshotSink()

    expect(sink.is_available()).toBe(true)
    sink.publish(snapshot())

    expect(invoke).toHaveBeenCalledOnce()
    expect(invoke.mock.calls[0][0]).toBe(MCP_PUBLISH_COMMAND)
    expect(invoke.mock.calls[0][1]).toHaveProperty('snapshot')
  })

  it('never propagates transport errors into the application', () => {
    set_tauri({ invoke: () => { throw new Error('ipc closed') } })
    expect(() => new TauriSnapshotSink().publish(snapshot())).not.toThrow()
  })
})
