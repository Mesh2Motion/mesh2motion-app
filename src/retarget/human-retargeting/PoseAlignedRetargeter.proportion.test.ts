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
import { PoseAlignedRetargeter } from './PoseAlignedRetargeter.ts'

const M2M_SKELETON = 'static/assets/human/skeleton.glb'
const RPM_AVATAR = 'static/test-files/retarget testing/rpm-avatar.glb'
const FPS = 30
/** palms closer than this (metres) count as touching or about to */
const NEAR_CONTACT = 0.12
/** RPM wrist-to-fingertip length over M2M's, measured from the two files */
const RPM_HAND_SIZE = 0.833

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
interface RigNames { left: ArmNames, right: ArmNames, left_thigh: string, right_thigh: string, left_foot: string, right_foot: string }

const M2M: RigNames = {
  left: { clavicle: 'clavicle_l', upper: 'upperarm_l', lower: 'lowerarm_l', hand: 'hand_l' },
  right: { clavicle: 'clavicle_r', upper: 'upperarm_r', lower: 'lowerarm_r', hand: 'hand_r' },
  left_thigh: 'thigh_l', right_thigh: 'thigh_r', left_foot: 'foot_l', right_foot: 'foot_r'
}
const RPM: RigNames = {
  left: { clavicle: 'LeftShoulder', upper: 'LeftArm', lower: 'LeftForeArm', hand: 'LeftHand' },
  right: { clavicle: 'RightShoulder', upper: 'RightArm', lower: 'RightForeArm', hand: 'RightHand' },
  left_thigh: 'LeftUpLeg', right_thigh: 'RightUpLeg', left_foot: 'LeftFoot', right_foot: 'RightFoot'
}

interface Frame {
  /** left-to-right hand separation in shoulder half-widths: 0 = touching, negative = crossed */
  hand_gap: number
  /** distance between the two palm centres, metres */
  palm_distance: number
  /** same for the feet, in hip half-widths */
  foot_gap: number
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
      rotations: new Map(skeleton.bones.map(b => [b.name, b.quaternion.clone()]))
    })
  }
  return frames
}

interface Result { source: Frame[], plain: Frame[], corrected: Frame[] }

async function retarget_clip (animation_file: string): Promise<Result> {
  const source_file = await load_glb(M2M_SKELETON)
  const clip = (await load_glb(`static/assets/human/animations/${animation_file}`)).animations[0]
  const target_file = await load_glb(RPM_AVATAR)
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
  const bake = (correct_proportions: boolean): Frame[] => {
    const retargeted = PoseAlignedRetargeter.retarget(clip, new_source(), new_target(), mapping,
      { hip_scale: 1, fps: FPS, correct_proportions })
    return sample(new_target(), retargeted, RPM)
  }

  return { source: sample(new_source(), clip, M2M), plain: bake(false), corrected: bake(true) }
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
      expect(worst).toBeLessThan(15)

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
