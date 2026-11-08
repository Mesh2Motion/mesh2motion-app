import { describe, expect, it } from 'vitest'
import { Bone, Group, Skeleton, Vector3 } from 'three'
import { FacialSkeleton } from './FacialSkeleton'
import { Utility } from '../../Utilities'
import { Generators } from '../../Generators'

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

describe('FacialSkeleton', () => {
  it('adds once, parents to the head, and preserves the body on removal', () => {
    const skeleton = rig()
    const original = [...skeleton.bones]
    expect(FacialSkeleton.add(skeleton)).toBe(true)
    expect(FacialSkeleton.add(skeleton)).toBe(false)
    expect(FacialSkeleton.bones(skeleton)).toHaveLength(12)
    const jaw = skeleton.bones.find(b => b.name === 'face_jaw')!
    expect(jaw.parent).toBe(FacialSkeleton.head(skeleton))
    expect(jaw.children.map(b => b.name)).toContain('face_lip_lower')
    expect(skeleton.boneInverses).toHaveLength(skeleton.bones.length)
    FacialSkeleton.remove(skeleton)
    expect(skeleton.bones).toEqual(original)
    expect(original[2].children).toHaveLength(0)
    expect(FacialSkeleton.add(skeleton)).toBe(true)
  })

  it('uses mirrored names and positions compatible with editor mirroring', () => {
    const skeleton = rig()
    FacialSkeleton.add(skeleton)
    const left = skeleton.bones.find(b => b.name === 'face_eye_L')!
    const right = skeleton.bones.find(b => b.name === 'face_eye_R')!
    expect(Utility.calculate_bone_base_name(left.name)).toBe(Utility.calculate_bone_base_name(right.name))
    expect(left.position.x).toBeCloseTo(-right.position.x)
    expect(left.position.y).toBeCloseTo(right.position.y)
    expect(left.position.z).toBeCloseTo(right.position.z)
    expect(Utility.is_leaf_bone(left)).toBe(false)
  })

  it('survives the cloned armature used by binding and follows head movement', () => {
    const skeleton = rig()
    FacialSkeleton.add(skeleton)
    const group = new Group()
    group.add(skeleton.bones[0])
    const clone = Generators.create_skeleton(group.clone().children[0])
    expect(FacialSkeleton.bones(clone)).toHaveLength(12)
    const before = FacialSkeleton.bounds(clone).getCenter(new Vector3())
    FacialSkeleton.head(clone)!.position.y += 0.2
    const after = FacialSkeleton.bounds(clone).getCenter(new Vector3())
    expect(after.y - before.y).toBeCloseTo(0.2)
    expect(after.x).toBeCloseTo(before.x)
  })

  it('leaves unsupported skeletons untouched', () => {
    const skeleton = new Skeleton([new Bone()])
    expect(FacialSkeleton.add(skeleton)).toBe(false)
    expect(FacialSkeleton.bounds(skeleton).isEmpty()).toBe(true)
  })
})
