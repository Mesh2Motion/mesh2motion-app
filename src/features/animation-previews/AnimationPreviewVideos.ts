import { type SkeletonType } from '../../lib/enums/SkeletonType.ts'
import { RigConfig } from '../../lib/RigConfig.ts'

/**
 * One shared, interaction-driven scheduler for an animation list's video thumbnails.
 *
 * Visibility gates everything, but visibility alone never starts playback. A tile
 * becomes eligible only when the user interacts with it: mouse hover (after a
 * short delay), keyboard focus, or an explicit preview-button action. Selection
 * never starts playback. Eligible tiles compete for small, fixed caps, so resource use tracks
 * visible/interacted tiles rather than the size of the catalog.
 *
 * Native WebKitGTK issues byte-range requests for short looping MP4s. Tauri's embedded
 * `tauri://` protocol answers those with a full 200 body (no 206/Accept-Ranges), which can
 * leave the media pipeline unable to present frames. Desktop builds resolve bundled
 * resources through Tauri's range-capable `asset://` protocol; browser builds keep the
 * original direct URL behavior. Diagnostics are opt-in with `?m2m-preview-debug=1` or
 * localStorage `m2m-preview-debug=1`.
 *
 * Protected lifecycle behavior from 7cd06bfa is preserved: one play() call site,
 * no redundant load(), safe teardown and stale asynchronous callback protection.
 */

const DEBUG_QUERY_PARAM = 'm2m-preview-debug'
const DEBUG_STORAGE_KEY = 'm2m-preview-debug'

/**
 * Independent upper limits, not targets: the scheduler never fills them
 * unless that many tiles are simultaneously visible AND interacted with.
 * They bound resource use without depending on catalog size.
 */
export const MAX_ACTIVE_PREVIEW_VIDEOS = 20
export const MAX_CONCURRENT_PREVIEW_FETCHES = 20
/** Initial attempt + at most 2 retries for a transient media failure. NOT 20. */
export const MAX_PLAYBACK_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 300

/** Hover must persist this long before a thumbnail starts playing. */
export const HOVER_DELAY_MS = 200
/** Hover/focus/selection end grace period before the thumbnail is paused. */
export const INTERACTION_END_DEBOUNCE_MS = 250

export interface PreviewVideoOptions {
  /** Upper limit on concurrently playing thumbnail videos. Default 20. */
  max_active_videos?: number
  /** Use the range-capable Tauri asset protocol for bundled media on desktop builds. */
  use_asset_protocol_on_desktop?: boolean
  /** Independent upper limit on in-flight media fetches. Default 20. */
  max_concurrent_fetches?: number
  /** Hover delay override, primarily for tests. */
  hover_delay_ms?: number
}

/** Live scheduler counters, useful for native scroll-test verification. */
export interface PreviewSchedulerStats {
  visible_tiles: number
  interacted_tiles: number
  video_count: number
  playing_count: number
  in_flight_fetches: number
  queued_fetches: number
}

interface FetchJob {
  placeholder: HTMLElement
  run: (signal: AbortSignal) => Promise<void>
}

interface TileInteraction {
  /** Row/item that carries the selected state. */
  tile: HTMLElement
  hovered: boolean
  focused: boolean
  selected: boolean
  manually_requested: boolean
  hover_timer: ReturnType<typeof setTimeout> | null
  end_timer: ReturnType<typeof setTimeout> | null
  listeners: Array<() => void>
}

type LogPayload = Record<string, unknown>
interface TauriPreviewCore {
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>
  convertFileSrc: (filePath: string) => string
}

