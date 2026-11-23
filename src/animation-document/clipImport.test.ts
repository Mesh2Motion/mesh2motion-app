import { describe, expect, it } from 'vitest'
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import { create_empty_document } from './create'
import { import_clip_as_document } from './clipImport'
import { make_test_rig } from '../authoringObservation/testFixtures'

function template () {
  return create_empty_document({
    skeleton: make_test_rig().skeleton,
    rig_identifier: 'human',
    clip_name: 'Base',
    duration_seconds: 2
  })
}

describe('From Existing Animation clip import', () => {
  it('copies quaternion and position tracks into new document channels', () => {
    const base = template()
    const clip = new AnimationClip('Idle_A', 2, [
      new QuaternionKeyframeTrack('upperarm_r.quaternion', [0, 1, 2], [0, 0, 0, 1, 0, 0.7071, 0, 0.7071, 0, 0, 0, 1]),
      new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 1, 0, 0, 1.1, 0])
    ])
    const { document, report } = import_clip_as_document(clip, base, 'Idle_A')
    expect(report.imported).toBe(2)
    expect(report.skipped).toHaveLength(0)
    expect(document.channels).toHaveLength(2)
    expect(document.clip.name).toBe('Idle_A (imported)')
    expect(document.clip.duration_seconds).toBe(2)
    const quaternion = document.channels.find((channel) => channel.property === 'quaternion')!
    expect(quaternion.keyframes).toHaveLength(3)
    expect(quaternion.keyframes[0].interpolation).toBe('slerp')
    const position = document.channels.find((channel) => channel.property === 'position')!
    expect(position.keyframes[0].values).toEqual([0, 1, 0])
  })

  it('does not silently invent bones for unmatched tracks', () => {
    const base = template()
    const clip = new AnimationClip('Unknown', 1, [
      new QuaternionKeyframeTrack('not_a_bone.quaternion', [0], [0, 0, 0, 1])
    ])
    const { document, report } = import_clip_as_document(clip, base, 'Unknown')
    expect(document.channels).toHaveLength(0)
    expect(report.skipped).toEqual(['not_a_bone.quaternion'])
  })

  it('collapses duplicate step times so the document validates', () => {
    const base = template()
    const clip = new AnimationClip('Step', 1, [
      new VectorKeyframeTrack('pelvis.position', [0, 0.5, 0.5, 1], [0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0])
    ])
    const { document } = import_clip_as_document(clip, base, 'Step')
    const channel = document.channels[0]
    expect(channel.keyframes.map((key) => key.time_seconds)).toEqual([0, 0.5, 1])
    expect(document.validation.state).toBe('valid')
  })

  it('normalizes imported quaternions to unit length', () => {
    const base = template()
    const clip = new AnimationClip('Scale', 1, [
      new QuaternionKeyframeTrack('upperarm_l.quaternion', [0], [0, 0, 0, 5])
    ])
    const { document } = import_clip_as_document(clip, base, 'Scale')
    expect(document.channels[0].keyframes[0].values).toEqual([0, 0, 0, 1])
  })
})
