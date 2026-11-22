/**
 * Render-loop scheduling and context-restore recovery.
 *
 * Kept separate from Mesh2MotionEngine so the recovery path can be unit
 * tested without a real WebGL context. The scheduler guarantees that at most
 * one animation frame is pending at any time; `resume()` never starts a second
 * chain if a frame is already scheduled.
 */

import { RenderLoopGuard } from './RenderLoopGuard.ts'

export type FrameRequest = (callback: () => void) => number
export type FrameCallback = () => void

export class RenderLoopScheduler {
  private pending_handle: number | null = null

  constructor (
    private readonly request_frame: FrameRequest,
    private readonly frame_callback: FrameCallback
  ) {}

  /**
   * Schedule the next frame if none is pending.
   * Returns true when a new frame was actually requested.
   */
  public schedule_next (): boolean {
    if (this.pending_handle !== null) {
      return false
    }
    this.pending_handle = this.request_frame(() => {
      // The scheduled callback is executing; allow exactly one successor.
      this.pending_handle = null
      this.frame_callback()
    })
    return true
  }

  /** Resume after a stopped loop. No-op when a frame is already pending. */
  public resume (): boolean {
    return this.schedule_next()
  }

  public is_pending (): boolean {
    return this.pending_handle !== null
  }
}

/**
 * Owns the WebGL context-loss flag and re-enters the render loop when the
 * context is restored, including after RenderLoopGuard stopped it.
 */
export class RenderLoopRecovery {
  private context_lost = false

  constructor (
    private readonly guard: RenderLoopGuard,
    private readonly scheduler: RenderLoopScheduler,
    private readonly on_lost?: () => void
  ) {}

  public on_context_lost (): void {
    this.context_lost = true
    this.on_lost?.()
  }

  public on_context_restored (): void {
    this.context_lost = false
    this.guard.reset()
    this.scheduler.resume()
  }

  public is_context_lost (): boolean {
    return this.context_lost
  }
}
