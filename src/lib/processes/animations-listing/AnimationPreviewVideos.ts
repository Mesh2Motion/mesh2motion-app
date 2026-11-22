import { type SkeletonType } from '../../enums/SkeletonType'
import { RigConfig } from '../../RigConfig'

/**
 * Looping MP4 previews for library animations. Lists can hold hundreds of animations and only so many
 * videos can play at once, so placeholders are only turned into videos once they scroll into view.
 *
 * Native WebKitGTK issues byte-range requests for short looping MP4s. Tauri's embedded `tauri://`
 * protocol answers those with a full 200 body (no 206/Accept-Ranges), which can leave the media
 * pipeline unable to present frames. Desktop builds resolve bundled resources through Tauri's
 * range-capable `asset://` protocol; browser builds keep the original direct URL behavior.
 * Diagnostics are opt-in with `?m2m-preview-debug=1` or localStorage `m2m-preview-debug=1`.
 */

const DEBUG_QUERY_PARAM = 'm2m-preview-debug'
const DEBUG_STORAGE_KEY = 'm2m-preview-debug'
const DEFAULT_MAX_ACTIVE_VIDEOS = 12

export interface PreviewVideoOptions {
  /** Maximum number of concurrently playing preview videos. */
  max_active_videos?: number
  /** Use the range-capable Tauri asset protocol for bundled media on desktop builds. */
  use_asset_protocol_on_desktop?: boolean
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
  private readonly active = new Set<HTMLElement>()
  private readonly videos = new Map<HTMLElement, HTMLVideoElement>()
  private readonly blob_urls = new Map<HTMLVideoElement, string>()
  private readonly debug: boolean
  private readonly max_active: number
  private readonly use_asset_protocol_on_desktop: boolean
  private disposing = false
  private probe_video: HTMLVideoElement | null = null
  private probe_placeholder: HTMLElement | null = null
  private probe_last_log = 0
  private probe_last_time = 0
  private probe_frame_handle: number | null = null
  private readonly probe_ids = new WeakMap<HTMLVideoElement, number>()
  private probe_next_id = 1

  constructor (options: PreviewVideoOptions = {}) {
    this.debug = diagnostics_enabled()
    this.max_active = options.max_active_videos ?? DEFAULT_MAX_ACTIVE_VIDEOS
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

  /** Create an empty video element; source and listeners are attached by the loader. */
  static create_video (src?: string, width: number = 100, height: number = 120): HTMLVideoElement {
    const video = document.createElement('video')
    video.className = 'anim-preview'
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

  /** Watch placeholders and swap in videos only while they are near the viewport. */
  public observe_placeholders (container: HTMLElement): void {
    this.disconnect()
    this.container = container

    if (typeof IntersectionObserver === 'undefined') {
      // Without an observer, create nothing rather than loading hundreds of videos.
      this.log('observer-unavailable', {})
      return
    }

    this.observer = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        const placeholder = entry.target as HTMLElement
        this.log('intersection', {
          visible: entry.isIntersecting,
          src: placeholder.getAttribute('data-src'),
          boundingClientRect: {
            width: entry.boundingClientRect.width,
            height: entry.boundingClientRect.height
          }
        })
        if (entry.isIntersecting) {
          this.active.add(placeholder)
          this.ensure_video(placeholder)
        } else {
          this.active.delete(placeholder)
          this.pause_video(placeholder)
        }
      }
      this.enforce_limit()
    }, { rootMargin: '300px' })

