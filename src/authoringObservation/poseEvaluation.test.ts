import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { create_empty_document, with_animation_channel } from '../animation-document/create'
import { apply_evaluated_pose, evaluate_document_at_time, pose_digest } from './poseEvaluation'
import { make_test_rig } from './testFixtures'
import { bone_rest_transforms } from '../animation-document/rigIdentity'

function make_document () {
  const { skeleton } = make_test_rig()
  let document = create_empty_document({ skeleton, rig_identifier: 'human', clip_name: 'Move', duration_seconds: 1 })
  const identity = document.bones.find((entry) => entry.display_name === 'upperarm_r')!
  const bone = skeleton.bones[identity.index]
  document = with_animation_channel(document, {
    bone_id: identity.id,
    property: 'quaternion',
    keyframes: [
      { time_seconds: 0, values: [0, 0, 0, 1], interpolation: 'slerp' },
      { time_seconds: 0.5, values: [0, 0.7071, 0, 0.7071], interpolation: 'slerp' }
    ]
  })
  return { document, skeleton, bone }
}

describe('pose evaluation drives real movement', () => {
  it('applies different local rotations at different timestamps', () => {
    const { document, skeleton, bone } = make_document()
    const original = bone.quaternion.clone()
    const at_start = evaluate_document_at_time(document, 0)
    const first = apply_evaluated_pose(skeleton, at_start)
    const q0 = bone.quaternion.clone()
    expect(q0.w).toBeCloseTo(1, 4)

    const at_middle = evaluate_document_at_time(document, 0.5)
    const second = apply_evaluated_pose(skeleton, at_middle)
    const q1 = bone.quaternion.clone()
    expect(q1.y).toBeCloseTo(0.7071, 4)
    expect(q1.equals(q0)).toBe(false)

    first.restore()
    second.restore()
    expect(bone.quaternion.equals(original)).toBe(true)
  })

  it('produces a distinct pose digest per evaluated time', () => {
    const { document } = make_document()
    const digest0 = pose_digest(evaluate_document_at_time(document, 0))
    const digest1 = pose_digest(evaluate_document_at_time(document, 0.5))
    expect(digest0).not.toBe(digest1)
  })

  it('refreshes GPU skin matrices for the evaluated and restored poses', () => {
    const { document, skeleton } = make_document()
    const identity = document.bones.find((entry) => entry.display_name === 'upperarm_r')!
    const offset = identity.index * 16
    skeleton.update()
    const matrices = skeleton.boneMatrices!
    const before = Array.from(matrices.slice(offset, offset + 16))

    const applied = apply_evaluated_pose(skeleton, evaluate_document_at_time(document, 0.5))
    expect(Array.from(matrices.slice(offset, offset + 16))).not.toEqual(before)
    applied.restore()

    expect(Array.from(matrices.slice(offset, offset + 16))).toEqual(before)
  })

  it('resets unkeyed live-mixer transforms to bind pose for deterministic captures', () => {
    const { document, skeleton } = make_document()
    skeleton.calculateInverses()
    const head_index = document.bones.find((entry) => entry.display_name === 'head')!.index
    const unkeyed = skeleton.bones[head_index]!
    const live_mixer_quaternion = unkeyed.quaternion.clone().setFromAxisAngle(new Vector3(0, 1, 0), 1.2)
    unkeyed.quaternion.copy(live_mixer_quaternion)
    const bind_pose = bone_rest_transforms(skeleton)
    const expected = bind_pose[head_index]!

    const applied = apply_evaluated_pose(skeleton, evaluate_document_at_time(document, 0.5))
    expect(unkeyed.quaternion.x).toBeCloseTo(expected.quaternion[0])
    expect(unkeyed.quaternion.y).toBeCloseTo(expected.quaternion[1])
    expect(unkeyed.quaternion.z).toBeCloseTo(expected.quaternion[2])
    expect(unkeyed.quaternion.w).toBeCloseTo(expected.quaternion[3])
    applied.restore()
    expect(unkeyed.quaternion.equals(live_mixer_quaternion)).toBe(true)
  })
})
