import {
  AnimationClip, AnimationMixer, type Bone, type Object3D,
  Quaternion, QuaternionKeyframeTrack, type Skeleton,
  Vector3, VectorKeyframeTrack
} from 'three'
import { LimbProportionCorrector, type ProportionLimb } from './LimbProportionCorrector.ts'

const _q = new Quaternion()
const _q2 = new Quaternion()
const _v = new Vector3()
const _v2 = new Vector3()
const _goal = new Vector3()

/**
 * What the proportion correction does and how hard. Every part can be switched off
 * or tuned on its own. The defaults favour exact contact over smoothness.
 */
export interface ProportionSettings {
  /**
   * Keep hands (and feet) where the source has them relative to the body's centre
   * line and to each other, so they meet instead of crossing or stopping short.
   */
  keep_limb_spacing: boolean
  /**
   * Keep a hand (or foot) that is close to another part of the body on the source at
   * the same offset from that part on the target: a hand hanging by the thigh, on
   * the hip, on the opposite arm, at the head. Stops arms swinging into the legs on
   * a target with narrower shoulders or wider hips.
   */
  keep_body_clearance: boolean
  /**
   * Multiplies those offsets. Bone lengths say nothing about how thick a body is, so
   * raise it (1.2, 1.5) for a bulky target whose hands still sink in, lower it for a
   * slim one whose hands hover.
   */
  body_clearance_scale: number
  /** Set the body's height, and each leg, so planted feet sit on the floor. */
  ground_feet: boolean
  /** Put hands down on the floor when the source has them there (push-ups, crawling). */
  ground_hands: boolean
  /**
   * Seconds over which the body's height correction is averaged. Longer gives
   * steadier hips through a stride and leaves more for the legs to take up;
   * 0 follows the feet frame by frame.
   */
  body_height_smoothing: number
  /**
   * Seconds over which each limb end's correction is averaged. 0 keeps contact
   * exact on the frame it happens. About 0.035 (one frame at 30 fps) softens the
   * single-frame jumps in very fast clips, at the cost of contact: a clap's palms
   * end up noticeably closer than the source has them.
   */
  limb_smoothing: number
  /**
   * Most an elbow or knee may be opened or closed by the correction, in degrees.
   * Lower stays closer to the rotation-copied pose and reaches less far.
   */
  max_joint_change: number
  /** World direction pointing away from the floor. null works it out from the rest pose. */
  up: Vector3 | null
}

export const DEFAULT_PROPORTION_SETTINGS: Readonly<ProportionSettings> = {
  keep_limb_spacing: true,
  keep_body_clearance: true,
  body_clearance_scale: 1,
  ground_feet: true,
  ground_hands: true,
  body_height_smoothing: 0.15,
  limb_smoothing: 0,
  max_joint_change: 30,
  up: null
}

export interface PoseAlignedRetargetOptions {
  /**
   * Target size over source size (hip height ratio). Scales the body's translation
   * when no legs are detected to measure a leg length ratio from.
   */
  hip_scale: number
  fps: number
  /**
   * Reposition limb ends relative to the body so proportion differences between the
   * skeletons do not push hands/feet through each other or the body. Default true.
   */
  correct_proportions?: boolean
  /** Overrides for individual parts of the proportion correction. See ProportionSettings. */
  proportion_settings?: Partial<ProportionSettings>
}

/**
 * Retargets animations by aligning the target skeleton's bone directions to
 * the source skeleton before capturing reference offsets.
 *
 * The offset between aligned skeletons is pure twist (bone-roll convention
 * difference), not swing (T-pose vs A-pose mismatch). Per-frame retarget
 * applies: target_world = source_world × twist_offset, then converts to local
 * space using the already-retargeted parent. Bones are processed parent-first
 * so children always see the corrected parent.
 *
 * Rotation copying alone leaves limb ends wherever the target's proportions put
 * them, so each frame is followed by a positional pass on the arms and legs.
 * See LimbProportionCorrector.
 */
export class PoseAlignedRetargeter {

