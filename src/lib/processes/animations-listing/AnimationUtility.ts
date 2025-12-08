import { AnimationClip, Quaternion, Vector3, Euler, type KeyframeTrack, type QuaternionKeyframeTrack } from 'three'
import type { TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair'

export class AnimationUtility {
  // when we scaled the skeleton itself near the beginning, we kept track of that
  // this scaling will affect position keyframes since they expect the original skeleton scale
  // this will fix any issues with position keyframes not matching the current skeleton scale
  static apply_skeleton_scale_to_position_keyframes (animation_clips: AnimationClip[], scaleAmount: number): void {
    animation_clips.forEach((animation_clip: AnimationClip) => {
      animation_clip.tracks.forEach((track: KeyframeTrack) => {
        if (track.name.includes('.position')) {
          const values = track.values
          for (let i = 0; i < values.length; i += 3) {
            values[i] *= scaleAmount
            values[i + 1] *= scaleAmount
            values[i + 2] *= scaleAmount
          }
        }
      })
    })
  }

  static deep_clone_animation_clip (clip: AnimationClip): AnimationClip {
    const tracks = clip.tracks.map((track: KeyframeTrack) => track.clone())
    return new AnimationClip(clip.name, clip.duration, tracks)
  }

  static deep_clone_animation_clips (animation_clips: AnimationClip[]): AnimationClip[] {
    return animation_clips.map((clip: AnimationClip) => {
      return this.deep_clone_animation_clip(clip)
    })
  }

  /// Removes position tracks from animation clips, keeping only rotation tracks.
  /// @param animation_clips - The animation clips to modify.
  /// @param preserve_root_position - Whether to keep the root position track.
  static clean_track_data (animation_clips: AnimationClip[]): void {
    animation_clips.forEach((animation_clip: AnimationClip) => {
      // remove all position nodes except root
      let rotation_tracks: KeyframeTrack[] = []

      // does the animation clip name include "RM". This indicates a root motion clip and we can keep the root position track
      const preserve_root_position: boolean = animation_clip.name.toLowerCase().endsWith('rm')

      if (preserve_root_position) {
        rotation_tracks = animation_clip.tracks
          .filter((x: KeyframeTrack) => x.name.includes('quaternion') ||
          x.name.toLowerCase().includes('hips.position') ||
          x.name.toLowerCase().includes('root.position'))
        console.log('Preserving root position for clip: ' + animation_clip.name)
      } else {
        rotation_tracks = animation_clip.tracks
          .filter((x: KeyframeTrack) => x.name.includes('quaternion') ||
          x.name.toLowerCase().includes('hips.position'))
      }

      animation_clip.tracks = rotation_tracks // update track data
    })
  }

  /**
   * Applies rotation constraints to finger bones to prevent unnatural backward bending.
   * This is especially important for models with simplified hand skeletons (2-3 bones)
   * where animations designed for full 5-finger skeletons can cause issues.
   * @param animation_clips - The animation clips to constrain
   */
  static apply_finger_rotation_constraints (animation_clips: TransformedAnimationClipPair[]): void {
    animation_clips.forEach((warped_clip: TransformedAnimationClipPair) => {
      warped_clip.display_animation_clip.tracks.forEach((track: KeyframeTrack) => {
        // Only process quaternion tracks for finger bones
        if (!track.name.includes('quaternion')) {
          return
        }

        const track_name_lower = track.name.toLowerCase()

        // Check if this is a finger bone (thumb, index, middle, ring, pinky)
        const is_finger_bone = track_name_lower.includes('thumb') ||
                              track_name_lower.includes('index') ||
                              track_name_lower.includes('middle') ||
                              track_name_lower.includes('ring') ||
                              track_name_lower.includes('pinky') ||
                              track_name_lower.includes('finger')

        if (!is_finger_bone) {
          return
        }

        const quaternion_track: QuaternionKeyframeTrack = track as QuaternionKeyframeTrack
        const values = quaternion_track.values
        const units_in_quaternions = 4

        // Process each quaternion keyframe
        for (let i = 0; i < values.length; i += units_in_quaternions) {
          const quat = new Quaternion(
            values[i], // x
            values[i + 1], // y
            values[i + 2], // z
            values[i + 3] // w
          )

          // Convert quaternion to Euler angles to check and constrain rotation
          const euler = new Vector3()
          this.quaternion_to_constrained_euler(quat, euler)

          // Constrain finger rotations to prevent backward bending
          // Fingers typically bend in one direction (curling forward)
          // We'll limit the extension (backward bending) while allowing natural curling

          // X-axis: finger curl/extension (main bending axis)
          // Limit extension to prevent backward bending (negative values = extension)
          euler.x = Math.max(euler.x, -0.2) // Limit backward bend to ~11 degrees
          euler.x = Math.min(euler.x, 1.8) // Allow forward curl up to ~103 degrees

          // Y-axis: side-to-side movement (adduction/abduction)
          // Allow some side movement but not excessive
          euler.y = Math.max(euler.y, -0.5) // ~-29 degrees
          euler.y = Math.min(euler.y, 0.5) // ~29 degrees

          // Z-axis: rotation along finger length
          // Minimal rotation along this axis for natural movement
          euler.z = Math.max(euler.z, -0.3) // ~-17 degrees
          euler.z = Math.min(euler.z, 0.3) // ~17 degrees

          // Convert constrained Euler angles back to quaternion
          const constrained_quat = new Quaternion()
          constrained_quat.setFromEuler(new Euler(euler.x, euler.y, euler.z, 'XYZ'))

          // Write back the constrained quaternion
          values[i] = constrained_quat.x
          values[i + 1] = constrained_quat.y
          values[i + 2] = constrained_quat.z
          values[i + 3] = constrained_quat.w
        }
      })
    })
  }

  /**
   * Converts a quaternion to Euler angles safely
   * @param quat - Input quaternion
   * @param euler - Output Euler angles as Vector3
   */
  private static quaternion_to_constrained_euler (quat: Quaternion, euler: Vector3): void {
    // Create a temporary Euler to extract angles
    const temp_euler = new Euler()
    temp_euler.setFromQuaternion(quat, 'XYZ')
    euler.x = temp_euler.x
    euler.y = temp_euler.y
    euler.z = temp_euler.z
  }

  static apply_arm_extension_warp (animation_clips: TransformedAnimationClipPair[], percentage: number): void {
    // loop through each animation clip to update the tracks
    animation_clips.forEach((warped_clip: TransformedAnimationClipPair) => {
      warped_clip.display_animation_clip.tracks.forEach((track: KeyframeTrack) => {
        // if our name does not contain 'quaternion', we need to exit
        // since we are only modifying the quaternion tracks (e.g. L_Arm.quaternion )
        if (!track.name.includes('quaternion')) {
          return
        }

        const quaterion_track: QuaternionKeyframeTrack = track

        // if the track is an upper arm bone, then modify that
        const is_right_arm_track_match: boolean = quaterion_track.name.includes('upper_armR')
        const is_left_arm_track_match: boolean = quaterion_track.name.includes('upper_armL')

        if (is_right_arm_track_match || is_left_arm_track_match) {
          const new_track_values: Float32Array = quaterion_track.values.slice() // clone array

          const track_count: number = quaterion_track.times.length
          for (let i = 0; i < track_count; i++) {
            // get correct value since it is a quaternion
            const units_in_quaternions: number = 4
            const quaternion: Quaternion = new Quaternion()

            // rotate the upper arms in opposite directions to rise/lower arms
            if (is_right_arm_track_match) {
              quaternion.setFromAxisAngle(new Vector3(0, 0, -1), percentage / 100)
            }
            if (is_left_arm_track_match) {
              quaternion.setFromAxisAngle(new Vector3(0, 0, 1), percentage / 100)
            }

            // get the existing quaternion
            const existing_quaternion: Quaternion = new Quaternion(
              new_track_values[i * units_in_quaternions + 0],
              new_track_values[i * units_in_quaternions + 1],
              new_track_values[i * units_in_quaternions + 2],
              new_track_values[i * units_in_quaternions + 3]
            )

            // multiply the existing quaternion by the new quaternion
            existing_quaternion.multiply(quaternion)

            // this should change the first quaternion component of the track
            new_track_values[i * units_in_quaternions + 0] = existing_quaternion.x
            new_track_values[i * units_in_quaternions + 1] = existing_quaternion.y
            new_track_values[i * units_in_quaternions + 2] = existing_quaternion.z
            new_track_values[i * units_in_quaternions + 3] = existing_quaternion.w
          }

          track.values = new_track_values
        }
      })
    })
  }

  /**
   * Mirrors animations by swapping left and right bone tracks.
   * This swaps tracks that end with 'L' or 'R' to create mirrored animations.
   */
  static apply_animation_mirroring (animation_clips: TransformedAnimationClipPair[]): void {
    // do the swapping of the left/right tracks since we have all mirrored tracks exist now
    animation_clips.forEach((warped_clip: TransformedAnimationClipPair) => {
      const tracks = warped_clip.display_animation_clip.tracks
      const clip_name: string = warped_clip.display_animation_clip.name
      const track_swaps: Array<{ leftIndex: number, rightIndex: number, clipDetails: string }> = []

      // Find pairs of L/R tracks to swap
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i]
        const track_name = track.name

        // Check if this is a left track that we haven't already processed
        if (track_name.endsWith('L.quaternion')) {
          // Find the corresponding right track
          const right_track_name = track_name.replace(/L\.quaternion$/, 'R.quaternion')
          const right_track_index = tracks.findIndex(t => t.name === right_track_name)

          if (right_track_index !== -1) {
            track_swaps.push({ leftIndex: i, rightIndex: right_track_index, clipDetails: clip_name + ':' + track_name })
          }
        }
      }

      // Perform the swaps with quaternion mirroring
      track_swaps.forEach(({ leftIndex, rightIndex, clipDetails }) => {
        const left_track = tracks[leftIndex]
        const right_track = tracks[rightIndex]

        // Clone the times and values to avoid reference issues
        const left_values = left_track.values.slice()
        const right_values = right_track.values.slice()
        const left_times = left_track.times.slice()
        const right_times = right_track.times.slice()

        // Mirror the quaternions before swapping
        const mirrored_left_values = this.mirror_quaternion_track_values(left_values)
        const mirrored_right_values = this.mirror_quaternion_track_values(right_values)

        // Swap the mirrored track values and times
        left_track.values = mirrored_right_values
        left_track.times = right_times
        right_track.values = mirrored_left_values
        right_track.times = left_times
      })
    })

    this.apply_center_bone_mirroring(animation_clips)
    this.apply_hips_position_mirroring(animation_clips)
  }

  /**
   * Mirrors quaternion values by inverting X and W components for proper reflection.
   * This creates the mathematical mirror of the rotation.
   */
  private static mirror_quaternion_track_values (values: Float32Array): Float32Array {
    const mirrored_values = values.slice() // clone the array
    const units_in_quaternions = 4

    // Process each quaternion keyframe
    for (let i = 0; i < values.length; i += units_in_quaternions) {
      const quat = new Quaternion(
        values[i], // x
        values[i + 1], // y
        values[i + 2], // z
        values[i + 3] // w
      )

      // For mirroring left/right bone rotations, we invert X and W components
      // This creates the proper mirror reflection of the rotation
      quat.x = -quat.x
      quat.w = -quat.w

      // Write back the mirrored quaternion
      mirrored_values[i] = quat.x
      mirrored_values[i + 1] = quat.y
      mirrored_values[i + 2] = quat.z
      mirrored_values[i + 3] = quat.w
    }

    return mirrored_values
  }

  /**
   * Mirrors center bone rotations and hips position by inverting specific components.
   * This handles bones like spine, hips, neck, head that don't have L/R pairs.
   */
  private static apply_center_bone_mirroring (animation_clips: TransformedAnimationClipPair[]): void {
    animation_clips.forEach((warped_clip: TransformedAnimationClipPair) => {
      const tracks = warped_clip.display_animation_clip.tracks

      tracks.forEach((track: KeyframeTrack) => {
        const track_name_lower = track.name.toLowerCase()

        // Handle quaternion tracks for center bones
        if (track.name.includes('quaternion')) {
          const is_center_bone = track_name_lower.includes('spine') ||
                                track_name_lower.includes('hips') ||
                                track_name_lower.includes('neck') ||
                                track_name_lower.includes('head') ||
                                track_name_lower.includes('torso') ||
                                track_name_lower.includes('chest')

          if (!is_center_bone) { return } // mirror rotations for center aligned bones

          const values = track.values
          const units_in_quaternions = 4

          // Process each quaternion keyframe
          for (let i = 0; i < values.length; i += units_in_quaternions) {
            const quat = new Quaternion(
              values[i], // x
              values[i + 1], // y
              values[i + 2], // z
              values[i + 3] // w
            )

            // For mirroring, we need to invert the Y and Z components
            // This creates the mirror effect for center bone rotations
            quat.y = -quat.y
            quat.z = -quat.z

            // Write back the modified quaternion
            values[i] = quat.x
            values[i + 1] = quat.y
            values[i + 2] = quat.z
            values[i + 3] = quat.w
          }
        }
      })
    })
  }

  /**
   * Mirrors hips position tracks by inverting the X component.
   * This handles the hips bone position for locomotion and falling animations.
   */
  private static apply_hips_position_mirroring (animation_clips: TransformedAnimationClipPair[]): void {
    animation_clips.forEach((warped_clip: TransformedAnimationClipPair) => {
      const tracks = warped_clip.display_animation_clip.tracks

      tracks.forEach((track: KeyframeTrack) => {
        const track_name_lower = track.name.toLowerCase()

        // Handle position tracks specifically for hips
        if (track.name.includes('position') && track_name_lower.includes('hips')) {
          const values = track.values
          const units_in_position = 3 // x, y, z

          // Process each position keyframe
          for (let i = 0; i < values.length; i += units_in_position) {
            // For mirroring hips position, we need to invert the X component
            // This creates the mirror effect for hips movement (left/right movement)
            // Y (up/down) and Z (forward/back) remain unchanged
            values[i] = -values[i] // invert X position
            // values[i + 1] unchanged (Y - up/down)
            // values[i + 2] unchanged (Z - forward/back)
          }
        }
      })
    })
  }
}
