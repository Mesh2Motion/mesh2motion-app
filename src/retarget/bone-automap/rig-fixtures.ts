import { type RawBoneRecord } from './interfaces/RawBoneRecord'

/**
 * Skeleton fixtures for the auto-mapping tests.
 *
 * Each builder returns a flat (bone, parent) list - the same shape
 * BoneAutoMapper extracts from a three.js armature - so the mapping pipeline can
 * be exercised end to end without loading a model.
 */

const ARMATURE = 'Armature'

class RigBuilder {
  readonly bones: RawBoneRecord[] = []

  add (name: string, parent_name: string): this {
    this.bones.push({ name, parent_name })
    return this
  }

  /** Add a parent-to-child chain, returning the last bone's name */
  chain (parent: string, names: string[]): string {
    let current: string = parent
    for (const name of names) {
      this.add(name, current)
      current = name
    }
    return current
  }
}

/** The Mesh2Motion human rig - always the source side of a mapping */
export function mesh2motion_rig (): RawBoneRecord[] {
  const rig = new RigBuilder()

  rig.add('pelvis', ARMATURE)
  rig.chain('pelvis', ['spine_01', 'spine_02', 'spine_03'])
  rig.chain('spine_03', ['neck_01', 'head', 'head_leaf'])

  for (const side of ['l', 'r']) {
    const hand: string = rig.chain('spine_03',
      [`clavicle_${side}`, `upperarm_${side}`, `lowerarm_${side}`, `hand_${side}`])

    for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      rig.chain(hand, [
        `${finger}_01_${side}`, `${finger}_02_${side}`, `${finger}_03_${side}`, `${finger}_04_leaf_${side}`
      ])
    }

    rig.chain('pelvis',
      [`thigh_${side}`, `calf_${side}`, `foot_${side}`, `ball_${side}`, `ball_leaf_${side}`])
  }

  return rig.bones
}

/**
 * A Mixamo rig. Pass '' for the prefix to get the stripped-name variant that some
 * FBX -> glTF pipelines produce ("Hips", "LeftForeArm", "LeftHandIndex1").
 */
export function mixamo_rig (prefix: string = 'mixamorig'): RawBoneRecord[] {
  const rig = new RigBuilder()
  const p = (name: string): string => prefix + name

  rig.add(p('Hips'), ARMATURE)
  rig.chain(p('Hips'), [p('Spine'), p('Spine1'), p('Spine2')])
  rig.chain(p('Spine2'), [p('Neck'), p('Head'), p('HeadTop_End')])

  for (const side of ['Left', 'Right']) {
    const hand: string = rig.chain(p('Spine2'),
      [p(`${side}Shoulder`), p(`${side}Arm`), p(`${side}ForeArm`), p(`${side}Hand`)])

    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      rig.chain(hand, [1, 2, 3, 4].map(i => p(`${side}Hand${finger}${i}`)))
    }

    rig.chain(p('Hips'), [
      p(`${side}UpLeg`), p(`${side}Leg`), p(`${side}Foot`), p(`${side}ToeBase`), p(`${side}Toe_End`)
    ])
  }

  return rig.bones
}

/**
 * Unreal Engine mannequin. Shares Mesh2Motion's naming for the main joints but adds
 * twist bones, which must be rejected rather than mapped onto real joints.
 */
export function unreal_rig (): RawBoneRecord[] {
  const rig = new RigBuilder()

  rig.add('root', ARMATURE)
  rig.add('pelvis', 'root')
  rig.chain('pelvis', ['spine_01', 'spine_02', 'spine_03'])
  rig.chain('spine_03', ['neck_01', 'head'])

  for (const side of ['l', 'r']) {
    rig.chain('spine_03', [`clavicle_${side}`, `upperarm_${side}`])
    rig.add(`upperarm_twist_01_${side}`, `upperarm_${side}`)
    rig.add(`lowerarm_${side}`, `upperarm_${side}`)
    rig.add(`lowerarm_twist_01_${side}`, `lowerarm_${side}`)
    rig.add(`hand_${side}`, `lowerarm_${side}`)

    for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      rig.chain(`hand_${side}`,
        [`${finger}_01_${side}`, `${finger}_02_${side}`, `${finger}_03_${side}`])
    }

    rig.chain('pelvis', [`thigh_${side}`, `calf_${side}`, `foot_${side}`, `ball_${side}`])
    rig.add(`thigh_twist_01_${side}`, `thigh_${side}`)
    rig.add(`calf_twist_01_${side}`, `calf_${side}`)
  }

  return rig.bones
}

/**
 * DAZ / Poser style naming. The interesting part is that "lShldr" is the upper arm
 * here, the exact opposite of Mixamo's "LeftShoulder" being the clavicle.
 */
export function daz_rig (): RawBoneRecord[] {
  const rig = new RigBuilder()

  rig.add('hip', ARMATURE)
  rig.chain('hip', ['abdomen', 'chest'])
  rig.chain('chest', ['neck', 'head'])

  for (const side of ['l', 'r']) {
    const hand: string = rig.chain('chest',
      [`${side}Collar`, `${side}Shldr`, `${side}ForeArm`, `${side}Hand`])

    for (const finger of ['Thumb', 'Index', 'Mid', 'Ring', 'Pinky']) {
      rig.chain(hand, [1, 2, 3].map(i => `${side}${finger}${i}`))
    }

    rig.chain('hip', [`${side}Thigh`, `${side}Shin`, `${side}Foot`, `${side}Toe`])
  }

  return rig.bones
}

/** VRM humanoid naming, including its proximal/intermediate/distal finger segments */
export function vrm_rig (): RawBoneRecord[] {
  const rig = new RigBuilder()

  rig.add('hips', ARMATURE)
  rig.chain('hips', ['spine', 'chest', 'upperChest'])
  rig.chain('upperChest', ['neck', 'head'])

  for (const side of ['left', 'right']) {
    const hand: string = rig.chain('upperChest',
      [`${side}Shoulder`, `${side}UpperArm`, `${side}LowerArm`, `${side}Hand`])

    for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
      rig.chain(hand, ['Proximal', 'Intermediate', 'Distal'].map(seg => `${side}${finger}${seg}`))
    }

    rig.chain('hips', [`${side}UpperLeg`, `${side}LowerLeg`, `${side}Foot`, `${side}Toes`])
  }

  return rig.bones
}

export function bone_names (bones: RawBoneRecord[]): string[] {
  return bones.map(b => b.name)
}
