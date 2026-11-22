/**
 * WebGL startup guards.
 *
 * Keeps renderer creation failures and canvas context-loss events observable,
 * and turns an otherwise silent/blank startup into a visible error message.
 * These helpers are inert until a failure actually occurs.
 */

import * as THREE from 'three'
import { mark, mark_error } from './StartupDiagnostics.ts'

export const FATAL_ERROR_ELEMENT_ID = 'm2m-startup-error'

type RendererFactory = () => THREE.WebGLRenderer

const default_renderer_factory: RendererFactory = () =>
  new THREE.WebGLRenderer({ antialias: true, alpha: true })

/**
 * Create the main WebGL renderer, wrapping the underlying exception with a
 * descriptive message. The factory argument is injectable so the failure path
 * can be unit tested without a real GL context.
 */
export function create_webgl_renderer (factory: RendererFactory = default_renderer_factory): THREE.WebGLRenderer {
  mark('renderer-create:start')
  try {
    const renderer = factory()
    mark('renderer-create:ok')
    return renderer
  } catch (error) {
    mark_error('renderer-create', error)
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`WebGL renderer initialization failed: ${detail}`)
  }
}

/**
 * Attach `webglcontextlost` / `webglcontextrestored` listeners.
 * `preventDefault()` on context loss is required to allow restoration.
 */
export function install_webgl_context_handlers (
  canvas: HTMLCanvasElement,
  on_lost: () => void,
  on_restored: () => void
): void {
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    mark('webgl-context-lost')
    on_lost()
  })
  canvas.addEventListener('webglcontextrestored', () => {
    mark('webgl-context-restored')
    on_restored()
  })
}

/**
 * Display a visible, last-resort message when startup cannot continue.
 * Idempotent: repeated failures update the same panel instead of stacking.
 */
export function display_fatal_startup_error (error: unknown): void {
  mark_error('fatal', error)
  try {
    const message = error instanceof Error ? error.message : String(error)
    let panel = document.getElementById(FATAL_ERROR_ELEMENT_ID)
    if (panel === null) {
      panel = document.createElement('div')
      panel.id = FATAL_ERROR_ELEMENT_ID
      panel.setAttribute('role', 'alert')
      Object.assign(panel.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        right: '0',
        padding: '0.75rem 1rem',
        background: '#7a1f1f',
        color: '#ffffff',
        fontFamily: 'sans-serif',
        fontSize: '0.95rem',
        zIndex: '2147483647',
        whiteSpace: 'pre-wrap'
      })
      const host = document.body ?? document.documentElement
      host.appendChild(panel)
    }
    panel.textContent = `Mesh2Motion could not start: ${message}`
  } catch (display_error) {
    // Never throw from the error reporter itself.
    try {
      console.error('[M2M startup] failed to display fatal error', display_error)
    } catch {
      // Nothing else can be done.
    }
  }
}
