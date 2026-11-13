import {
  AnimationClip, AnimationMixer, type Bone, type Object3D,
  Quaternion, QuaternionKeyframeTrack, type Skeleton,
  Vector3, VectorKeyframeTrack
} from 'three'
import { RetargetUtils, type TrackNameParts } from '../RetargetUtils.ts'

const _q = new Quaternion()
const _q2 = new Quaternion()
const _v = new Vector3()
const _v2 = new Vector3()

export interface PoseAlignedRetargetOptions {
  hip_scale: number
  fps: number
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
 */
export class PoseAlignedRetargeter {

  /**
   * For each mapped bone, find the first mapped child bone.
   * The bone direction is the vector from bone to its mapped child.
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

      for (const child of source_bone.children) {
        if ((child as Bone).isBone !== true) continue
        const child_target = reverse.get(child.name)
        if (child_target !== undefined && target_by_name.has(child_target)) {
          main_child.set(target_name, child_target)
          break
        }
      }
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

  /**
   * Compute how much to scale arm alignment to prevent proportion-based
   * body penetration. Returns a value in (0, 1] where 1 = full alignment
   * and smaller values pull the arms outward.
   */
  private static compute_arm_proportion_scale (
    source_skeleton: Skeleton, target_skeleton: Skeleton,
    bone_mapping: Map<string, string>,
    source_by_name: Map<string, Bone>, target_by_name: Map<string, Bone>
  ): number {
    const find_bone = (skeleton: Skeleton, ...hints: string[]): Bone | undefined =>
      skeleton.bones.find(b => hints.some(h => b.name.toLowerCase().includes(h)))

    const src_shoulder = find_bone(source_skeleton, 'upperarm_l', 'leftarm')
    const src_hand = find_bone(source_skeleton, 'hand_l', 'lefthand')
    const src_spine = find_bone(source_skeleton, 'spine_03', 'spine_02', 'spine2', 'spine1')
    const tgt_shoulder = find_bone(target_skeleton, 'leftarm', 'upperarm_l')
    const tgt_hand = find_bone(target_skeleton, 'lefthand', 'hand_l')
    const tgt_spine = find_bone(target_skeleton, 'spine2', 'spine1', 'spine_03', 'spine_02')

    if (!src_shoulder || !src_hand || !src_spine || !tgt_shoulder || !tgt_hand || !tgt_spine) return 1

    const wp = (bone: Bone): Vector3 => { const v = new Vector3(); bone.getWorldPosition(v); return v }

    const src_arm_len = wp(src_shoulder).distanceTo(wp(src_hand))
    const src_shoulder_x = Math.abs(wp(src_shoulder).x - wp(src_spine).x)
    const tgt_arm_len = wp(tgt_shoulder).distanceTo(wp(tgt_hand))
    const tgt_shoulder_x = Math.abs(wp(tgt_shoulder).x - wp(tgt_spine).x)

    if (src_arm_len < 0.01 || tgt_arm_len < 0.01 || src_shoulder_x < 0.01 || tgt_shoulder_x < 0.01) return 1

    // scale = (target_shoulder_offset × source_arm_length) / (source_shoulder_offset × target_arm_length)
    // When < 1, the target's arms reach further relative to body width → overshoot risk
    const scale = (tgt_shoulder_x * src_arm_len) / (src_shoulder_x * tgt_arm_len)
    console.log(`Arm proportion scale: ${scale.toFixed(3)} (src arm=${src_arm_len.toFixed(3)} shoulder=${src_shoulder_x.toFixed(3)}, tgt arm=${tgt_arm_len.toFixed(3)} shoulder=${tgt_shoulder_x.toFixed(3)})`)
    return Math.min(1, scale)
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
    const main_child = this.build_main_child_map(bone_mapping, source_by_name, target_by_name)

    // ── Phase 1: Swing target bones to match source bone directions ──
    // Both skeletons must be at rest pose with valid world matrices.
    source_skeleton.bones[0]?.updateMatrixWorld(true)
    target_skeleton.bones[0]?.updateMatrixWorld(true)

    // Compute arm proportion scale: prevents hands overshooting into the body
    // when the target has longer arms relative to shoulder width.
    const proportion_scale = this.compute_arm_proportion_scale(
      source_skeleton, target_skeleton, bone_mapping, source_by_name, target_by_name)

    // Bones that should receive proportion correction (arm chain and descendants)
    const arm_source_names = new Set<string>()
    for (const [, sn] of bone_mapping) {
      const lower = sn.toLowerCase()
      if (lower.includes('arm') || lower.includes('hand') || lower.includes('clavicle') ||
          lower.includes('finger') || lower.includes('thumb') || lower.includes('index') ||
          lower.includes('middle') || lower.includes('ring') || lower.includes('pinky')) {
        arm_source_names.add(sn)
      }
    }

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

      // For arm bones, partially align to prevent proportion-based overshoot.
      // Blend toward source direction by proportion_scale (< 1 pulls back).
      let align_dir = s_dir
      if (arm_source_names.has(source_name) && proportion_scale < 1) {
        align_dir = t_dir.clone().lerp(s_dir, proportion_scale).normalize()
      }

      const A = new Quaternion().setFromUnitVectors(t_dir, align_dir)

      // Apply swing to target bone: new world = A × old world
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

    // ── Capture offsets (should be ~pure twist now) ──
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

    // Find position bone and compute hip scale
    const reverse_mapping = RetargetUtils.reverse_bone_mapping_one_to_one(bone_mapping)
    let position_source_name: string | null = null
    for (const [, sn] of bone_mapping) {
      if (sn.toLowerCase().includes('pelvis') || sn.toLowerCase().includes('hips')) {
        position_source_name = sn
        break
      }
    }

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

    for (let frame = 0; frame < frame_count; frame++) {
      const time = Math.min(frame * frame_time, duration)
      mixer.setTime(time)
      source_skeleton.bones[0]?.updateMatrixWorld(true)

      // Process bones parent-first
      for (const [target_name] of sorted_mapping) {
        const source_name = bone_mapping.get(target_name)!
        const source_bone = source_by_name.get(source_name)!
        const target_bone = target_by_name.get(target_name)!
        const offset = offsets.get(target_name)!

        // target_world = source_world × offset
        source_bone.getWorldQuaternion(_q)
        const target_world = _q.multiply(offset)

        // Convert to local: local = parent_world⁻¹ × target_world
        if (target_bone.parent !== null) {
          target_bone.parent.getWorldQuaternion(_q2)
          target_bone.quaternion.copy(_q2.invert().multiply(target_world))
        } else {
          target_bone.quaternion.copy(target_world)
        }
        target_bone.updateMatrixWorld(true)

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

        // Position track for hips
        if (source_name === position_source_name) {
          data.positions.push(
            target_bone.position.x * options.hip_scale,
            target_bone.position.y * options.hip_scale,
            target_bone.position.z * options.hip_scale
          )
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
