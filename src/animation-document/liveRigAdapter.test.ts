import { describe, expect, it } from 'vitest'
import { Skeleton } from 'three'
import {
  SUPPORTED_RIG_IDENTIFIERS,
  UnsupportedRigError,
  check_rig_compatibility,
  create_document_from_live_rig,
  draft_document_to_clip,
  is_supported_rig,
  read_live_rig
} from './liveRigAdapter'
import { create_agent_wave_skeleton } from './fixtures/AgentWave01'
import { validate_document } from './validation'

describe('read_live_rig', () => {
  it('reads real bones, parents and rest transforms from the live skeleton', () => {
    const skeleton = create_agent_wave_skeleton()
    const catalog = read_live_rig(skeleton, 'human')
    expect(catalog.bones).toHaveLength(skeleton.bones.length)
    expect(catalog.bones[0]).toMatchObject({
      id: 'human:bone:000', display_name: 'hips', index: 0, parent_id: null
    })
    expect(catalog.bones[10]).toMatchObject({ id: 'human:bone:010', display_name: 'upperarm.R' })
    expect(catalog.bones[10].parent_id).toBe('human:bone:009')
    expect(catalog.bones[0].local_position).toEqual([0, 1, 0])
    expect(catalog.bones[0].local_quaternion).toEqual([0, 0, 0, 1])
    expect(catalog.bones[0].local_scale).toEqual([1, 1, 1])
    expect(catalog.rig.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects unsupported rigs', () => {
    expect(() => read_live_rig(create_agent_wave_skeleton(), 'dragon')).toThrow(UnsupportedRigError)
    expect(is_supported_rig('horse')).toBe(true)
    expect(SUPPORTED_RIG_IDENTIFIERS).toEqual(['human', 'fox', 'horse'])
  })
})

describe('create_document_from_live_rig', () => {
  it('creates a valid revision-1 document bound to the live rig', () => {
    const skeleton = create_agent_wave_skeleton()
    const document = create_document_from_live_rig({
      skeleton,
      rig_identifier: 'human',
      clip_name: 'Live Draft',
      duration_seconds: 1
    })
    expect(document.revision).toBe(1)
    expect(document.validation.state).toBe('valid')
    expect(validate_document(document, { live_fingerprint: read_live_rig(skeleton, 'human').rig.fingerprint }).state).toBe('valid')
  })

  it('rejects an unsupported rig identifier', () => {
    expect(() => create_document_from_live_rig({
      skeleton: create_agent_wave_skeleton(),
      rig_identifier: 'spider',
      clip_name: 'x',
      duration_seconds: 1
    })).toThrow(UnsupportedRigError)
  })
})

describe('check_rig_compatibility', () => {
  it('accepts an unchanged rig', () => {
    const skeleton = create_agent_wave_skeleton()
    const document = create_document_from_live_rig({
      skeleton, rig_identifier: 'human', clip_name: 'draft', duration_seconds: 1
    })
    expect(check_rig_compatibility(document, skeleton)).toMatchObject({ compatible: true, kind: 'compatible' })
  })

  it('rejects a renamed bone instead of silently redirecting by name', () => {
    const skeleton = create_agent_wave_skeleton()
    const document = create_document_from_live_rig({
      skeleton, rig_identifier: 'human', clip_name: 'draft', duration_seconds: 1
    })
    skeleton.bones[10].name = 'totally_different_arm'
    const result = check_rig_compatibility(document, skeleton)
    expect(result.compatible).toBe(false)
    expect(result.kind).toBe('renamed')
    expect(() => draft_document_to_clip(document, skeleton)).toThrow(/incompatible live rig \(renamed\)/)
  })

  it('rejects a reordered skeleton', () => {
    const original = create_agent_wave_skeleton()
    const document = create_document_from_live_rig({
      skeleton: original, rig_identifier: 'human', clip_name: 'draft', duration_seconds: 1
    })
    const reordered = new Skeleton([original.bones[1], original.bones[0], ...original.bones.slice(2)])
    const result = check_rig_compatibility(document, reordered)
    expect(result.compatible).toBe(false)
    expect(result.details.length).toBeGreaterThan(0)
    expect(result.document_fingerprint).not.toBe(result.live_fingerprint)
    expect(() => draft_document_to_clip(document, reordered)).toThrow(/incompatible live rig/)
  })

  it('rejects a reparented bone', () => {
    const skeleton = create_agent_wave_skeleton()
    const document = create_document_from_live_rig({
      skeleton, rig_identifier: 'human', clip_name: 'draft', duration_seconds: 1
    })
    const head = skeleton.bones[4]
    const forearm = skeleton.bones[7]
    if (head === undefined || forearm === undefined) throw new Error('fixture skeleton too small')
    head.parent?.remove(head)
    forearm.add(head)
    const result = check_rig_compatibility(document, skeleton)
    expect(result.compatible).toBe(false)
    expect(result.kind).toBe('reparented')
  })

  it('rejects a changed rest transform when names and hierarchy are stable', () => {
    const skeleton = create_agent_wave_skeleton()
    const document = create_document_from_live_rig({
      skeleton, rig_identifier: 'human', clip_name: 'draft', duration_seconds: 1
    })
    skeleton.bones[2].position.x = 0.5
    skeleton.bones[0].updateWorldMatrix(true, true)
    skeleton.calculateInverses()
    const result = check_rig_compatibility(document, skeleton)
    expect(result.compatible).toBe(false)
    expect(result.kind).toBe('rest-transform-changed')
  })
})

describe('draft_document_to_clip', () => {
  it('converts a live-rig draft with live bone names', () => {
    const skeleton = create_agent_wave_skeleton()
    const document = create_document_from_live_rig({
      skeleton, rig_identifier: 'human', clip_name: 'Live Draft', duration_seconds: 1
    })
    document.channels.push({
      bone_id: 'human:bone:010',
      property: 'quaternion',
      keyframes: [
        { time_seconds: 0, values: [0, 0, 0, 1], interpolation: 'slerp' },
        { time_seconds: 1, values: [0, 0, 0.5, Math.sqrt(0.75)], interpolation: 'slerp' }
      ]
    })
    const clip = draft_document_to_clip(document, skeleton)
    expect(clip.name).toBe('Live Draft')
    expect(clip.tracks[0].name).toBe('upperarm.R.quaternion')
  })
})
