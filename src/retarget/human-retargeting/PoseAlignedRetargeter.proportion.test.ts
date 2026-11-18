// Retargets real Mesh2Motion clips onto the ReadyPlayerMe test avatar and checks that
// the hands keep their position relative to the body, not just their bone directions.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  type AnimationClip, AnimationMixer, type Bone, type Group, type Object3D, Quaternion,
  type Skeleton, SkinnedMesh, Vector3
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { RetargetUtils } from '../RetargetUtils.ts'
import { MixamoMapper } from '../bone-automap/MixamoMapper.ts'
import { PoseAlignedRetargeter, type ProportionSettings } from './PoseAlignedRetargeter.ts'

const M2M_SKELETON = 'static/assets/human/skeleton.glb'
const RPM_AVATAR = 'static/test-files/retarget testing/rpm-avatar.glb'
const FPS = 30
/** palms closer than this (metres) count as touching or about to */
const NEAR_CONTACT = 0.12
/** RPM wrist-to-fingertip length over M2M's, measured from the two files */
const RPM_HAND_SIZE = 0.833
/** RPM thigh + shin length over M2M's, measured from the two files */
const LEG_LENGTH_RATIO = 1.068

interface Loaded { scene: Group, animations: AnimationClip[] }

/**
 * Parse a GLB with its images removed. Embedded textures never finish decoding under
 * jsdom, which would leave GLTFLoader's onLoad waiting forever.
 */
async function load_glb (path: string): Promise<Loaded> {
  const file = readFileSync(path)
  const json_length = file.readUInt32LE(12)
  const json = JSON.parse(file.subarray(20, 20 + json_length).toString('utf8'))
  delete json.images
  delete json.textures
  delete json.samplers
  delete json.materials
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) delete primitive.material
  }

  const binary = file.subarray(20 + json_length + 8)
  let json_text = JSON.stringify(json)
  while (Buffer.byteLength(json_text) % 4 !== 0) json_text += ' '
  const json_bytes = Buffer.from(json_text, 'utf8')

  // allocate inside this realm: a Node ArrayBuffer fails GLTFLoader's instanceof check under jsdom
  const total = 12 + 8 + json_bytes.length + 8 + binary.length
  const array_buffer = new ArrayBuffer(total)
  const view = new DataView(array_buffer)
  const bytes = new Uint8Array(array_buffer)
  view.setUint32(0, 0x46546C67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, json_bytes.length, true)
  view.setUint32(16, 0x4E4F534A, true)
  bytes.set(json_bytes, 20)
  view.setUint32(20 + json_bytes.length, binary.length, true)
  view.setUint32(24 + json_bytes.length, 0x004E4942, true)
  bytes.set(binary, 28 + json_bytes.length)

  return await new Promise((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(array_buffer, '', (gltf) => {
      resolve({ scene: gltf.scene, animations: gltf.animations })
    }, reject)
  })
}

function first_skinned_mesh (root: Object3D): SkinnedMesh {
  let found: SkinnedMesh | null = null
  root.traverse((child) => {
    if (found === null && child instanceof SkinnedMesh) found = child
  })
  if (found === null) throw new Error('no skinned mesh')
  return found
}

function bone (skeleton: Skeleton, name: string): Bone {
  const found = skeleton.bones.find(b => b.name === name)
  if (found === undefined) throw new Error(`no bone ${name}`)
  return found
}

function distance_to_segment (point: Vector3, from: Vector3, to: Vector3): number {
  const along = to.clone().sub(from)
  const t = Math.min(1, Math.max(0, point.clone().sub(from).dot(along) / along.lengthSq()))
  return point.distanceTo(from.addScaledVector(along, t))
}

function world (b: Bone): Vector3 {
  return b.getWorldPosition(new Vector3())
}

/** target bone name -> source bone name, the same shape the app produces */
function rpm_mapping (source: Skeleton, target: Skeleton): Map<string, string> {
  const mapping = new Map<string, string>()
  for (const source_bone of source.bones) {
    const mixamo_name = MixamoMapper.map_source_bone_name_to_mixamo(source_bone.name)
    if (mixamo_name === undefined) continue
    const target_name = mixamo_name.replace('mixamorig', '')
    if (target.bones.some(b => b.name === target_name)) mapping.set(target_name, source_bone.name)
  }
  return mapping
}

