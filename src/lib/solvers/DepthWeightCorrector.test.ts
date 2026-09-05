import { describe, it, expect } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute } from 'three'
import { DepthWeightCorrector } from './DepthWeightCorrector'

/**
 * The same minimal humanoid rig the arm plane tests use, with a head and neck
 * added so there is somewhere sensible for stripped hair weights to land.
 * WORLD positions:
 *
 *   root     (0, 0,   0)
 *   spine_01 (0, 1.0, 0)   chest (0, 1.5, 0)
 *   neck     (0, 1.7, 0)   head  (0, 1.9, 0)
 *   clavicle (+/-0.1, 1.5, 0)   upperarm (+/-1.0, 1.5, 0)
 *   lowerarm (+/-2.0, 1.5, 0)   hand (+/-3.0, 1.5, 0)
 *
 * Every bone sits at z = 0, so the shoulder anchor depth is 0 and the front and
 * back planes land at +distance and -distance.
 */
function build_test_rig (): Bone[] {
  const root = new Bone()
  root.name = 'root'

  const spine = new Bone()
  spine.name = 'spine_01'
  spine.position.set(0, 1.0, 0)
  root.add(spine)

  const chest = new Bone()
  chest.name = 'chest'
  chest.position.set(0, 0.5, 0)
  spine.add(chest)

  const neck = new Bone()
  neck.name = 'neck'
  neck.position.set(0, 0.2, 0)
  chest.add(neck)

  const head = new Bone()
  head.name = 'head'
  head.position.set(0, 0.2, 0)
  neck.add(head)

  const head_end = new Bone()
  head_end.name = 'head_end'
  head_end.position.set(0, 0.2, 0)
  head.add(head_end)

  const bones: Bone[] = [root, spine, chest, neck, head, head_end]

  const build_arm = (side: string, direction: number): void => {
    const clavicle = new Bone()
    clavicle.name = `clavicle_${side}`
    clavicle.position.set(direction * 0.1, 0, 0)

    const upperarm = new Bone()
    upperarm.name = `upperarm_${side}`
    upperarm.position.set(direction * 0.9, 0, 0)

    const lowerarm = new Bone()
    lowerarm.name = `lowerarm_${side}`
    lowerarm.position.set(direction * 1.0, 0, 0)

    const hand = new Bone()
    hand.name = `hand_${side}`
    hand.position.set(direction * 1.0, 0, 0)

    lowerarm.add(hand)
    upperarm.add(lowerarm)
    clavicle.add(upperarm)
    chest.add(clavicle)

    bones.push(clavicle, upperarm, lowerarm, hand)
  }

  build_arm('l', 1)
  build_arm('r', -1)

  root.updateWorldMatrix(true, true)
  return bones
}

function bone_index (bones: Bone[], name: string): number {
  return bones.findIndex(bone => bone.name === name)
}

function geometry_from_points (points: Array<[number, number, number]>): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points.flat(), 3))
  return geometry
}

describe('DepthWeightCorrector.shoulder_anchor_z', () => {
  it('returns the world Z of the shoulder joint', () => {
    const bones = build_test_rig()
    expect(DepthWeightCorrector.shoulder_anchor_z(bones)).toBeCloseTo(0)
  })

  it('follows a shoulder that is not at the origin depth', () => {
    const bones = build_test_rig()
    const chest = bones[bone_index(bones, 'chest')]
    chest.position.z = 0.3
    chest.updateWorldMatrix(true, true)

    expect(DepthWeightCorrector.shoulder_anchor_z(bones)).toBeCloseTo(0.3)
  })

  it('returns null when the rig has no arm bones', () => {
    const snake_head = new Bone()
    snake_head.name = 'head'
    expect(DepthWeightCorrector.shoulder_anchor_z([snake_head])).toBeNull()
  })
})

