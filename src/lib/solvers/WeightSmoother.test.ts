import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from 'three'

import { WeightSmoother } from './WeightSmoother.js'

function count_non_zero_weights (skin_weights: number[], vertex: number): number {
  const offset = vertex * 4
  return [
    skin_weights[offset],
    skin_weights[offset + 1],
    skin_weights[offset + 2],
    skin_weights[offset + 3]
  ].filter(weight => weight > 1e-6).length
}

describe('WeightSmoother', () => {
  it('accumulates influences across adjacent standard boundaries instead of collapsing back to two weights', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 1, 0,
      1, 1, 0,
      2, 1, 0,
      0, 0, 0,
      1, 0, 0,
      2, 0, 0
    ], 3))
    geometry.setIndex(new Uint16BufferAttribute([
      0, 3, 1,
      1, 3, 4,
      1, 4, 2,
      2, 4, 5
    ], 1))

    const bones = ['bone-left', 'bone-middle', 'bone-right'].map((name) => {
      const bone = new Bone()
      bone.name = name
      return bone
    })

    const skin_indices = [
      0, 0, 0, 0,
      1, 0, 0, 0,
      2, 0, 0, 0,
      0, 0, 0, 0,
      1, 0, 0, 0,
      2, 0, 0, 0
    ]
    const skin_weights = [
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]

    const smoother = new WeightSmoother(geometry, bones)
    smoother.smooth_bone_weight_boundaries(skin_indices, skin_weights)

    expect(count_non_zero_weights(skin_weights, 1)).toBeGreaterThanOrEqual(3)
    expect(count_non_zero_weights(skin_weights, 4)).toBeGreaterThanOrEqual(3)
  })

  it('applies a joint-to-center gradient along a bone chain', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      2, 0, 0
    ], 3))

    const root_bone = new Bone()
    root_bone.name = 'root'

    const mid_bone = new Bone()
    mid_bone.name = 'spine'
    mid_bone.position.set(1, 0, 0)
    root_bone.add(mid_bone)

    const child_bone = new Bone()
    child_bone.name = 'chest'
    child_bone.position.set(1, 0, 0)
    mid_bone.add(child_bone)

    root_bone.updateWorldMatrix(true, true)

    const bones = [root_bone, mid_bone, child_bone]
    const skin_indices = [
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]
    const skin_weights = [
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]

    const smoother = new WeightSmoother(geometry, bones)
    smoother.smooth_bone_weight_boundaries(skin_indices, skin_weights)

    expect(skin_weights[0]).toBeCloseTo(0.2, 5)
    expect(skin_weights[1]).toBeCloseTo(0.8, 5)
    expect(skin_weights[4]).toBeCloseTo(1.0, 5)
    expect(skin_weights[8]).toBeCloseTo(0.2, 5)
    expect(skin_weights[9]).toBeCloseTo(0.8, 5)
  })

  it('uses a wider smoothing band between pelvis and thigh bones', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 1, 0,
      1, 1, 0,
      2, 1, 0,
      3, 1, 0,
      0, 0, 0,
      1, 0, 0,
      2, 0, 0,
      3, 0, 0
    ], 3))
    geometry.setIndex(new Uint16BufferAttribute([
      0, 4, 1,
      1, 4, 5,
      1, 5, 2,
      2, 5, 6,
      2, 6, 3,
      3, 6, 7
    ], 1))

    const pelvis = new Bone()
    pelvis.name = 'pelvis'

    const spine = new Bone()
    spine.name = 'spine'
    pelvis.add(spine)

    const thigh = new Bone()
    thigh.name = 'leftThigh'
    pelvis.add(thigh)

    const shin = new Bone()
    shin.name = 'leftShin'
    thigh.add(shin)

    pelvis.updateWorldMatrix(true, true)

    const bones = [pelvis, spine, thigh, shin]
    const skin_indices = [
      0, 0, 0, 0,
      0, 0, 0, 0,
      2, 0, 0, 0,
      2, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      2, 0, 0, 0,
      2, 0, 0, 0
    ]
    const skin_weights = [
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]

    const smoother = new WeightSmoother(geometry, bones)
    smoother.smooth_bone_weight_boundaries(skin_indices, skin_weights)

    expect(skin_weights[1]).toBeCloseTo(0.48, 5)
    expect(skin_weights[5]).toBeCloseTo(0.5, 5)
    expect(skin_weights[13]).toBeCloseTo(0.48, 5)
  })

  it('adds extra pelvis-basin blending for central glute-area vertices', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, -0.05, 0,
      0.25, -0.15, 0,
      -0.25, -0.15, 0,
      0, -0.3, 0,
      0.5, -0.45, 0,
      -0.5, -0.45, 0
    ], 3))

    const pelvis = new Bone()
    pelvis.name = 'pelvis'

    const spine = new Bone()
    spine.name = 'spine'
    spine.position.set(0, 0.4, 0)
    pelvis.add(spine)

    const left_thigh = new Bone()
    left_thigh.name = 'leftThigh'
    left_thigh.position.set(-0.4, -0.6, 0)
    pelvis.add(left_thigh)

    const right_thigh = new Bone()
    right_thigh.name = 'rightThigh'
    right_thigh.position.set(0.4, -0.6, 0)
    pelvis.add(right_thigh)

    pelvis.updateWorldMatrix(true, true)

    const bones = [pelvis, spine, left_thigh, right_thigh]
    const skin_indices = [
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      2, 0, 0, 0,
      3, 0, 0, 0
    ]
    const skin_weights = [
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]

    const smoother = new WeightSmoother(geometry, bones)
    smoother.smooth_bone_weight_boundaries(skin_indices, skin_weights)

    expect(skin_weights[4 + 1]).toBeGreaterThan(0.12)
    expect([2, 3]).toContain(skin_indices[4 + 1])
    expect(skin_weights[8 + 1]).toBeGreaterThan(0.12)
    expect([2, 3]).toContain(skin_indices[8 + 1])
    expect(skin_weights[12 + 1]).toBeGreaterThan(0.12)
    expect([2, 3]).toContain(skin_indices[12 + 1])
  })

  it('uses a wider smoothing band between spine-chain and shoulder-chain bones', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 1, 0,
      1, 1, 0,
      2, 1, 0,
      3, 1, 0,
      0, 0, 0,
      1, 0, 0,
      2, 0, 0,
      3, 0, 0
    ], 3))
    geometry.setIndex(new Uint16BufferAttribute([
      0, 4, 1,
      1, 4, 5,
      1, 5, 2,
      2, 5, 6,
      2, 6, 3,
      3, 6, 7
    ], 1))

    const chest = new Bone()
    chest.name = 'chest'

    const neck = new Bone()
    neck.name = 'neck'
    chest.add(neck)

    const clavicle = new Bone()
    clavicle.name = 'leftClavicle'
    chest.add(clavicle)

    const upper_arm = new Bone()
    upper_arm.name = 'leftUpperArm'
    clavicle.add(upper_arm)

    chest.updateWorldMatrix(true, true)

    const bones = [chest, neck, clavicle, upper_arm]
    const skin_indices = [
      0, 0, 0, 0,
      0, 0, 0, 0,
      2, 0, 0, 0,
      2, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      2, 0, 0, 0,
      2, 0, 0, 0
    ]
    const skin_weights = [
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]

    const smoother = new WeightSmoother(geometry, bones)
    smoother.smooth_bone_weight_boundaries(skin_indices, skin_weights)

    expect(skin_weights[1]).toBeCloseTo(0.5, 5)
    expect(skin_weights[5]).toBeCloseTo(0.5, 5)
    expect(skin_weights[13]).toBeCloseTo(0.5, 5)
  })

  it('uses a symmetric socket smoothing band between clavicle and upper arm bones', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 1, 0,
      1, 1, 0,
      2, 1, 0,
      3, 1, 0,
      0, 0, 0,
      1, 0, 0,
      2, 0, 0,
      3, 0, 0
    ], 3))
    geometry.setIndex(new Uint16BufferAttribute([
      0, 4, 1,
      1, 4, 5,
      1, 5, 2,
      2, 5, 6,
      2, 6, 3,
      3, 6, 7
    ], 1))

    const clavicle = new Bone()
    clavicle.name = 'leftClavicle'

    const upper_arm = new Bone()
    upper_arm.name = 'leftUpperArm'
    clavicle.add(upper_arm)

    const forearm = new Bone()
    forearm.name = 'leftForeArm'
    upper_arm.add(forearm)

    clavicle.updateWorldMatrix(true, true)

    const bones = [clavicle, upper_arm, forearm]
    const skin_indices = [
      0, 0, 0, 0,
      0, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]
    const skin_weights = [
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0
    ]

    const smoother = new WeightSmoother(geometry, bones)
    smoother.smooth_bone_weight_boundaries(skin_indices, skin_weights)

    expect(skin_weights[1]).toBeCloseTo(0.5, 5)
    expect(skin_weights[5]).toBeCloseTo(0.5, 5)
    expect(skin_weights[13]).toBeCloseTo(0.5, 5)
  })
})