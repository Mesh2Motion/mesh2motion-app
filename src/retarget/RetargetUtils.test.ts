import { describe, it, expect } from 'vitest'
import { Bone, BufferGeometry, Group, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three'
import { RetargetUtils } from './RetargetUtils.ts'
import { HumanChainConfig } from './human-retargeting/HumanChainConfig.ts'

// two bone chain bound under a scaled, offset parent, the way a loaded model usually sits
function create_bound_chain (): { parent: Group, mesh: SkinnedMesh, root: Bone, child: Bone } {
  const parent = new Group()
  parent.position.set(1, 2, 3)
  parent.scale.setScalar(0.5)

  const root = new Bone()
  root.position.set(0, 1, 0)
  root.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)

  const child = new Bone()
  child.position.set(0, 0.5, 0)
  child.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6)
  root.add(child)

  const mesh = new SkinnedMesh(new BufferGeometry(), new MeshBasicMaterial())
  mesh.add(root)
  parent.add(mesh)
  parent.updateMatrixWorld(true)
  mesh.bind(new Skeleton([root, child]))

  return { parent, mesh, root, child }
}

describe('RetargetUtils.capture_bind_pose_rest_transforms', () => {
  it('recovers the rest pose after the bones have been animated', () => {
    const { mesh, root, child } = create_bound_chain()
    const expected = RetargetUtils.capture_bone_rest_transforms(mesh.skeleton)

    // pose the skeleton like an animation would
    root.position.set(0.3, 0.2, 0.1)
    child.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 1.2)
    mesh.updateMatrixWorld(true)

    const recovered = RetargetUtils.capture_bind_pose_rest_transforms(mesh)

    recovered.forEach((rest, index) => {
      expect(rest.position.distanceTo(expected[index].position)).toBeLessThan(1e-5)
      expect(rest.quaternion.angleTo(expected[index].quaternion)).toBeLessThan(1e-5)
      expect(rest.scale.distanceTo(expected[index].scale)).toBeLessThan(1e-5)
    })
  })

  it('still recovers bone locals when the model was moved after binding', () => {
    const { parent, mesh } = create_bound_chain()
    const expected = RetargetUtils.capture_bone_rest_transforms(mesh.skeleton)

    parent.position.set(-4, 0, 7)
    parent.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 2))
    parent.updateMatrixWorld(true)

    const recovered = RetargetUtils.capture_bind_pose_rest_transforms(mesh)

    recovered.forEach((rest, index) => {
      expect(rest.position.distanceTo(expected[index].position)).toBeLessThan(1e-5)
      expect(rest.quaternion.angleTo(expected[index].quaternion)).toBeLessThan(1e-5)
    })
  })
})

describe('HumanChainConfig.build_mapped_chain_configs', () => {
  it('builds both sides of a mapping and leaves unmapped bones empty', () => {
    // other rig -> Mesh2Motion. head_leaf is mapped but head is not
    const mapping = new Map<string, string>([
      ['Hips', 'pelvis'],
      ['HeadTop_End', 'head_leaf'],
      ['Neck', 'neck_01']
    ])

    const { mesh2motion_config, other_rig_config } = HumanChainConfig.build_mapped_chain_configs(mapping)

    expect(mesh2motion_config.pelvis).toEqual(['pelvis'])
    expect(other_rig_config.pelvis).toEqual(['Hips'])

    // 'head' must not count as mapped just because 'head_leaf' is
    expect(mesh2motion_config.head).toEqual(['neck_01', ''])
    expect(other_rig_config.head).toEqual(['Neck', ''])

    expect(mesh2motion_config.armL).toEqual(['', '', '', ''])
  })
})
