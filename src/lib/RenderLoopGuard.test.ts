import { describe, expect, it } from 'vitest'
import { RenderLoopGuard } from './RenderLoopGuard.ts'

describe('RenderLoopGuard', () => {
  it('does not stop before the configured number of consecutive failures', () => {
    const guard = new RenderLoopGuard(3)

    expect(guard.note_failure()).toBe(false)
    expect(guard.note_failure()).toBe(false)
    expect(guard.failure_count()).toBe(2)
    expect(guard.is_stopped()).toBe(false)
  })

  it('stops the loop on the third consecutive failure and stays stopped', () => {
    const guard = new RenderLoopGuard(3)

    guard.note_failure()
    guard.note_failure()
    expect(guard.note_failure()).toBe(true)
    expect(guard.is_stopped()).toBe(true)
    expect(guard.note_failure()).toBe(true)
  })

  it('resets the counter on a successful frame', () => {
    const guard = new RenderLoopGuard(3)

    guard.note_failure()
    guard.note_failure()
    guard.note_success()
    expect(guard.failure_count()).toBe(0)

    expect(guard.note_failure()).toBe(false)
    expect(guard.is_stopped()).toBe(false)
  })

  it('can be reset after a context restore', () => {
    const guard = new RenderLoopGuard(2)

    guard.note_failure()
    guard.note_failure()
    expect(guard.is_stopped()).toBe(true)

    guard.reset()
    expect(guard.is_stopped()).toBe(false)
    expect(guard.failure_count()).toBe(0)
    expect(guard.note_failure()).toBe(false)
  })
})
