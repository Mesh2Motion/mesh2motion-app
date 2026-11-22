/**
 * Monotonic snapshot sequence that survives a webview reload.
 *
 * The M2M-009 Rust host requires strictly increasing `meta.sequence` for the
 * lifetime of the desktop process. A naive ControlSession restarts at 1 after
 * each page load, which makes the second page's publications be rejected.
 * Persisting the counter in the webview origin keeps v1.0 unchanged: no new
 * fields, no schema bump, no weaker monotonic check on the Rust side.
 */

export interface SequenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SEQUENCE_STORAGE_KEY = 'm2m-mcp-sequence'

function in_memory_storage (): SequenceStorage {
  let value: string | null = null
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next }
  }
}

/** Use localStorage when available; otherwise fall back to an in-memory store. */
export function create_browser_sequence_ledger (): SequenceLedger {
  let storage: SequenceStorage | null = null
  try {
    if (typeof window !== 'undefined' && window.localStorage !== undefined) {
      storage = window.localStorage
    }
  } catch {
    storage = null
  }
  return new SequenceLedger(storage ?? in_memory_storage())
}

export class SequenceLedger {
  private value: number

  constructor (private readonly storage: SequenceStorage | null = null) {
    this.value = this.read()
  }

  private read (): number {
    try {
      const raw = this.storage?.getItem(SEQUENCE_STORAGE_KEY)
      if (raw === null || raw === undefined) {
        return 0
      }
      const parsed = Number(raw)
      return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0
    } catch {
      return 0
    }
  }

  /** Advance once and persist. Never returns a previously returned value. */
  public next (): number {
    this.value = this.value < Number.MAX_SAFE_INTEGER ? this.value + 1 : this.value
    try {
      this.storage?.setItem(SEQUENCE_STORAGE_KEY, String(this.value))
    } catch {
      // Storage can be unavailable; in-memory monotonicity still holds.
    }
    return this.value
  }

  public current (): number {
    return this.value
  }
}
