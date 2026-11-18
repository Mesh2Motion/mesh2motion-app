import { describe, it, expect } from 'vitest'
import { LimbProportionCorrector, type ProportionLimb } from './LimbProportionCorrector.ts'

/** Only the figures remap_along_axis reads. */
function limb (values: Partial<ProportionLimb>): ProportionLimb {
  return {
    source_half_width: 0.174,
    target_half_width: 0.112,
    length_ratio: 0.913,
    contact_ratio: 0.833,
    near_distance: 0.067,
    ...values
  } as ProportionLimb
}

describe('LimbProportionCorrector.remap_along_axis', () => {
  const rpm_arm = limb({})

  it('keeps the body landmarks in place', () => {
    expect(LimbProportionCorrector.remap_along_axis(0, rpm_arm)).toBe(0)
    expect(LimbProportionCorrector.remap_along_axis(0.174, rpm_arm)).toBeCloseTo(0.112, 6)
    expect(LimbProportionCorrector.remap_along_axis(-0.174, rpm_arm)).toBeCloseTo(-0.112, 6)
  })

  it('uses hand size right at the centre line and limb length outside the root joint', () => {
    expect(LimbProportionCorrector.remap_along_axis(0.02, rpm_arm)).toBeCloseTo(0.02 * 0.833, 6)
    expect(LimbProportionCorrector.remap_along_axis(0.274, rpm_arm)).toBeCloseTo(0.112 + 0.1 * 0.913, 6)
  })

  it('is odd, continuous and strictly increasing', () => {
    for (const subject of [rpm_arm, limb({ target_half_width: 0.3, length_ratio: 1.4, contact_ratio: 1.2 })]) {
      let previous = LimbProportionCorrector.remap_along_axis(-0.5, subject)
      for (let x = -0.4995; x <= 0.5; x += 0.0005) {
        const value = LimbProportionCorrector.remap_along_axis(x, subject)
        expect(value).toBeGreaterThan(previous)
        expect(value - previous).toBeLessThan(0.002)
        expect(LimbProportionCorrector.remap_along_axis(-x, subject)).toBeCloseTo(-value, 9)
        previous = value
      }
    }
  })
})