interface ArmNames { clavicle: string, upper: string, lower: string, hand: string }
interface RigNames {
  left: ArmNames, right: ArmNames, hips: string
  left_thigh: string, right_thigh: string, left_foot: string, right_foot: string, left_ball: string, right_ball: string
  left_calf: string, right_calf: string
}

const M2M: RigNames = {
  left: { clavicle: 'clavicle_l', upper: 'upperarm_l', lower: 'lowerarm_l', hand: 'hand_l' },
  right: { clavicle: 'clavicle_r', upper: 'upperarm_r', lower: 'lowerarm_r', hand: 'hand_r' },
  hips: 'pelvis',
  left_thigh: 'thigh_l', right_thigh: 'thigh_r', left_foot: 'foot_l', right_foot: 'foot_r', left_ball: 'ball_l', right_ball: 'ball_r',
  left_calf: 'calf_l', right_calf: 'calf_r'
}
const RPM: RigNames = {
  left: { clavicle: 'LeftShoulder', upper: 'LeftArm', lower: 'LeftForeArm', hand: 'LeftHand' },
  right: { clavicle: 'RightShoulder', upper: 'RightArm', lower: 'RightForeArm', hand: 'RightHand' },
  hips: 'Hips',
  left_thigh: 'LeftUpLeg', right_thigh: 'RightUpLeg', left_foot: 'LeftFoot', right_foot: 'RightFoot', left_ball: 'LeftToeBase', right_ball: 'RightToeBase',
  left_calf: 'LeftLeg', right_calf: 'RightLeg'
}

interface Frame {
  /** left-to-right hand separation in shoulder half-widths: 0 = touching, negative = crossed */
  hand_gap: number
  /** distance between the two palm centres, metres */
  palm_distance: number
  /** same for the feet, in hip half-widths */
  foot_gap: number
  hips: Vector3
  /** world positions of the two ball-of-foot joints */
  balls: [Vector3, Vector3]
  /** world positions of the two palm centres */
  palms: [Vector3, Vector3]
  /** distance from each palm centre to the thigh bone (hip joint to knee) on its own side */
  thigh_clearance: [number, number]
  rotations: Map<string, Quaternion>
}

/** Play a clip on a skeleton and measure each frame. */
function sample (skeleton: Skeleton, clip: AnimationClip, names: RigNames): Frame[] {
  skeleton.bones[0].updateMatrixWorld(true)
  // where a limb's end bone makes contact: centre of the joints attached to it
  const contact = (end: string): Vector3 => {
    const attached = bone(skeleton, end).children
    const centre = new Vector3()
    attached.forEach(child => centre.add(world(child as Bone)))
    return centre.divideScalar(attached.length)
  }
  const gap = (root_l: string, root_r: string, end_l: string, end_r: string): number => {
    const across = world(bone(skeleton, root_l)).sub(world(bone(skeleton, root_r)))
    const half_width = across.length() / 2
    return contact(end_l).sub(contact(end_r)).dot(across.normalize()) / half_width
  }

  // the clip's tracks address bones by name, so any ancestor of all bones works as mixer root
  let mixer_root: Object3D = skeleton.bones[0]
  while (mixer_root.parent !== null) mixer_root = mixer_root.parent
  const mixer = new AnimationMixer(mixer_root)
  mixer.clipAction(clip).play()

  const frames: Frame[] = []
  const frame_count = Math.ceil(clip.duration * FPS) + 1
  for (let i = 0; i < frame_count; i++) {
    mixer.setTime(Math.min(i / FPS, clip.duration))
    mixer_root.updateMatrixWorld(true)
    frames.push({
      hand_gap: gap(names.left.upper, names.right.upper, names.left.hand, names.right.hand),
      palm_distance: contact(names.left.hand).distanceTo(contact(names.right.hand)),
      foot_gap: gap(names.left_thigh, names.right_thigh, names.left_foot, names.right_foot),
      hips: world(bone(skeleton, names.hips)),
      balls: [world(bone(skeleton, names.left_ball)), world(bone(skeleton, names.right_ball))],
      palms: [contact(names.left.hand), contact(names.right.hand)],
      thigh_clearance: [
        distance_to_segment(contact(names.left.hand), world(bone(skeleton, names.left_thigh)), world(bone(skeleton, names.left_calf))),
        distance_to_segment(contact(names.right.hand), world(bone(skeleton, names.right_thigh)), world(bone(skeleton, names.right_calf)))
      ],
      rotations: new Map(skeleton.bones.map(b => [b.name, b.quaternion.clone()]))
    })
  }
  return frames
}

