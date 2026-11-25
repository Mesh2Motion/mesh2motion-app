/** Deterministic human-like rig used by observation tests. No WebGL required. */
import { Bone, Scene, Skeleton } from 'three'

export function make_test_rig (): { skeleton: Skeleton, scene: Scene, by_name: Map<string, Bone> } {
  const scene = new Scene()
  const by_name = new Map<string, Bone>()
  const add = (name: string, parent: Bone | null, position: [number, number, number]): Bone => {
    const bone = new Bone()
    bone.name = name
    bone.position.set(...position)
    if (parent !== null) parent.add(bone)
    else scene.add(bone)
    by_name.set(name, bone)
    return bone
  }
  const root = add('root', null, [0, 0, 0])
  const pelvis = add('pelvis', root, [0, 1, 0])
  const spine = add('spine_01', pelvis, [0, 0.3, 0])
  add('head', spine, [0, 0.7, 0])
  const shoulder_l = add('upperarm_l', spine, [-0.5, 0.4, 0])
  const shoulder_r = add('upperarm_r', spine, [0.5, 0.4, 0])
  const hand_l = add('hand_l', shoulder_l, [-0.4, -0.4, 0])
  const hand_r = add('hand_r', shoulder_r, [0.4, -0.4, 0])
  add('index_l', hand_l, [-0.1, -0.1, 0])
  add('index_r', hand_r, [0.1, -0.1, 0])
  const skeleton = new Skeleton([...by_name.values()])
  scene.updateMatrixWorld(true)
  skeleton.bones.forEach((bone) => bone.updateWorldMatrix(true, false))
  return { skeleton, scene, by_name }
}
