import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebGLRenderer } from 'three'
import {
  create_webgl_renderer,
  display_fatal_startup_error,
  display_render_loop_error,
  clear_fatal_startup_error,
  FATAL_ERROR_ELEMENT_ID,
  RENDER_LOOP_ERROR_REASON,
  install_webgl_context_handlers
} from './WebGLStartup.ts'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('create_webgl_renderer', () => {
  it('returns the renderer produced by the factory', () => {
    const renderer = {} as WebGLRenderer
    const factory = vi.fn((): WebGLRenderer => renderer)

    expect(create_webgl_renderer(factory)).toBe(renderer)
    expect(factory).toHaveBeenCalledOnce()
  })

  it('throws a descriptive error when renderer creation fails', () => {
    const factory = vi.fn((): WebGLRenderer => {
      throw new Error('no webgl context')
    })

    expect(() => create_webgl_renderer(factory)).toThrowError(
      /WebGL renderer initialization failed.*no webgl context/
    )
  })
})

describe('install_webgl_context_handlers', () => {
  it('prevents default on context loss and reports restoration', () => {
    const canvas = document.createElement('canvas')
    const on_lost = vi.fn()
    const on_restored = vi.fn()

    install_webgl_context_handlers(canvas, on_lost, on_restored)

    const lost_event = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lost_event)
    expect(lost_event.defaultPrevented).toBe(true)
    expect(on_lost).toHaveBeenCalledOnce()

    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(on_restored).toHaveBeenCalledOnce()
  })
})

describe('display_fatal_startup_error', () => {
  it('shows one visible panel even when called repeatedly', () => {
    display_fatal_startup_error(new Error('renderer blew up'))
    display_fatal_startup_error(new Error('second failure'))

    const panels = document.querySelectorAll(`#${FATAL_ERROR_ELEMENT_ID}`)
    expect(panels).toHaveLength(1)
    expect(panels[0]?.textContent).toContain('Mesh2Motion could not start')
    // The panel is updated in place, so the most recent failure is shown.
    expect(panels[0]?.textContent).toContain('second failure')
    expect(panels[0]?.getAttribute('role')).toBe('alert')
  })
})

describe('render-loop error panel', () => {
  it('removes only its own panel after recovery', () => {
    display_render_loop_error(new Error('loop stopped'))
    const panel = document.getElementById(FATAL_ERROR_ELEMENT_ID)
    expect(panel?.dataset.m2mReason).toBe(RENDER_LOOP_ERROR_REASON)

    clear_fatal_startup_error(RENDER_LOOP_ERROR_REASON)
    expect(document.getElementById(FATAL_ERROR_ELEMENT_ID)).toBeNull()
  })

  it('does not remove an initialization failure panel', () => {
    display_fatal_startup_error(new Error('renderer init failed'))
    clear_fatal_startup_error(RENDER_LOOP_ERROR_REASON)
    expect(document.getElementById(FATAL_ERROR_ELEMENT_ID)).not.toBeNull()
  })
})