interface Result {
  source: Frame[], plain: Frame[], corrected: Frame[], hip_scale: number, rest: { source: Frame, target: Frame }
  /** the retargeted clip with correction on */
  clip: AnimationClip
}

/**
 * @param up which world axis is up. 'z' stands both rigs up in a Z-up world by turning
 *   their armature nodes, the way a Z-up scene would hold them.
 */
async function retarget_clip (
  animation_file: string, up: 'y' | 'z' = 'y', proportion_settings: Partial<ProportionSettings> = {}
): Promise<Result> {
  const source_file = await load_glb(M2M_SKELETON)
  const clip = (await load_glb(`static/assets/human/animations/${animation_file}`)).animations[0]
  const target_file = await load_glb(RPM_AVATAR)
  if (up === 'z') {
    for (const scene of [source_file.scene, target_file.scene]) {
      const armature = scene.children.find(child => child.name.toLowerCase().includes('armature'))
      if (armature === undefined) throw new Error('no armature node')
      armature.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2))
    }
  }
  target_file.scene.updateMatrixWorld(true)
  const target_real = first_skinned_mesh(target_file.scene).skeleton
  const target_rest = RetargetUtils.capture_bone_rest_transforms(target_real)

  const new_source = (): Skeleton => {
    const skeleton = RetargetUtils.create_skeleton_from_group_object(source_file.scene)
    if (skeleton === null) throw new Error('no source skeleton')
    return skeleton
  }
  const new_target = (): Skeleton => RetargetUtils.clone_skeleton(target_real, target_rest)

  const mapping = rpm_mapping(new_source(), target_real)
  // same figure the app passes in: ratio of rest hip heights
  const rest_frame = (skeleton: Skeleton, names: RigNames): Frame => {
    skeleton.bones[0].updateMatrixWorld(true)
    return {
      hand_gap: 0, palm_distance: 0, foot_gap: 0, rotations: new Map(), palms: [new Vector3(), new Vector3()], thigh_clearance: [0, 0],
      hips: world(bone(skeleton, names.hips)),
      balls: [world(bone(skeleton, names.left_ball)), world(bone(skeleton, names.right_ball))]
    }
  }
  const rest = { source: rest_frame(new_source(), M2M), target: rest_frame(new_target(), RPM) }
  const hip_scale = rest.target.hips[up] / rest.source.hips[up]

  let corrected_clip: AnimationClip | null = null
  const bake = (correct_proportions: boolean): Frame[] => {
    const retargeted = PoseAlignedRetargeter.retarget(clip, new_source(), new_target(), mapping,
      { hip_scale, fps: FPS, correct_proportions, proportion_settings })
    if (correct_proportions) corrected_clip = retargeted
    return sample(new_target(), retargeted, RPM)
  }

  const frames = { source: sample(new_source(), clip, M2M), plain: bake(false), corrected: bake(true) }
  return { ...frames, hip_scale, rest, clip: corrected_clip as unknown as AnimationClip }
}

function degrees_between (a: Quaternion, b: Quaternion): number {
  return a.angleTo(b) * 180 / Math.PI
}

function report (label: string, result: Result): void {
  const closest = result.source.reduce((best, frame, i) =>
    Math.abs(frame.hand_gap) < Math.abs(result.source[best].hand_gap) ? i : best, 0)
  const worst_gap_error = (frames: Frame[]): number =>
    Math.max(...frames.map((frame, i) => Math.abs(frame.hand_gap - result.source[i].hand_gap)))
  console.log(`${label}: hands closest at frame ${closest}. gap in shoulder half-widths: ` +
    `source ${result.source[closest].hand_gap.toFixed(3)}, ` +
    `rotation-only ${result.plain[closest].hand_gap.toFixed(3)}, ` +
    `corrected ${result.corrected[closest].hand_gap.toFixed(3)}. ` +
    `palm distance cm: source ${(result.source[closest].palm_distance * 100).toFixed(1)}, ` +
    `rotation-only ${(result.plain[closest].palm_distance * 100).toFixed(1)}, ` +
    `corrected ${(result.corrected[closest].palm_distance * 100).toFixed(1)}. ` +
    `worst gap error over clip: rotation-only ${worst_gap_error(result.plain).toFixed(3)}, ` +
    `corrected ${worst_gap_error(result.corrected).toFixed(3)}`)
}

