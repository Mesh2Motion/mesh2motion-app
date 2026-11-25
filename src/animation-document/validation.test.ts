import { describe, expect, it } from 'vitest'
import { validate_document, with_validation } from './validation'
import type { AnimationDocument } from './types'
import { create_agent_wave_01_document } from './fixtures/AgentWave01'

function base_document (): AnimationDocument {
  return {
    schema_version: 'animation-document/v1',
    rig: { identifier: 'human', fingerprint: 'abc123' },
    bones: [{ id: 'human:bone:000', display_name: 'hips', index: 0, parent_id: null }],
    clip: { name: 'test', duration_seconds: 1 },
    channels: [{
      bone_id: 'human:bone:000',
      property: 'position',
      keyframes: [
        { time_seconds: 0, values: [0, 0, 0], interpolation: 'linear' },
        { time_seconds: 1, values: [1, 2, 3], interpolation: 'linear' }
      ]
    }],
    revision: 1,
    validation: { state: 'draft', errors: [] }
  }
}

describe('validate_document', () => {
  it('accepts a well-formed document deterministically', () => {
    const document = base_document()
    const first = validate_document(document)
    const second = validate_document(document)
    expect(first).toEqual(second)
    expect(first.state).toBe('valid')
    expect(first.errors).toEqual([])
  })

  it('rejects NaN and infinite values', () => {
    const document = base_document()
    document.channels[0].keyframes[1].values[1] = Number.NaN
    expect(validate_document(document).errors).toContain(
      'channel human:bone:000.position keyframe 1: non-finite value at index 1')
    document.channels[0].keyframes[1].values[1] = Infinity
    expect(validate_document(document).errors.some((error) => error.includes('non-finite value'))).toBe(true)
  })

  it('rejects negative, decreasing and out-of-range times', () => {
    const document = base_document()
    document.channels[0].keyframes[1].time_seconds = -0.1
    expect(validate_document(document).errors.some((error) => error.includes('negative time'))).toBe(true)
    document.channels[0].keyframes[1].time_seconds = 2
    expect(validate_document(document).errors.some((error) => error.includes('exceeds clip duration'))).toBe(true)
    document.channels[0].keyframes[0].time_seconds = 0.5
    document.channels[0].keyframes[1].time_seconds = 0.5
    expect(validate_document(document).errors.some((error) => error.includes('not strictly increasing'))).toBe(true)
  })

  it('rejects invalid duration, empty name and wrong schema', () => {
    const document = base_document()
    document.clip.duration_seconds = 0
    expect(validate_document(document).errors).toContain('clip.duration_seconds: out of bounds')
    document.clip.duration_seconds = 1
    document.clip.name = '  '
    expect(validate_document(document).errors).toContain('clip.name: empty clip name')
    document.clip.name = 'test'
    document.schema_version = 'animation-document/v2' as typeof document.schema_version
    expect(validate_document(document).errors.some((error) => error.includes('schema_version'))).toBe(true)
  })

  it('accepts every positive duration and rejects zero', () => {
    const document = base_document()
    document.clip.duration_seconds = 0.0005
    document.channels[0].keyframes[1].time_seconds = 0.0005
    expect(validate_document(document).state).toBe('valid')
    document.clip.duration_seconds = 0
    expect(validate_document(document).errors).toContain('clip.duration_seconds: out of bounds')
  })

  it('rejects invalid bones and unknown bone references', () => {
    const document = base_document()
    document.channels[0].bone_id = 'human:bone:999'
    expect(validate_document(document).errors.some((error) => error.includes('unknown bone_id'))).toBe(true)
    document.channels[0].bone_id = 'human:bone:000'
    document.bones[0].parent_id = 'human:bone:000'
    expect(validate_document(document).errors).toContain('bones[0]: self-parent')
  })

  it('checks the live skeleton fingerprint when supplied', () => {
    const document = base_document()
    expect(validate_document(document, { live_fingerprint: 'abc123' }).state).toBe('valid')
    expect(validate_document(document, { live_fingerprint: 'def456' }).errors.some(
      (error) => error.includes('incompatible with live rig'))).toBe(true)
  })

  it('enforces value arity and quaternion normalization', () => {
    const document = base_document()
    document.channels[0].property = 'quaternion'
    document.channels[0].keyframes[0].interpolation = 'slerp'
    document.channels[0].keyframes[1].interpolation = 'slerp'
    document.channels[0].keyframes[0].values = [0, 0, 0]
    expect(validate_document(document).errors.some((error) => error.includes('expected 4 values'))).toBe(true)
    document.channels[0].keyframes[0].values = [0, 0, 0, 0]
    expect(validate_document(document).errors.some((error) => error.includes('zero-length quaternion'))).toBe(true)
    document.channels[0].keyframes[0].values = [0, 0, 0, 1]
    document.channels[0].keyframes[1].values = [0, 0, 0, 1]
    expect(validate_document(document).state).toBe('valid')
    document.channels[0].keyframes[0].values = [0, 0, 0, 2]
    expect(validate_document(document).errors).toContain(
      'channel human:bone:000.quaternion keyframe 0: quaternion must be normalized')
    document.channels[0].keyframes[0].values = [0, 0, 0, 1]
    document.channels[0].keyframes[0].interpolation = 'linear'
    expect(validate_document(document).errors).toContain(
      'channel human:bone:000.quaternion keyframe 0: quaternion interpolation must be slerp or step')
  })

  it('rejects slerp on position and scale channels', () => {
    const document = base_document()
    document.channels[0].keyframes[0].interpolation = 'slerp'
    expect(validate_document(document).errors).toContain(
      'channel human:bone:000.position keyframe 0: slerp is only valid for quaternion channels')
  })

  it('with_validation returns a copy and does not mutate input', () => {
    const document = base_document()
    document.clip.name = ''
    const validated = with_validation(document)
    expect(validated).not.toBe(document)
    expect(validated.validation.state).toBe('invalid')
    expect(document.validation.state).toBe('draft')
  })

  it('validates the Agent_Wave_01 fixture', () => {
    expect(validate_document(create_agent_wave_01_document()).state).toBe('valid')
  })
})
