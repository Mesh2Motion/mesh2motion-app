import { describe, expect, it } from 'vitest'
import { get_view_helper_viewport } from './CustomViewHelper.ts'

describe('get_view_helper_viewport', () => {
  it('positions the helper at the lower-left hitbox when the canvas starts after the sidebar', () => {
    const canvas = { left: 256, top: 96, width: 515, height: 654 }
    const hitbox = { left: 256, top: 630, width: 120, height: 120 }

    expect(get_view_helper_viewport(hitbox, canvas, 128, false)).toEqual({ x: -8, y: 0 })
  })

  it('keeps the helper anchored when the whole app window moves', () => {
    const first = get_view_helper_viewport(
      { left: 256, top: 630, width: 120, height: 120 },
      { left: 256, top: 96, width: 515, height: 654 },
      128,
      false
    )
    const moved = get_view_helper_viewport(
      { left: 856, top: 730, width: 120, height: 120 },
      { left: 856, top: 196, width: 515, height: 654 },
      128,
      false
    )

    expect(moved).toEqual(first)
  })

  it('preserves the WebGPU helper vertical offset', () => {
    expect(get_view_helper_viewport(
      { left: 256, top: 630, width: 120, height: 120 },
      { left: 256, top: 96, width: 515, height: 654 },
      90,
      true
    )).toEqual({ x: 30, y: 30 })
  })
})