function diagnostics_enabled (): boolean {
  try {
    if (typeof window === 'undefined') {
      return false
    }
    if (new URLSearchParams(window.location.search).get(DEBUG_QUERY_PARAM) === '1') {
      return true
    }
    return window.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function has_tauri_bridge (): boolean {
  try {
    if (typeof window === 'undefined') {
      return false
    }
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__
    return internals !== undefined && typeof internals.invoke === 'function'
  } catch {
    return false
  }
}

function tauri_preview_core (): TauriPreviewCore | null {
  try {
    const core = (window as unknown as { __TAURI__?: { core?: Partial<TauriPreviewCore> } }).__TAURI__?.core
    if (typeof core?.invoke !== 'function' || typeof core.convertFileSrc !== 'function') {
      return null
    }
    return core as TauriPreviewCore
  } catch {
    return null
  }
}

export class AnimationPreviewVideos {
  private observer: IntersectionObserver | null = null
  private container: HTMLElement | null = null
  /** Tiles currently inside the visible scroll viewport. */
  private readonly active = new Set<HTMLElement>()
  /** Placeholder nodes currently registered with IntersectionObserver. */
  private readonly observed_placeholders = new Set<HTMLElement>()
  /** Tiles with an interaction that currently requests playback. */
  private readonly interactions = new Map<HTMLElement, TileInteraction>()
  /** Tiles whose video is currently playing (bounded by max_active). */
  private readonly playing = new Set<HTMLElement>()
  /** Tiles that exhausted their bounded retries; never re-created until re-observed. */
  private readonly failed = new Set<HTMLElement>()
  private readonly videos = new Map<HTMLElement, HTMLVideoElement>()
  private readonly blob_urls = new Map<HTMLVideoElement, string>()
  private readonly debug: boolean
  private readonly max_active: number
  private readonly max_concurrent_fetches: number
  private readonly hover_delay_ms: number
  private readonly use_asset_protocol_on_desktop: boolean
  private disposing = false
  private readonly playback_attempts = new Map<HTMLElement, number>()
  private readonly retry_timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>()
  private readonly fetch_queue: FetchJob[] = []
  private readonly fetch_controllers = new Map<HTMLElement, AbortController>()
  private readonly pending_fetches = new Set<HTMLElement>()
  private in_flight_fetches = 0
  private probe_video: HTMLVideoElement | null = null
  private probe_placeholder: HTMLElement | null = null
  private probe_last_log = 0
  private probe_last_time = 0
  private probe_frame_handle: number | null = null
  private readonly probe_ids = new WeakMap<HTMLVideoElement, number>()
  private probe_next_id = 1

  constructor (options: PreviewVideoOptions = {}) {
    this.debug = diagnostics_enabled()
    this.max_active = options.max_active_videos ?? MAX_ACTIVE_PREVIEW_VIDEOS
    this.max_concurrent_fetches = options.max_concurrent_fetches ?? MAX_CONCURRENT_PREVIEW_FETCHES
    this.hover_delay_ms = options.hover_delay_ms ?? HOVER_DELAY_MS
    this.use_asset_protocol_on_desktop = options.use_asset_protocol_on_desktop ?? true
  }

  /** URL of the preview video for a library animation. Custom imports have no preview. */
  static preview_src (skeleton_type: SkeletonType, theme_name: string, animation_name: string): string | null {
    const preview_folder: string | undefined = RigConfig.by_skeleton_type(skeleton_type)?.animation_preview_folder
    if (preview_folder === undefined) {
      console.error('Unknown skeleton type for animation previews. Add the rig to RigConfig.ts.')
      return null
    }
    return `../animpreviews/${preview_folder}/${theme_name}_${animation_name}.mp4`
  }

  /**
   * Static poster for a preview video, generated offline by
   * `tools/generate-preview-posters.mjs`. Kept next to the MP4 with a .webp suffix.
   */
  static poster_src (video_src: string | null): string | null {
    if (video_src === null || !video_src.toLowerCase().endsWith('.mp4')) {
      return null
    }
    return `${video_src.slice(0, -4)}.webp`
  }

  /** Create an empty video element; source and listeners are attached on demand. */
  static create_video (src?: string, width: number = 100, height: number = 120): HTMLVideoElement {
    const video = document.createElement('video')
    video.className = 'anim-preview'
    // Never buffer media merely because a video element exists. play() triggers
    // loading only for tiles that actually won a scheduler slot.
    video.preload = 'none'
    if (src !== undefined) {
      video.src = src
    }
    video.width = width
    video.height = height
    video.loop = true
    video.muted = true
    video.playsInline = true
    return video
  }

  private log (event: string, payload: LogPayload): void {
    if (!this.debug) {
      return
    }
    try {
      console.debug('[M2M preview]', event, payload)
    } catch {
      // Diagnostics must never break the UI.
    }
  }

  /** Live scheduler counters (playing count is always <= max_active). */
  public get_stats (): PreviewSchedulerStats {
    return {
      visible_tiles: this.active.size,
      interacted_tiles: [...this.active].filter(placeholder => this.is_eligible(placeholder)).length,
      video_count: this.videos.size,
      playing_count: this.playing.size,
      in_flight_fetches: this.in_flight_fetches,
      queued_fetches: this.fetch_queue.length
    }
  }

  /** Watch placeholders. Idle visible tiles remain lightweight placeholders. */
  public observe_placeholders (container: HTMLElement): void {
    if (this.container === container && this.observer !== null) {
      this.refresh_placeholders()
      return
    }
    this.disconnect()
    this.container = container
    this.failed.clear()

    if (typeof IntersectionObserver === 'undefined') {
      // Keep static posters usable; without an observer never create videos.
      for (const placeholder of container.querySelectorAll<HTMLElement>('.anim-preview-placeholder')) {
        this.ensure_poster(placeholder)
      }
      this.log('observer-unavailable', {})
      return
    }

    this.observer = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        const placeholder = entry.target as HTMLElement
        this.log('intersection', {
          visible: entry.isIntersecting,
          src: placeholder.getAttribute('data-src')
        })
        if (entry.isIntersecting) {
          this.active.add(placeholder)
          this.ensure_poster(placeholder)
          this.ensure_interaction(placeholder)
        } else {
          // Scroll-out wins over any hover/focus/selection state.
          this.active.delete(placeholder)
          this.release_video(placeholder)
          this.cancel_interaction(placeholder)
        }
      }
      this.refresh_playback()
    }, { rootMargin: '0px' })

    this.refresh_placeholders()
  }

  /** Reconcile observer targets after a virtualized catalog mounts or removes rows. */
  public refresh_placeholders (): void {
    if (this.container === null || this.observer === null || this.disposing) return
    const current = new Set(this.container.querySelectorAll<HTMLElement>('.anim-preview-placeholder'))

    for (const placeholder of this.observed_placeholders) {
      if (current.has(placeholder)) continue
      this.observer.unobserve(placeholder)
      this.observed_placeholders.delete(placeholder)
      this.active.delete(placeholder)
      this.cancel_interaction(placeholder)
      this.release_video(placeholder)
      this.failed.delete(placeholder)
    }

    for (const placeholder of current) {
      // Virtualized items are mounted in a bounded visible/overscan window. Load
      // their tiny static posters at mount time instead of waiting for a native
      // IntersectionObserver delivery, which can be delayed or omitted while
      // WebKitGTK lays out the scrolling catalog. This does not create or play
      // video elements; playback remains interaction- and visibility-gated.
      this.ensure_poster(placeholder)
      if (this.observed_placeholders.has(placeholder)) continue
      this.observed_placeholders.add(placeholder)
      this.observer.observe(placeholder)
    }
    this.refresh_playback()
  }

  /**
   * Explicit selection bridge for lists that manage selection via classes rather
   * than a `data-selected` attribute (the Composer slot markers).
   */
  public set_selected (placeholder: HTMLElement, selected: boolean): void {
    const state = this.interactions.get(placeholder)
    if (state === undefined || this.disposing) {
      return
    }
    state.selected = selected
    this.refresh_playback()
  }

  /** Accessible explicit preview action; selection alone never requests playback. */
  public toggle_explicit_preview (placeholder: HTMLElement): boolean {
    const state = this.interactions.get(placeholder)
    if (state === undefined || this.disposing || !this.active.has(placeholder)) return false
    state.manually_requested = !state.manually_requested
    this.refresh_playback()
    return state.manually_requested
  }

  private ensure_interaction (placeholder: HTMLElement): TileInteraction {
    const existing = this.interactions.get(placeholder)
    if (existing !== undefined) {
      return existing
    }

    // The interactive card owns hover/focus. Selection updates metadata only;
    // it never requests playback.
    const tile = placeholder.closest<HTMLElement>('[data-selected], .anim-item, .composer-library-item') ?? placeholder
    const state: TileInteraction = {
      tile,
      hovered: false,
      focused: false,
      selected: false,
      manually_requested: false,
      hover_timer: null,
      end_timer: null,
      listeners: []
    }

    const add = (element: HTMLElement, type: string, listener: EventListener): void => {
      element.addEventListener(type, listener)
      state.listeners.push(() => { element.removeEventListener(type, listener) })
    }

    add(tile, 'pointerenter', (event: Event) => {
      if ((event as PointerEvent).pointerType !== 'touch') {
        this.set_hover(placeholder, true)
      }
    })
    add(tile, 'pointerleave', (event: Event) => {
      if ((event as PointerEvent).pointerType !== 'touch') {
        this.set_hover(placeholder, false)
      }
    })
    add(tile, 'focusin', () => { this.set_focus(placeholder, true) })
    add(tile, 'focusout', () => { this.set_focus(placeholder, false) })
    add(tile, 'change', () => {
      this.sync_selected(placeholder)
    })

    this.interactions.set(placeholder, state)
    this.sync_selected(placeholder)
    return state
  }

  private sync_selected (placeholder: HTMLElement): void {
    const state = this.interactions.get(placeholder)
    if (state === undefined) {
      return
    }
    state.selected = state.tile.getAttribute('data-selected') === 'true' ||
      state.tile.classList.contains('in-upper-slot') ||
      state.tile.classList.contains('in-lower-slot')
  }

  private set_hover (placeholder: HTMLElement, hovered: boolean): void {
    const state = this.interactions.get(placeholder)
    if (state === undefined || this.disposing) {
      return
    }
    state.hovered = hovered
    if (state.hover_timer !== null) {
      clearTimeout(state.hover_timer)
      state.hover_timer = null
    }
    if (hovered) {
      this.clear_end_timer(placeholder)
      if (this.active.has(placeholder)) {
        state.hover_timer = setTimeout(() => {
          state.hover_timer = null
          this.refresh_playback()
        }, this.hover_delay_ms)
      }
    } else {
      this.schedule_end(placeholder)
    }
    this.refresh_playback()
  }

  private set_focus (placeholder: HTMLElement, focused: boolean): void {
    const state = this.interactions.get(placeholder)
    if (state === undefined || this.disposing) {
      return
    }
    state.focused = focused
    if (focused) {
      this.clear_end_timer(placeholder)
    } else {
      this.schedule_end(placeholder)
    }
    this.refresh_playback()
  }

  private schedule_end (placeholder: HTMLElement): void {
    const state = this.interactions.get(placeholder)
    if (state === undefined || this.disposing) {
      return
    }
    if (state.end_timer !== null) {
      clearTimeout(state.end_timer)
    }
    state.end_timer = setTimeout(() => {
      state.end_timer = null
      this.refresh_playback()
    }, INTERACTION_END_DEBOUNCE_MS)
  }

  private clear_end_timer (placeholder: HTMLElement): void {
    const state = this.interactions.get(placeholder)
    if (state !== undefined && state.end_timer !== null) {
      clearTimeout(state.end_timer)
      state.end_timer = null
    }
  }

  private cancel_interaction (placeholder: HTMLElement): void {
    const state = this.interactions.get(placeholder)
    if (state === undefined) {
      return
    }
    if (state.hover_timer !== null) clearTimeout(state.hover_timer)
    if (state.end_timer !== null) clearTimeout(state.end_timer)
    // Listeners stay attached: a tile can scroll back into view and be hovered.
  }

  private is_eligible (placeholder: HTMLElement): boolean {
    const state = this.interactions.get(placeholder)
    if (state === undefined || !this.active.has(placeholder) || this.failed.has(placeholder)) {
      return false
    }
    if (state.manually_requested || state.focused || state.end_timer !== null) {
      return true
    }
    // Hover starts playback only after the configured delay, unless this tile
    // is already playing (re-hover during the end debounce must not flicker).
    if (state.hovered) {
      return this.playing.has(placeholder) || state.hover_timer === null
    }
    return false
  }

  private priority (placeholder: HTMLElement): number {
    const state = this.interactions.get(placeholder)
    if (state === undefined) {
      return 0
    }
    if (state.manually_requested) return 4
    if (state.focused) return 3
    if (state.selected) return 2
    return 1 // hovered
  }

  /** Single arbitration point: only eligible, visible tiles may hold a slot. */
  private refresh_playback (): void {
    if (this.disposing) {
      return
    }
    const ranked = [...this.active]
      .filter(placeholder => this.is_eligible(placeholder))
      .sort((left, right) => this.priority(right) - this.priority(left))

    const allowed = new Set(ranked.slice(0, this.max_active))
    for (const placeholder of [...this.playing]) {
      if (!allowed.has(placeholder) || !this.active.has(placeholder)) {
        this.release_video(placeholder)
      }
    }
    for (const placeholder of allowed) {
      const video = this.videos.get(placeholder)
      if (video !== undefined && video.paused) {
        // A tile that still holds a slot but was paused (e.g. browser-suspended)
        // resumes on the next interaction without replacing its source or node.
        this.safe_play(video, placeholder)
      } else {
        this.ensure_video(placeholder)
      }
    }
    this.log('schedule', {
      visible: this.active.size,
      eligible: ranked.length,
      playing: this.playing.size,
      fetches: this.in_flight_fetches
    })
  }

  private ensure_video (placeholder: HTMLElement): void {
    if (this.playing.has(placeholder) || this.videos.has(placeholder) || this.failed.has(placeholder)) {
      return
    }
    const src = placeholder.getAttribute('data-src')
    if (src === null || src === '') {
      return
    }

    const video = AnimationPreviewVideos.create_video()
    if (this.debug && this.probe_video === null) {
      this.probe_video = video
      this.probe_placeholder = placeholder
      this.probe_ids.set(video, this.probe_next_id++)
    }
    this.attach_media_listeners(video, placeholder, src)
    placeholder.appendChild(video)
    this.videos.set(placeholder, video)

    if (has_tauri_bridge() && this.use_asset_protocol_on_desktop) {
      this.enqueue_fetch(placeholder)
    } else {
      video.src = src
      this.log('source-direct', { src })
      this.safe_play(video, placeholder)
    }
  }

  /** Load only mounted/visible static posters from the embedded frontend dist. */
  private ensure_poster (placeholder: HTMLElement): void {
    const image = placeholder.querySelector<HTMLImageElement>('.anim-preview-poster')
    const poster_src = placeholder.getAttribute('data-poster-src')
    if (image === null || poster_src === null || image.dataset.requested === 'true') return
    image.dataset.requested = 'true'
    image.addEventListener('load', () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        placeholder.classList.remove('poster-unavailable')
        this.log('poster-decoded', { src: poster_src, width: image.naturalWidth, height: image.naturalHeight })
      } else {
        this.fail_poster(image, placeholder, poster_src, 'decoded with zero dimensions')
      }
    }, { once: true })
    image.addEventListener('error', () => {
      this.fail_poster(image, placeholder, poster_src, 'image load failed')
    }, { once: true })

    // Posters live in the frontend public directory (static/animpreviews) and
    // are embedded into the Tauri binary with the rest of the dist. A relative
    // URL therefore works in both the browser and the native app, without
    // depending on the OS resource directory or the allowlisted video command.
    image.src = new URL(poster_src, document.baseURI).href
  }

  private fail_poster (image: HTMLImageElement, placeholder: HTMLElement, src: string, reason: string): void {
    image.hidden = true
    placeholder.classList.add('poster-unavailable')
    this.log('poster-error', { src, reason })
  }

  private async load_asset_source (video: HTMLVideoElement, placeholder: HTMLElement, src: string, signal: AbortSignal): Promise<void> {
    try {
      const core = tauri_preview_core()
      if (core === null) {
        throw new Error('Tauri asset API unavailable')
      }
      const asset_key = src.replace(/^\.\.\/animpreviews\//, '')
      const file_path = await core.invoke('animation_preview_asset_path', { assetKey: asset_key })
      if (this.videos.get(placeholder) !== video) {
        return
      }
      if (typeof file_path !== 'string' || file_path.length === 0) {
        throw new Error('Tauri returned no preview resource path')
      }
      const asset_url = core.convertFileSrc(file_path)
      // WebKitGTK's GStreamer media source rejects the Tauri asset scheme for
      // some bundled MP4s (FormatError), although the same resource works as a
      // Blob. Fetch only the Rust-allowlisted resource, then give the media
      // pipeline a fully buffered, seekable blob URL.
      const response = await fetch(asset_url, { signal })
      if (!response.ok) {
        throw new Error(`Preview resource request failed (${response.status})`)
      }
      const data = await response.blob()
      if (this.videos.get(placeholder) !== video || this.disposing || signal.aborted) {
        return
      }
      if (data.size === 0) {
        throw new Error('Preview resource was empty')
      }
      const media_blob = data.type === 'video/mp4' ? data : new Blob([data], { type: 'video/mp4' })
      const blob_url = URL.createObjectURL(media_blob)
      this.blob_urls.set(video, blob_url)
      video.src = blob_url
      this.log('source-blob', { asset_key, asset_url, blob_size: media_blob.size })
      // Stale callback protection: the tile must still own this video and still
      // hold a scheduler slot before a fetched source is ever played.
      if (this.is_eligible(placeholder)) {
        this.safe_play(video, placeholder)
      }
    } catch (error) {
      if (this.videos.get(placeholder) !== video || this.disposing || signal.aborted) {
        return
      }
      this.log('asset-error', { src, error: String(error) })
      this.show_fallback(placeholder, src, String(error))
    }
  }

  /** Queue a bounded media transfer, serving higher-priority interactions first. */
  private enqueue_fetch (placeholder: HTMLElement): void {
    if (this.disposing || this.pending_fetches.has(placeholder)) {
      return
    }
    const src = placeholder.getAttribute('data-src')
    if (src === null || src === '') {
      return
    }
    this.pending_fetches.add(placeholder)
    const job: FetchJob = {
      placeholder,
      run: async (signal) => {
        const video = this.videos.get(placeholder)
        if (video === undefined || this.disposing) {
          return
        }
        await this.load_asset_source(video, placeholder, src, signal)
      }
    }
    const insert_at = this.fetch_queue.findIndex(other => this.priority(other.placeholder) < this.priority(placeholder))
    if (insert_at >= 0) {
      this.fetch_queue.splice(insert_at, 0, job)
    } else {
      this.fetch_queue.push(job)
    }
    this.pump_fetches()
  }

  private pump_fetches (): void {
    while (!this.disposing && this.in_flight_fetches < this.max_concurrent_fetches && this.fetch_queue.length > 0) {
      const job = this.fetch_queue.shift() as FetchJob
      const controller = new AbortController()
      this.fetch_controllers.set(job.placeholder, controller)
      this.in_flight_fetches += 1
      void job.run(controller.signal).finally(() => {
        // A cancelled job may settle late (or never, with a non-compliant
        // transport). Only the controller still registered here owns a slot.
        if (this.fetch_controllers.get(job.placeholder) !== controller) {
          return
        }
        this.in_flight_fetches -= 1
        this.fetch_controllers.delete(job.placeholder)
        this.pending_fetches.delete(job.placeholder)
        this.pump_fetches()
      })
    }
  }

  private abort_fetch (placeholder: HTMLElement): void {
    const controller = this.fetch_controllers.get(placeholder)
    if (controller !== undefined) {
      // Release the slot immediately on cancellation instead of waiting for a
      // possibly never-settling transport promise to reach its finally block.
      controller.abort()
      this.fetch_controllers.delete(placeholder)
      this.pending_fetches.delete(placeholder)
      this.in_flight_fetches = Math.max(0, this.in_flight_fetches - 1)
      this.pump_fetches()
    }
    const index = this.fetch_queue.findIndex(job => job.placeholder === placeholder)
    if (index >= 0) {
      this.fetch_queue.splice(index, 1)
      this.pending_fetches.delete(placeholder)
    }
  }

  private attach_media_listeners (video: HTMLVideoElement, placeholder: HTMLElement, src: string): void {
    // The error listener is functional, not diagnostic: it must exist in every mode.
    video.addEventListener('error', () => {
      // Ignore errors raised by teardown or by a stale async source callback.
      if (this.disposing || this.videos.get(placeholder) !== video) {
        return
      }
      this.log('media-event', {
        name: 'error',
        src,
        currentSrc: video.currentSrc,
        readyState: video.readyState,
        networkState: video.networkState,
        error: video.error == null ? null : { code: video.error.code, message: video.error.message }
      })
      this.retry_or_fallback(placeholder, video, src, 'media error')
    })

    if (!this.debug) {
      return
    }
    const events = [
      'loadedmetadata', 'canplay', 'canplaythrough', 'playing', 'play',
      'waiting', 'stalled', 'abort', 'emptied', 'suspend'
    ] as const
    for (const name of events) {
      video.addEventListener(name, () => {
        this.log('media-event', {
          name,
          src,
          currentSrc: video.currentSrc,
          readyState: video.readyState,
          networkState: video.networkState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          error: video.error == null ? null : { code: video.error.code, message: video.error.message }
        })
      })
    }
    this.log('canPlayType', {
      src,
      mp4: video.canPlayType('video/mp4'),
      avc1: video.canPlayType('video/mp4; codecs="avc1.42E01E"')
    })
    if (video === this.probe_video) {
      this.start_probe(video, src)
    }
  }

  /**
   * Bounded frame-progress telemetry for one representative tile. Uses
   * requestVideoFrameCallback where available and timeupdate otherwise;
   * logs at most one sample per 250 ms and only in preview debug mode.
   */
  private start_probe (video: HTMLVideoElement, src: string): void {
    const with_frame_callback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }
    if (typeof with_frame_callback.requestVideoFrameCallback === 'function') {
      const step = (_now: number, metadata: { mediaTime: number }): void => {
        if (this.disposing || this.videos.get(this.probe_placeholder as HTMLElement) !== video) {
          return
        }
        this.sample_probe(video, metadata.mediaTime, src)
        this.probe_frame_handle = with_frame_callback.requestVideoFrameCallback?.(step) ?? null
      }
      this.probe_frame_handle = with_frame_callback.requestVideoFrameCallback(step)
      return
    }
    video.addEventListener('timeupdate', () => { this.sample_probe(video, video.currentTime, src) })
  }

  private sample_probe (video: HTMLVideoElement, time: number, src: string): void {
    const now = Date.now()
    if (now - this.probe_last_log < 250) {
      return
    }
    const looped = time < this.probe_last_time - 0.1
    this.probe_last_log = now
    this.probe_last_time = time
    this.log(looped ? 'loop-boundary' : 'frame-progress', {
      probeId: this.probe_ids.get(video),
      src,
      currentTime: Number(time.toFixed(3)),
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight
    })
  }

  private safe_play (video: HTMLVideoElement, placeholder: HTMLElement): void {
    // The single play() call site. Repeated scheduler passes and stale async
    // callbacks must never re-issue play() on an already-running video.
    if (this.disposing || !video.hasAttribute('src') || (!video.paused && !video.ended)) {
      return
    }
    if (!this.is_eligible(placeholder) || this.videos.get(placeholder) !== video) {
      return
    }
    this.playing.add(placeholder)
    try {
      const result = video.play()
      if (result !== undefined && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch((error: unknown) => {
          const source = placeholder.getAttribute('data-src') ?? ''
          this.playing.delete(placeholder)
          this.log('play-rejected', { src: source, error: String(error) })
          this.retry_or_fallback(placeholder, video, source, String(error))
        })
      }
    } catch (error) {
      const source = placeholder.getAttribute('data-src') ?? ''
      this.playing.delete(placeholder)
      this.log('play-threw', { src: source, error: String(error) })
      this.retry_or_fallback(placeholder, video, source, String(error))
    }
  }

  /** Bounded retry with linear backoff; falls back only after MAX_PLAYBACK_ATTEMPTS. */
  private retry_or_fallback (placeholder: HTMLElement, video: HTMLVideoElement, src: string, reason: string): void {
    if (this.disposing || this.videos.get(placeholder) !== video) {
      return
    }
    const attempt = (this.playback_attempts.get(placeholder) ?? 0) + 1
    this.playback_attempts.set(placeholder, attempt)
    if (attempt >= MAX_PLAYBACK_ATTEMPTS) {
      this.log('retry-exhausted', { src, attempt, reason })
      this.show_fallback(placeholder, src, reason)
      return
    }
    this.clear_retry_timer(placeholder)
    const delay = RETRY_BASE_DELAY_MS * attempt
    this.log('retry-scheduled', { src, attempt, delay, reason })
    const timer = setTimeout(() => {
      this.retry_timers.delete(placeholder)
      if (this.disposing || this.videos.get(placeholder) !== video || !this.is_eligible(placeholder)) {
        return
      }
      this.safe_play(video, placeholder)
    }, delay)
    this.retry_timers.set(placeholder, timer)
  }

  private clear_retry_timer (placeholder: HTMLElement): void {
    const timer = this.retry_timers.get(placeholder)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.retry_timers.delete(placeholder)
    }
  }

  private show_fallback (placeholder: HTMLElement, src: string, reason: string): void {
    if (placeholder.querySelector('.preview-fallback') !== null) {
      return
    }
    this.failed.add(placeholder)
    this.playing.delete(placeholder)
    this.clear_retry_timer(placeholder)
    this.abort_fetch(placeholder)
    this.cancel_interaction(placeholder)
    this.log('fallback', { src, reason })
    placeholder.classList.add('preview-failed')
    // Inline poster background would otherwise outrank the fallback CSS.
    placeholder.style.removeProperty('background-image')
    const fallback = document.createElement('span')
    fallback.className = 'preview-fallback'
    fallback.textContent = 'Preview unavailable'
    fallback.setAttribute('title', `Preview unavailable: ${reason}`)
    placeholder.replaceChildren(fallback)
    this.release_video(placeholder)
  }

  /** Pause and release owned media for a tile that no longer holds a slot. */
  private release_video (placeholder: HTMLElement): void {
    this.playing.delete(placeholder)
    this.clear_retry_timer(placeholder)
    this.abort_fetch(placeholder)
    this.playback_attempts.delete(placeholder)
    const video = this.videos.get(placeholder)
    if (video !== undefined) {
      // Drop the stale reference before removing src so any synchronous media
      // event cannot insert a fallback into a tile we no longer own.
      this.videos.delete(placeholder)
      video.pause()
      // Do not call load(): it fires media events that could insert a fallback.
      video.removeAttribute('src')
      video.remove()
      this.revoke_blob_url(video)
    }
  }

  private revoke_blob_url (video: HTMLVideoElement): void {
    const blob_url = this.blob_urls.get(video)
    if (blob_url !== undefined) {
      URL.revokeObjectURL(blob_url)
      this.blob_urls.delete(video)
    }
  }

  /** Stop observing, cancel every pending operation and release all owned resources. */
  public disconnect (): void {
    this.disposing = true
    this.observer?.disconnect()
    this.observer = null
    this.observed_placeholders.clear()
    for (const [placeholder, state] of this.interactions) {
      if (state.hover_timer !== null) clearTimeout(state.hover_timer)
      if (state.end_timer !== null) clearTimeout(state.end_timer)
      for (const remove of state.listeners) remove()
      this.release_video(placeholder)
      state.listeners.length = 0
    }
    this.interactions.clear()
    for (const placeholder of [...this.retry_timers.keys()]) {
      this.clear_retry_timer(placeholder)
    }
    for (const controller of this.fetch_controllers.values()) {
      controller.abort()
    }
    this.fetch_controllers.clear()
    this.fetch_queue.length = 0
    this.pending_fetches.clear()
    this.playback_attempts.clear()
    this.failed.clear()
    this.playing.clear()
    this.active.clear()
    if (this.probe_frame_handle !== null) {
      const with_frame_callback = this.probe_video as (HTMLVideoElement & { cancelVideoFrameCallback?: (handle: number) => void }) | null
      with_frame_callback?.cancelVideoFrameCallback?.(this.probe_frame_handle)
      this.probe_frame_handle = null
    }
    for (const video of this.videos.values()) {
      this.revoke_blob_url(video)
    }
    this.videos.clear()
    this.probe_video = null
    this.probe_placeholder = null
    this.container = null
    this.disposing = false
  }
}
