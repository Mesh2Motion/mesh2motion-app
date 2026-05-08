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

function build_quadruped_test_skeleton (): Skeleton {
  const root = new Bone()
  root.name = 'root'

  const pelvis = new Bone()
  pelvis.name = 'Pelvis'
  root.add(pelvis)

  const spine1 = new Bone()
  spine1.name = 'Spine1'
  pelvis.add(spine1)

  const spine2 = new Bone()
  spine2.name = 'Spine2'
  spine1.add(spine2)

  const chest = new Bone()
  chest.name = 'Chest'
  spine2.add(chest)

  const head = new Bone()
  head.name = 'Head'
  chest.add(head)

  const head_tip = new Bone()
  head_tip.name = 'HeadTip'
  head.add(head_tip)

  const front_leg_shoulder_l = new Bone()
  front_leg_shoulder_l.name = 'FrontLegShoulder_L'
  pelvis.add(front_leg_shoulder_l)

  const front_leg_upper_l = new Bone()
  front_leg_upper_l.name = 'FrontLegUpper_L'
  front_leg_shoulder_l.add(front_leg_upper_l)

  const front_leg_foot_l = new Bone()
  front_leg_foot_l.name = 'FrontLegFoot_L'
  front_leg_upper_l.add(front_leg_foot_l)

  const front_leg_foot1_l = new Bone()
  front_leg_foot1_l.name = 'FrontLegFoot1_L'
  front_leg_foot_l.add(front_leg_foot1_l)

  const front_leg_shoulder_r = new Bone()
  front_leg_shoulder_r.name = 'FrontLegShoulder_R'
  pelvis.add(front_leg_shoulder_r)

  const front_leg_upper_r = new Bone()
  front_leg_upper_r.name = 'FrontLegUpper_R'
  front_leg_shoulder_r.add(front_leg_upper_r)

  const front_leg_foot_r = new Bone()
  front_leg_foot_r.name = 'FrontLegFoot_R'
  front_leg_upper_r.add(front_leg_foot_r)

  const back_leg_pelvis_l = new Bone()
  back_leg_pelvis_l.name = 'BackLegPelvis_L'
  pelvis.add(back_leg_pelvis_l)

  const back_leg_upper_l = new Bone()
  back_leg_upper_l.name = 'BackLegUpper_L'
  back_leg_pelvis_l.add(back_leg_upper_l)

  const back_leg_foot_l = new Bone()
  back_leg_foot_l.name = 'BackLegFoot_L'
  back_leg_upper_l.add(back_leg_foot_l)

  const back_leg_foot1_l = new Bone()
  back_leg_foot1_l.name = 'BackLegFoot1_L'
  back_leg_foot_l.add(back_leg_foot1_l)

  const back_leg_pelvis_r = new Bone()
  back_leg_pelvis_r.name = 'BackLegPelvis_R'
  pelvis.add(back_leg_pelvis_r)

  const back_leg_upper_r = new Bone()
  back_leg_upper_r.name = 'BackLegUpper_R'
  back_leg_pelvis_r.add(back_leg_upper_r)

  const back_leg_foot_r = new Bone()
  back_leg_foot_r.name = 'BackLegFoot_R'
  back_leg_upper_r.add(back_leg_foot_r)

  const back_leg_foot1_r = new Bone()
  back_leg_foot1_r.name = 'BackLegFoot1_R'
  back_leg_foot_r.add(back_leg_foot1_r)

  return new Skeleton([
    root,
    pelvis,
    spine1,
    spine2,
    chest,
    head,
    head_tip,
    front_leg_shoulder_l,
    front_leg_upper_l,
    front_leg_foot_l,
    front_leg_foot1_l,
    front_leg_shoulder_r,
    front_leg_upper_r,
    front_leg_foot_r,
    back_leg_pelvis_l,
    back_leg_upper_l,
    back_leg_foot_l,
    back_leg_foot1_l,
    back_leg_pelvis_r,
    back_leg_upper_r,
    back_leg_foot_r,
    back_leg_foot1_r
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

  it('condenses spine, head, and quadruped leg chains', () => {
    const skeleton = build_quadruped_test_skeleton()
    const chest_bone = skeleton.bones.find((bone) => bone.name === 'Chest')
    const head_tip_bone = skeleton.bones.find((bone) => bone.name === 'HeadTip')
    const front_leg_foot_l = skeleton.bones.find((bone) => bone.name === 'FrontLegFoot_L')
    const back_leg_foot1_r = skeleton.bones.find((bone) => bone.name === 'BackLegFoot1_R')

    expect(chest_bone).toBeDefined()
    expect(head_tip_bone).toBeDefined()
    expect(front_leg_foot_l).toBeDefined()
    expect(back_leg_foot1_r).toBeDefined()

    expect(Utility.chain_root_bone_from_bone(chest_bone!)).toBe(skeleton.bones.find((bone) => bone.name === 'Spine1'))
    expect(Utility.chain_root_bone_from_bone(head_tip_bone!)).toBe(skeleton.bones.find((bone) => bone.name === 'Head'))
    expect(Utility.chain_root_bone_from_bone(front_leg_foot_l!)).toBe(skeleton.bones.find((bone) => bone.name === 'FrontLegShoulder_L'))
    expect(Utility.chain_root_bone_from_bone(back_leg_foot1_r!)).toBe(skeleton.bones.find((bone) => bone.name === 'BackLegPelvis_R'))
  })
})