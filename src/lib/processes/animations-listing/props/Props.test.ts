import { describe, it, expect } from 'vitest'
import { Bone, Euler, Group, Mesh, Quaternion, Skeleton, Vector3 } from 'three'
import { HandBoneResolver } from './HandBoneResolver'
import { PropCatalog } from './PropCatalog'
import { NO_PROP } from './PropId'
import { props_manifest } from '../../../AssetManifest'
import { PropsExportFilter, PROP_USER_DATA_KEY } from './PropsExportFilter'
import { PropSide } from './PropSide'
import { mount_quaternion, mount_scale } from './PropsManager'

function make_skeleton (names: string[]): Skeleton {
  return new Skeleton(names.map((name) => {
    const bone = new Bone()
    bone.name = name
    return bone
  }))
}

describe('PropCatalog', () => {
  it('registers every prop from the props manifest', () => {
    const definitions = PropCatalog.all()

    expect(definitions).toHaveLength(props_manifest.props.length)
    expect(new Set(definitions.map((definition) => definition.asset_path)).size).toBe(definitions.length)
    expect(PropCatalog.find('spear_A')?.asset_path).toBe('assets/props/spear_A.glb')
    expect(PropCatalog.find('spear_A')?.preview_path).toBe('assets/props/preview/spear_A.png')
    expect(PropCatalog.find('spear_A')?.model_offset_y).toBe(0)
    expect(PropCatalog.find(NO_PROP)).toBeUndefined()
  })

  it('uses app display names and categories, overriding the manifest category when configured', () => {
    expect(PropCatalog.find('sword_C')?.display_name).toBe('Katana')
    expect(PropCatalog.find('sword_C')?.category).toBe('Swords')
    expect(PropCatalog.find('Knife_1')?.category).toBe('Daggers')
    expect(PropCatalog.find('Shovel')?.category).toBe('Tools')
  })

  it('falls back to the manifest name and category for props without settings', () => {
    const definition = PropCatalog.find('fistweapon_A_stacked')
    expect(definition?.display_name).toBe('Fistweapon A Stacked')
    expect(definition?.category).toBe('Fist Weapons')
  })
})

describe('HandBoneResolver', () => {
  it('finds exact hand bone names', () => {
    const skeleton = make_skeleton(['pelvis', 'hand_l', 'index_01_l', 'hand_r'])
    expect(HandBoneResolver.resolve(skeleton, PropSide.Left)?.name).toBe('hand_l')
    expect(HandBoneResolver.resolve(skeleton, PropSide.Right)?.name).toBe('hand_r')
  })

  it('falls back to side-marked hand bones and skips fingers', () => {
    const skeleton = make_skeleton(['Hand_Index_L', 'Claw_Hand_L', 'Claw_Hand_R'])
    expect(HandBoneResolver.resolve(skeleton, PropSide.Left)?.name).toBe('Claw_Hand_L')
    expect(HandBoneResolver.resolve(skeleton, PropSide.Right)?.name).toBe('Claw_Hand_R')
  })

  it('returns null when the hand bone is missing', () => {
    const skeleton = make_skeleton(['pelvis', 'hand_r'])
    expect(HandBoneResolver.resolve(skeleton, PropSide.Left)).toBeNull()
  })
})

describe('mount_quaternion', () => {
  it('mirrors the prop geometry while preserving the grip and face directions', () => {
    for (const [side, hand_rotation] of [[PropSide.Left, new Euler(0, 0, Math.PI / 2)], [PropSide.Right, new Euler(0, 0, -Math.PI / 2)]] as const) {
      const hand_quaternion = new Quaternion().setFromEuler(hand_rotation)
      const world_to_local = hand_quaternion.clone().invert()
      const local_forward = new Vector3(0, 0, 1).applyQuaternion(world_to_local)
      const local_down = new Vector3(0, -1, 0).applyQuaternion(world_to_local)
      const prop_world_quaternion = hand_quaternion.multiply(mount_quaternion(local_forward, local_down, new Euler()))
      const prop_scale = mount_scale(side, 2)

      expect(new Vector3(0, 1, 0).applyQuaternion(prop_world_quaternion).distanceTo(new Vector3(0, 0, 1))).toBeLessThan(1e-6)
      expect(new Vector3(0, 0, 1).applyQuaternion(prop_world_quaternion).distanceTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6)
      expect(new Vector3(1, 0, 0).multiply(prop_scale).applyQuaternion(prop_world_quaternion).x).toBe(side === PropSide.Left ? 2 : -2)
    }
  })
})

describe('PropsExportFilter', () => {
  it('detaches props and restores them to their original parents', () => {
    const root = new Bone()
    const hand = new Bone()
    root.add(hand)

    const prop = new Group()
    prop.userData[PROP_USER_DATA_KEY] = true
    prop.add(new Mesh())
    const other_child = new Bone()
    hand.add(prop, other_child)

    const restore = PropsExportFilter.detach_props([root])
    expect(prop.parent).toBeNull()
    expect(hand.children).toEqual([other_child])

    restore()
    expect(prop.parent).toBe(hand)
  })
})
