import { describe, it, expect } from 'vitest'
import { BoneAutoMapper } from './BoneAutoMapper'
import { BoneChainResolver, type RawBoneRecord } from './BoneChainResolver'
import { MixamoMapper } from './MixamoMapper'
import { RigifyMapper } from './RigifyMapper'
import { type BoneMetadata, BoneSlot } from './BoneTypes'
import { HumanChainConfig } from '../human-retargeting/HumanChainConfig'
import {
  bone_names, daz_rig, mesh2motion_rig, mixamo_rig, unreal_rig, vrm_rig
} from './rig-fixtures'

/** Run a target rig through the full canonical-slot pipeline against Mesh2Motion */
function map_rig (target: RawBoneRecord[]): Map<string, string> {
  return BoneAutoMapper.map_by_canonical_slots(
    BoneChainResolver.build_metadata(mesh2motion_rig()),
    BoneChainResolver.build_metadata(target)
  )
}

function slot_of (metadata: BoneMetadata[], name: string): BoneSlot {
  return (metadata.find(b => b.name === name) as BoneMetadata).slot
}

describe('BoneChainResolver', () => {
  it('resolves the Mesh2Motion source rig to the expected slots', () => {
    const meta = BoneChainResolver.build_metadata(mesh2motion_rig())

    expect(slot_of(meta, 'pelvis')).toBe(BoneSlot.Pelvis)
    expect(slot_of(meta, 'spine_02')).toBe(BoneSlot.Spine)
    expect(slot_of(meta, 'neck_01')).toBe(BoneSlot.Neck)
    expect(slot_of(meta, 'head_leaf')).toBe(BoneSlot.Head)
    expect(slot_of(meta, 'clavicle_l')).toBe(BoneSlot.Clavicle)
    expect(slot_of(meta, 'upperarm_l')).toBe(BoneSlot.UpperArm)
    expect(slot_of(meta, 'lowerarm_l')).toBe(BoneSlot.LowerArm)
    expect(slot_of(meta, 'ball_leaf_r')).toBe(BoneSlot.Ball)
    expect(slot_of(meta, 'index_03_r')).toBe(BoneSlot.FingerIndex)
  })

  it('numbers chains from the hierarchy, not from the digits in the name', () => {
    // Mixamo's Spine/Spine1/Spine2 must line up with spine_01/spine_02/spine_03
    const mixamo = BoneChainResolver.build_metadata(mixamo_rig(''))
    const ordinal_of = (name: string): number =>
      (mixamo.find(b => b.name === name) as BoneMetadata).slot_ordinal

    expect(ordinal_of('Spine')).toBe(1)
    expect(ordinal_of('Spine1')).toBe(2)
    expect(ordinal_of('Spine2')).toBe(3)
    expect(ordinal_of('Head')).toBe(1)
    expect(ordinal_of('HeadTop_End')).toBe(2)
  })

  it('settles shoulder ambiguity from the hierarchy, both ways round', () => {
    // Mixamo: "LeftShoulder" is the clavicle, "LeftArm" is the upper arm
    const mixamo = BoneChainResolver.build_metadata(mixamo_rig(''))
    expect(slot_of(mixamo, 'LeftShoulder')).toBe(BoneSlot.Clavicle)
    expect(slot_of(mixamo, 'LeftArm')).toBe(BoneSlot.UpperArm)
    expect(slot_of(mixamo, 'LeftForeArm')).toBe(BoneSlot.LowerArm)

    // DAZ: "lShldr" is the upper arm and "lCollar" is the clavicle
    const daz = BoneChainResolver.build_metadata(daz_rig())
    expect(slot_of(daz, 'lCollar')).toBe(BoneSlot.Clavicle)
    expect(slot_of(daz, 'lShldr')).toBe(BoneSlot.UpperArm)
    expect(slot_of(daz, 'lForeArm')).toBe(BoneSlot.LowerArm)
  })

  it('settles leg ambiguity: Mixamo LeftLeg is the calf', () => {
    const mixamo = BoneChainResolver.build_metadata(mixamo_rig(''))
    expect(slot_of(mixamo, 'LeftUpLeg')).toBe(BoneSlot.Thigh)
    expect(slot_of(mixamo, 'LeftLeg')).toBe(BoneSlot.Calf)
    expect(slot_of(mixamo, 'LeftToeBase')).toBe(BoneSlot.Ball)
  })

  it('rejects twist, IK and root bones instead of guessing at them', () => {
    const unreal = BoneChainResolver.build_metadata(unreal_rig())

    expect(slot_of(unreal, 'root')).toBe(BoneSlot.Unknown)
    expect(slot_of(unreal, 'upperarm_twist_01_l')).toBe(BoneSlot.Unknown)
    expect(slot_of(unreal, 'lowerarm_twist_01_r')).toBe(BoneSlot.Unknown)
    expect(slot_of(unreal, 'calf_twist_01_l')).toBe(BoneSlot.Unknown)

    // a twist bone sitting between the hand and the forearm must not absorb the
    // forearm's slot during the arm walk
    expect(slot_of(unreal, 'lowerarm_l')).toBe(BoneSlot.LowerArm)
    expect(slot_of(unreal, 'upperarm_l')).toBe(BoneSlot.UpperArm)
  })
})

