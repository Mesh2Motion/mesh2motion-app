/**
 * Sizes the WebGL renderer against its real viewport container.
 *
 * Replaces the old window.innerWidth/innerHeight listener. A ResizeObserver
 * tracks the container (which also covers snapped/tiled KDE windows), the
 * camera aspect and drawing buffer are updated together, and device pixel
 * ratio is capped to avoid excessive render resolution on HiDPI displays.
 * Only one observer and one DPR watcher are ever active per instance.
 */

import { Vector2, type PerspectiveCamera, type WebGLRenderer } from 'three'

export const MAX_PIXEL_RATIO = 2

export class ViewportManager {
  private observer: ResizeObserver | null = null
  private dpr_query: MediaQueryList | null = null
  private disposed = false

  constructor (
    private readonly renderer: WebGLRenderer,
    private readonly camera: PerspectiveCamera,
    private readonly container: HTMLElement
  ) {}

  public start (): void {
    if (this.disposed) {
      return
    }
    this.resize()
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { this.resize() })
      this.observer.observe(this.container)
    }
    // ResizeObserver covers container size changes; fullscreen transitions can
    // briefly report a zero-sized container, so also resync explicitly.
    document.addEventListener('fullscreenchange', this.on_fullscreen_change)
    document.addEventListener('webkitfullscreenchange', this.on_fullscreen_change)
    this.watch_pixel_ratio()
  }

  private on_fullscreen_change = (): void => {
    this.resize()
  }

  private on_pixel_ratio_change = (): void => {
    this.watch_pixel_ratio()
    this.resize()
  }

  private watch_pixel_ratio (): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    if (this.dpr_query !== null && typeof this.dpr_query.removeEventListener === 'function') {
      this.dpr_query.removeEventListener('change', this.on_pixel_ratio_change)
    }
    const ratio = window.devicePixelRatio || 1
    this.dpr_query = window.matchMedia(`(resolution: ${ratio}dppx)`)
    if (typeof this.dpr_query.addEventListener === 'function') {
      this.dpr_query.addEventListener('change', this.on_pixel_ratio_change)
    }
  }

  public resize (): void {
    if (this.disposed) {
      return
    }
    // Guard on the raw measurement: clamping to 1 first made this branch
    // unreachable and produced a bogus 1x1 render during fullscreen/tiling.
    const raw_width = this.container.clientWidth
    const raw_height = this.container.clientHeight
    if (raw_width <= 0 || raw_height <= 0) {
      return
    }
    const width = Math.max(1, Math.floor(raw_width))
    const height = Math.max(1, Math.floor(raw_height))

    const pixel_ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), MAX_PIXEL_RATIO)
    // Avoid redundant work on repeated resize events during animation playback.
    if (this.renderer.getPixelRatio() !== pixel_ratio) {
      this.renderer.setPixelRatio(pixel_ratio)
    }
    const size = this.renderer.getSize(new Vector2())
    if (size.width !== width || size.height !== height) {
      // false = do not overwrite CSS sizing; the container owns layout size.
      this.renderer.setSize(width, height, false)
      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
    }
  }

  public dispose (): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.observer?.disconnect()
    this.observer = null
    document.removeEventListener('fullscreenchange', this.on_fullscreen_change)
    document.removeEventListener('webkitfullscreenchange', this.on_fullscreen_change)
    if (this.dpr_query !== null && typeof this.dpr_query.removeEventListener === 'function') {
      this.dpr_query.removeEventListener('change', this.on_pixel_ratio_change)
    }
    this.dpr_query = null
  }
}
