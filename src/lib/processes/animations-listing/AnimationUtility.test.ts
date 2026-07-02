import { describe, it, expect } from 'vitest'
import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack } from 'three'
import { AnimationUtility } from './AnimationUtility'

/**
 * Builds a simple clip with one quaternion track per bone name provided.
 * Track names follow the `boneName.quaternion` convention the app uses.
 */
function create_clip (name: string, bone_names: string[]): AnimationClip {
  const tracks = bone_names.map((bone_name) =>
    new QuaternionKeyframeTrack(`${bone_name}.quaternion`, [0], [0, 0, 0, 1]))
  return new AnimationClip(name, 1, tracks)
}

function track_bone_names (clip: AnimationClip): string[] {
  return clip.tracks.map((track) => track.name.split('.')[0])
}

describe('AnimationUtility.strip_tracks_for_missing_bones', () => {
  it('removes tracks whose bone is not on the rig', () => {
    const clip = create_clip('walk', ['pelvis', 'upperarm_l', 'thumb_02_l', 'index_03_r'])
    const valid_bones = new Set(['pelvis', 'upperarm_l'])

    AnimationUtility.strip_tracks_for_missing_bones([clip], valid_bones)

    expect(track_bone_names(clip).sort()).toEqual(['pelvis', 'upperarm_l'])
  })

  it('is case-insensitive against the lowercased valid set', () => {
    const clip = create_clip('walk', ['Pelvis', 'UpperArm_L'])
    // extract_bone_name_from_track lowercases, so the set must be lowercased too
    const valid_bones = new Set(['pelvis', 'upperarm_l'])

    AnimationUtility.strip_tracks_for_missing_bones([clip], valid_bones)

    expect(clip.tracks.length).toBe(2)
  })

  it('preserves the root position track (root bone exists on the rig)', () => {
    const clip = new AnimationClip('run_RM', 1, [
      new QuaternionKeyframeTrack('pelvis.quaternion', [0], [0, 0, 0, 1]),
      new NumberKeyframeTrack('root.position', [0], [0, 0, 0]),
      new QuaternionKeyframeTrack('thumb_02_l.quaternion', [0], [0, 0, 0, 1])
    ])
    const valid_bones = new Set(['pelvis', 'root'])

    AnimationUtility.strip_tracks_for_missing_bones([clip], valid_bones)

    const names = clip.tracks.map((t) => t.name).sort()
    expect(names).toEqual(['pelvis.quaternion', 'root.position'])
  })

  it('is a no-op when the valid set is undefined', () => {
    const clip = create_clip('walk', ['pelvis', 'thumb_02_l'])

    AnimationUtility.strip_tracks_for_missing_bones([clip], undefined)

    expect(clip.tracks.length).toBe(2)
  })

  it('is a no-op when the valid set is empty', () => {
    const clip = create_clip('walk', ['pelvis', 'thumb_02_l'])

    AnimationUtility.strip_tracks_for_missing_bones([clip], new Set())

    expect(clip.tracks.length).toBe(2)
  })
})
