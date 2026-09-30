import { describe, it, expect } from 'vitest'
import { Bone, Matrix4, Object3D, Scene, Skeleton, SkinnedMesh, BufferGeometry } from 'three'
import { AnimationUtility } from './AnimationUtility'

function build_armature (hips_height: number): { root: Bone, hips: Bone } {
  const root = new Bone()
  root.name = 'root'
  const hips = new Bone()
  hips.name = 'pelvis'
  hips.position.set(0, hips_height, 0)
  root.add(hips)
  root.updateWorldMatrix(true, true)
  return { root, hips }
}

describe('AnimationUtility hip height helpers', () => {
  it('reads the bind pose hip height from a skinned mesh', () => {
    const { root, hips } = build_armature(1.5)
    const skeleton = new Skeleton([root, hips])
    const mesh = new SkinnedMesh(new BufferGeometry())
    mesh.add(root)
    mesh.bind(skeleton, new Matrix4())

    expect(AnimationUtility.bind_pose_hips_height(mesh)).toBeCloseTo(1.5)
  })

  it('returns null when the rig has no hips bone', () => {
    const root = new Bone()
    root.name = 'root'
    const skeleton = new Skeleton([root])
    const mesh = new SkinnedMesh(new BufferGeometry())
    mesh.add(root)
    mesh.bind(skeleton, new Matrix4())

    expect(AnimationUtility.bind_pose_hips_height(mesh)).toBeNull()
  })

  it('reads the rest hip height from an imported scene, including armature scale', () => {
    const { root } = build_armature(1.0)
    const armature = new Object3D()
    armature.add(root)
    armature.scale.set(2, 2, 2)
    const scene = new Scene()
    scene.add(armature)

    expect(AnimationUtility.rest_hips_height_from_scene(scene)).toBeCloseTo(2.0)
  })

  it('returns null for a scene without bones', () => {
    const scene = new Scene()
    scene.add(new Object3D())
    expect(AnimationUtility.rest_hips_height_from_scene(scene)).toBeNull()
  })
})
