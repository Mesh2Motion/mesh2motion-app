import { describe, it, expect } from 'vitest'
import {
  AnimationClip, Bone, Euler, type KeyframeTrack, NumberKeyframeTrack, Quaternion, QuaternionKeyframeTrack, Skeleton, VectorKeyframeTrack
} from 'three'
import { ComposerClipBuilder } from './ComposerClipBuilder'

const fps = 10

/**
 * Small version of the human rig: root > pelvis > (spine_01 > upperarm_l), (thigh_l > calf_l)
 */
function make_skeleton (): Skeleton {
  const names = ['root', 'pelvis', 'spine_01', 'upperarm_l', 'thigh_l', 'calf_l']
  const bones: Record<string, Bone> = {}
  names.forEach((name) => {
    bones[name] = new Bone()
    bones[name].name = name
  })

  bones.root.add(bones.pelvis)
  bones.pelvis.add(bones.spine_01, bones.thigh_l)
  bones.spine_01.add(bones.upperarm_l)
  bones.thigh_l.add(bones.calf_l)

  return new Skeleton(names.map(name => bones[name]))
}

const upper_body_bone_names = ComposerClipBuilder.upper_body_bone_names(make_skeleton(), 'spine_01')

// rotation tracks that hold one constant number on every bone, so it is easy to tell which clip a track came from
function constant_rotation_tracks (bone_names: string[], marker: number, duration: number): QuaternionKeyframeTrack[] {
  return bone_names.map(bone_name =>
    new QuaternionKeyframeTrack(`${bone_name}.quaternion`, [0, duration], [marker, 0, 0, 1, marker, 0, 0, 1])
  )
}

function find_track (clip: AnimationClip, name: string): KeyframeTrack {
  const track = clip.tracks.find(t => t.name === name)
  if (track === undefined) {
    throw new Error(`Track ${name} not found`)
  }
  return track
}

function value_at_frame (track: KeyframeTrack, frame: number): number[] {
  const size = track.getValueSize()
  return Array.from(track.values.slice(frame * size, frame * size + size))
}

describe('ComposerClipBuilder.upper_body_bone_names', () => {
  it('includes the upper body root and everything below it', () => {
    expect([...upper_body_bone_names].sort()).toEqual(['spine_01', 'upperarm_l'])
  })

  it('is empty when the bone is missing', () => {
    expect(ComposerClipBuilder.upper_body_bone_names(make_skeleton(), 'chest').size).toBe(0)
  })
})