  /**
   * For each mapped bone, pick the mapped child that defines its direction.
   * The bone direction is the vector from bone to that child.
   *
   * Where a bone branches into a mirrored pair plus something else (chest: neck and
   * two clavicles, hips: spine and two thighs), the child that is not half of a pair
   * is used. Pointing the chest at one clavicle would roll the whole upper body
   * sideways whenever the two rigs place their shoulder joints differently.
   *
   * Needs the source skeleton's world matrices to be up to date.
   */
  private static build_main_child_map (
    bone_mapping: Map<string, string>,
    source_by_name: Map<string, Bone>,
    target_by_name: Map<string, Bone>
  ): Map<string, string> {
    const reverse = new Map<string, string>()
    for (const [tn, sn] of bone_mapping) reverse.set(sn, tn)

    const main_child = new Map<string, string>()

    for (const [target_name, source_name] of bone_mapping) {
      const source_bone = source_by_name.get(source_name)
      if (source_bone === undefined) continue

      const mapped_children: Bone[] = []
      for (const child of source_bone.children) {
        if ((child as Bone).isBone !== true) continue
        const child_target = reverse.get(child.name)
        if (child_target !== undefined && target_by_name.has(child_target)) mapped_children.push(child as Bone)
      }
      if (mapped_children.length === 0) continue

      // a child with a sibling at the same distance from the bone is half of a mirrored pair
      const origin = source_bone.getWorldPosition(new Vector3())
      const distances = mapped_children.map(child => child.getWorldPosition(new Vector3()).distanceTo(origin))
      const is_paired = (index: number): boolean => distances.some((other, other_index) =>
        other_index !== index && Math.abs(other - distances[index]) <= 0.02 * Math.max(other, distances[index]))
      const unpaired = mapped_children.findIndex((_, index) => !is_paired(index))

      const chosen = mapped_children[unpaired === -1 ? 0 : unpaired]
      main_child.set(target_name, reverse.get(chosen.name) as string)
    }
    return main_child
  }

  /**
   * Sort mapped bones parent-first so each bone is processed after its parent.
   */
  private static parent_first_order (
    bone_mapping: Map<string, string>,
    target_skeleton: Skeleton
  ): Array<[string, string]> {
    const target_by_name = new Map<string, Bone>(
      target_skeleton.bones.map(b => [b.name, b])
    )

    const depth = (bone_name: string): number => {
      let d = 0
      let current: Object3D | null = target_by_name.get(bone_name) ?? null
      while (current !== null) { d++; current = current.parent }
      return d
    }

    const entries = [...bone_mapping.entries()]
    entries.sort((a, b) => depth(a[0]) - depth(b[0]))
    return entries
  }

