import { describe, expect, it, vi } from 'vitest'
import { RenderLoopGuard } from './RenderLoopGuard.ts'
import { RenderLoopRecovery, RenderLoopScheduler } from './RenderLoopRecovery.ts'

/** Test harness that records rAF requests and can run the pending frame. */
function create_harness (max_failures = 3) {
  const guard = new RenderLoopGuard(max_failures)
  let request_count = 0
  let pending: (() => void) | null = null

  // Mimics Mesh2MotionEngine.animate(): re-arm only while the guard allows it.
  const frame_callback = vi.fn(() => {
    if (!guard.is_stopped()) {
      scheduler.schedule_next()
    }
  })
  const scheduler = new RenderLoopScheduler((callback) => {
    request_count += 1
    pending = callback
    return request_count
  }, frame_callback)
  const recovery = new RenderLoopRecovery(guard, scheduler)

  return {
    guard,
    scheduler,
    recovery,
    frame_callback,
    get request_count (): number { return request_count },
    run_pending_frame (): void {
      const callback = pending
      pending = null
      callback?.()
    }
  }
}

describe('RenderLoopScheduler', () => {
  it('never requests a second frame while one is pending', () => {
    const h = create_harness()

    expect(h.scheduler.schedule_next()).toBe(true)
    expect(h.scheduler.schedule_next()).toBe(false)
    expect(h.scheduler.resume()).toBe(false)
    expect(h.request_count).toBe(1)
  })

  it('runs exactly one frame per request', () => {
    const h = create_harness()

    h.scheduler.schedule_next()
    h.run_pending_frame()
    expect(h.frame_callback).toHaveBeenCalledTimes(1)
    expect(h.request_count).toBe(2) // engine-style successor
    expect(h.scheduler.is_pending()).toBe(true)
  })
})

describe('RenderLoopRecovery', () => {
  it('tracks context loss and clears it on restore', () => {
    const h = create_harness()
    const on_lost = vi.fn()
    const recovery = new RenderLoopRecovery(h.guard, h.scheduler, on_lost)

    recovery.on_context_lost()
    expect(recovery.is_context_lost()).toBe(true)
    expect(on_lost).toHaveBeenCalledOnce()

    recovery.on_context_restored()
    expect(recovery.is_context_lost()).toBe(false)
  })

  it('regression: restarts one loop after guard stop + context restore', () => {
    const h = create_harness(1)

    // Normal running loop, then a render failure trips the guard.
    h.scheduler.schedule_next()
    expect(h.request_count).toBe(1)
    h.guard.note_failure()
    h.run_pending_frame() // pending frame observes stopped guard and does not re-arm
    expect(h.scheduler.is_pending()).toBe(false)

    // The already-pending frame ran; on restore the loop must come back.
    h.recovery.on_context_restored()
    expect(h.guard.is_stopped()).toBe(false)
    expect(h.request_count).toBe(2)
    expect(h.scheduler.is_pending()).toBe(true)

    // Repeated restore events must not add concurrent rAF chains.
    h.recovery.on_context_restored()
    h.recovery.on_context_restored()
    expect(h.request_count).toBe(2)

    // The single resumed frame re-arms exactly one successor.
    h.run_pending_frame()
    expect(h.request_count).toBe(3)
    expect(h.scheduler.is_pending()).toBe(true)
  })
})
