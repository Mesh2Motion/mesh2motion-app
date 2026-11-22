import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnimationLoopController, type FrameCanceller, type FrameScheduler } from './AnimationLoopController.ts'

let pending: Map<number, FrameRequestCallback>
let next_id: number
let request: FrameScheduler
let cancel: FrameCanceller
let tick: (delta_time: number) => void
let clock: number

beforeEach(() => {
  pending = new Map()
  next_id = 1
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  request = vi.fn((callback: FrameRequestCallback) => {
    const id = next_id++
    pending.set(id, callback)
    return id
  }) as unknown as FrameScheduler
  cancel = vi.fn((id: number) => {
    pending.delete(id)
  }) as unknown as FrameCanceller
  tick = vi.fn() as unknown as (delta_time: number) => void
})

function run_frame (time: number): void {
  clock = time
  const [id, callback] = [...pending.entries()][0] ?? []
  if (id !== undefined && callback !== undefined) {
    pending.delete(id)
    callback(time)
  }
}

describe('AnimationLoopController', () => {
  it('starts exactly one loop and advances on frames', () => {
    const loop = new AnimationLoopController(request, cancel, tick)
    loop.start()
    expect(request).toHaveBeenCalledTimes(1)

    run_frame(16)
    expect(tick).toHaveBeenCalledWith(0.016)
    expect(request).toHaveBeenCalledTimes(2)
    expect(pending.size).toBe(1)
    loop.dispose()
  })

  it('does not create a second loop on repeated start', () => {
    const loop = new AnimationLoopController(request, cancel, tick)
    loop.start()
    loop.start()
    loop.start()
    expect(request).toHaveBeenCalledTimes(1)
    run_frame(16)
    expect(request).toHaveBeenCalledTimes(2)
    loop.dispose()
  })

  it('stops cleanly and can be restarted', () => {
    const loop = new AnimationLoopController(request, cancel, tick)
    loop.start()
    loop.stop()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(pending.size).toBe(0)
    expect(loop.is_running()).toBe(false)

    loop.start()
    expect(request).toHaveBeenCalledTimes(2)
    expect(loop.is_running()).toBe(true)
    run_frame(32)
    expect(tick).toHaveBeenCalledTimes(1)
    loop.dispose()
  })

  it('never reschedules after disposal, even from a pending callback', () => {
    const loop = new AnimationLoopController(request, cancel, tick)
    loop.start()
    const callback = [...pending.values()][0]
    loop.dispose()
    callback?.(16)
    expect(request).toHaveBeenCalledTimes(1)
    expect(tick).not.toHaveBeenCalled()

    loop.start()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('supports component recreation with a fresh controller', () => {
    const first = new AnimationLoopController(request, cancel, tick)
    first.start()
    first.dispose()

    const second = new AnimationLoopController(request, cancel, tick)
    second.start()
    expect(request).toHaveBeenCalledTimes(2)
    run_frame(48)
    expect(tick).toHaveBeenCalledTimes(1)
    second.dispose()
  })
})
