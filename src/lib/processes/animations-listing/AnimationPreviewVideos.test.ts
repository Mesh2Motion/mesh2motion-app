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

let invoke_mock: ReturnType<typeof vi.fn>
let convert_file_src_mock: ReturnType<typeof vi.fn>
let paused_videos: HTMLVideoElement[]

function set_tauri (enabled: boolean): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: enabled ? { invoke: vi.fn() } : undefined,
    configurable: true,
    writable: true
  })
  Object.defineProperty(window, '__TAURI__', {
    value: enabled ? { core: { invoke: invoke_mock, convertFileSrc: convert_file_src_mock } } : undefined,
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
  paused_videos = []
  pause_mock = vi.fn(function (this: HTMLVideoElement) { paused_videos.push(this) })
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { value: play_mock, configurable: true, writable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { value: pause_mock, configurable: true, writable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'load', { value: vi.fn(), configurable: true, writable: true })
  Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', {
    value: vi.fn(() => 'probably'),
    configurable: true,
    writable: true
  })
  invoke_mock = vi.fn().mockResolvedValue('/resources/animpreviews/human/dark_Angry.mp4')
  convert_file_src_mock = vi.fn((path: string) => `asset://localhost${path}`)
  globalThis.fetch = vi.fn() as typeof fetch
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

  it('uses the range-capable Tauri asset protocol for desktop previews', async () => {
    set_tauri(true)
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    await Promise.resolve()
    await Promise.resolve()

    expect(invoke_mock).toHaveBeenCalledWith('animation_preview_asset_path', { assetKey: 'human/dark_Angry.mp4' })
    expect(convert_file_src_mock).toHaveBeenCalledWith('/resources/animpreviews/human/dark_Angry.mp4')
    expect(tile.querySelector('video')?.getAttribute('src')).toBe('asset://localhost/resources/animpreviews/human/dark_Angry.mp4')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(play_mock).toHaveBeenCalledOnce()
    previews.disconnect()
  })

  it('waits for the native asset path before calling play', async () => {
    set_tauri(true)
    let resolve_path: ((path: string) => void) | undefined
    invoke_mock.mockImplementation(() => new Promise<string>((resolve) => { resolve_path = resolve }))
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]
    observer.emit([{ target: tile, isIntersecting: true }])
    observer.emit([{ target: tile, isIntersecting: true }])
    expect(play_mock).not.toHaveBeenCalled()

    resolve_path?.('/resources/animpreviews/human/dark_Angry.mp4')
    await vi.waitFor(() => expect(play_mock).toHaveBeenCalledOnce())
    expect(tile.classList.contains('preview-failed')).toBe(false)
    previews.disconnect()
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

  it('shows a fallback when the desktop asset lookup fails', async () => {
    set_tauri(true)
    invoke_mock.mockRejectedValue(new Error('resource unavailable'))
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

  it('keeps viewport-visible previews when the active-video cap is reached', () => {
    const container = document.createElement('div')
    const visible_tile = placeholder('human/dark_visible.mp4')
    const prefetch_tile = placeholder('human/dark_prefetch.mp4')
    container.append(visible_tile, prefetch_tile)
    vi.spyOn(visible_tile, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 220, left: 10, right: 110, width: 100, height: 120
    } as DOMRect)
    vi.spyOn(prefetch_tile, 'getBoundingClientRect').mockReturnValue({
      top: 900, bottom: 1020, left: 10, right: 110, width: 100, height: 120
    } as DOMRect)
    const previews = new AnimationPreviewVideos({ max_active_videos: 1 })

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([
      { target: prefetch_tile, isIntersecting: true },
      { target: visible_tile, isIntersecting: true }
    ])

    expect(paused_videos).toEqual([prefetch_tile.querySelector('video')])
    previews.disconnect()
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