describe('canonical slot mapping', () => {
  it('maps a Mixamo rig whose "mixamorig" prefix was stripped', () => {
    const mappings = map_rig(mixamo_rig(''))

    expect(mappings.get('Hips')).toBe('pelvis')
    expect(mappings.get('Spine')).toBe('spine_01')
    expect(mappings.get('Spine2')).toBe('spine_03')
    expect(mappings.get('Neck')).toBe('neck_01')
    expect(mappings.get('Head')).toBe('head')
    expect(mappings.get('HeadTop_End')).toBe('head_leaf')

    expect(mappings.get('LeftShoulder')).toBe('clavicle_l')
    expect(mappings.get('LeftArm')).toBe('upperarm_l')
    expect(mappings.get('LeftForeArm')).toBe('lowerarm_l')
    expect(mappings.get('LeftHand')).toBe('hand_l')
    expect(mappings.get('RightForeArm')).toBe('lowerarm_r')

    expect(mappings.get('LeftUpLeg')).toBe('thigh_l')
    expect(mappings.get('LeftLeg')).toBe('calf_l')
    expect(mappings.get('LeftFoot')).toBe('foot_l')
    expect(mappings.get('LeftToeBase')).toBe('ball_l')
    expect(mappings.get('LeftToe_End')).toBe('ball_leaf_l')

    expect(mappings.get('LeftHandIndex1')).toBe('index_01_l')
    expect(mappings.get('LeftHandIndex4')).toBe('index_04_leaf_l')
    expect(mappings.get('RightHandPinky3')).toBe('pinky_03_r')

    // every bone in the rig should map - it is the same skeleton, differently named
    expect(mappings.size).toBe(mixamo_rig('').length)
  })

  it('never assigns one source bone to two targets', () => {
    for (const rig of [mixamo_rig(''), unreal_rig(), daz_rig(), vrm_rig()]) {
      const mappings = map_rig(rig)
      expect(new Set(mappings.values()).size).toBe(mappings.size)
    }
  })

  it('maps an Unreal mannequin and leaves its twist bones alone', () => {
    const mappings = map_rig(unreal_rig())

    expect(mappings.get('pelvis')).toBe('pelvis')
    expect(mappings.get('clavicle_l')).toBe('clavicle_l')
    expect(mappings.get('lowerarm_r')).toBe('lowerarm_r')
    expect(mappings.get('ball_l')).toBe('ball_l')
    expect(mappings.get('index_03_l')).toBe('index_03_l')

    expect(mappings.has('root')).toBe(false)
    expect(mappings.has('upperarm_twist_01_l')).toBe(false)
    expect(mappings.has('thigh_twist_01_r')).toBe(false)
  })

  it('maps DAZ naming, including its inverted shoulder convention', () => {
    const mappings = map_rig(daz_rig())

    expect(mappings.get('hip')).toBe('pelvis')
    expect(mappings.get('lCollar')).toBe('clavicle_l')
    expect(mappings.get('lShldr')).toBe('upperarm_l')
    expect(mappings.get('lForeArm')).toBe('lowerarm_l')
    expect(mappings.get('lHand')).toBe('hand_l')
    expect(mappings.get('rThigh')).toBe('thigh_r')
    expect(mappings.get('rShin')).toBe('calf_r')
    expect(mappings.get('rToe')).toBe('ball_r')
    expect(mappings.get('lMid2')).toBe('middle_02_l')

    // a 2-bone torso is spread across the 3-bone source spine rather than dropped
    expect(mappings.get('abdomen')).toBe('spine_01')
    expect(mappings.get('chest')).toBe('spine_03')
  })

  it('maps VRM naming, including proximal/intermediate/distal fingers', () => {
    const mappings = map_rig(vrm_rig())

    expect(mappings.get('hips')).toBe('pelvis')
    expect(mappings.get('upperChest')).toBe('spine_03')
    expect(mappings.get('leftShoulder')).toBe('clavicle_l')
    expect(mappings.get('leftUpperArm')).toBe('upperarm_l')
    expect(mappings.get('leftLowerArm')).toBe('lowerarm_l')
    expect(mappings.get('rightUpperLeg')).toBe('thigh_r')
    expect(mappings.get('rightLowerLeg')).toBe('calf_r')
    expect(mappings.get('leftToes')).toBe('ball_l')
    expect(mappings.get('leftIndexProximal')).toBe('index_01_l')
    expect(mappings.get('leftIndexDistal')).toBe('index_03_l')
    expect(mappings.get('rightLittleProximal')).toBe('pinky_01_r')
  })

  it('lets literal name agreement win over anything the vocabulary infers', () => {
    // the animal rigs already use Mesh2Motion's naming, so a rig whose chain is
    // shorter than the source must still map name-for-name rather than being spread
    // proportionally along the source chain
    const source = BoneChainResolver.build_metadata([
      { name: 'pelvis', parent_name: null },
      { name: 'tail_01', parent_name: 'pelvis' },
      { name: 'tail_02', parent_name: 'tail_01' },
      { name: 'tail_03', parent_name: 'tail_02' },
      { name: 'tail_04', parent_name: 'tail_03' },
      { name: 'tail_05', parent_name: 'tail_04' }
    ])
    const target = BoneChainResolver.build_metadata([
      { name: 'pelvis', parent_name: null },
      { name: 'tail_01', parent_name: 'pelvis' },
      { name: 'tail_02', parent_name: 'tail_01' },
      { name: 'tail_03', parent_name: 'tail_02' }
    ])

    const mappings = BoneAutoMapper.map_by_canonical_slots(source, target)

    expect(mappings.get('tail_01')).toBe('tail_01')
    expect(mappings.get('tail_02')).toBe('tail_02')
    expect(mappings.get('tail_03')).toBe('tail_03')
  })

  it('spreads a differently-named chain of unequal length along the source', () => {
    const source = BoneChainResolver.build_metadata([
      { name: 'pelvis', parent_name: null },
      { name: 'tail_01', parent_name: 'pelvis' },
      { name: 'tail_02', parent_name: 'tail_01' },
      { name: 'tail_03', parent_name: 'tail_02' }
    ])
    const target = BoneChainResolver.build_metadata([
      { name: 'Hips', parent_name: null },
      { name: 'Tail_A', parent_name: 'Hips' },
      { name: 'Tail_B', parent_name: 'Tail_A' }
    ])

    const mappings = BoneAutoMapper.map_by_canonical_slots(source, target)

    expect(mappings.get('Hips')).toBe('pelvis')
    expect(mappings.get('Tail_A')).toBe('tail_01')
    expect(mappings.get('Tail_B')).toBe('tail_03')
  })

  it('leaves an unrecognisable rig unmapped rather than mapping it wrongly', () => {
    const nonsense: RawBoneRecord[] = [
      { name: 'zzz_00', parent_name: null },
      { name: 'zzz_01', parent_name: 'zzz_00' },
      { name: 'zzz_02', parent_name: 'zzz_01' }
    ]

    expect(map_rig(nonsense).size).toBe(0)
  })

  it('survives a skeleton with a parent cycle', () => {
    const cyclic: RawBoneRecord[] = [
      { name: 'a', parent_name: 'c' },
      { name: 'b', parent_name: 'a' },
      { name: 'c', parent_name: 'b' }
    ]

    expect(() => BoneChainResolver.build_metadata(cyclic)).not.toThrow()
  })
})

