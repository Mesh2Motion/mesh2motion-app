import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlSession } from './ControlSession.ts'
import { ControlHost, ControlObservation, empty_observation } from './ControlHost.ts'
import { SequenceLedger, SequenceStorage } from './SequenceLedger.ts'
import { TauriSnapshotSink } from './transport/TauriSnapshotSink.ts'

function memory_storage (initial: Map<string, string> = new Map()): SequenceStorage {
  return {
    getItem: key => initial.get(key) ?? null,
    setItem: (key, value) => { initial.set(key, value) }
  }
}

function host (overrides: Partial<ControlObservation> = {}): ControlHost {
  const observation: ControlObservation = {
    ...empty_observation(),
    engine_attached: true,
    first_frame_rendered: true,
    has_loaded_model: true,
    renderer_created: true,
    ...overrides
  }
  return { observe: vi.fn(() => observation) }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: undefined, configurable: true, writable: true })
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: undefined, configurable: true, writable: true })
})

describe('publisher sequence lifecycle', () => {
  it('keeps sequences strictly increasing across a webview reload', () => {
    const shared = memory_storage()
    const before = new ControlSession(() => 0, new SequenceLedger(shared))
    before.attach(host())
    const sequences = [before.refresh()?.meta.sequence, before.refresh()?.meta.sequence]

    // Simulate reload: new JS session, same origin storage, same Rust process.
    const after = new ControlSession(() => 0, new SequenceLedger(shared))
    after.attach(host())
    const after_reload = after.refresh()?.meta.sequence

    expect(after_reload).toBeGreaterThan(Math.max(...(sequences as number[])))
    expect(new Set([...sequences, after_reload]).size).toBe(3)
  })

  it('never emits repeated sequence values within one session', () => {
    const session = new ControlSession(() => 0, new SequenceLedger(memory_storage()))
    session.attach(host())
    const values = Array.from({ length: 20 }, () => session.refresh()?.meta.sequence)
    expect(new Set(values).size).toBe(values.length)
  })

  it('starts a new application session at a fresh sequence (Rust host also restarts)', () => {
    const first = new ControlSession(() => 0, new SequenceLedger(memory_storage()))
    first.attach(host())
    expect(first.refresh()?.meta.sequence).toBeGreaterThan(0)

    const new_process = new ControlSession(() => 0, new SequenceLedger(memory_storage()))
    new_process.attach(host())
    expect(new_process.refresh()?.meta.sequence).toBe(2) // attach + first refresh
  })

  it('emits RFC3339 capture times with advisory age_ms zero', () => {
    const session = new ControlSession(() => 1000, new SequenceLedger(memory_storage()))
    session.attach(host())
    const snapshot = session.refresh()
    expect(snapshot?.meta.age_ms).toBe(0)
    expect(snapshot?.meta.captured_at).toBe(new Date(1000).toISOString())
  })

  it('does not fabricate a snapshot when no host is attached', () => {
    const session = new ControlSession(() => 0, new SequenceLedger(memory_storage()))
    expect(session.refresh()).toBeNull()
    expect(session.current()).toBeNull()
    const status = session.applicationStatus()
    expect(status.ok && status.data.phase).toBe('uninitialized')
  })
})

describe('TauriSink reconnect telemetry', () => {
  it('reports a rejected publish and clears it after a successful reconnect', async () => {
    const invoke = vi.fn()
      .mockRejectedValueOnce(new Error('host disabled'))
      .mockResolvedValueOnce(undefined)
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke },
      configurable: true,
      writable: true
    })
    const on_error = vi.fn()
    const on_success = vi.fn()
    const sink = new TauriSnapshotSink(on_error, on_success)
    const snapshot = new ControlSession(() => 0, new SequenceLedger())
    snapshot.attach(host())
    const value = snapshot.refresh()

    sink.publish(value!)
    await Promise.resolve()
    await Promise.resolve()
    expect(sink.last_error()).toBe('host disabled')
    expect(on_error).toHaveBeenCalledOnce()

    sink.publish(value!)
    await Promise.resolve()
    await Promise.resolve()
    expect(sink.last_error()).toBeNull()
    expect(on_success).toHaveBeenCalledOnce()
  })

  it('stays inert without a Tauri bridge (web builds)', () => {
    const sink = new TauriSnapshotSink()
    expect(sink.is_available()).toBe(false)
    const snapshot = new ControlSession(() => 0, new SequenceLedger())
    snapshot.attach(host())
    expect(() => sink.publish(snapshot.refresh()!)).not.toThrow()
    expect(sink.last_error()).toBeNull()
  })
})