  static retarget (
    source_clip: AnimationClip,
    source_skeleton: Skeleton,
    target_skeleton: Skeleton,
    bone_mapping: Map<string, string>,
    options: PoseAlignedRetargetOptions
  ): AnimationClip {
    const source_by_name = new Map<string, Bone>(
      source_skeleton.bones.map(b => [b.name, b])
    )
    const target_by_name = new Map<string, Bone>(
      target_skeleton.bones.map(b => [b.name, b])
    )

    const sorted_mapping = this.parent_first_order(bone_mapping, target_skeleton)
    // ── Phase 1: Swing target bones to match source bone directions ──
    // Both skeletons must be at rest pose with valid world matrices.
    source_skeleton.bones[0]?.updateMatrixWorld(true)
    target_skeleton.bones[0]?.updateMatrixWorld(true)

    const main_child = this.build_main_child_map(bone_mapping, source_by_name, target_by_name)

    // Where the target's joints are in its own rest pose, before it gets re-posed
    const target_rest_positions = new Map<Bone, Vector3>(
      target_skeleton.bones.map(b => [b, b.getWorldPosition(new Vector3())]))

    for (const [target_name] of sorted_mapping) {
      const source_name = bone_mapping.get(target_name)!
      const child_target_name = main_child.get(target_name)
      if (child_target_name === undefined) continue

      const source_bone = source_by_name.get(source_name)!
      const target_bone = target_by_name.get(target_name)!
      const source_child_name = bone_mapping.get(child_target_name)!
      const source_child = source_by_name.get(source_child_name)!
      const target_child = target_by_name.get(child_target_name)!

      // Bone direction = world position of child minus world position of bone
      source_bone.getWorldPosition(_v)
      source_child.getWorldPosition(_v2)
      const s_dir = _v2.clone().sub(_v).normalize()

      target_bone.getWorldPosition(_v)
      target_child.getWorldPosition(_v2)
      const t_dir = _v2.clone().sub(_v).normalize()

      const A = new Quaternion().setFromUnitVectors(t_dir, s_dir)

      target_bone.getWorldQuaternion(_q)
      const new_world = A.clone().multiply(_q)

      // Convert to local: local = parent_world⁻¹ × world
      if (target_bone.parent !== null) {
        target_bone.parent.getWorldQuaternion(_q2)
        target_bone.quaternion.copy(_q2.invert().multiply(new_world))
      } else {
        target_bone.quaternion.copy(new_world)
      }
      // Children must see this change
      target_bone.updateMatrixWorld(true)
    }

    // ── Capture offsets ──
    const offsets = new Map<string, Quaternion>()
    for (const [target_name] of sorted_mapping) {
      const source_name = bone_mapping.get(target_name)!
      const source_bone = source_by_name.get(source_name)!
      const target_bone = target_by_name.get(target_name)!

      source_bone.getWorldQuaternion(_q)
      target_bone.getWorldQuaternion(_q2)
      // offset = source_world⁻¹ × target_world_aligned
      offsets.set(target_name, _q.invert().multiply(_q2).clone())
    }

    // ── Find the limbs that get a positional correction ──
    // Measured now, while source (rest) and target (aligned) are in matching poses.
    const settings: ProportionSettings = { ...DEFAULT_PROPORTION_SETTINGS, ...options.proportion_settings }
    const max_hinge_change = settings.max_joint_change * Math.PI / 180
    const limbs = options.correct_proportions === false
      ? []
      : LimbProportionCorrector.detect_limbs(
        bone_mapping, source_by_name, target_by_name, target_rest_positions, settings.up)
    // the legs still set the scale of the body's travel when their grounding is off
    const standing_limbs = limbs.filter(limb => limb.grounded)
    const grounded_limbs = settings.ground_feet ? standing_limbs : []
    const up = limbs[0]?.up ?? new Vector3(0, 1, 0)

    // How far the body travels scales with leg length: a crouch that folds the legs
    // to the same angles drops the hips by that much. The hip height ratio is only
    // a stand-in for it (it also counts ankle and sole height, which do not fold).
    const translation_scale = standing_limbs.length > 0
      ? standing_limbs.reduce((sum, limb) => sum + limb.length_ratio, 0) / standing_limbs.length
      : options.hip_scale
    for (const limb of limbs) {
      console.log(`Proportion correction: ${limb.target_root.name} -> ${limb.target_end.name} ` +
        `(length x${limb.length_ratio.toFixed(3)}, ` +
        `width x${(limb.target_half_width / limb.source_half_width).toFixed(3)}, ` +
        `end x${limb.contact_ratio.toFixed(3)}${limb.grounded ? ', grounded' : ''})`)
    }

    // Bones whose local rotation depends on a corrected limb: the limb itself and
    // everything below it, in parent-first order.
    const below_limb = sorted_mapping.filter(([target_name]) => {
      let current: Object3D | null = target_by_name.get(target_name) ?? null
      while (current !== null) {
        if (limbs.some(limb => limb.target_root === current)) return true
        current = current.parent
      }
      return false
    })

    // World rotation each target bone should have on the current frame
    const world_rotations = new Map<string, Quaternion>()
    for (const [target_name] of sorted_mapping) world_rotations.set(target_name, new Quaternion())

    const apply_world_rotation = (target_name: string): void => {
      const target_bone = target_by_name.get(target_name)!
      const target_world = world_rotations.get(target_name)!
      // local = parent_world⁻¹ × target_world
      if (target_bone.parent !== null) {
        target_bone.parent.getWorldQuaternion(_q2)
        target_bone.quaternion.copy(_q2.invert().multiply(target_world))
      } else {
        target_bone.quaternion.copy(target_world)
      }
      target_bone.updateMatrixWorld(true)
    }

    // ── Find the bone that carries the body's translation ──
    // The mapped pelvis/hips by name, else the top-most mapped bone.
    let position_target_name: string | null = sorted_mapping[0]?.[0] ?? null
    for (const [target_name, source_name] of sorted_mapping) {
      const lower = source_name.toLowerCase()
      if (lower.includes('pelvis') || lower.includes('hips')) { position_target_name = target_name; break }
    }
    const position_source = position_target_name === null
      ? undefined
      : source_by_name.get(bone_mapping.get(position_target_name)!)
    const position_target = position_target_name === null ? undefined : target_by_name.get(position_target_name)
    // Where both sit in the reference pose. Phase 1 only rotates, so these are still rest positions.
    const source_rest_position = position_source?.getWorldPosition(new Vector3()) ?? new Vector3()
    const target_rest_position = position_target?.getWorldPosition(new Vector3()) ?? new Vector3()

    // How much the body is standing on its feet this frame, from the source's hip
    // height: 1 from a deep crouch upwards, 0 when sitting or lying on the floor.
    // Only then do the feet decide how high the body sits.
    const source_floor = grounded_limbs.reduce((sum, limb) => sum + limb.source_floor, 0) /
      Math.max(1, grounded_limbs.length)
    const standing_amount = (source_hip_height: number): number => {
      if (grounded_limbs.length === 0) return 1
      const relative = (source_hip_height - source_floor) / (source_rest_position.dot(up) - source_floor)
      const t = Math.min(1, Math.max(0, (relative - 0.2) / 0.2))
      return t * t * (3 - 2 * t)
    }
    let standing = 1

    // ── Phase 2: Sample animation frame-by-frame ──
    const mixer = new AnimationMixer(source_skeleton.bones[0])
    const action = mixer.clipAction(source_clip, source_skeleton.bones[0])
    action.play()

    const duration = source_clip.duration
    const frame_time = 1 / options.fps
    const frame_count = Math.ceil(duration * options.fps) + 1

    // Storage: target_bone_name → { times, quaternions, positions }
    const bone_data = new Map<string, { times: number[], quaternions: number[], positions: number[] }>()
    for (const [target_name] of sorted_mapping) {
      bone_data.set(target_name, { times: [], quaternions: [], positions: [] })
    }

    // Pose both skeletons for a frame: source from the clip, target by rotation copy
    const copy_pose = (frame: number): number => {
      const time = Math.min(frame * frame_time, duration)
      mixer.setTime(time)
      source_skeleton.bones[0]?.updateMatrixWorld(true)

      // Body translation: the source's displacement from its rest position, scaled to
      // the target's size, applied on top of the target's own rest position.
      if (position_source !== undefined && position_target !== undefined) {
        position_source.getWorldPosition(_v)
        standing = standing_amount(_v.dot(up))
        _v.sub(source_rest_position)
        // off its feet, height above the floor goes by overall body size instead
        const vertical_scale = options.hip_scale + (translation_scale - options.hip_scale) * standing
        const rise = _v.dot(up)
        _v.multiplyScalar(translation_scale).addScaledVector(up, rise * (vertical_scale - translation_scale))
          .add(target_rest_position)
        if (position_target.parent !== null) position_target.parent.worldToLocal(_v)
        position_target.position.copy(_v)
      }

      // target_world = source_world × offset, parent-first
      for (const [target_name] of sorted_mapping) {
        const source_bone = source_by_name.get(bone_mapping.get(target_name)!)!
        source_bone.getWorldQuaternion(_q)
        world_rotations.get(target_name)!.copy(_q).multiply(offsets.get(target_name)!)
        apply_world_rotation(target_name)
      }
      return time
    }

    // Gaussian average over neighbouring frames. Each frame's value counts by its
    // confidence. Where the confidence nearby averages less than `floor`, the result
    // shrinks towards zero in proportion; above that it is the plain weighted average.
    const smooth = (values: Float32Array, seconds: number, confidence: Float32Array, floor: number): Float32Array => {
      const sigma = Math.max(1e-3, seconds * options.fps)
      const reach = Math.ceil(3 * sigma)
      const result = new Float32Array(values.length)
      for (let frame = 0; frame < values.length; frame++) {
        let total = 0
        let weights = 0
        let plain_weights = 0
        for (let other = Math.max(0, frame - reach); other <= Math.min(values.length - 1, frame + reach); other++) {
          const weight = Math.exp(-0.5 * ((other - frame) / sigma) ** 2)
          const trusted = weight * confidence[other]
          total += trusted * values[other]
          weights += trusted
          plain_weights += weight
        }
        const divisor = Math.max(weights, floor * plain_weights)
        result[frame] = divisor > 0 ? total / divisor : 0
      }
      return result
    }

    const set_body_height = (frame: number): void => {
      if (grounded_limbs.length === 0 || position_target === undefined) return
      position_target.getWorldPosition(_v)
      _v.addScaledVector(up, body_lifts[frame])
      if (position_target.parent !== null) position_target.parent.worldToLocal(_v)
      position_target.position.copy(_v)
      position_target.updateMatrixWorld(true)
    }

    // ── Sweep 1: how high the body should sit ──
    // How far the whole body is raised or lowered each frame so the planted feet sit
    // at the height the source has them above the floor. The frame-by-frame figure
    // wobbles through a stride as each leg's error comes and goes, and means nothing
    // while both feet are in the air. So the body takes only the slow part of it,
    // carried across from the frames where a foot is actually down, and the legs
    // take up the rest below.
    let body_lifts: Float32Array = new Float32Array(frame_count)
    if (grounded_limbs.length > 0 && position_target !== undefined) {
      const confidence = new Float32Array(frame_count)
      for (let frame = 0; frame < frame_count; frame++) {
        copy_pose(frame)
        const wanted = LimbProportionCorrector.body_lift(grounded_limbs, translation_scale)
        body_lifts[frame] = wanted.lift
        confidence[frame] = wanted.confidence * standing
      }
      body_lifts = smooth(body_lifts, settings.body_height_smoothing, confidence, 0.3)
    }

    // Where a limb's end joint should go on the frame both skeletons are posed for
    const last_contact = new Map(limbs.map(limb => [limb, { position: new Vector3(), frame: -2 }]))
    const limb_goal = (limb: ProportionLimb, out: Vector3, frame: number): Vector3 => {
      // the legs take up what the body's height left over for each foot. Hands
      // only come into it when the source has them down on the floor
      const use_floor = limb.floor_known && (limb.grounded ? settings.ground_feet : settings.ground_hands)
      const lift = use_floor
        ? -(limb.grounded ? standing : 1) * LimbProportionCorrector.floor_weight(limb) *
          LimbProportionCorrector.height_error(limb, translation_scale)
        : 0
      LimbProportionCorrector.compute_goal(limb, out, lift, settings.keep_limb_spacing)
      // not for the limbs being stood on: where a foot goes is the floor's business,
      // and feet passing each other are already kept apart by their spacing
      if (settings.keep_body_clearance && !limb.grounded) {
        // A hand whipping past the body is not resting near anything, and a clearance
        // that cuts in for a single frame of it only shows as a twitch. So it lets go
        // as the hand's speed against the body rises from 1.5 to 4.5 m/s on a
        // human-sized hand (a quarter to three quarters of a hand-length per 1/30 s)
        const position = LimbProportionCorrector.source_contact_on_body(limb, _v2)
        const last = last_contact.get(limb)!
        const speed = last.frame === frame - 1 ? position.distanceTo(last.position) * options.fps : 0
        last.position.copy(position)
        last.frame = frame
        const hand_lengths_per_second = speed / limb.source_contact_size
        const t = Math.min(1, Math.max(0, (hand_lengths_per_second - 7.5) / 15))
        LimbProportionCorrector.keep_clearance(limb, out, settings.body_clearance_scale, 1 - t * t * (3 - 2 * t))
      }
      return out
    }

    // ── Sweep 2 (only with limb smoothing): average each limb end's correction ──
    // Kept as an offset from the rotation-copied position, in the anchor bone's
    // orientation so it turns with the body.
    let limb_offsets: Float32Array[][] | null = null
    if (settings.limb_smoothing > 0 && limbs.length > 0) {
      const offsets_by_limb: Float32Array[][] = limbs.map(() => [0, 1, 2].map(() => new Float32Array(frame_count)))
      for (let frame = 0; frame < frame_count; frame++) {
        copy_pose(frame)
        set_body_height(frame)
        limbs.forEach((limb, index) => {
          limb_goal(limb, _goal, frame).sub(limb.target_end.getWorldPosition(_v))
            .applyQuaternion(limb.target_anchor.getWorldQuaternion(_q).invert())
          offsets_by_limb[index][0][frame] = _goal.x
          offsets_by_limb[index][1][frame] = _goal.y
          offsets_by_limb[index][2][frame] = _goal.z
        })
      }
      const every_frame = new Float32Array(frame_count).fill(1)
      limb_offsets = offsets_by_limb.map(axes =>
        axes.map(values => smooth(values, settings.limb_smoothing, every_frame, 0)))
    }

    // ── Final sweep: bake ──
    for (let frame = 0; frame < frame_count; frame++) {
      // Pass 1: copy rotations
      const time = copy_pose(frame)

      // Pass 2: move limb ends to their body-relative positions. Bones below a limb
      // keep their world rotation, so hands and feet stay oriented as the source has them.
      if (limbs.length > 0) {
        set_body_height(frame)
        limbs.forEach((limb, index) => {
          if (limb_offsets === null) {
            limb_goal(limb, _goal, frame)
          } else {
            const offset = limb_offsets[index]
            _goal.set(offset[0][frame], offset[1][frame], offset[2][frame])
              .applyQuaternion(limb.target_anchor.getWorldQuaternion(_q))
              .add(limb.target_end.getWorldPosition(_v))
          }
          LimbProportionCorrector.solve(limb, _goal, world_rotations, max_hinge_change)
        })
        for (const [target_name] of below_limb) apply_world_rotation(target_name)
      }

      // Pass 3: record keys
      for (const [target_name] of sorted_mapping) {
        const target_bone = target_by_name.get(target_name)!

        // Hemisphere continuity: flip if dot with previous key is negative
        const data = bone_data.get(target_name)!
        const q = target_bone.quaternion
        if (data.quaternions.length >= 4) {
          const prev_i = data.quaternions.length - 4
          const dot = q.x * data.quaternions[prev_i] + q.y * data.quaternions[prev_i + 1] +
                      q.z * data.quaternions[prev_i + 2] + q.w * data.quaternions[prev_i + 3]
          if (dot < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w }
        }

        data.times.push(time)
        data.quaternions.push(q.x, q.y, q.z, q.w)

        if (target_name === position_target_name) {
          data.positions.push(target_bone.position.x, target_bone.position.y, target_bone.position.z)
        }
      }
    }

    // ── Build tracks ──
    const tracks: Array<QuaternionKeyframeTrack | VectorKeyframeTrack> = []
    for (const [target_name, data] of bone_data) {
      tracks.push(new QuaternionKeyframeTrack(
        `${target_name}.quaternion`,
        new Float32Array(data.times),
        new Float32Array(data.quaternions)
      ))
      if (data.positions.length > 0) {
        tracks.push(new VectorKeyframeTrack(
          `${target_name}.position`,
          new Float32Array(data.times),
          new Float32Array(data.positions)
        ))
      }
    }

    console.log(`Pose-aligned retarget: ${frame_count} frames, ${tracks.length} tracks, ${offsets.size} bones`)
    return new AnimationClip(`${source_clip.name} RT`, duration, tracks)
  }
}
