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
   * Compute per-bone proportion scales to prevent body penetration.
   *
   * For each bone: scale = (tgt_center_dist × src_chain_len) / (src_center_dist × tgt_chain_len)
   *
   * Bones near the body center (spine) get scale ≈ 1 (no correction).
   * Limb bones with different reach/body-width ratios get scale < 1
   * (partial alignment to prevent overshoot).
   */
  private static compute_proportion_scales (
    source_by_name: Map<string, Bone>, target_by_name: Map<string, Bone>,
    bone_mapping: Map<string, string>,
    sorted_mapping: Array<[string, string]>,
    main_child: Map<string, string>
  ): Map<string, number> {
    const scales = new Map<string, number>()
    const wp = (bone: Bone): Vector3 => { const v = new Vector3(); bone.getWorldPosition(v); return v }

    // Body center = pelvis/hips world position
    const src_center_bone = [...source_by_name.values()].find(
      b => b.name.toLowerCase().includes('pelvis') || b.name.toLowerCase().includes('hips'))
    const tgt_center_bone = [...target_by_name.values()].find(
      b => b.name.toLowerCase().includes('pelvis') || b.name.toLowerCase().includes('hips'))
    if (!src_center_bone || !tgt_center_bone) return scales

    const src_center = wp(src_center_bone)
    const tgt_center = wp(tgt_center_bone)

    // Compute chain length from each bone to its furthest mapped descendant
    const src_chain_lengths = new Map<string, number>()
    const tgt_chain_lengths = new Map<string, number>()

    // Walk sorted_mapping in REVERSE (leaf-first) to accumulate chain lengths upward
    for (let i = sorted_mapping.length - 1; i >= 0; i--) {
      const [target_name, source_name] = sorted_mapping[i]
      const child_target = main_child.get(target_name)

      const src_bone = source_by_name.get(source_name)
      const tgt_bone = target_by_name.get(target_name)
      if (!src_bone || !tgt_bone) continue

      let src_len = 0
      let tgt_len = 0

      if (child_target !== undefined) {
        const child_source = bone_mapping.get(child_target)
        const src_child = child_source ? source_by_name.get(child_source) : undefined
        const tgt_child = target_by_name.get(child_target)

        if (src_child && tgt_child) {
          const src_segment = wp(src_bone).distanceTo(wp(src_child))
          const tgt_segment = wp(tgt_bone).distanceTo(wp(tgt_child))
          src_len = src_segment + (src_chain_lengths.get(child_source!) ?? 0)
          tgt_len = tgt_segment + (tgt_chain_lengths.get(child_target) ?? 0)
        }
      }

      src_chain_lengths.set(source_name, src_len)
      tgt_chain_lengths.set(target_name, tgt_len)
    }

    // Detect limb chains by finding the first bone in each limb that has significant
    // lateral offset from the body center. Compute scale from the full limb measurement:
    //   scale = (tgt_joint_offset × src_extremity_reach) / (src_joint_offset × tgt_extremity_reach)
    // where joint_offset = distance from body center to the limb's root joint
    // and extremity_reach = distance from root joint to the chain's end (hand/foot)

    // Find the extremity (furthest descendant) for each bone
    const extremity_of = new Map<string, string>()
    for (const [target_name, source_name] of sorted_mapping) {
      let furthest_tgt = target_name
      let cur = target_name
      while (main_child.has(cur)) { cur = main_child.get(cur)!; furthest_tgt = cur }
      extremity_of.set(target_name, furthest_tgt)
    }

    // Compute scale for bones that are limb joints (offset from center > threshold)
    const limb_scales = new Map<string, number>()
    const OFFSET_THRESHOLD = 0.08

    for (const [target_name, source_name] of sorted_mapping) {
      const src_bone = source_by_name.get(source_name)
      const tgt_bone = target_by_name.get(target_name)
      if (!src_bone || !tgt_bone) continue

      const src_pos = wp(src_bone)
      const tgt_pos = wp(tgt_bone)
      const src_offset = Math.abs(src_pos.x - src_center.x)
      const tgt_offset = Math.abs(tgt_pos.x - tgt_center.x)

      // Only compute for bones with significant lateral offset (limb joints, not spine)
      if (src_offset < OFFSET_THRESHOLD || tgt_offset < OFFSET_THRESHOLD) continue

      // Reach from this bone to its extremity
      const extremity_tgt = extremity_of.get(target_name)
      const extremity_src_name = extremity_tgt ? bone_mapping.get(extremity_tgt) : undefined
      if (!extremity_tgt || !extremity_src_name) continue

      const src_extremity = source_by_name.get(extremity_src_name)
      const tgt_extremity = target_by_name.get(extremity_tgt)
      if (!src_extremity || !tgt_extremity) continue

      const src_reach = src_pos.distanceTo(wp(src_extremity))
      const tgt_reach = tgt_pos.distanceTo(wp(tgt_extremity))
      if (src_reach < 0.01 || tgt_reach < 0.01) continue

      const scale = Math.min(1, (tgt_offset * src_reach) / (src_offset * tgt_reach))
      limb_scales.set(target_name, scale)
    }

    // Each bone inherits the nearest ancestor's scale (parent-first order ensures
    // the chain root's scale propagates to all descendants uniformly).
    for (const [target_name] of sorted_mapping) {
      const tgt_bone = target_by_name.get(target_name)
      let current: Bone | null = tgt_bone?.parent as Bone ?? null
      let inherited = -1
      while (current !== null && (current as Bone).isBone === true) {
        if (scales.has(current.name) && scales.get(current.name)! < 1) {
          inherited = scales.get(current.name)!
          break
        }
        if (limb_scales.has(current.name)) { inherited = limb_scales.get(current.name)!; break }
        current = current.parent as Bone
      }
      // Use inherited scale if available, otherwise own computed scale, otherwise 1
      if (inherited > 0) {
        scales.set(target_name, inherited)
      } else if (limb_scales.has(target_name)) {
        scales.set(target_name, limb_scales.get(target_name)!)
      } else {
        scales.set(target_name, 1)
      }
    }

    // Log
    const logged = new Set<number>()
    for (const [name, scale] of scales) {
      const rounded = Math.round(scale * 1000)
      if (scale < 0.99 && !logged.has(rounded)) {
        logged.add(rounded)
        console.log(`Proportion scale: ${scale.toFixed(3)} (e.g. ${name})`)
      }
    }

    return scales
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

    // Per-chain proportion scales: prevents limbs overshooting into the body.
    // Computed at the limb root (upper arm, thigh) and inherited by children.
    const proportion_scales = this.compute_proportion_scales(
      source_by_name, target_by_name, bone_mapping, sorted_mapping, main_child)

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

      // Partially align bones with proportion mismatch to prevent overshoot.
      const bone_scale = proportion_scales.get(target_name) ?? 1
      let align_dir = s_dir
      if (bone_scale < 1) {
        align_dir = t_dir.clone().lerp(s_dir, bone_scale).normalize()
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
