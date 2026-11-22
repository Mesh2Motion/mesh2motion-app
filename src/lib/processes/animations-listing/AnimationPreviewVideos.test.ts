import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnimationPreviewVideos } from './AnimationPreviewVideos.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'

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
  play_mock = vi.fn(function (this: HTMLVideoElement) {
    // Mirror the browser: play() clears paused synchronously.
    Object.defineProperty(this, 'paused', { value: false, configurable: true })
    return Promise.resolve()
  })
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
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    blob: async () => new Blob(['preview'], { type: 'video/mp4' })
  }) as unknown as typeof fetch
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:preview-test'), configurable: true
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(), configurable: true
  })
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

  it('buffers allowlisted Tauri assets into a Blob URL for desktop playback', async () => {
    set_tauri(true)
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    await vi.waitFor(() => expect(play_mock).toHaveBeenCalledOnce())

    expect(invoke_mock).toHaveBeenCalledWith('animation_preview_asset_path', { assetKey: 'human/dark_Angry.mp4' })
    expect(convert_file_src_mock).toHaveBeenCalledWith('/resources/animpreviews/human/dark_Angry.mp4')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'asset://localhost/resources/animpreviews/human/dark_Angry.mp4',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(tile.querySelector('video')?.getAttribute('src')).toBe('blob:preview-test')
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    previews.disconnect()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-test')
  })

  it('shows a fallback when the allowlisted preview transfer fails', async () => {
    set_tauri(true)
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    await vi.waitFor(() => expect(tile.querySelector('.preview-fallback')).not.toBeNull())

    expect(URL.createObjectURL).not.toHaveBeenCalled()
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

  it('shows a static fallback only after bounded media retries are exhausted', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    const video = tile.querySelector('video')!

    video.dispatchEvent(new Event('error'))
    expect(tile.querySelector('.preview-fallback')).toBeNull()
    vi.advanceTimersByTime(300)
    video.dispatchEvent(new Event('error'))
    expect(tile.querySelector('.preview-fallback')).toBeNull()
    vi.advanceTimersByTime(600)
    video.dispatchEvent(new Event('error'))

    expect(tile.classList.contains('preview-failed')).toBe(true)
    expect(tile.querySelector('.preview-fallback')?.textContent).toContain('Preview unavailable')
    previews.disconnect()
    vi.useRealTimers()
  })

  it('recovers from a transient media error without disabling the tile', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    const video = tile.querySelector('video')!
    play_mock.mockClear()

    // A real media error puts the element into a paused/error state; the retry
    // must re-issue play() rather than treating the error as terminal.
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    video.dispatchEvent(new Event('error'))
    vi.advanceTimersByTime(300)

    expect(tile.querySelector('.preview-fallback')).toBeNull()
    expect(play_mock).toHaveBeenCalledOnce()
    previews.disconnect()
    vi.useRealTimers()
  })

  it('caps concurrent media fetches and prioritizes visible placeholders', async () => {
    set_tauri(true)
    let resolve_fetch: ((value: unknown) => void) | undefined
    const fetch_mock = vi.fn(() => new Promise<unknown>((resolve) => { resolve_fetch = resolve }))
    globalThis.fetch = fetch_mock as unknown as typeof fetch
    const container = document.createElement('div')
    const tiles = Array.from({ length: 6 }, (_, i) => placeholder(`human/dark_clip${i}.mp4`))
    tiles.forEach(tile => container.appendChild(tile))
    const previews = new AnimationPreviewVideos({ max_concurrent_fetches: 2 })

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit(tiles.map(target => ({ target, isIntersecting: true })))
    await vi.waitFor(() => expect(fetch_mock).toHaveBeenCalledTimes(2))

    resolve_fetch?.({ ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'video/mp4' }) })
    await vi.waitFor(() => expect(fetch_mock).toHaveBeenCalledTimes(3))

    previews.disconnect()
    vi.useRealTimers()
  })

  it('aborts pending fetches on rapid rig/theme redraw', async () => {
    set_tauri(true)
    const abort_signals: AbortSignal[] = []
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal != null) abort_signals.push(init.signal)
      return new Promise<unknown>(() => {}) as unknown as Promise<Response>
    }) as unknown as typeof fetch
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    await vi.waitFor(() => expect(abort_signals.length).toBeGreaterThan(0))
    previews.disconnect()
    expect(abort_signals.every(signal => signal.aborted)).toBe(true)
  })

  it('handles rejected autoplay with bounded retries and no unhandled promise', async () => {
    vi.useFakeTimers()
    play_mock.mockRejectedValue(new Error('autoplay blocked'))
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    await Promise.resolve()
    await Promise.resolve()

    // A single rejected play() must not permanently disable the preview.
    expect(tile.classList.contains('preview-failed')).toBe(false)
    expect(tile.querySelector('.preview-fallback')).toBeNull()

    // Advance through the bounded backoff; each retried play() rejects again.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(tile.classList.contains('preview-failed')).toBe(true)
    expect(tile.querySelector('.preview-fallback')).not.toBeNull()
    previews.disconnect()
    vi.useRealTimers()
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

  it('does not recreate nodes or replay on repeated observer notifications', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()
    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]

    observer.emit([{ target: tile, isIntersecting: true }])
    const first_node = tile.querySelector('video')
    for (let i = 0; i < 5; i += 1) {
      observer.emit([{ target: tile, isIntersecting: true }])
    }

    expect(tile.querySelector('video')).toBe(first_node)
    expect(play_mock).toHaveBeenCalledOnce()
    previews.disconnect()
  })

  it('keeps generated source URLs stable across redraws', () => {
    const first = AnimationPreviewVideos.preview_src(SkeletonType.Human, 'dark', 'Angry')
    const second = AnimationPreviewVideos.preview_src(SkeletonType.Human, 'dark', 'Angry')
    expect(first).toBe(second)
    expect(first).toBe('../animpreviews/human/dark_Angry.mp4')
  })

  it('resumes a stopped video after a loop boundary without replacing it', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()
    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]
    observer.emit([{ target: tile, isIntersecting: true }])
    const video = tile.querySelector('video')!
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    Object.defineProperty(video, 'ended', { value: true, configurable: true })

    observer.emit([{ target: tile, isIntersecting: true }])
    expect(tile.querySelector('video')).toBe(video)
    expect(play_mock).toHaveBeenCalledTimes(2)
    previews.disconnect()
  })

  it('handles rapid pause/resume transitions without extra sources', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()
    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]

    observer.emit([{ target: tile, isIntersecting: true }])
    observer.emit([{ target: tile, isIntersecting: false }])
    Object.defineProperty(tile.querySelector('video')!, 'paused', { value: true, configurable: true })
    observer.emit([{ target: tile, isIntersecting: true }])

    expect(play_mock).toHaveBeenCalledTimes(2)
    expect(pause_mock).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('video')).toHaveLength(1)
    previews.disconnect()
  })

  it('does not leak observer instances or videos across repeated rig/theme redraws', () => {
    const container = document.createElement('div')
    const previews = new AnimationPreviewVideos()
    for (let i = 0; i < 4; i += 1) {
      container.innerHTML = ''
      container.appendChild(placeholder(`human/dark_clip${i}.mp4`))
      previews.observe_placeholders(container)
      FakeIntersectionObserver.instances[i].emit([{ target: container.firstElementChild!, isIntersecting: true }])
      expect(container.querySelectorAll('video')).toHaveLength(1)
    }
    previews.disconnect()
    expect(container.querySelectorAll('video')).toHaveLength(0)
    expect(FakeIntersectionObserver.instances.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true)
  })

  it('does not call load() or show a fallback during teardown', () => {
    set_tauri(true)
    const load_mock = vi.spyOn(HTMLMediaElement.prototype, 'load')
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()
    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    const video = tile.querySelector('video')!

    previews.disconnect()
    video.dispatchEvent(new Event('error'))

    expect(load_mock).not.toHaveBeenCalled()
    expect(tile.querySelector('.preview-fallback')).toBeNull()
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
