import { describe, expect, it } from 'vitest'
import { AnimationMixer, Bone, Group, Quaternion, Skeleton, Vector3 } from 'three'
import { FacialSkeleton } from '../edit-skeleton/FacialSkeleton'
import { FacialAnimations } from './FacialAnimations'

function rig (): Skeleton {
  const root = new Bone()
  root.name = 'root'
  const neck = new Bone()
  neck.position.y = 1.5
  const head = new Bone()
  head.name = 'head'
  head.position.y = 0.15
  head.rotation.x = 0.2
  root.add(neck)
  neck.add(head)
  return new Skeleton([root, neck, head])
}

describe('FacialAnimations', () => {
  it('is only available once the face rig exists', () => {
    const skeleton = rig()
    expect(FacialAnimations.has_face_bones(skeleton)).toBe(false)
    expect(FacialAnimations.create_clip_pairs(skeleton)).toHaveLength(0)

    FacialSkeleton.add(skeleton)
    expect(FacialAnimations.has_face_bones(skeleton)).toBe(true)
  })

  it('creates named facial clips with valid tracks on face bones', () => {
    const skeleton = rig()
    FacialSkeleton.add(skeleton)
    const pairs = FacialAnimations.create_clip_pairs(skeleton)

    expect(pairs.map(pair => pair.display_animation_clip.name)).toEqual([
      'Facial Idle', 'Facial Talk', 'Facial Surprise', 'Facial Look Around', 'Facial Jaw Test', 'Facial Smile'
    ])

    const face_bone_names = new Set(FacialSkeleton.bones(skeleton).map(bone => bone.name))
    for (const pair of pairs) {
      expect(pair.metadata.source_type).toBe('generated')
      expect(pair.metadata.tags).toContain('facial')
      expect(pair.display_animation_clip.tracks.length).toBeGreaterThan(0)

      for (const track of pair.display_animation_clip.tracks) {
        expect(track.name.endsWith('.quaternion')).toBe(true)
        const bone_name = track.name.replace(/\.quaternion$/, '')
        expect(face_bone_names.has(bone_name)).toBe(true)
        expect(track.times[0]).toBe(0)
        expect(track.times[track.times.length - 1]).toBeCloseTo(pair.display_animation_clip.duration)
        expect(track.values.length).toBe(track.times.length * 4)

        for (let i = 0; i < track.values.length; i += 4) {
          const quaternion = new Quaternion(track.values[i], track.values[i + 1], track.values[i + 2], track.values[i + 3])
          expect(quaternion.length()).toBeCloseTo(1)
        }
      }
    }
  })

  it('animates bones while preserving the fitted rest rotation', () => {
    const skeleton = rig()
    FacialSkeleton.add(skeleton)
    const jaw = skeleton.bones.find(bone => bone.name === 'face_jaw')!
    jaw.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.3)
    const fitted_rotation = jaw.quaternion.clone()

    const pair = FacialAnimations.create_clip_pairs(skeleton)
      .find(candidate => candidate.display_animation_clip.name === 'Facial Talk')!
    const track = pair.display_animation_clip.tracks.find(candidate => candidate.name === 'face_jaw.quaternion')!
    const first_key = new Quaternion(track.values[0], track.values[1], track.values[2], track.values[3])
    expect(first_key.angleTo(fitted_rotation)).toBeCloseTo(0)

    const root = new Group()
    root.add(skeleton.bones[0])
    const mixer = new AnimationMixer(root)
    mixer.clipAction(pair.display_animation_clip).play()
    mixer.update(0.18)

    expect(jaw.quaternion.angleTo(fitted_rotation)).toBeGreaterThan(0.1)
  })
})