describe('PoseAlignedRetargeter proportion correction (M2M -> RPM)', () => {
  for (const file of ['clapping.glb', 'pray.glb', 'meditate.glb']) {
    it(`keeps hands where the source has them relative to the body: ${file}`, async () => {
      const result = await retarget_clip(file)
      report(file, result)

      result.source.forEach((source_frame, i) => {
        const corrected = result.corrected[i]
        // hands must not swap sides unless the source's did
        if (source_frame.hand_gap > 0.05) expect(corrected.hand_gap).toBeGreaterThan(0)
        if (source_frame.foot_gap > 0.05) expect(corrected.foot_gap).toBeGreaterThan(0)

        // when the palms are together, the distance between them is the source's
        // distance in hand sizes: not pushed into each other, not left hanging apart
        if (source_frame.palm_distance < NEAR_CONTACT) {
          expect(corrected.palm_distance / source_frame.palm_distance).toBeGreaterThan(RPM_HAND_SIZE - 0.03)
          expect(corrected.palm_distance / source_frame.palm_distance).toBeLessThan(RPM_HAND_SIZE + 0.03)
        }
      })
    })

    it(`stays close to the rotation-only pose: ${file}`, async () => {
      const result = await retarget_clip(file)
      let worst = 0
      let worst_bone = ''
      result.corrected.forEach((frame, i) => {
        for (const [name, rotation] of frame.rotations) {
          const delta = degrees_between(rotation, result.plain[i].rotations.get(name) as Quaternion)
          if (delta > worst) { worst = delta; worst_bone = name }
        }
      })
      console.log(`${file}: largest change vs rotation-only: ${worst.toFixed(1)} deg (${worst_bone})`)
      // meditate moves the arms most: the hands go to the knees, which sit wider on RPM
      expect(worst).toBeLessThan(25)

      // and it must not introduce pops between consecutive frames
      let worst_step = 0
      for (let i = 1; i < result.corrected.length; i++) {
        for (const [name, rotation] of result.corrected[i].rotations) {
          const step = degrees_between(rotation, result.corrected[i - 1].rotations.get(name) as Quaternion)
          const plain_step = degrees_between(result.plain[i].rotations.get(name) as Quaternion,
            result.plain[i - 1].rotations.get(name) as Quaternion)
          worst_step = Math.max(worst_step, step - plain_step)
        }
      }
      console.log(`${file}: largest extra per-frame rotation step: ${worst_step.toFixed(1)} deg`)
      expect(worst_step).toBeLessThan(2)
    })
  }

  it('rotation-only retargeting does cross the hands, so the checks above have teeth', async () => {
    const result = await retarget_clip('clapping.glb')
    const crossed = result.plain.filter((frame, i) => result.source[i].hand_gap > 0.05 && frame.hand_gap < 0)
    expect(crossed.length).toBeGreaterThan(0)
  })
})

