import { describe, expect, it } from 'vitest'
import {
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  type AnimationClip,
  type Interpolant,
  type KeyframeTrack
} from 'three'
import { document_to_animation_clip } from './conversion'
import { create_agent_wave_01_document } from './fixtures/AgentWave01'
import { make_bone_id_resolver, bone_identities } from './rigIdentity'
import { create_agent_wave_skeleton } from './fixtures/AgentWave01'
import { normalize_quaternion, slerp_quaternion } from './conventions'
import type { AnimationDocument } from './types'

function resolver () {
  return make_bone_id_resolver(bone_identities(create_agent_wave_skeleton(), 'human'))
}

function track_of (clip: AnimationClip, name: string): KeyframeTrack {
  const track = clip.tracks.find((candidate) => candidate.name === name)
  if (track === undefined) {
    throw new Error(`missing track ${name}`)
  }
  return track
}

/** createInterpolant is assigned at runtime and missing from three's types. */
type InterpolatableTrack = KeyframeTrack & { createInterpolant: () => Interpolant }

function interpolant_of (track: KeyframeTrack): Interpolant {
  return (track as InterpolatableTrack).createInterpolant()
}

describe('document_to_animation_clip', () => {
  it('converts the Agent_Wave_01 fixture to a two-second clip', () => {
    const document = create_agent_wave_01_document()
    const clip = document_to_animation_clip(document, { resolve_bone_name: resolver() })
    expect(clip.name).toBe('Agent_Wave_01')
    expect(clip.duration).toBeCloseTo(2)
    expect(clip.tracks).toHaveLength(5)
    expect(clip.tracks.every((track) => track instanceof QuaternionKeyframeTrack)).toBe(true)
    expect(clip.tracks.map((track) => track.name)).toContain('upperarm.R.quaternion')
  })

  it('uses a binding prefix when requested', () => {
    const clip = document_to_animation_clip(create_agent_wave_01_document(), {
      resolve_bone_name: resolver(),
      binding_prefix: 'bones['
    })
    expect(clip.tracks[0].name).toMatch(/^bones\[/)
  })

  it('creates vector tracks for position and scale channels', () => {
    const document = create_agent_wave_01_document()
    const vector_document: AnimationDocument = {
      ...document,
      channels: [{
        bone_id: 'human:bone:000',
        property: 'position',
        keyframes: [
          { time_seconds: 0, values: [0, 1, 0], interpolation: 'linear' },
          { time_seconds: 1, values: [0, 2, 0], interpolation: 'linear' }
        ]
      }]
    }
    const clip = document_to_animation_clip(vector_document, { resolve_bone_name: resolver() })
    expect(clip.tracks[0]).toBeInstanceOf(VectorKeyframeTrack)
    expect(clip.tracks[0].name).toBe('hips.position')
  })

  it('encodes step interpolation as held values', () => {
    const document = create_agent_wave_01_document()
    const step_document: AnimationDocument = {
      ...document,
      channels: [{
        bone_id: 'human:bone:000',
        property: 'scale',
        keyframes: [
          { time_seconds: 0, values: [1, 1, 1], interpolation: 'step' },
          { time_seconds: 0.5, values: [2, 2, 2], interpolation: 'step' },
          { time_seconds: 1, values: [3, 3, 3], interpolation: 'step' }
        ]
      }]
    }
    const clip = document_to_animation_clip(step_document, { resolve_bone_name: resolver() })
    const track = clip.tracks[0]
    const interpolant = interpolant_of(track)
    expect(Array.from(interpolant.evaluate(0.25) as ArrayLike<number>)).toEqual([1, 1, 1])
    expect(Array.from(interpolant.evaluate(0.75) as ArrayLike<number>)).toEqual([2, 2, 2])
  })

  it('rejects invalid documents and unresolved bone IDs', () => {
    const document = create_agent_wave_01_document()
    document.clip.name = ''
    expect(() => document_to_animation_clip(document, { resolve_bone_name: resolver() })).toThrow(/invalid AnimationDocument/)
    const valid = create_agent_wave_01_document()
    expect(() => document_to_animation_clip(valid, { resolve_bone_name: () => undefined })).toThrow(/cannot resolve bone_id/)
  })

  it('does not mutate the source document', () => {
    const document = create_agent_wave_01_document()
    const before = JSON.stringify(document)
    document_to_animation_clip(document, { resolve_bone_name: resolver() })
    expect(JSON.stringify(document)).toBe(before)
  })
})

describe('transform equivalence', () => {
  it('matches the pure slerp convention at sampled times', () => {
    const document = create_agent_wave_01_document()
    const clip = document_to_animation_clip(document, { resolve_bone_name: resolver() })
    const track = track_of(clip, 'upperarm.R.quaternion')
    const interpolant = interpolant_of(track)
    const source = document.channels.find((channel) => channel.bone_id === 'human:bone:010')
    expect(source).toBeDefined()
    if (source === undefined) return
    const [first, second] = source.keyframes
    const sampled = Array.from(interpolant.evaluate(0.125) as ArrayLike<number>)
    const expected = slerp_quaternion(first.values, second.values, 0.5)
    const normalized = normalize_quaternion(sampled)
    // q and -q represent the same rotation; choose the hemisphere matching
    // the expected quaternion before comparing component values.
    const dot = normalized.reduce((sum, value, index) => sum + value * expected[index], 0)
    const aligned = dot < 0 ? normalized.map((value) => -value) : normalized
    expected.forEach((value, index) => {
      expect(aligned[index]).toBeCloseTo(value, 4)
    })
  })
})
