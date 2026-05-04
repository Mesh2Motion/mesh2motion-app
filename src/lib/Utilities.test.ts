import { describe, expect, it } from 'vitest'
import { Bone, Skeleton } from 'three'

import { Utility } from './Utilities'

function build_test_skeleton (): Skeleton {
  const root = new Bone()
  root.name = 'root'

  const hips = new Bone()
  hips.name = 'Hips'
  root.add(hips)

  const spine = new Bone()
  spine.name = 'Spine'
  hips.add(spine)

  const left_leg = new Bone()
  left_leg.name = 'LeftLeg'
  hips.add(left_leg)

  const right_leg = new Bone()
  right_leg.name = 'RightLeg'
  hips.add(right_leg)

  const chest = new Bone()
  chest.name = 'Chest'
  spine.add(chest)

  const left_shoulder = new Bone()
  left_shoulder.name = 'LeftShoulder'
  chest.add(left_shoulder)

  const left_forearm = new Bone()
  left_forearm.name = 'LeftForeArm'
  left_shoulder.add(left_forearm)

  const left_hand = new Bone()
  left_hand.name = 'LeftHand'
  left_forearm.add(left_hand)

  const left_thumb = new Bone()
  left_thumb.name = 'LeftHandThumb1'
  left_hand.add(left_thumb)

  const left_index = new Bone()
  left_index.name = 'LeftHandIndex1'
  left_hand.add(left_index)

  const right_shoulder = new Bone()
  right_shoulder.name = 'RightShoulder'
  chest.add(right_shoulder)

  const head = new Bone()
  head.name = 'Head'
  chest.add(head)

  return new Skeleton([
    root,
    hips,
    spine,
    left_leg,
    right_leg,
    chest,
    left_shoulder,
    left_forearm,
    left_hand,
    left_thumb,
    left_index,
    right_shoulder,
    head
  ])
}

describe('Utility chain roots', () => {
  it('derives condensed main chains and folds fingers into the hand chain', () => {
    const skeleton = build_test_skeleton()
    const chain_root_names = Utility.unique_chain_root_bones_from_skeleton(skeleton).map((bone) => bone.name)

    expect(chain_root_names).toEqual(['Hips', 'Spine', 'LeftLeg', 'RightLeg', 'LeftShoulder', 'LeftHand', 'RightShoulder', 'Head'])
  })

  it('maps descendant bones back to their condensed chain root', () => {
    const skeleton = build_test_skeleton()
    const chest_bone = skeleton.bones.find((bone) => bone.name === 'Chest')
    const head_bone = skeleton.bones.find((bone) => bone.name === 'Head')
    const thumb_bone = skeleton.bones.find((bone) => bone.name === 'LeftHandThumb1')
    const hand_bone = skeleton.bones.find((bone) => bone.name === 'LeftHand')

    expect(chest_bone).toBeDefined()
    expect(head_bone).toBeDefined()
    expect(thumb_bone).toBeDefined()
    expect(hand_bone).toBeDefined()
    expect(Utility.chain_root_bone_from_bone(chest_bone!)).toBe(skeleton.bones.find((bone) => bone.name === 'Spine'))
    expect(Utility.chain_root_bone_from_bone(head_bone!)).toBe(head_bone)
    expect(Utility.chain_root_bone_from_bone(thumb_bone!)).toBe(hand_bone)
  })
})