describe('PoseAlignedRetargeter body translation and footing (M2M -> RPM)', () => {
  /** height of the lower ball-of-foot joint above where it is in the rest pose */
  const lowest_foot = (frame: Frame, rest: Frame): number =>
    Math.min(frame.balls[0].y, frame.balls[1].y) - Math.min(rest.balls[0].y, rest.balls[1].y)

  it('carries the hips down into a crouch', async () => {
    const result = await retarget_clip('crouch-idle.glb')
    const source_drop = result.rest.source.hips.y - Math.min(...result.source.map(f => f.hips.y))
    const target_drop = result.rest.target.hips.y - Math.min(...result.corrected.map(f => f.hips.y))
    console.log(`crouch-idle.glb: hips drop source ${(source_drop * 100).toFixed(1)} cm, ` +
      `target ${(target_drop * 100).toFixed(1)} cm`)

    expect(source_drop).toBeGreaterThan(0.2)
    // roughly the source's drop at the target's size, not the constant it used to be
    expect(target_drop / source_drop).toBeGreaterThan(0.9)
    expect(target_drop / source_drop).toBeLessThan(1.4)
  })

  for (const file of ['crouch-idle.glb', 'clapping.glb', 'walk-female.glb', 'sprint.glb', 'sitting-idle.glb']) {
    it(`keeps the feet on the floor: ${file}`, async () => {
      const result = await retarget_clip(file)
      let worst = 0
      let worst_plain = 0
      result.source.forEach((source_frame, i) => {
        const wanted = lowest_foot(source_frame, result.rest.source) * LEG_LENGTH_RATIO
        worst = Math.max(worst, Math.abs(lowest_foot(result.corrected[i], result.rest.target) - wanted))
        worst_plain = Math.max(worst_plain, Math.abs(lowest_foot(result.plain[i], result.rest.target) - wanted))
      })
      console.log(`${file}: worst height error of the lower foot: rotation-only ` +
        `${(worst_plain * 100).toFixed(1)} cm, corrected ${(worst * 100).toFixed(1)} cm`)
      expect(worst).toBeLessThan(0.03)
    })
  }

  it('puts the hands on the floor in a push-up', async () => {
    const result = await retarget_clip('pushup.glb')
    const floor = (rest: Frame): number => Math.min(rest.balls[0].y, rest.balls[1].y)
    let worst = 0
    let worst_plain = 0
    let frames = 0
    result.source.forEach((source_frame, i) => {
      for (const side of [0, 1]) {
        const source_height = source_frame.palms[side].y - floor(result.rest.source)
        if (source_height > 0.06) continue
        frames++
        const wanted = source_height * LEG_LENGTH_RATIO
        worst = Math.max(worst, Math.abs(result.corrected[i].palms[side].y - floor(result.rest.target) - wanted))
        worst_plain = Math.max(worst_plain, Math.abs(result.plain[i].palms[side].y - floor(result.rest.target) - wanted))
      }
    })
    console.log(`pushup.glb: worst palm height error while on the floor: rotation-only ` +
      `${(worst_plain * 100).toFixed(1)} cm, corrected ${(worst * 100).toFixed(1)} cm`)
    expect(frames).toBeGreaterThan(50)
    expect(worst_plain).toBeGreaterThan(0.05)
    expect(worst).toBeLessThan(0.015)
  })

  it('finds the floor in a Z-up world too', async () => {
    // Bone-local tracks do not depend on how the world is oriented, so the same
    // bake in a Z-up world has to come out the same
    const y_up = (await retarget_clip('crouch-idle.glb', 'y')).clip
    const z_up = (await retarget_clip('crouch-idle.glb', 'z')).clip
    expect(z_up.tracks.length).toBe(y_up.tracks.length)

    let worst = 0
    y_up.tracks.forEach((track, index) => {
      const other = z_up.tracks[index]
      expect(other.name).toBe(track.name)
      const is_rotation = track.name.endsWith('.quaternion')
      for (let i = 0; i < track.values.length; i += is_rotation ? 4 : 3) {
        // q and -q are the same rotation
        let same = 0
        let flipped = 0
        for (let k = 0; k < (is_rotation ? 4 : 3); k++) {
          same = Math.max(same, Math.abs(track.values[i + k] - other.values[i + k]))
          flipped = Math.max(flipped, Math.abs(track.values[i + k] + other.values[i + k]))
        }
        worst = Math.max(worst, is_rotation ? Math.min(same, flipped) : same)
      }
    })
    expect(worst).toBeLessThan(1e-3)
  })

  it('does not make the hips bob through a stride', async () => {
    const result = await retarget_clip('sprint.glb')
    let worst = 0
    for (let i = 1; i < result.source.length; i++) {
      const source_step = result.source[i].hips.clone().sub(result.source[i - 1].hips).multiplyScalar(LEG_LENGTH_RATIO)
      const target_step = result.corrected[i].hips.clone().sub(result.corrected[i - 1].hips)
      worst = Math.max(worst, target_step.sub(source_step).length())
    }
    console.log(`sprint.glb: largest per-frame hip movement not in the source: ${(worst * 100).toFixed(2)} cm`)
    expect(worst).toBeLessThan(0.01)
  })
})

