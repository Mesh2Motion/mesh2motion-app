import { describe, expect, it } from 'vitest'
import { Bone, BoxGeometry, Group, Mesh, Skeleton, Vector3 } from 'three'
import { BreastSkeleton } from './BreastSkeleton'
import { Utility } from '../../Utilities'
import { Generators } from '../../Generators'

function rig (): { skeleton: Skeleton, chest: Bone } {
  const root = new Bone()
  root.name = 'root'
  const spine_01 = new Bone()
  spine_01.name = 'spine_01'
  spine_01.position.y = 1
  const chest = new Bone()
  chest.name = 'spine_03'
  chest.position.y = 0.5
  const neck = new Bone()
  neck.name = 'neck_01'
  neck.position.y = 0.3
  const head = new Bone()
  head.name = 'head'
  head.position.y = 0.2
  root.add(spine_01)
  spine_01.add(chest)
  chest.add(neck)
  neck.add(head)
  return { skeleton: new Skeleton([root, spine_01, chest, neck, head]), chest }
}

describe('BreastSkeleton', () => {
  it('adds once, parents to the chest, and preserves the body on removal', () => {
    const { skeleton, chest } = rig()
    const original = [...skeleton.bones]
    expect(BreastSkeleton.chest(skeleton)).toBe(chest)
    expect(BreastSkeleton.add(skeleton)).toBe(true)
    expect(BreastSkeleton.add(skeleton)).toBe(false)
    expect(BreastSkeleton.bones(skeleton)).toHaveLength(2)
    const left = skeleton.bones.find(b => b.name === 'breast_L')!
    const right = skeleton.bones.find(b => b.name === 'breast_R')!
    expect(left.parent).toBe(chest)
    expect(right.parent).toBe(chest)
    expect(skeleton.boneInverses).toHaveLength(skeleton.bones.length)
    BreastSkeleton.remove(skeleton)
    expect(skeleton.bones).toEqual(original)
    expect(chest.children).toHaveLength(1)
    expect(BreastSkeleton.add(skeleton)).toBe(true)
  })

  it('uses mirrored names and positions compatible with editor mirroring', () => {
    const { skeleton } = rig()
    BreastSkeleton.add(skeleton)
    const left = skeleton.bones.find(b => b.name === 'breast_L')!
    const right = skeleton.bones.find(b => b.name === 'breast_R')!
    expect(Utility.calculate_bone_base_name(left.name)).toBe(Utility.calculate_bone_base_name(right.name))
    expect(left.position.x).toBeCloseTo(-right.position.x)
    expect(left.position.y).toBeCloseTo(right.position.y)
    expect(left.position.z).toBeCloseTo(right.position.z)
    expect(Utility.is_leaf_bone(left)).toBe(false)
  })

  it('places the joints inside the chest in front of the spine', () => {
    const { skeleton } = rig()
    BreastSkeleton.add(skeleton)
    const left = skeleton.bones.find(b => b.name === 'breast_L')!
    const chest = BreastSkeleton.chest(skeleton)!
    const chest_position = chest.getWorldPosition(new Vector3())
    const left_position = left.getWorldPosition(new Vector3())
    expect(left_position.y).toBeCloseTo(chest_position.y)
    expect(left_position.z).toBeGreaterThan(chest_position.z)
  })

  it('survives the cloned armature used by binding and follows chest movement', () => {
    const { skeleton } = rig()
    BreastSkeleton.add(skeleton)
    const group = new Group()
    group.add(skeleton.bones[0])
    const clone = Generators.create_skeleton(group.clone().children[0])
    expect(BreastSkeleton.bones(clone)).toHaveLength(2)
    const before = BreastSkeleton.bounds(clone).getCenter(new Vector3())
    BreastSkeleton.chest(clone)!.position.y += 0.2
    const after = BreastSkeleton.bounds(clone).getCenter(new Vector3())
    expect(after.y - before.y).toBeCloseTo(0.2)
    expect(after.x).toBeCloseTo(before.x)
  })

  it('estimates the chest region from the mesh without including the arms', () => {
    const group = new Group()
    const mesh = new Mesh(new BoxGeometry(0.2, 2, 0.2, 1, 20, 1))
    mesh.position.set(0, 0.2, 1)
    group.add(mesh)
    // an out-stretched arm at chest height, well outside the torso window
    const arm = new Mesh(new BoxGeometry(0.2, 0.2, 0.2))
    arm.position.set(0.5, 0.2, 2)
    group.add(arm)
    const chest = new Bone()
    chest.name = 'spine_03'
    chest.position.set(0, 0.2, 1)
    group.add(chest)

    const bounds = BreastSkeleton.model_chest_bounds(group, chest)
    expect(bounds.max.z).toBeCloseTo(1.1)
    expect(bounds.max.x).toBeCloseTo(0.1)
    expect(bounds.getSize(new Vector3()).y).toBeCloseTo(0)

    const skeleton = new Skeleton([chest])
    expect(BreastSkeleton.add(skeleton, bounds)).toBe(true)
    const breast = skeleton.bones.find(b => b.name === 'breast_L')!
    expect(breast.getWorldPosition(new Vector3()).x).toBeCloseTo(0.055)
    expect(breast.getWorldPosition(new Vector3()).z).toBeCloseTo(1.05)
  })

  it('leaves unsupported skeletons untouched', () => {
    const skeleton = new Skeleton([new Bone()])
    expect(BreastSkeleton.chest(skeleton)).toBeUndefined()
    expect(BreastSkeleton.add(skeleton)).toBe(false)
    expect(BreastSkeleton.bounds(skeleton).isEmpty()).toBe(true)
  })
})
