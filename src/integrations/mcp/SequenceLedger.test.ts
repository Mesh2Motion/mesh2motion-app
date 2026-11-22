import { describe, expect, it, vi } from 'vitest'
import { SEQUENCE_STORAGE_KEY, SequenceLedger, SequenceStorage } from './SequenceLedger.ts'

function storage (initial: Map<string, string> = new Map()): SequenceStorage {
  return {
    getItem: key => initial.get(key) ?? null,
    setItem: (key, value) => { initial.set(key, value) }
  }
}

describe('SequenceLedger', () => {
  it('never returns the same sequence twice', () => {
    const ledger = new SequenceLedger(storage())
    const values = Array.from({ length: 25 }, () => ledger.next())
    expect(new Set(values).size).toBe(values.length)
    expect(values[0]).toBe(1)
    expect(values[24]).toBe(25)
  })

  it('continues from the persisted value after a webview reload', () => {
    const shared = storage()
    const first = new SequenceLedger(shared)
    first.next()
    const before_reload = first.next()

    // A reload creates a new JS session/ledger but the same origin storage.
    const after_reload = new SequenceLedger(shared)
    expect(after_reload.current()).toBe(before_reload)
    expect(after_reload.next()).toBeGreaterThan(before_reload)
  })

  it('starts fresh for a new application session with isolated storage', () => {
    const first = new SequenceLedger(storage())
    first.next()
    const new_session = new SequenceLedger(storage())
    expect(new_session.next()).toBe(1)
  })

  it('survives corrupt storage values and storage failures', () => {
    const corrupt = storage(new Map([[SEQUENCE_STORAGE_KEY, 'not-a-number']]))
    expect(new SequenceLedger(corrupt).next()).toBe(1)

    const failing: SequenceStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') }
    }
    const ledger = new SequenceLedger(failing)
    expect(ledger.next()).toBe(1)
    expect(ledger.next()).toBe(2)
  })

  it('does not wrap around at the safe integer limit', () => {
    const high = storage(new Map([[SEQUENCE_STORAGE_KEY, String(Number.MAX_SAFE_INTEGER)]]))
    const ledger = new SequenceLedger(high)
    expect(ledger.next()).toBe(Number.MAX_SAFE_INTEGER)
    expect(ledger.next()).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('uses an injected clock-independent ledger without touching storage', () => {
    const spy = vi.fn()
    const ledger = new SequenceLedger({ getItem: spy, setItem: vi.fn() })
    ledger.next()
    expect(spy).toHaveBeenCalledOnce()
  })
})
