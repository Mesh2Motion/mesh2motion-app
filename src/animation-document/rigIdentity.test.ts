import { describe, expect, it } from 'vitest'
import { Bone, Skeleton, Vector3 } from 'three'
import {
  bone_identities,
  bone_rest_transforms,
  compute_rig_fingerprint,
  make_bone_id_resolver,
  rig_descriptor,
  stable_bone_id
} from './rigIdentity'
import { create_agent_wave_skeleton } from './fixtures/AgentWave01'

describe('rig identity', () => {
  it('derives stable IDs from skeleton index, not display names', () => {
    expect(stable_bone_id('human', 0)).toBe('human:bone:000')
    expect(stable_bone_id('fox', 12)).toBe('fox:bone:012')
    const skeleton = create_agent_wave_skeleton()
    const identities = bone_identities(skeleton, 'human')
    expect(identities[0]).toEqual({ id: 'human:bone:000', display_name: 'hips', index: 0, parent_id: null })
    expect(identities[1].parent_id).toBe('human:bone:000')
    expect(identities[10].display_name).toBe('upperarm.R')
  })

  it('keeps the ID when a bone display name is renamed', () => {
    const skeleton = create_agent_wave_skeleton()
    const before = bone_identities(skeleton, 'human')
    skeleton.bones[10].name = 'renamed_upper_arm'
    const after = bone_identities(skeleton, 'human')
    expect(after[10].id).toBe(before[10].id)
    expect(after[10].display_name).toBe('renamed_upper_arm')
  })

  it('changes the fingerprint on structural or rest-pose changes', () => {
    const skeleton = create_agent_wave_skeleton()
    const fingerprint = compute_rig_fingerprint(skeleton)
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(compute_rig_fingerprint(create_agent_wave_skeleton())).toBe(fingerprint)
    skeleton.bones[10].position.x += 0.01
    skeleton.bones[0].updateWorldMatrix(true, true)
    skeleton.calculateInverses()
    expect(compute_rig_fingerprint(skeleton)).not.toBe(fingerprint)
  })

  it('keeps the rig fingerprint and catalog rest transforms stable while bones are animated', () => {
    const skeleton = create_agent_wave_skeleton()
    const fingerprint = compute_rig_fingerprint(skeleton)
    const rest = bone_rest_transforms(skeleton)
    skeleton.bones[10].position.x += 0.4
    skeleton.bones[10].quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.8)
    expect(compute_rig_fingerprint(skeleton)).toBe(fingerprint)
    expect(bone_rest_transforms(skeleton)[10]).toEqual(rest[10])
  })

  it('produces identical fingerprints for structurally identical skeletons', () => {
    const first = create_agent_wave_skeleton()
    const second = create_agent_wave_skeleton()
    expect(compute_rig_fingerprint(first)).toBe(compute_rig_fingerprint(second))
    expect(rig_descriptor(first, 'human')).toEqual(rig_descriptor(second, 'human'))
  })

  it('resolves stable IDs to live bone names for PropertyBinding', () => {
    const skeleton = create_agent_wave_skeleton()
    const resolver = make_bone_id_resolver(bone_identities(skeleton, 'human'))
    expect(resolver('human:bone:010')).toBe('upperarm.R')
    expect(resolver('human:bone:999')).toBeUndefined()
  })

  it('handles unparented bones', () => {
    const bone = new Bone()
    bone.name = 'root'
    const skeleton = new Skeleton([bone])
    expect(bone_identities(skeleton, 'human')[0].parent_id).toBeNull()
  })
})
