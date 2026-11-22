/**
 * Development-only startup markers.
 *
 * All logging is off unless explicitly enabled, so normal application behavior
 * (and console output) is unchanged. Enable with either:
 *   - `?m2m-debug=1` in the page URL
 *   - `localStorage.setItem('m2m-startup-debug', '1')`
 *
 * A runtime opt-in is used instead of `import.meta.env` because this project's
 * tsconfig uses `module: commonjs`, which rejects `import.meta`.
 *
 * Every helper is defensive: a failure inside diagnostics must never break
 * application startup, including in restricted webviews where storage access
 * can throw.
 */

const DEBUG_QUERY_PARAM = 'm2m-debug'
const DEBUG_STORAGE_KEY = 'm2m-startup-debug'

let cached_enabled: boolean | undefined

function read_debug_flag (): boolean {
  try {
    if (typeof window === 'undefined') {
      return false
    }
    if (new URLSearchParams(window.location.search).get(DEBUG_QUERY_PARAM) === '1') {
      return true
    }
    return window.localStorage.getItem(DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** True when startup markers should be emitted. Result is cached once. */
export function startup_debug_enabled (): boolean {
  if (cached_enabled === undefined) {
    cached_enabled = read_debug_flag()
  }
  return cached_enabled
}

function describe (detail: unknown): string {
  if (detail === undefined) {
    return ''
  }
  if (detail instanceof Error) {
    return ` ${detail.name}: ${detail.message}`
  }
  try {
    return ` ${JSON.stringify(detail)}`
  } catch {
    return ` ${String(detail)}`
  }
}

/** Emit a timestamped marker, e.g. `[M2M startup] renderer-create:ok`. */
export function mark (stage: string, detail?: unknown): void {
  if (!startup_debug_enabled()) {
    return
  }
  try {
    console.debug(`[M2M startup] ${stage}${describe(detail)}`)
  } catch {
    // Diagnostics must never break startup.
  }
}

/** Emit a marker for a caught error, without throwing. */
export function mark_error (stage: string, error: unknown): void {
  mark(`${stage}:error`, error)
}