describe('PoseAlignedRetargeter body clearance (M2M -> RPM)', () => {
  /** closest a palm gets to its own thigh, as [source, rotation-only, corrected] in metres */
  const closest = (result: Result): [number, number, number] => {
    let frame = 0
    let side = 0
    result.source.forEach((source_frame, i) => {
      for (const k of [0, 1]) {
        if (source_frame.thigh_clearance[k] < result.source[frame].thigh_clearance[side]) { frame = i; side = k }
      }
    })
    return [result.source[frame].thigh_clearance[side], result.plain[frame].thigh_clearance[side],
      result.corrected[frame].thigh_clearance[side]]
  }

  for (const file of ['confused.glb', 'idle-a.glb', 'walk-female.glb']) {
    it(`keeps a hanging hand out of the thigh: ${file}`, async () => {
      const result = await retarget_clip(file)
      const [source, plain, corrected] = closest(result)
      console.log(`${file}: palm to thigh bone at its closest: source ${(source * 100).toFixed(1)} cm, ` +
        `rotation-only ${(plain * 100).toFixed(1)} cm, corrected ${(corrected * 100).toFixed(1)} cm`)

      // rotation copying brings it well inside what the source keeps
      expect(plain / source).toBeLessThan(0.75)
      // corrected: the source's clearance at the target's size, give or take
      expect(corrected / source).toBeGreaterThan(0.9)
      expect(corrected / source).toBeLessThan(1.25)

      // and never, on any frame near the leg, much closer than the source
      result.source.forEach((source_frame, i) => {
        for (const side of [0, 1]) {
          if (source_frame.thigh_clearance[side] > 0.2) continue
          expect(result.corrected[i].thigh_clearance[side] / source_frame.thigh_clearance[side]).toBeGreaterThan(0.85)
        }
      })
    })
  }

  it('keep_body_clearance off lets the hand into the thigh again', async () => {
    const [source, , corrected] = closest(await retarget_clip('confused.glb', 'y', { keep_body_clearance: false }))
    expect(corrected / source).toBeLessThan(0.75)
  })

  it('body_clearance_scale widens the clearance', async () => {
    const [, , normal] = closest(await retarget_clip('confused.glb'))
    const [, , wide] = closest(await retarget_clip('confused.glb', 'y', { body_clearance_scale: 1.3 }))
    expect(wide).toBeGreaterThan(normal * 1.15)
  })
})