describe('DepthWeightCorrector.apply_depth_weight_correction', () => {
  it('takes back hair off an arm bone and hands it to the nearest non-arm bone', () => {
    const bones = build_test_rig()
    const upperarm_l = bone_index(bones, 'upperarm_l')

    // a strand hanging behind the shoulder, at the same X and height as the arm
    const geometry = geometry_from_points([[0.9, 1.5, -0.4]])
    const skin_indices = [upperarm_l, 0, 0, 0]
    const skin_weights = [1.0, 0, 0, 0]

    new DepthWeightCorrector(geometry, bones, 0.15).apply_depth_weight_correction(skin_indices, skin_weights)

    expect(skin_indices[0]).not.toBe(upperarm_l)
    expect(bones[skin_indices[0]].name.includes('arm')).toBe(false)
    expect(skin_weights[0] + skin_weights[1] + skin_weights[2] + skin_weights[3]).toBeCloseTo(1.0)
  })

  it('catches hair in front of the body too', () => {
    const bones = build_test_rig()
    const upperarm_r = bone_index(bones, 'upperarm_r')

    const geometry = geometry_from_points([[-0.9, 1.5, 0.4]])
    const skin_indices = [upperarm_r, 0, 0, 0]
    const skin_weights = [1.0, 0, 0, 0]

    new DepthWeightCorrector(geometry, bones, 0.15).apply_depth_weight_correction(skin_indices, skin_weights)

    expect(bones[skin_indices[0]].name.includes('arm')).toBe(false)
  })

  it('leaves the arm itself alone, which sits between the two planes', () => {
    const bones = build_test_rig()
    const lowerarm_l = bone_index(bones, 'lowerarm_l')

    // out at the wrist but at body depth, which is what the arm plane guards
    const geometry = geometry_from_points([[2.0, 1.5, 0.05]])
    const skin_indices = [lowerarm_l, 0, 0, 0]
    const skin_weights = [1.0, 0, 0, 0]

    new DepthWeightCorrector(geometry, bones, 0.15).apply_depth_weight_correction(skin_indices, skin_weights)

    expect(skin_indices[0]).toBe(lowerarm_l)
    expect(skin_weights[0]).toBe(1.0)
  })

  it('measures depth from the shoulder rather than from the world origin', () => {
    const bones = build_test_rig()
    const chest = bones[bone_index(bones, 'chest')]
    chest.position.z = 0.5
    chest.updateWorldMatrix(true, true)

    const upperarm_l = bone_index(bones, 'upperarm_l')

    // z = 0.55 is far from the origin but only 0.05 off the shoulder's depth
    const geometry = geometry_from_points([[0.9, 1.5, 0.55]])
    const skin_indices = [upperarm_l, 0, 0, 0]
    const skin_weights = [1.0, 0, 0, 0]

    new DepthWeightCorrector(geometry, bones, 0.15).apply_depth_weight_correction(skin_indices, skin_weights)

    expect(skin_indices[0]).toBe(upperarm_l)
  })

  it('does not touch weights that were never on an arm bone', () => {
    const bones = build_test_rig()
    const head = bone_index(bones, 'head')

    const geometry = geometry_from_points([[0.9, 1.5, -0.4]])
    const skin_indices = [head, 0, 0, 0]
    const skin_weights = [1.0, 0, 0, 0]

    new DepthWeightCorrector(geometry, bones, 0.15).apply_depth_weight_correction(skin_indices, skin_weights)

    expect(skin_indices[0]).toBe(head)
    expect(skin_weights[0]).toBe(1.0)
  })

  it('is a no-op at zero distance, which would otherwise strip both arms entirely', () => {
    const bones = build_test_rig()
    const upperarm_l = bone_index(bones, 'upperarm_l')

    const geometry = geometry_from_points([[0.9, 1.5, -0.4]])
    const skin_indices = [upperarm_l, 0, 0, 0]
    const skin_weights = [1.0, 0, 0, 0]

    new DepthWeightCorrector(geometry, bones, 0).apply_depth_weight_correction(skin_indices, skin_weights)

    expect(skin_indices[0]).toBe(upperarm_l)
    expect(skin_weights[0]).toBe(1.0)
  })

  it('is a no-op when the rig has no arm bones', () => {
    const snake_head = new Bone()
    snake_head.name = 'head'
    snake_head.updateWorldMatrix(true, true)

    const geometry = geometry_from_points([[0, 0, 5]])
    const skin_indices = [0, 0, 0, 0]
    const skin_weights = [1.0, 0, 0, 0]

    new DepthWeightCorrector(geometry, [snake_head], 0.15).apply_depth_weight_correction(skin_indices, skin_weights)

    expect(skin_indices).toEqual([0, 0, 0, 0])
    expect(skin_weights).toEqual([1.0, 0, 0, 0])
  })

  it('merges the stolen weight into an existing slot for the replacement bone', () => {
    const bones = build_test_rig()
    const upperarm_l = bone_index(bones, 'upperarm_l')
    const chest = bone_index(bones, 'chest')

    const geometry = geometry_from_points([[0.2, 1.5, -0.4]])
    const skin_indices = [upperarm_l, chest, 0, 0]
    const skin_weights = [0.6, 0.4, 0, 0]

    new DepthWeightCorrector(geometry, bones, 0.15).apply_depth_weight_correction(skin_indices, skin_weights)

    expect(skin_indices[1]).toBe(chest)
    expect(skin_weights[1]).toBeCloseTo(1.0)
    expect(skin_weights[0]).toBe(0)
  })
})
