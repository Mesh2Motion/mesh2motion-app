import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RetargetAnimationPreview } from './RetargetAnimationPreview.ts'

let pending: Map<number, FrameRequestCallback>
let next_id: number
let request: ReturnType<typeof vi.fn>
let cancel: ReturnType<typeof vi.fn>

beforeEach(() => {
  pending = new Map()
  next_id = 1
  request = vi.fn((callback: FrameRequestCallback) => {
    const id = next_id++
    pending.set(id, callback)
    return id
  })
  cancel = vi.fn((id: number) => { pending.delete(id) })
  Object.defineProperty(globalThis, 'requestAnimationFrame', { value: request, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: cancel, configurable: true, writable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function make_preview (): RetargetAnimationPreview {
  const mapping = Object.assign(new EventTarget(), { has_both_skeletons: () => false })
  return new RetargetAnimationPreview(mapping as never)
}

describe('RetargetAnimationPreview loop lifecycle', () => {
  it('starts once on repeated begin() calls', () => {
    const preview = make_preview()
    preview.begin()
    preview.begin()
    expect(request).toHaveBeenCalledTimes(1)
    preview.dispose()
  })

  it('stops on stop_preview() and restarts on start_preview()', () => {
    const preview = make_preview()
    preview.begin()
    preview.stop_preview()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(pending.size).toBe(0)

    void preview.start_preview()
    expect(request).toHaveBeenCalledTimes(2)
    preview.dispose()
  })

  it('does not reschedule after dispose', () => {
    const preview = make_preview()
    preview.begin()
    const callback = [...pending.values()][0]
    preview.dispose()
    callback?.(16)
    expect(request).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalled()
  })

  it('supports component recreation without duplicate loops', () => {
    make_preview().dispose()
    const replacement = make_preview()
    replacement.begin()
    expect(request).toHaveBeenCalledTimes(1)
    replacement.dispose()
  })
})