describe('ComposerClipBuilder.compose_clip', () => {
  const all_bones = ['root', 'pelvis', 'spine_01', 'upperarm_l', 'thigh_l', 'calf_l']

  it('takes upper bones from the upper clip and every other bone from the lower clip', () => {
    const upper_clip = new AnimationClip('wave', 1, constant_rotation_tracks(all_bones, 0.1, 1))
    const lower_clip = new AnimationClip('walk', 1, constant_rotation_tracks(all_bones, 0.9, 1))

    const clip = ComposerClipBuilder.compose_clip({ upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo' })

    expect(clip.tracks).toHaveLength(all_bones.length)
    expect(value_at_frame(find_track(clip, 'spine_01.quaternion'), 0)[0]).toBeCloseTo(0.1)
    expect(value_at_frame(find_track(clip, 'upperarm_l.quaternion'), 0)[0]).toBeCloseTo(0.1)
    expect(value_at_frame(find_track(clip, 'pelvis.quaternion'), 0)[0]).toBeCloseTo(0.9)
    expect(value_at_frame(find_track(clip, 'calf_l.quaternion'), 0)[0]).toBeCloseTo(0.9)
    expect(clip.name).toBe('combo')
  })

  it('keeps root motion and hip height from the lower clip only', () => {
    const upper_clip = new AnimationClip('wave', 1, [
      new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 5, 0, 0, 5, 0])
    ])
    const lower_clip = new AnimationClip('walk', 1, [
      new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 2]),
      new VectorKeyframeTrack('pelvis.position', [0, 1], [0, 1, 0, 0, 1, 0])
    ])

    const clip = ComposerClipBuilder.compose_clip({ upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo' })

    expect(clip.tracks.map(t => t.name).sort()).toEqual(['pelvis.position', 'root.position'])
    expect(value_at_frame(find_track(clip, 'pelvis.position'), 0)).toEqual([0, 1, 0])
    expect(value_at_frame(find_track(clip, 'root.position'), 10)[2]).toBeCloseTo(2)
  })

  it('stretches a shorter upper clip to the length of the lower clip', () => {
    // upper clip rises from 0 to 1 over half a second
    const upper_clip = new AnimationClip('wave', 0.5, [
      new NumberKeyframeTrack('spine_01.morph', [0, 0.5], [0, 1])
    ])
    const lower_clip = new AnimationClip('walk', 2, constant_rotation_tracks(['pelvis'], 0, 2))

    const clip = ComposerClipBuilder.compose_clip({ upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo' })
    const upper_track = find_track(clip, 'spine_01.morph')

    expect(clip.duration).toBe(2)
    expect(upper_track.times).toHaveLength(21) // 2 seconds at 10 fps, including the last frame
    expect(value_at_frame(upper_track, 5)[0]).toBeCloseTo(0.25) // a quarter of the way through
    expect(value_at_frame(upper_track, 10)[0]).toBeCloseTo(0.5) // halfway
    expect(value_at_frame(upper_track, 20)[0]).toBeCloseTo(1) // ends together with the lower clip
  })

  it('stretches a shorter lower clip to the length of the upper clip', () => {
    const upper_clip = new AnimationClip('wave', 3, constant_rotation_tracks(['spine_01'], 0.1, 3))
    // lower clip moves the root from 0 to 2 over one second
    const lower_clip = new AnimationClip('walk', 1, [
      new VectorKeyframeTrack('root.position', [0, 1], [0, 0, 0, 0, 0, 2])
    ])

    const clip = ComposerClipBuilder.compose_clip({ upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo' })
    const root_track = find_track(clip, 'root.position')

    expect(clip.duration).toBe(3)
    expect(root_track.times[root_track.times.length - 1]).toBeCloseTo(3)
    expect(value_at_frame(root_track, 15)[2]).toBeCloseTo(1) // halfway
    expect(value_at_frame(root_track, 30)[2]).toBeCloseTo(2) // ends together with the upper clip
  })

  it('uses the upper clip length when the lower clip is a single pose', () => {
    const upper_clip = new AnimationClip('wave', 1.5, constant_rotation_tracks(['spine_01'], 0.1, 1.5))
    const lower_clip = new AnimationClip('pose', 0, [
      new QuaternionKeyframeTrack('pelvis.quaternion', [0], [0.9, 0, 0, 1])
    ])

    const clip = ComposerClipBuilder.compose_clip({ upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo' })

    expect(clip.duration).toBe(1.5)
    expect(value_at_frame(find_track(clip, 'pelvis.quaternion'), 15)[0]).toBeCloseTo(0.9)
  })

  it('does not change the source clips', () => {
    const upper_clip = new AnimationClip('wave', 1, constant_rotation_tracks(['spine_01'], 0.1, 1))
    const lower_clip = new AnimationClip('walk', 1, constant_rotation_tracks(['pelvis'], 0.9, 1))

    ComposerClipBuilder.compose_clip({ upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo' })

    expect(Array.from(upper_clip.tracks[0].times)).toEqual([0, 1])
    expect(Array.from(lower_clip.tracks[0].times)).toEqual([0, 1])
  })
})

describe('ComposerClipBuilder upright upper body', () => {
  // turning the hips this far forward is roughly what a crouch does
  const hips_tilted = new Quaternion().setFromEuler(new Euler(Math.PI / 4, 0, 0))
  const spine_twist = new Quaternion().setFromEuler(new Euler(0, Math.PI / 6, 0))

  function rotation_track (bone_name: string, rotation: Quaternion, duration: number = 1): QuaternionKeyframeTrack {
    const values = [...rotation.toArray(), ...rotation.toArray()]
    return new QuaternionKeyframeTrack(`${bone_name}.quaternion`, [0, duration], values)
  }

  function frame_rotation (clip: AnimationClip, bone_name: string, frame: number): Quaternion {
    return new Quaternion().fromArray(value_at_frame(find_track(clip, `${bone_name}.quaternion`), frame))
  }

  it('finds the upper body root and the bones between it and the skeleton root', () => {
    const rig = ComposerClipBuilder.upright_upper_body_rig(make_skeleton(), 'spine_01')

    expect(rig?.upper_body_root.name).toBe('spine_01')
    expect(rig?.parent_chain.map(bone => bone.name)).toEqual(['pelvis'])
    expect(ComposerClipBuilder.upright_upper_body_rig(make_skeleton(), 'chest')).toBeUndefined()
  })

  it('keeps the upper body facing the way it did in the upper clip', () => {
    const rig = ComposerClipBuilder.upright_upper_body_rig(make_skeleton(), 'spine_01')
    const upper_clip = new AnimationClip('wave', 1, [rotation_track('spine_01', spine_twist)])
    const lower_clip = new AnimationClip('crouch', 1, [rotation_track('pelvis', hips_tilted)])

    const clip = ComposerClipBuilder.compose_clip({
      upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo', upright_upper_body: rig
    })

    // the hips still tilt, but hips * spine ends up where the upper clip had it (upper clip hips are at rest)
    const pelvis = frame_rotation(clip, 'pelvis', 5)
    const spine = frame_rotation(clip, 'spine_01', 5)
    expect(pelvis.angleTo(hips_tilted)).toBeCloseTo(0)
    expect(pelvis.multiply(spine).angleTo(spine_twist)).toBeCloseTo(0)
  })

  it('makes no difference when both clips have the same hips', () => {
    const rig = ComposerClipBuilder.upright_upper_body_rig(make_skeleton(), 'spine_01')
    const upper_clip = new AnimationClip('wave', 1, [rotation_track('pelvis', hips_tilted), rotation_track('spine_01', spine_twist)])
    const lower_clip = new AnimationClip('walk', 1, [rotation_track('pelvis', hips_tilted)])

    const clip = ComposerClipBuilder.compose_clip({
      upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo', upright_upper_body: rig
    })

    expect(frame_rotation(clip, 'spine_01', 3).angleTo(spine_twist)).toBeCloseTo(0)
  })

  it('adds an upper body root track when the upper clip has none', () => {
    const rig = ComposerClipBuilder.upright_upper_body_rig(make_skeleton(), 'spine_01')
    const upper_clip = new AnimationClip('wave', 1, [rotation_track('upperarm_l', spine_twist)])
    const lower_clip = new AnimationClip('crouch', 1, [rotation_track('pelvis', hips_tilted)])

    const clip = ComposerClipBuilder.compose_clip({
      upper_clip, lower_clip, upper_body_bone_names, fps, name: 'combo', upright_upper_body: rig
    })

    // the spine cancels the hip tilt, so the upper body stays at its rest orientation
    expect(frame_rotation(clip, 'spine_01', 0).angleTo(hips_tilted.clone().invert())).toBeCloseTo(0)
  })
})