describe('PoseAlignedRetargeter proportion settings (M2M -> RPM)', () => {
  const crossed_frames = (result: Result): number =>
    result.corrected.filter((frame, i) => result.source[i].hand_gap > 0.05 && frame.hand_gap < 0).length
  const floor = (rest: Frame): number => Math.min(rest.balls[0].y, rest.balls[1].y)
  const worst_foot_error = (result: Result): number => Math.max(...result.source.map((source_frame, i) => {
    const lowest = (frame: Frame, rest: Frame): number => Math.min(frame.balls[0].y, frame.balls[1].y) - floor(rest)
    return Math.abs(lowest(result.corrected[i], result.rest.target) -
      lowest(source_frame, result.rest.source) * LEG_LENGTH_RATIO)
  }))
  const worst_palm_error = (result: Result): number => Math.max(...result.source.map((source_frame, i) =>
    Math.max(...[0, 1].map((side) => {
      const source_height = source_frame.palms[side].y - floor(result.rest.source)
      if (source_height > 0.06) return 0
      return Math.abs(result.corrected[i].palms[side].y - floor(result.rest.target) - source_height * LEG_LENGTH_RATIO)
    }))))

  it('keep_limb_spacing off lets the hands cross again', async () => {
    expect(crossed_frames(await retarget_clip('clapping.glb'))).toBe(0)
    expect(crossed_frames(await retarget_clip('clapping.glb', 'y', { keep_limb_spacing: false }))).toBeGreaterThan(0)
  })

  it('ground_feet off leaves the feet where rotation copying puts them', async () => {
    expect(worst_foot_error(await retarget_clip('crouch-idle.glb'))).toBeLessThan(0.005)
    expect(worst_foot_error(await retarget_clip('crouch-idle.glb', 'y', { ground_feet: false }))).toBeGreaterThan(0.02)
  })

  it('ground_hands off stops the hands being put down on the floor', async () => {
    const on = worst_palm_error(await retarget_clip('pushup.glb'))
    const off = worst_palm_error(await retarget_clip('pushup.glb', 'y', { ground_hands: false }))
    console.log(`pushup.glb palm height error: ground_hands on ${(on * 100).toFixed(1)} cm, off ${(off * 100).toFixed(1)} cm`)
    expect(on).toBeLessThan(0.01)
    expect(off).toBeGreaterThan(on + 0.005)
  })

  it('max_joint_change limits how far an elbow is moved', async () => {
    const elbow_change = (result: Result): number => Math.max(...result.corrected.map((frame, i) =>
      degrees_between(frame.rotations.get('LeftForeArm') as Quaternion,
        result.plain[i].rotations.get('LeftForeArm') as Quaternion)))
    const free = elbow_change(await retarget_clip('pray.glb'))
    const limited = elbow_change(await retarget_clip('pray.glb', 'y', { max_joint_change: 0 }))
    // with no hinge change allowed, what is left is the elbow following the shoulder's swing
    expect(free).toBeGreaterThan(2)
    expect(limited).toBeLessThan(free)
  })

  it('limb_smoothing trades contact for smoothness', async () => {
    const report = async (limb_smoothing: number): Promise<{ jump: number, palm_ratio: number }> => {
      const fast = await retarget_clip('kick-spin.glb', 'y', { limb_smoothing })
      let jump = 0
      for (let i = 1; i < fast.corrected.length; i++) {
        for (const [name, rotation] of fast.corrected[i].rotations) {
          jump = Math.max(jump, degrees_between(rotation, fast.corrected[i - 1].rotations.get(name) as Quaternion) -
            degrees_between(fast.plain[i].rotations.get(name) as Quaternion,
              fast.plain[i - 1].rotations.get(name) as Quaternion))
        }
      }
      const clap = await retarget_clip('clapping.glb', 'y', { limb_smoothing })
      const palm_ratio = Math.min(...clap.corrected.map((frame, i) =>
        clap.source[i].palm_distance < NEAR_CONTACT ? frame.palm_distance / clap.source[i].palm_distance : 9))
      return { jump, palm_ratio }
    }
    const exact = await report(0)
    const smoothed = await report(0.035)
    console.log(`limb_smoothing 0: kick-spin jump ${exact.jump.toFixed(1)} deg, clap palm gap x${exact.palm_ratio.toFixed(2)}; ` +
      `0.035: jump ${smoothed.jump.toFixed(1)} deg, clap palm gap x${smoothed.palm_ratio.toFixed(2)}`)
    expect(smoothed.jump).toBeLessThan(exact.jump)
    expect(smoothed.palm_ratio).toBeLessThan(exact.palm_ratio)
  })

  it('body_height_smoothing steadies the hips', async () => {
    const hip_bob = (result: Result): number => {
      let worst = 0
      for (let i = 1; i < result.source.length; i++) {
        const source_step = result.source[i].hips.clone().sub(result.source[i - 1].hips).multiplyScalar(LEG_LENGTH_RATIO)
        worst = Math.max(worst, result.corrected[i].hips.clone().sub(result.corrected[i - 1].hips).sub(source_step).length())
      }
      return worst
    }
    const smoothed = hip_bob(await retarget_clip('sprint.glb'))
    const raw = hip_bob(await retarget_clip('sprint.glb', 'y', { body_height_smoothing: 0 }))
    console.log(`sprint.glb hip movement not in the source: smoothing 0.15 s ${(smoothed * 100).toFixed(2)} cm, ` +
      `none ${(raw * 100).toFixed(2)} cm per frame`)
    expect(smoothed).toBeLessThan(raw)
  })

  it('an explicit up direction gives the same result as the detected one', async () => {
    const detected = worst_foot_error(await retarget_clip('crouch-idle.glb'))
    const given = worst_foot_error(await retarget_clip('crouch-idle.glb', 'y', { up: new Vector3(0, 1, 0) }))
    expect(given).toBeCloseTo(detected, 6)
  })
})
