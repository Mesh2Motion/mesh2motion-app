import { describe, expect, it, vi } from 'vitest'
import type { WebGLRenderer } from 'three'
import { RendererLifecycle } from './RendererLifecycle'

function make_renderer (container: HTMLElement): WebGLRenderer {
  const canvas = document.createElement('canvas')
  const renderer = {
    domElement: canvas,
    getPixelRatio: vi.fn(() => 1),
    setPixelRatio: vi.fn(),
    getSize: vi.fn((size: { width: number, height: number }) => Object.assign(size, { width: 320, height: 200 })),
    setSize: vi.fn(),
    dispose: vi.fn()
  }
  container.append(canvas)
  return renderer as unknown as WebGLRenderer
}

describe('RendererLifecycle', () => {
  it('starts one frame chain and cancels it without invoking a stale callback', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 320 })
    Object.defineProperty(container, 'clientHeight', { value: 200 })
    const pending = new Map<number, () => void>()
    let next_handle = 1
    const request_frame = vi.fn((callback: () => void) => {
      const handle = next_handle++
      pending.set(handle, callback)
      return handle
    })
    const cancel_frame = vi.fn((handle: number) => { pending.delete(handle) })
    const frame = vi.fn()
    const renderer = make_renderer(container)
    const lifecycle = new RendererLifecycle(
      renderer,
      { aspect: 1, updateProjectionMatrix: vi.fn() } as never,
      container,
      frame,
      undefined,
      request_frame,
      cancel_frame
    )

    lifecycle.start()
    lifecycle.start()
    expect(request_frame).toHaveBeenCalledTimes(1)
    const late_callback = [...pending.values()][0]
    lifecycle.dispose()
    late_callback?.()

    expect(cancel_frame).toHaveBeenCalledTimes(1)
    expect(frame).not.toHaveBeenCalled()
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
    expect(renderer.domElement.isConnected).toBe(false)
  })

  it('removes WebGL context handlers and viewport listeners during disposal', () => {
    const container = document.createElement('div')
    Object.defineProperty(container, 'clientWidth', { value: 320 })
    Object.defineProperty(container, 'clientHeight', { value: 200 })
    const canvas = document.createElement('canvas')
    const renderer = {
      domElement: canvas,
      getPixelRatio: vi.fn(() => 1),
      setPixelRatio: vi.fn(),
      getSize: vi.fn((size: { width: number, height: number }) => Object.assign(size, { width: 320, height: 200 })),
      setSize: vi.fn(),
      dispose: vi.fn()
    } as unknown as WebGLRenderer
    const add = vi.spyOn(canvas, 'addEventListener')
    const remove = vi.spyOn(canvas, 'removeEventListener')
    const lifecycle = new RendererLifecycle(
      renderer,
      { aspect: 1, updateProjectionMatrix: vi.fn() } as never,
      container,
      vi.fn(),
      undefined,
      () => 1,
      vi.fn()
    )
    lifecycle.start()
    lifecycle.dispose()

    expect(add).toHaveBeenCalledWith('webglcontextlost', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('webglcontextlost', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('webglcontextrestored', expect.any(Function))
  })
})