    container.querySelectorAll<HTMLElement>('.anim-preview-placeholder').forEach((placeholder) => {
      this.observer?.observe(placeholder)
    })
  }

  private ensure_video (placeholder: HTMLElement): void {
    const existing = this.videos.get(placeholder)
    if (existing !== undefined) {
      // A second IntersectionObserver notification can arrive while the
      // resource-path command is still resolving. Do not call play() on a
      // source-less element; WebKit may reject it and replace the tile.
      if (existing.hasAttribute('src')) {
        this.safe_play(existing, placeholder)
      }
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
    placeholder.replaceChildren(video)
    this.videos.set(placeholder, video)

    if (has_tauri_bridge() && this.use_asset_protocol_on_desktop) {
      void this.load_asset_source(video, placeholder, src)
    } else {
      video.src = src
      this.log('source-direct', { src })
      this.safe_play(video, placeholder)
    }
  }

  private async load_asset_source (video: HTMLVideoElement, placeholder: HTMLElement, src: string): Promise<void> {
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
      const response = await fetch(asset_url)
      if (!response.ok) {
        throw new Error(`Preview resource request failed (${response.status})`)
      }
      const data = await response.blob()
      if (this.videos.get(placeholder) !== video || this.disposing) {
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
      if (this.active.has(placeholder)) {
        this.safe_play(video, placeholder)
      }
    } catch (error) {
      if (this.videos.get(placeholder) !== video) {
        return
      }
      this.log('asset-error', { src, error: String(error) })
      this.show_fallback(placeholder, src, String(error))
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
      this.show_fallback(placeholder, src, 'media error')
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
    // Repeated observer notifications must not re-issue play() on an already
    // running video; WebKit can treat that as a seek/restart.
    if (this.disposing || !video.hasAttribute('src') || (!video.paused && !video.ended)) {
      return
    }
    try {
      const result = video.play()
      if (result !== undefined && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch((error: unknown) => {
          this.log('play-rejected', { src: placeholder.getAttribute('data-src'), error: String(error) })
          this.show_fallback(placeholder, placeholder.getAttribute('data-src') ?? '', String(error))
        })
      }
    } catch (error) {
      this.log('play-threw', { src: placeholder.getAttribute('data-src'), error: String(error) })
      this.show_fallback(placeholder, placeholder.getAttribute('data-src') ?? '', String(error))
    }
  }

  private show_fallback (placeholder: HTMLElement, src: string, reason: string): void {
    if (placeholder.querySelector('.preview-fallback') !== null) {
      return
    }
    this.log('fallback', { src, reason })
    placeholder.classList.add('preview-failed')
    const fallback = document.createElement('span')
    fallback.className = 'preview-fallback'
    fallback.textContent = 'Preview unavailable'
    fallback.setAttribute('title', `Preview unavailable: ${reason}`)
    placeholder.replaceChildren(fallback)
    const video = this.videos.get(placeholder)
    if (video !== undefined) {
      video.pause()
      video.removeAttribute('src')
      video.remove()
      this.revoke_blob_url(video)
      this.videos.delete(placeholder)
    }
    this.active.delete(placeholder)
  }

  private pause_video (placeholder: HTMLElement): void {
    const video = this.videos.get(placeholder)
    if (video !== undefined) {
      video.pause()
      this.log('paused-offscreen', { src: placeholder.getAttribute('data-src') })
    }
  }

  private revoke_blob_url (video: HTMLVideoElement): void {
    const blob_url = this.blob_urls.get(video)
    if (blob_url !== undefined) {
      URL.revokeObjectURL(blob_url)
      this.blob_urls.delete(video)
    }
  }

  private enforce_limit (): void {
    const viewport_height = window.innerHeight || document.documentElement.clientHeight
    const viewport_width = window.innerWidth || document.documentElement.clientWidth
    const ranked = [...this.active].map((placeholder) => {
      const rect = placeholder.getBoundingClientRect()
      const visible = rect.bottom > 0 && rect.top < viewport_height && rect.right > 0 && rect.left < viewport_width
      const vertical_distance = Math.max(0, -rect.bottom, rect.top - viewport_height)
      const horizontal_distance = Math.max(0, -rect.right, rect.left - viewport_width)
      return { placeholder, visible, distance: Math.hypot(vertical_distance, horizontal_distance) }
    }).sort((left, right) => Number(right.visible) - Number(left.visible) || left.distance - right.distance)

    for (const { placeholder } of ranked.slice(this.max_active)) {
      this.pause_video(placeholder)
      this.active.delete(placeholder)
    }
  }

  /** Stop observing, pause every video and release all video nodes. */
  public disconnect (): void {
    this.disposing = true
    this.observer?.disconnect()
    this.observer = null
    for (const placeholder of [...this.active]) {
      this.pause_video(placeholder)
    }
    this.active.clear()
    if (this.probe_frame_handle !== null) {
      const with_frame_callback = this.probe_video as (HTMLVideoElement & { cancelVideoFrameCallback?: (handle: number) => void }) | null
      with_frame_callback?.cancelVideoFrameCallback?.(this.probe_frame_handle)
      this.probe_frame_handle = null
    }
    for (const [placeholder, video] of this.videos) {
      video.pause()
      // Do not call load() during teardown: it fires media events that could
      // otherwise insert a fallback into a placeholder being removed.
      video.removeAttribute('src')
      video.remove()
      this.revoke_blob_url(video)
      this.videos.delete(placeholder)
    }
    this.videos.clear()
    this.probe_video = null
    this.probe_placeholder = null
    this.container = null
    this.disposing = false
  }
}
