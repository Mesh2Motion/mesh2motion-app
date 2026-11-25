/**
 * Owned requestAnimationFrame loop with explicit start/stop/dispose.
 *
 * Replaces inline, un-cancellable rAF loops. Only one frame is ever pending per
 * controller; stop() cancels it and dispose() makes subsequent starts no-ops.
 */

export type FrameScheduler = (callback: FrameRequestCallback) => number
export type FrameCanceller = (handle: number) => void

export class AnimationLoopController {
  private handle: number | null = null
  private running = false
  private disposed = false

  constructor (
    private readonly request_frame: FrameScheduler,
    private readonly cancel_frame: FrameCanceller,
    private readonly tick: (delta_time: number) => void
  ) {}

  public start (): void {
    if (this.disposed || this.running) {
      return
    }
    this.running = true
    let last_time = performance.now()
    const frame = (now: number): void => {
      if (this.disposed || !this.running) {
        return
      }
      this.handle = this.request_frame(frame)
      const delta_time = (now - last_time) / 1000
      last_time = now
      this.tick(delta_time)
    }
    this.handle = this.request_frame(frame)
  }

  public stop (): void {
    this.running = false
    if (this.handle !== null) {
      this.cancel_frame(this.handle)
      this.handle = null
    }
  }

  public dispose (): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.stop()
  }

  public is_running (): boolean {
    return this.running && !this.disposed
  }
}
