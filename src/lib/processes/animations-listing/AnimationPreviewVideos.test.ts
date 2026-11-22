import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AnimationPreviewVideos,
  HOVER_DELAY_MS,
  INTERACTION_END_DEBOUNCE_MS,
  MAX_ACTIVE_PREVIEW_VIDEOS,
  MAX_CONCURRENT_PREVIEW_FETCHES,
  MAX_PLAYBACK_ATTEMPTS,
  TOUCH_PREVIEW_TIMEOUT_MS
} from './AnimationPreviewVideos.ts'
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

function row_with (tile: HTMLElement, selected = false): HTMLElement {
  const row = document.createElement('div')
  row.className = 'anim-item'
  row.setAttribute('data-selected', selected ? 'true' : 'false')
  row.appendChild(tile)
  return row
}

function pointer_event (type: string, pointerType: 'mouse' | 'touch'): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

/** Keyboard focus enables playback immediately (no hover delay). */
function focus_tile (tile: HTMLElement): void {
  tile.dispatchEvent(new Event('focusin'))
}

function blur_tile (tile: HTMLElement): void {
  tile.dispatchEvent(new Event('focusout'))
}

async function flush (): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve()
  }
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
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AnimationPreviewVideos — interaction-gated scheduler', () => {
  it('keeps offscreen previews completely inactive', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    focus_tile(tile)
    expect(previews.get_stats().visible_tiles).toBe(0)
    expect(tile.querySelector('video')).toBeNull()
    expect(play_mock).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    previews.disconnect()
  })

  it('shows a static placeholder for a visible but idle tile (no autoplay)', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])

    expect(previews.get_stats().visible_tiles).toBe(1)
    expect(previews.get_stats().playing_count).toBe(0)
    expect(tile.querySelector('video')).toBeNull()
    expect(play_mock).not.toHaveBeenCalled()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    previews.disconnect()
  })

  it('plays after a hover delay and pauses after the documented end debounce', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos({ hover_delay_ms: HOVER_DELAY_MS })

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    tile.dispatchEvent(pointer_event('pointerenter', 'mouse'))
    expect(play_mock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(HOVER_DELAY_MS)
    expect(play_mock).toHaveBeenCalledOnce()

    tile.dispatchEvent(pointer_event('pointerleave', 'mouse'))
    vi.advanceTimersByTime(INTERACTION_END_DEBOUNCE_MS - 1)
    expect(paused_videos).toHaveLength(0) // still playing during the grace period
    vi.advanceTimersByTime(1)
    expect(paused_videos).toHaveLength(1)
    expect(previews.get_stats().playing_count).toBe(0)
    previews.disconnect()
  })

  it('pauses after keyboard focus ends with the documented debounce', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    focus_tile(tile)
    expect(play_mock).toHaveBeenCalledOnce()

    blur_tile(tile)
    vi.advanceTimersByTime(INTERACTION_END_DEBOUNCE_MS)
    expect(paused_videos).toHaveLength(1)
    expect(previews.get_stats().playing_count).toBe(0)
    previews.disconnect()
  })

  it('allows playback from keyboard focus and selection', () => {
    const container = document.createElement('div')
    const focus_tile_node = placeholder('human/dark_focus.mp4')
    const selected_tile = placeholder('human/dark_selected.mp4')
    const row = row_with(selected_tile, false)
    container.append(focus_tile_node, row)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([
      { target: focus_tile_node, isIntersecting: true },
      { target: selected_tile, isIntersecting: true }
    ])
    expect(play_mock).not.toHaveBeenCalled()

    focus_tile(focus_tile_node)
    expect(play_mock).toHaveBeenCalledTimes(1)

    row.setAttribute('data-selected', 'true')
    row.dispatchEvent(new Event('change', { bubbles: true }))
    expect(play_mock).toHaveBeenCalledTimes(2)
    expect(previews.get_stats().playing_count).toBe(2)
    previews.disconnect()
  })

  it('supports explicit tap-to-preview on touch input', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    tile.dispatchEvent(pointer_event('pointerdown', 'touch'))
    expect(play_mock).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(TOUCH_PREVIEW_TIMEOUT_MS)
    vi.advanceTimersByTime(INTERACTION_END_DEBOUNCE_MS)
    expect(previews.get_stats().playing_count).toBe(0)
    previews.disconnect()
  })

  it('pauses and cancels work when a tile scrolls out of view regardless of hover', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    focus_tile(tile)
    expect(play_mock).toHaveBeenCalledOnce()

    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: false }])
    expect(paused_videos).toHaveLength(1)
    expect(previews.get_stats().playing_count).toBe(0)
    expect(tile.querySelector('video')).toBeNull()
    expect(play_mock).toHaveBeenCalledOnce()
    previews.disconnect()
  })

  it('uses the direct asset URL in browser builds once interacted with', async () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    focus_tile(tile)

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
    focus_tile(tile)
    await flush()

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
    focus_tile(tile)
    await flush()

    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(tile.querySelector('.preview-fallback')).not.toBeNull()
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
    focus_tile(tile)
    await flush()

    expect(tile.querySelector('.preview-fallback')).not.toBeNull()
    previews.disconnect()
  })

  it('retries transient failures only within the bounded limit', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    focus_tile(tile)
    const video = tile.querySelector('video')!

    expect(MAX_PLAYBACK_ATTEMPTS).toBe(3) // initial + exactly 2 retries
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    video.dispatchEvent(new Event('error'))
    expect(tile.querySelector('.preview-fallback')).toBeNull()
    vi.advanceTimersByTime(300)
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    video.dispatchEvent(new Event('error'))
    expect(tile.querySelector('.preview-fallback')).toBeNull()
    vi.advanceTimersByTime(600)
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    video.dispatchEvent(new Event('error'))

    expect(tile.classList.contains('preview-failed')).toBe(true)
    expect(play_mock).toHaveBeenCalledTimes(MAX_PLAYBACK_ATTEMPTS)
    previews.disconnect()
  })

  it('recovers from a transient media error without disabling the tile', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    focus_tile(tile)
    const video = tile.querySelector('video')!
    play_mock.mockClear()

    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    video.dispatchEvent(new Event('error'))
    vi.advanceTimersByTime(300)

    expect(tile.querySelector('.preview-fallback')).toBeNull()
    expect(play_mock).toHaveBeenCalledOnce()
    previews.disconnect()
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
    focus_tile(tile)

    expect(tile.querySelector('.preview-fallback')).toBeNull()
    for (let i = 0; i < MAX_PLAYBACK_ATTEMPTS; i += 1) {
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      await Promise.resolve()
    }
    expect(tile.querySelector('.preview-fallback')).not.toBeNull()
    previews.disconnect()
  })

  it(`never plays more than ${MAX_ACTIVE_PREVIEW_VIDEOS} thumbnails (21 interacted tiles)`, () => {
    const container = document.createElement('div')
    const tiles = Array.from({ length: 21 }, (_, i) => placeholder(`human/dark_clip${i}.mp4`))
    tiles.forEach(tile => container.appendChild(tile))
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit(tiles.map(target => ({ target, isIntersecting: true })))
    tiles.forEach(tile => focus_tile(tile))

    expect(play_mock).toHaveBeenCalledTimes(MAX_ACTIVE_PREVIEW_VIDEOS)
    expect(previews.get_stats().playing_count).toBe(MAX_ACTIVE_PREVIEW_VIDEOS)
    expect(previews.get_stats().video_count).toBe(MAX_ACTIVE_PREVIEW_VIDEOS)
    expect(MAX_ACTIVE_PREVIEW_VIDEOS + 1).toBe(21) // a 21st playback is impossible
    previews.disconnect()
  })

  it(`never has more than ${MAX_CONCURRENT_PREVIEW_FETCHES} fetches in flight (21 tiles)`, async () => {
    set_tauri(true)
    let resolve_fetch: ((value: unknown) => void) | undefined
    globalThis.fetch = vi.fn(() => new Promise<unknown>((resolve) => { resolve_fetch = resolve })) as unknown as typeof fetch
    const container = document.createElement('div')
    const tiles = Array.from({ length: 21 }, (_, i) => placeholder(`human/dark_clip${i}.mp4`))
    tiles.forEach(tile => container.appendChild(tile))
    // Playback cap is deliberately raised so the fetch cap can be verified
    // independently; the two limits must not be coupled.
    const previews = new AnimationPreviewVideos({ max_active_videos: 25 })

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit(tiles.map(target => ({ target, isIntersecting: true })))
    tiles.forEach(tile => focus_tile(tile))
    await flush()

    const stats = previews.get_stats()
    expect(stats.in_flight_fetches).toBe(MAX_CONCURRENT_PREVIEW_FETCHES)
    expect(stats.queued_fetches).toBe(1) // the 21st request waits in the bounded queue
    expect(globalThis.fetch).toHaveBeenCalledTimes(MAX_CONCURRENT_PREVIEW_FETCHES)

    resolve_fetch?.({ ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'video/mp4' }) })
    await flush()
    expect(globalThis.fetch).toHaveBeenCalledTimes(MAX_CONCURRENT_PREVIEW_FETCHES + 1)
    previews.disconnect()
  })

  it('prioritizes selected/focused tiles over merely hovered tiles at the cap', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const selected = placeholder('human/dark_selected_priority.mp4')
    const row = row_with(selected, false)
    const hovered = placeholder('human/dark_hovered.mp4')
    container.append(row, hovered)
    const previews = new AnimationPreviewVideos({ max_active_videos: 1 })

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([
      { target: selected, isIntersecting: true },
      { target: hovered, isIntersecting: true }
    ])
    hovered.dispatchEvent(pointer_event('pointerenter', 'mouse'))
    vi.advanceTimersByTime(HOVER_DELAY_MS)
    expect(play_mock).toHaveBeenCalledOnce()
    expect((play_mock.mock.instances[0] as HTMLVideoElement).getAttribute('src')).toBe(
      'human/dark_hovered.mp4'
    )

    // Selection outranks hover at the cap: hovered is released, selected plays.
    play_mock.mockClear()
    row.setAttribute('data-selected', 'true')
    row.dispatchEvent(new Event('change', { bubbles: true }))
    expect(play_mock).toHaveBeenCalledOnce()
    expect((play_mock.mock.instances[0] as HTMLVideoElement).getAttribute('src')).toBe(
      'human/dark_selected_priority.mp4'
    )
    expect(previews.get_stats().playing_count).toBe(1)
    previews.disconnect()
  })

  it('cancels obsolete fetches during rapid scrolling', async () => {
    set_tauri(true)
    const abort_signals: AbortSignal[] = []
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.signal != null) abort_signals.push(init.signal)
      return new Promise<unknown>(() => {}) as unknown as Promise<Response>
    }) as unknown as typeof fetch
    const container = document.createElement('div')
    const tiles = Array.from({ length: 3 }, (_, i) => placeholder(`human/dark_scroll${i}.mp4`))
    tiles.forEach(tile => container.appendChild(tile))
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]
    observer.emit(tiles.map(target => ({ target, isIntersecting: true })))
    tiles.forEach(tile => focus_tile(tile))
    await flush()
    expect(abort_signals).toHaveLength(3)

    observer.emit(tiles.map(target => ({ target, isIntersecting: false })))
    expect(abort_signals.every(signal => signal.aborted)).toBe(true)
    await flush()
    expect(previews.get_stats().in_flight_fetches).toBe(0)
    previews.disconnect()
  })

  it('removes listeners, timers and pending work on cleanup', () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    tile.dispatchEvent(pointer_event('pointerenter', 'mouse'))
    const observer = FakeIntersectionObserver.instances[0]

    previews.disconnect()
    expect(observer.disconnect).toHaveBeenCalledOnce()
    expect(tile.querySelector('video')).toBeNull()

    // Listeners and timers no longer produce work after teardown.
    tile.dispatchEvent(new Event('focusin'))
    vi.advanceTimersByTime(5000)
    expect(play_mock).not.toHaveBeenCalled()
    expect(previews.get_stats().playing_count).toBe(0)
  })

  it('caps concurrent media fetches with an explicit lower limit', async () => {
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
    tiles.forEach(tile => focus_tile(tile))
    await flush()
    expect(fetch_mock).toHaveBeenCalledTimes(2)

    resolve_fetch?.({ ok: true, status: 200, blob: async () => new Blob(['x'], { type: 'video/mp4' }) })
    await flush()
    expect(fetch_mock).toHaveBeenCalledTimes(3)
    previews.disconnect()
  })

  it('pauses offscreen videos and releases the over-cap tile', () => {
    const container = document.createElement('div')
    const tiles = [placeholder('a.mp4'), placeholder('b.mp4'), placeholder('c.mp4')]
    tiles.forEach(tile => container.appendChild(tile))
    const previews = new AnimationPreviewVideos({ max_active_videos: 2 })

    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]
    observer.emit(tiles.map(target => ({ target, isIntersecting: true })))
    tiles.forEach(tile => focus_tile(tile))
    expect(play_mock).toHaveBeenCalledTimes(2)
    // The over-cap tile never receives a video at all, so no release is needed.
    expect(paused_videos).toHaveLength(0)
    expect(tiles[2].querySelector('video')).toBeNull()

    pause_mock.mockClear()
    observer.emit([{ target: tiles[0], isIntersecting: false }])
    expect(pause_mock).toHaveBeenCalledOnce()
    // Freeing a slot promotes the next eligible focused tile.
    expect(previews.get_stats().playing_count).toBe(2)
    expect(tiles[2].querySelector('video')).not.toBeNull()
    previews.disconnect()
  })

  it('keeps the interacted visible preview when the active cap is reached', () => {
    const container = document.createElement('div')
    const visible_tile = placeholder('human/dark_visible.mp4')
    const idle_tile = placeholder('human/dark_idle.mp4')
    container.append(idle_tile, visible_tile)
    const previews = new AnimationPreviewVideos({ max_active_videos: 1 })

    previews.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([
      { target: idle_tile, isIntersecting: true },
      { target: visible_tile, isIntersecting: true }
    ])
    focus_tile(visible_tile)

    expect(previews.get_stats().playing_count).toBe(1)
    expect(visible_tile.querySelector('video')).not.toBeNull()
    expect(idle_tile.querySelector('video')).toBeNull()
    previews.disconnect()
  })

  it('does not recreate nodes or replay on repeated observer notifications', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()
    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]

    observer.emit([{ target: tile, isIntersecting: true }])
    focus_tile(tile)
    const first_node = tile.querySelector('video')
    for (let i = 0; i < 5; i += 1) {
      observer.emit([{ target: tile, isIntersecting: true }])
    }

    expect(tile.querySelector('video')).toBe(first_node)
    expect(play_mock).toHaveBeenCalledOnce()
    previews.disconnect()
  })

  it('resumes a stopped video after a loop boundary without replacing it', () => {
    const container = document.createElement('div')
    const tile = placeholder()
    container.appendChild(tile)
    const previews = new AnimationPreviewVideos()
    previews.observe_placeholders(container)
    const observer = FakeIntersectionObserver.instances[0]
    observer.emit([{ target: tile, isIntersecting: true }])
    focus_tile(tile)
    const video = tile.querySelector('video')!
    Object.defineProperty(video, 'paused', { value: true, configurable: true })
    Object.defineProperty(video, 'ended', { value: true, configurable: true })

    focus_tile(tile)
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
    focus_tile(tile)
    observer.emit([{ target: tile, isIntersecting: false }])
    observer.emit([{ target: tile, isIntersecting: true }])

    expect(play_mock).toHaveBeenCalledTimes(2)
    expect(container.querySelectorAll('video')).toHaveLength(1)
    previews.disconnect()
  })

  it('does not leak observers or videos across repeated rig/theme redraws', () => {
    const container = document.createElement('div')
    const previews = new AnimationPreviewVideos()
    for (let i = 0; i < 4; i += 1) {
      container.innerHTML = ''
      const tile = placeholder(`human/dark_clip${i}.mp4`)
      container.appendChild(tile)
      previews.observe_placeholders(container)
      FakeIntersectionObserver.instances[i].emit([{ target: tile, isIntersecting: true }])
      focus_tile(tile)
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
    focus_tile(tile)
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
    const tile = placeholder()
    container.appendChild(tile)
    quiet.observe_placeholders(container)
    FakeIntersectionObserver.instances[0].emit([{ target: tile, isIntersecting: true }])
    focus_tile(tile)
    expect(debug).not.toHaveBeenCalled()
    quiet.disconnect()

    window.history.replaceState({}, '', '/?m2m-preview-debug=1')
    const verbose = new AnimationPreviewVideos()
    const container2 = document.createElement('div')
    const tile2 = placeholder()
    container2.appendChild(tile2)
    verbose.observe_placeholders(container2)
    FakeIntersectionObserver.instances[1].emit([{ target: tile2, isIntersecting: true }])
    focus_tile(tile2)
    expect(debug).toHaveBeenCalled()
    verbose.disconnect()
  })

  it('keeps generated source URLs stable across redraws', () => {
    const first = AnimationPreviewVideos.preview_src(SkeletonType.Human, 'dark', 'Angry')
    const second = AnimationPreviewVideos.preview_src(SkeletonType.Human, 'dark', 'Angry')
    expect(first).toBe(second)
    expect(first).toBe('../animpreviews/human/dark_Angry.mp4')
  })
})