describe('template rig detection', () => {
  it('detects a Mixamo rig with and without the mixamorig prefix', () => {
    expect(MixamoMapper.is_target_valid_skeleton(bone_names(mixamo_rig()))).toBe(true)
    expect(MixamoMapper.is_target_valid_skeleton(bone_names(mixamo_rig('')))).toBe(true)
  })

  it('does not mistake other rigs for Mixamo', () => {
    expect(MixamoMapper.is_target_valid_skeleton(bone_names(unreal_rig()))).toBe(false)
    expect(MixamoMapper.is_target_valid_skeleton(bone_names(daz_rig()))).toBe(false)
    expect(MixamoMapper.is_target_valid_skeleton(bone_names(vrm_rig()))).toBe(false)
    expect(MixamoMapper.is_target_valid_skeleton(bone_names(mesh2motion_rig()))).toBe(false)
    expect(MixamoMapper.is_target_valid_skeleton([])).toBe(false)
  })

  it('maps a prefix-stripped Mixamo rig through the exact template table', () => {
    const source = BoneChainResolver.build_metadata(mesh2motion_rig())
    const target = BoneChainResolver.build_metadata(mixamo_rig(''))
    const mappings = MixamoMapper.map_mixamo_bones(source, target)

    expect(mappings.get('LeftForeArm')).toBe('lowerarm_l')
    expect(mappings.get('LeftHandIndex1')).toBe('index_01_l')
    expect(mappings.get('HeadTop_End')).toBe('head_leaf')
    expect(mappings.size).toBe(mixamo_rig('').length)
  })

  it('still maps a prefixed Mixamo rig the way it always did', () => {
    const source = BoneChainResolver.build_metadata(mesh2motion_rig())
    const target = BoneChainResolver.build_metadata(mixamo_rig())
    const mappings = MixamoMapper.map_mixamo_bones(source, target)

    expect(mappings.get('mixamorigLeftForeArm')).toBe('lowerarm_l')
    expect(mappings.size).toBe(mixamo_rig().length)
  })

  it('builds retarget chains from the rig\'s real bone names, not the template\'s', () => {
    // Regression: the retargeter used to feed a detected Mixamo rig a hardcoded
    // chain config spelling every bone "mixamorigX". A rig exported without the
    // prefix resolved to no joints at all, and the empty pelvis chain crashed
    // Rig.buildRigScalar. The chains must come from the actual bone mapping.
    const source = BoneChainResolver.build_metadata(mesh2motion_rig())
    const target = BoneChainResolver.build_metadata(mixamo_rig(''))
    const mappings = MixamoMapper.map_mixamo_bones(source, target)

    const source_config = HumanChainConfig.build_custom_source_config(mappings)
    const target_config = HumanChainConfig.build_custom_target_config(source_config, mappings)

    expect(target_config.pelvis).toEqual(['Hips'])
    expect(target_config.armL).toEqual(['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'])
    expect(target_config.legR).toEqual(['RightUpLeg', 'RightLeg', 'RightFoot'])
    expect(target_config.spine).toEqual(['Spine', 'Spine1', 'Spine2'])

    // every configured bone must actually exist in the target skeleton
    const target_names = new Set<string>(bone_names(mixamo_rig('')))
    for (const chain of Object.values(target_config)) {
      for (const name of chain) {
        if (name === '') continue
        expect(target_names.has(name)).toBe(true)
      }
    }
  })

  it('matches Rigify bones across exporter separator variations', () => {
    const source = BoneChainResolver.build_metadata(mesh2motion_rig())

    const dotted: RawBoneRecord[] = [
      { name: 'DEF-upper_arm.L', parent_name: null },
      { name: 'DEF-f_index.01.L', parent_name: 'DEF-upper_arm.L' }
    ]
    const flattened: RawBoneRecord[] = [
      { name: 'DEF-upper_armL', parent_name: null },
      { name: 'DEF-f_index01L', parent_name: 'DEF-upper_armL' }
    ]

    for (const variant of [dotted, flattened]) {
      const mappings = RigifyMapper.map_rigify_bones(
        source, BoneChainResolver.build_metadata(variant)
      )
      expect([...mappings.values()].sort()).toEqual(['index_01_l', 'upperarm_l'])
    }
  })
})
