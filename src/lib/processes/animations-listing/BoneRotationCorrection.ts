import { Quaternion, type Bone, type KeyframeTrack, type Object3D, type QuaternionKeyframeTrack, type Skeleton } from 'three'
import { type BoneRotationCorrectionData, type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BoneRotationCorrection {
  private static quaternion_to_tuple (quaternion: Quaternion): [number, number, number, number] {
    return [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
  }

  private static normalized_bone_name (bone_name: string): string {
    return bone_name.trim().toLowerCase()
  }

  private static get_armature_bones_by_name (armature: Object3D): Map<string, Bone> {
    const reference_map = new Map<string, Bone>()

    armature.traverse((node: Object3D) => {
      if (node.type !== 'Bone') {
        return
      }

      const bone = node as Bone
      reference_map.set(this.normalized_bone_name(bone.name), bone)
    })

    return reference_map
  }

  static clone_data (rotation_corrections: BoneRotationCorrectionData[]): BoneRotationCorrectionData[] {
    return rotation_corrections.map((rotation_correction: BoneRotationCorrectionData) => ({
      ...rotation_correction,
      reference_rest_quaternion: [...rotation_correction.reference_rest_quaternion] as [number, number, number, number],
      target_bind_quaternion: [...rotation_correction.target_bind_quaternion] as [number, number, number, number],
      correction_quaternion: [...rotation_correction.correction_quaternion] as [number, number, number, number]
    }))
  }

  static calculate (
    reference_rest_armature: Object3D,
    target_binding_skeleton: Skeleton
  ): BoneRotationCorrectionData[] {
    const reference_bones_by_name = this.get_armature_bones_by_name(reference_rest_armature)
    const corrections: BoneRotationCorrectionData[] = []

    target_binding_skeleton.bones.forEach((target_bone: Bone) => {
      const normalized_name = this.normalized_bone_name(target_bone.name)
      const reference_bone = reference_bones_by_name.get(normalized_name)

      if (reference_bone === undefined) {
        return
      }

      const reference_quaternion = reference_bone.quaternion.clone().normalize()
      const target_quaternion = target_bone.quaternion.clone().normalize()

      // Delta that rotates reference rest pose into the current edited bind pose.
      const correction_quaternion = target_quaternion
        .clone()
        .multiply(reference_quaternion.clone().invert())
        .normalize()

      const has_meaningful_rotation_difference =
        Math.abs(correction_quaternion.x) > 1e-5 ||
        Math.abs(correction_quaternion.y) > 1e-5 ||
        Math.abs(correction_quaternion.z) > 1e-5 ||
        Math.abs(correction_quaternion.w - 1) > 1e-5

      if (!has_meaningful_rotation_difference) {
        return
      }

      corrections.push({
        bone_name: target_bone.name,
        reference_rest_quaternion: this.quaternion_to_tuple(reference_quaternion),
        target_bind_quaternion: this.quaternion_to_tuple(target_quaternion),
        correction_quaternion: this.quaternion_to_tuple(correction_quaternion)
      })
    })

    return corrections
  }

  static apply (
    animation_clips: TransformedAnimationClipPair[],
    rotation_correction_data: BoneRotationCorrectionData[]
  ): void {
    const correction_map = new Map<string, Quaternion>()

    rotation_correction_data.forEach((rotation_correction: BoneRotationCorrectionData) => {
      const correction_values: [number, number, number, number] = rotation_correction.correction_quaternion
      const correction_quaternion = new Quaternion(
        correction_values[0],
        correction_values[1],
        correction_values[2],
        correction_values[3]
      )
      const normalized_bone_name = this.normalized_bone_name(String(rotation_correction.bone_name))
      correction_map.set(normalized_bone_name, correction_quaternion)
    })

    animation_clips.forEach((warped_clip: TransformedAnimationClipPair) => {
      // Keep correction data on each transformed clip for debugging/export workflows.
      warped_clip.rotation_correction_data = this.clone_data(rotation_correction_data)

      warped_clip.display_animation_clip.tracks.forEach((track: KeyframeTrack) => {
        if (!track.name.toLowerCase().endsWith('.quaternion')) {
          return
        }

        const bone_name = this.normalized_bone_name(track.name.replace(/\.quaternion$/i, ''))
        const correction_quaternion = correction_map.get(bone_name)

        if (correction_quaternion === undefined) {
          return
        }

        const quaternion_track: QuaternionKeyframeTrack = track
        const new_track_values: Float32Array = quaternion_track.values.slice()
        const units_in_quaternions = 4

        for (let i = 0; i < quaternion_track.times.length; i++) {
          const quaternion_offset = i * units_in_quaternions
          const existing_quaternion = new Quaternion(
            new_track_values[quaternion_offset + 0],
            new_track_values[quaternion_offset + 1],
            new_track_values[quaternion_offset + 2],
            new_track_values[quaternion_offset + 3]
          )

          existing_quaternion.multiply(correction_quaternion)

          new_track_values[quaternion_offset + 0] = existing_quaternion.x
          new_track_values[quaternion_offset + 1] = existing_quaternion.y
          new_track_values[quaternion_offset + 2] = existing_quaternion.z
          new_track_values[quaternion_offset + 3] = existing_quaternion.w
        }

        track.values = new_track_values
      })
    })
  }
}