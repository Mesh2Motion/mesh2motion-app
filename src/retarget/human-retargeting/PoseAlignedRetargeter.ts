import {
  AnimationClip, AnimationMixer, type Bone, type Object3D,
  Quaternion, QuaternionKeyframeTrack, type Skeleton,
  Vector3, VectorKeyframeTrack
} from 'three'
import { LimbProportionCorrector } from './LimbProportionCorrector.ts'

const _q = new Quaternion()
const _q2 = new Quaternion()
const _v = new Vector3()
const _v2 = new Vector3()
const _goal = new Vector3()

export interface PoseAlignedRetargetOptions {
  hip_scale: number
  fps: number
  /**
   * Reposition limb ends relative to the body so proportion differences between the
   * skeletons do not push hands/feet through each other or the body. Default true.
   */
  correct_proportions?: boolean
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
    const limbs = options.correct_proportions === false
      ? []
      : LimbProportionCorrector.detect_limbs(bone_mapping, source_by_name, target_by_name)
    for (const limb of limbs) {
      console.log(`Proportion correction: ${limb.target_root.name} -> ${limb.target_end.name} ` +
        `(length x${limb.length_ratio.toFixed(3)}, ` +
        `width x${(limb.target_half_width / limb.source_half_width).toFixed(3)}, ` +
        `end x${limb.contact_ratio.toFixed(3)})`)
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

    // Find position bone and compute hip scale
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

      // Pass 1: copy rotations. target_world = source_world × offset, parent-first
      for (const [target_name] of sorted_mapping) {
        const source_bone = source_by_name.get(bone_mapping.get(target_name)!)!
        source_bone.getWorldQuaternion(_q)
        world_rotations.get(target_name)!.copy(_q).multiply(offsets.get(target_name)!)
        apply_world_rotation(target_name)
      }

      // Pass 2: move limb ends to their body-relative positions. Bones below a limb
      // keep their world rotation, so hands and feet stay oriented as the source has them.
      if (limbs.length > 0) {
        for (const limb of limbs) {
          LimbProportionCorrector.compute_goal(limb, _goal)
          LimbProportionCorrector.solve(limb, _goal, world_rotations)
        }
        for (const [target_name] of below_limb) apply_world_rotation(target_name)
      }

      // Pass 3: record keys
      for (const [target_name] of sorted_mapping) {
        const source_name = bone_mapping.get(target_name)!
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
