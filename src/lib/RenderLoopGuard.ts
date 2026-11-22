/**
 * Bounded failure counter for the animation loop.
 *
 * A render exception that repeats every frame previously kept rescheduling
 * requestAnimationFrame forever, producing a runaway loop and an unresponsive
 * UI. This guard stops the loop after a small number of consecutive failures
 * and resets on the first successful frame.
 */
export class RenderLoopGuard {
  private consecutive_failures = 0
  private stopped = false

  constructor (private readonly max_failures: number = 3) {}

  /** Record a successful frame. */
  public note_success (): void {
    this.consecutive_failures = 0
  }

  /** Record a failed frame. Returns true once the loop must be stopped. */
  public note_failure (): boolean {
    if (this.stopped) {
      return true
    }
    this.consecutive_failures += 1
    if (this.consecutive_failures >= this.max_failures) {
      this.stopped = true
    }
    return this.stopped
  }

  public is_stopped (): boolean {
    return this.stopped
  }

  public failure_count (): number {
    return this.consecutive_failures
  }

  /** Clear both the counter and the stopped state (e.g. after context restore). */
  public reset (): void {
    this.consecutive_failures = 0
    this.stopped = false
  }
}
