import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnimationPreviewVideos } from './AnimationPreviewVideos.ts'

class FakeIntersectionObserver {
  public static instances: FakeIntersectionObserver[] = []
  public readonly observe = vi.fn()
  public readonly disconnect = vi.fn()
  public callback: IntersectionObserverCallback

  constructor (callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }

  public emit (targets: Array<{ target: Element, isIntersecting: boolean }>): void {
    const entries = targets.map(item => ({
      ...item,
      boundingClientRect: { width: 100, height: 120 }
    }))
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

function placeholder (src = '../animpreviews/human/dark_Angry.mp4'): HTMLElement {
  const node = document.createElement('div')
  node.className = 'anim-preview-placeholder'
  node.setAttribute('data-src', src)
  return node
}

function response (ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: vi.fn(() => 'video/mp4') },
    blob: vi.fn().mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }))
  }
}

function set_tauri (enabled: boolean): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: enabled ? { invoke: vi.fn() } : undefined,
    configurable: true,
    writable: true
  })
}

let play_mock: ReturnType<typeof vi.fn>
let pause_mock: ReturnType<typeof vi.fn>

beforeEach(() => {
  document.body.innerHTML = ''
  FakeIntersectionObserver.instances = []
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: FakeIntersectionObserver,
    configurable: true,
    writable: true
  })
  play_mock = vi.fn().mockResolvedValue(undefined)
  pause_mock = vi.fn()
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { value: play_mock, configurable: true, writable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { value: pause_mock, configurable: true, writable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { value: vi.fn(), configurable: true, writable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', {
    value: vi.fn(() => 'probably'),
    configurable: true,
    writable: true
  })
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:preview'), configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true })
  globalThis.fetch = vi.fn().mockResolvedValue(response()) as typeof fetch
  window.history.replaceState({}, '', '/')
  set_tauri(false)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('AnimationPreviewVideos', () => {
  it('uses the direct asset URL in browser builds', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])

    expect(tile.querySelector('video')?.getAttribute('src')).toBe('../animpreviews/human/dark_Angry.mp4')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(play_mock).toHaveBeenCalled()
    previews.disconnect()
  })

  it('uses a Blob URL on desktop so no HTTP range support is needed', async () => {
    set_tauri(true)
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    await Promise.resolve()
    await Promise.resolve()

    expect(globalThis.fetch).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(tile.querySelector('video')?.getAttribute('src')).toBe('blob:preview')
    previews.disconnect()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('shows a static fallback when the media source errors', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    const video = tile.querySelector('video')!
    video.dispatchEvent(new Event('error'))

    expect(tile.classList.contains('preview-failed')).toBe(true)
    expect(tile.querySelector('.preview-fallback')?.textContent).toContain('Preview unavailable')
    previews.disconnect()
  })

  it('handles rejected autoplay without an unhandled promise', async () => {
    play_mock.mockRejectedValue(new Error('autoplay blocked'))
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    await Promise.resolve()
    await Promise.resolve()

    expect(tile.classList.contains('preview-failed')).toBe(true)
    previews.disconnect()
  })

  it('shows a fallback when the desktop fetch fails', async () => {
    set_tauri(true)
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline')) as typeof fetch
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    await Promise.resolve()
    await Promise.resolve()

    expect(tile.querySelector('.preview-fallback')).not.toBeNull()
    previews.disconnect()
  })

  it('pauses offscreen videos and caps concurrent playback', () => {
    const container = document.createElement('div')
    const tiles = [placeholder('a.mp4'), placeholder('b.mp4'), placeholder('c.mp4')]
    tiles.forEach(tile => container.appendChild(tile))
    const previews = new AnimationPreviewVideos({ max_active_videos: 2 })

    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]
    observer.emit(tiles.map(target => ({ target, isIntersecting: true })))
    expect(pause_mock).toHaveBeenCalledTimes(1) // third tile over the cap

    pause_mock.mockClear()
    observer.emit([{ target: tiles[0], isIntersecting: false }])
    expect(pause_mock).toHaveBeenCalledTimes(1)
    previews.disconnect()
    expect(pause_mock).toHaveBeenCalled()
  })

  it('disconnects the observer exactly once and removes videos', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]
    previews.disconnect()
    previews.disconnect()

    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(tile.querySelector('video')).toBeNull()
  })

  it('emits diagnostics only when opted in', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const quiet = new AnimationPreviewVideos()
    const container = document.createElement('div')
    container.appendChild(placeholder())
    quiet.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: container.firstElementChild!, isIntersecting: true }])
    expect(debug).not.toHaveBeenCalled()
    quiet.disconnect()

    window.history.replaceState({}, '', '/?m2m-preview-debug=1')
    const verbose = new AnimationPreviewVideos()
    const container2 = document.createElement('div')
    container2.appendChild(placeholder())
    verbose.observe_placeholders(container2)
    const observers = FakeIntersectionObserver.instances
    observers[observers.length - 1].emit([{ target: container2.firstElementChild!, isIntersecting: true }])
    expect(debug).toHaveBeenCalled()
    verbose.disconnect()
  })
})
