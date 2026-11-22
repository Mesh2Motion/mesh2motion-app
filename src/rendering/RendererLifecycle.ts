import type { PerspectiveCamera, WebGLRenderer } from 'three'
import { ViewportController } from './ViewportController.ts'
import { create_webgl_renderer, install_webgl_context_handlers } from '../lib/WebGLStartup.ts'

export type FrameRequest = (callback: () => void) => number
export type FrameCancel = (handle: number) => void
export type FrameCallback = () => void

/** Bounded failure counter for the one engine render loop. */
export class RenderLoopGuard {
  private consecutive_failures = 0
  private stopped = false

  constructor (private readonly max_failures: number = 3) {}

  public note_success (): void {
    this.consecutive_failures = 0
  }

  public note_failure (): boolean {
    if (this.stopped) return true
    this.consecutive_failures += 1
    if (this.consecutive_failures >= this.max_failures) this.stopped = true
    return this.stopped
  }

  public is_stopped (): boolean { return this.stopped }
  public failure_count (): number { return this.consecutive_failures }
  public reset (): void { this.consecutive_failures = 0; this.stopped = false }
}

/** Owns at most one pending animation frame and cancels it on disposal. */
export class RenderLoopScheduler {
  private pending_handle: number | null = null
  private disposed = false

  constructor (
    private readonly request_frame: FrameRequest,
    private readonly frame_callback: FrameCallback,
    private readonly cancel_frame: FrameCancel = handle => cancelAnimationFrame(handle)
  ) {}

  public schedule_next (): boolean {
    if (this.disposed || this.pending_handle !== null) return false
    this.pending_handle = this.request_frame(() => {
      this.pending_handle = null
      if (!this.disposed) this.frame_callback()
    })
    return true
  }

  public resume (): boolean { return this.schedule_next() }
  public is_pending (): boolean { return this.pending_handle !== null }

  public cancel_pending (): void {
    if (this.pending_handle === null) return
    this.cancel_frame(this.pending_handle)
    this.pending_handle = null
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel_pending()
  }
}

/** Owns context-loss state and resumes the same render chain after restoration. */
export class RenderLoopRecovery {
  private context_lost = false

  constructor (
    private readonly guard: RenderLoopGuard,
    private readonly scheduler: RenderLoopScheduler,
    private readonly on_lost?: () => void
  ) {}

  public on_context_lost (): void { this.context_lost = true; this.on_lost?.() }
  public on_context_restored (): void { this.context_lost = false; this.guard.reset(); this.scheduler.resume() }
  public is_context_lost (): boolean { return this.context_lost }
}

/**
 * The renderer's single lifecycle owner: viewport sizing, WebGL context events,
 * frame scheduling, recovery and resource disposal.
 */
export class RendererLifecycle {
  private readonly viewport: ViewportController
  private readonly guard = new RenderLoopGuard()
  private readonly scheduler: RenderLoopScheduler
  private readonly recovery: RenderLoopRecovery
  private readonly remove_context_handlers: () => void
  private started = false
  private disposed = false

  public static create_renderer (): WebGLRenderer {
    return create_webgl_renderer()
  }

  constructor (
    private readonly renderer: WebGLRenderer,
    camera: PerspectiveCamera,
    container: HTMLElement,
    frame_callback: FrameCallback,
    on_context_lost?: () => void,
    request_frame: FrameRequest = callback => requestAnimationFrame(callback),
    cancel_frame: FrameCancel = handle => cancelAnimationFrame(handle)
  ) {
    if (renderer.domElement.parentElement !== container) container.append(renderer.domElement)
    this.viewport = new ViewportController(renderer, camera, container)
    this.scheduler = new RenderLoopScheduler(request_frame, frame_callback, cancel_frame)
    this.recovery = new RenderLoopRecovery(this.guard, this.scheduler, on_context_lost)
    this.remove_context_handlers = install_webgl_context_handlers(
      renderer.domElement,
      () => { this.recovery.on_context_lost() },
      () => { this.recovery.on_context_restored() }
    )
  }

  public start (): void {
    if (this.disposed || this.started) return
    this.started = true
    this.viewport.start()
    this.scheduler.resume()
  }

  public schedule_next (): void {
    if (!this.disposed && !this.guard.is_stopped()) this.scheduler.schedule_next()
  }

  public context_lost (): boolean { return this.recovery.is_context_lost() }
  public loop_stopped (): boolean { return this.guard.is_stopped() }
  public failure_count (): number { return this.guard.failure_count() }

  public note_frame_success (): void { this.guard.note_success() }

  public note_frame_failure (): boolean {
    const stopped = this.guard.note_failure()
    if (stopped) this.scheduler.cancel_pending()
    return stopped
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.scheduler.dispose()
    this.viewport.dispose()
    this.remove_context_handlers()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
