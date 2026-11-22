import { describe, it, expect } from 'vitest'
import { Bone } from 'three'
import { ArmExtensionControl } from './processes/animations-listing/ArmExtensionControl'
import { Utility } from './Utilities'

/**
 * Creates a Bone with the given name, optionally with a child bone attached so
 * it is no longer childless.
 */
function make_bone (name: string, with_child = false): Bone {
  const bone = new Bone()
  bone.name = name
  if (with_child) {
    bone.add(new Bone())
  }
  return bone
}

describe('Utility.is_leaf_bone', () => {
  it('treats childless, name-marked tips as leaf bones', () => {
    expect(Utility.is_leaf_bone(make_bone('head_leaf'))).toBe(true)
    expect(Utility.is_leaf_bone(make_bone('thumb_04_leaf_l'))).toBe(true)
    expect(Utility.is_leaf_bone(make_bone('Ear_Tip_L'))).toBe(true)
    expect(Utility.is_leaf_bone(make_bone('tip'))).toBe(true)
  })

  it('keeps a name-marked bone that still has an animated child', () => {
    // e.g. a snake `tail_tip` whose child is the true chain-end `tip`
    expect(Utility.is_leaf_bone(make_bone('tail_tip', true))).toBe(false)
  })

  it('keeps a childless bone without a leaf/tip marker', () => {
    // e.g. simplified-hand mode where `finger_03` becomes the childless end
    expect(Utility.is_leaf_bone(make_bone('finger_03'))).toBe(false)
  })

  it('keeps a normal animatable bone', () => {
    expect(Utility.is_leaf_bone(make_bone('upperarm_l', true))).toBe(false)
    expect(Utility.is_leaf_bone(make_bone('upperarm_l'))).toBe(false)
  })
})

describe('ArmExtensionControl.set_value', () => {
  it('stores the variation arm extension and notifies listeners', () => {
    const control = ArmExtensionControl.getInstance()
    let value = -1

    ;(control as unknown as { on_change: (value: number) => void }).on_change = (next_value: number) => {
      value = next_value
    }

    control.set_value(24)

    expect(control.value()).toBe(24)
    expect(value).toBe(24)
  })
})
