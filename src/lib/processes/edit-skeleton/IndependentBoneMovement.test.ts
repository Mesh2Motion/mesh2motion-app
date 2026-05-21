import { describe, expect, it } from 'vitest'
import { Bone, Quaternion, Skeleton } from 'three'

import { IndependentBoneMovement } from './IndependentBoneMovement.ts'

function quaternion_angle_difference (left: Quaternion, right: Quaternion): number {
  const dot = Math.min(1, Math.abs(left.dot(right)))
  return 2 * Math.acos(dot)
}

describe('IndependentBoneMovement', () => {
  it('keeps a branching chest parent at its rest rotation when moving the clavicle', () => {
    const root = new Bone()
    root.name = 'root'

    const chest = new Bone()
    chest.name = 'chest'
    root.add(chest)

    const neck = new Bone()
    neck.name = 'neck'
    neck.position.set(0, 1, 0)
    chest.add(neck)

    const clavicle = new Bone()
    clavicle.name = 'leftClavicle'
    clavicle.position.set(1, 0.15, 0)
    chest.add(clavicle)

    const upper_arm = new Bone()
    upper_arm.name = 'leftUpperArm'
    upper_arm.position.set(1, 0, 0)
    clavicle.add(upper_arm)

    root.updateWorldMatrix(true, true)

    const movement = new IndependentBoneMovement()
    movement.set_rest_pose(new Skeleton([root, chest, neck, clavicle, upper_arm]))

    const chest_rest_rotation = chest.getWorldQuaternion(new Quaternion()).clone()

    clavicle.position.set(0.55, 0.35, -0.45)
    root.updateWorldMatrix(true, true)

    movement.finalize_drop(clavicle)

    const chest_final_rotation = chest.getWorldQuaternion(new Quaternion())
    expect(quaternion_angle_difference(chest_final_rotation, chest_rest_rotation)).toBeLessThan(1e-5)
  })
})