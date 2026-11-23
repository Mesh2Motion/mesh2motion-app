import { describe, expect, it } from 'vitest'
import { type AnimationClip, type Interpolant, type KeyframeTrack } from 'three'
import {
  AGENT_WAVE_01_CLIP_NAME,
  AGENT_WAVE_01_DURATION,
  create_agent_wave_01_document,
  create_agent_wave_skeleton
} from './AgentWave01'
import { validate_document } from '../validation'
import { document_to_animation_clip } from '../conversion'
import { bone_identities, make_bone_id_resolver } from '../rigIdentity'
import { ExportAnimationCleanupService } from '../../lib/processes/export-to-file/ExportAnimationCleanupService'
import type { AnimationDocument } from '../types'

const resolver = () => make_bone_id_resolver(bone_identities(create_agent_wave_skeleton(), 'human'))

type InterpolatableTrack = KeyframeTrack & { createInterpolant: () => Interpolant }

function sample_clip (clip: AnimationClip, track_name: string, time: number): number[] {
  const track = clip.tracks.find((candidate) => candidate.name === track_name)
  if (track === undefined) throw new Error(`missing ${track_name}`)
  const interpolant = (track as InterpolatableTrack).createInterpolant()
  return Array.from(interpolant.evaluate(time) as ArrayLike<number>)
}

function expect_clips_equivalent (first: AnimationClip, second: AnimationClip): void {
  expect(first.name).toBe(second.name)
  expect(first.duration).toBeCloseTo(second.duration, 6)
  expect(first.tracks.map((track) => track.name).sort()).toEqual(second.tracks.map((track) => track.name).sort())
  for (const time of [0, 0.25, 0.5, 1, 1.5, 2]) {
    for (const track of first.tracks) {
      const a = sample_clip(first, track.name, time)
      const b = sample_clip(second, track.name, time)
      expect(a.length).toBe(b.length)
      for (let i = 0; i < a.length; i++) {
        expect(a[i]).toBeCloseTo(b[i], 5)
      }
    }
  }
}

describe('Agent_Wave_01 fixture', () => {
  it('is an original two-second Human rotation clip', () => {
    const document = create_agent_wave_01_document()
    expect(document.clip.name).toBe(AGENT_WAVE_01_CLIP_NAME)
    expect(document.clip.duration_seconds).toBe(AGENT_WAVE_01_DURATION)
    expect(document.rig.identifier).toBe('human')
    expect(document.revision).toBe(1)
    expect(document.validation.state).toBe('valid')
    expect(document.channels.length).toBeGreaterThanOrEqual(5)
    expect(document.channels.every((channel) => channel.property === 'quaternion')).toBe(true)
    expect(document.channels.every((channel) => channel.keyframes.every(
      (keyframe) => keyframe.interpolation === 'slerp'))).toBe(true)
  })

  it('does not reuse an existing clip source', () => {
    const first = create_agent_wave_01_document()
    const second = create_agent_wave_01_document()
    expect(first).toEqual(second)
    expect(validate_document(first).state).toBe('valid')
    expect(first.channels.some((channel) => channel.bone_id.startsWith('human:bone:'))).toBe(true)
  })

  it('survives JSON export/reimport with transform equivalence', () => {
    const document = create_agent_wave_01_document()
    const serialized = JSON.stringify(document)
    const reimported = JSON.parse(serialized) as AnimationDocument
    expect(validate_document(reimported).state).toBe('valid')
    expect_clips_equivalent(
      document_to_animation_clip(document, { resolve_bone_name: resolver() }),
      document_to_animation_clip(reimported, { resolve_bone_name: resolver() })
    )
  })

  it('preserves transforms through the existing export cleanup pipeline', () => {
    const document = create_agent_wave_01_document()
    const before = document_to_animation_clip(document, { resolve_bone_name: resolver() })
    const after = document_to_animation_clip(document, { resolve_bone_name: resolver() })
    const skeleton = create_agent_wave_skeleton()
    ExportAnimationCleanupService.clean_clips_for_export([after], [skeleton.bones[0]])
    expect(after.tracks.length).toBe(before.tracks.length)
    expect_clips_equivalent(before, after)
  })
})
