import {
  type AnimationClip, type Bone, type Object3D, type Skeleton,
  Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack
} from 'three'
import { RetargetUtils, type TrackNameParts } from '../RetargetUtils.ts'

const BIND_EPSILON = 1e-6

export interface BindCorrection {
  L: Quaternion | null
  R: Quaternion | null
}

export interface BindCorrectionRetargetOptions {
  hip_scale: number
  root_correction_quat: Quaternion | null
  position_bone_name: string | null
}

export class BindCorrectionRetargeter {
  /**
   * Compute world rest quaternion for a bone by walking up only through bones that
   * are in the provided name set. Unmapped ancestors (like M2M's root bone) are
   * skipped — their rotation is not part of the mapped skeleton's coordinate space.
   */
  private static mapped_world_quat (bone: Bone, mapped_names: Set<string>): Quaternion {
    const q = bone.quaternion.clone()
    let current: Object3D | null = bone.parent
    while (current !== null && (current as Bone).isBone === true) {
      if (mapped_names.has(current.name)) {
        q.premultiply(current.quaternion)
      }
      current = current.parent
    }
    return q
  }

  /**
   * Compute L/R bind correction quaternions for each mapped bone where the
   * source and target rest poses differ.
   *
   * Formula:
   *   L = Rt × Wt⁻¹ × Ws × Rs⁻¹   (pre-multiply correction)
   *   R = Ws⁻¹ × Wt                  (post-multiply correction)
   *
   * World quaternions are computed by walking only through mapped ancestors,
   * excluding unmapped bones (like M2M's root bone with its 90° X rotation).
   *
   * @param source_skeleton M2M skeleton at rest pose
   * @param target_skeleton target skeleton at rest pose
   * @param bone_mapping target bone name → source bone name
   */
  static compute_bind_corrections (
    source_skeleton: Skeleton,
    target_skeleton: Skeleton,
    bone_mapping: Map<string, string>
  ): Map<string, BindCorrection> {
    const mapped_source_names = new Set<string>(bone_mapping.values())
    const mapped_target_names = new Set<string>(bone_mapping.keys())

    const source_by_name = new Map<string, Bone>(
      source_skeleton.bones.map(b => [b.name, b])
    )
    const target_by_name = new Map<string, Bone>(
      target_skeleton.bones.map(b => [b.name, b])
    )

    const corrections = new Map<string, BindCorrection>()

    for (const [target_bone_name, source_bone_name] of bone_mapping) {
      const source_bone = source_by_name.get(source_bone_name)
      const target_bone = target_by_name.get(target_bone_name)
      if (source_bone === undefined || target_bone === undefined) continue

      const Rs = source_bone.quaternion.clone()
      const Rt = target_bone.quaternion.clone()
      const Ws = this.mapped_world_quat(source_bone, mapped_source_names)
      const Wt = this.mapped_world_quat(target_bone, mapped_target_names)

      // L = Rt × Wt⁻¹ × Ws × Rs⁻¹
      const L = Rt.clone()
        .multiply(Wt.clone().invert())
        .multiply(Ws.clone())
        .multiply(Rs.clone().invert())

      // R = Ws⁻¹ × Wt
      const R = Ws.clone().invert().multiply(Wt.clone())

      const identity_L = (1 - Math.abs(L.w)) < BIND_EPSILON
      const identity_R = (1 - Math.abs(R.w)) < BIND_EPSILON

      if (identity_L && identity_R) continue

      corrections.set(target_bone_name, {
        L: identity_L ? null : L,
        R: identity_R ? null : R
      })
    }

    return corrections
  }

  /**
   * Retarget a source animation clip onto a target skeleton using bind corrections.
   *
   * For each track:
   * - Quaternion tracks: rename bone, apply L/R correction
   * - Position tracks (hips only): rename, rotate by root correction, scale
   * - Other tracks: skip
   */
  static retarget (
    source_clip: AnimationClip,
    corrections: Map<string, BindCorrection>,
    bone_mapping: Map<string, string>,
    options: BindCorrectionRetargetOptions
  ): AnimationClip {
    const reverse_mapping = RetargetUtils.reverse_bone_mapping_one_to_one(bone_mapping)
    const new_tracks: Array<QuaternionKeyframeTrack | VectorKeyframeTrack> = []
    const tmp_q = new Quaternion()
    const tmp_v = new Vector3()

    for (const track of source_clip.tracks) {
      const parts: TrackNameParts | null = RetargetUtils.parse_track_name_for_metadata(track.name)
      if (parts === null) continue

      const source_bone_name = parts.bone_name
      const property = parts.property

      const target_bone_name = reverse_mapping.get(source_bone_name)
      if (target_bone_name === undefined) continue

      if (property === 'quaternion') {
        const next = track.clone()
        next.name = `${target_bone_name}.quaternion`

        const correction = corrections.get(target_bone_name)
        if (correction !== undefined) {
          for (let i = 0; i < next.values.length; i += 4) {
            tmp_q.set(next.values[i], next.values[i + 1], next.values[i + 2], next.values[i + 3])
            if (correction.L !== null) tmp_q.premultiply(correction.L)
            if (correction.R !== null) tmp_q.multiply(correction.R)
            next.values[i] = tmp_q.x
            next.values[i + 1] = tmp_q.y
            next.values[i + 2] = tmp_q.z
            next.values[i + 3] = tmp_q.w
          }
        }

        new_tracks.push(next as QuaternionKeyframeTrack)
      } else if (property === 'position' && source_bone_name === (options.position_bone_name ?? '')) {
        const next = track.clone()
        next.name = `${target_bone_name}.position`

        for (let i = 0; i < next.values.length; i += 3) {
          if (options.root_correction_quat !== null) {
            tmp_v.set(next.values[i], next.values[i + 1], next.values[i + 2])
              .applyQuaternion(options.root_correction_quat)
            next.values[i] = tmp_v.x
            next.values[i + 1] = tmp_v.y
            next.values[i + 2] = tmp_v.z
          }
          if (options.hip_scale !== 1) {
            next.values[i] *= options.hip_scale
            next.values[i + 1] *= options.hip_scale
            next.values[i + 2] *= options.hip_scale
          }
        }

        new_tracks.push(next as VectorKeyframeTrack)
      }
    }

    const retargeted = source_clip.clone()
    retargeted.tracks = new_tracks
    return retargeted
  }
}
