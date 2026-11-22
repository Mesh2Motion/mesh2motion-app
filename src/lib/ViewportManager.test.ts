import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector2 } from 'three'
import { MAX_PIXEL_RATIO, ViewportManager } from './ViewportManager.ts'

class FakeResizeObserver {
  public static instances: FakeResizeObserver[] = []
  public readonly observe = vi.fn()
  public readonly disconnect = vi.fn()

  constructor (public readonly callback: () => void) {
    FakeResizeObserver.instances.push(this)
  }

  public trigger (): void {
    this.callback()
  }
}

function container_with (width: number, height: number): HTMLElement {
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: height, configurable: true })
  return container
}

function fake_renderer () {
  const size = new Vector2(0, 0)
  let ratio = 1
  return {
    getPixelRatio: vi.fn(() => ratio),
    setPixelRatio: vi.fn((value: number) => { ratio = value }),
    getSize: vi.fn((target: Vector2) => target.copy(size)),
    setSize: vi.fn((width: number, height: number) => { size.set(width, height) }),
    current_size: size
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = []
  Object.defineProperty(globalThis, 'ResizeObserver', { value: FakeResizeObserver, configurable: true, writable: true })
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true, writable: true })
  Object.defineProperty(window, 'matchMedia', {
    value: vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    configurable: true,
    writable: true
  })
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'ResizeObserver')
})

describe('ViewportManager', () => {
  it('sizes against the container and updates the camera', () => {
    const renderer = fake_renderer()
    const camera = { aspect: 1, updateProjectionMatrix: vi.fn() }
    const manager = new ViewportManager(
      renderer as never,
      camera as never,
      container_with(960, 540)
    )

    manager.start()
    expect(renderer.setSize).toHaveBeenCalledWith(960, 540, false)
    expect(camera.aspect).toBeCloseTo(960 / 540)
    expect(camera.updateProjectionMatrix).toHaveBeenCalled()
    expect(FakeResizeObserver.instances).toHaveLength(1)
    expect(FakeResizeObserver.instances[0].observe).toHaveBeenCalledOnce()
  })

  it('caps device pixel ratio and reacts to container resizes only', () => {
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true, writable: true })
    const renderer = fake_renderer()
    const camera = { aspect: 1, updateProjectionMatrix: vi.fn() }
    const container = container_with(800, 600)
    const manager = new ViewportManager(renderer as never, camera as never, container)

    manager.start()
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(MAX_PIXEL_RATIO)

    renderer.setSize.mockClear()
    camera.updateProjectionMatrix.mockClear()
    manager.resize()
    expect(renderer.setSize).not.toHaveBeenCalled()

    Object.defineProperty(container, 'clientWidth', { value: 640, configurable: true })
    FakeResizeObserver.instances[0].trigger()
    expect(renderer.setSize).toHaveBeenCalledWith(640, 600, false)
  })

  it('disconnects the observer exactly once on dispose', () => {
    const renderer = fake_renderer()
    const camera = { aspect: 1, updateProjectionMatrix: vi.fn() }
    const manager = new ViewportManager(renderer as never, camera as never, container_with(400, 300))

    manager.start()
    const observer = FakeResizeObserver.instances[0]
    manager.dispose()
    manager.dispose()
    expect(observer.disconnect).toHaveBeenCalledOnce()
  })
})
