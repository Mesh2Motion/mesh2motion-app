import {
  AnimationClip, type Bone, type Interpolant, type KeyframeTrack, type Object3D, PropertyBinding,
  Quaternion, QuaternionKeyframeTrack, type Skeleton
} from 'three'

export interface ComposeClipOptions {
  upper_clip: AnimationClip
  lower_clip: AnimationClip
  // bones driven by the upper clip. every other bone is driven by the lower clip
  upper_body_bone_names: Set<string>
  // frames per second the combined clip is baked at
  fps: number
  name: string
  // when set, the upper body keeps the orientation it had in the upper clip instead of following the lower clip's hips
  upright_upper_body?: UprightUpperBodyRig
}

export interface BoneRestRotation {
  name: string
  rest_quaternion: Quaternion
}

/**
 * Bones needed to keep the upper body upright. Bones without a rotation track in a clip use their rest rotation.
 */
export interface UprightUpperBodyRig {
  upper_body_root: BoneRestRotation // e.g. spine_01
  // bones between the skeleton root and the upper body root, top first (e.g. pelvis)
  parent_chain: BoneRestRotation[]
}

type KeyframeTrackConstructor = new (name: string, times: ArrayLike<number>, values: ArrayLike<number>) => KeyframeTrack
type InterpolatableTrack = KeyframeTrack & { createInterpolant: () => Interpolant }

/**
 * Builds a new animation by taking the upper body tracks from one clip
 * and the lower body tracks (including root motion and hip height) from another.
 */
export class ComposerClipBuilder {
  /**
   * Names of the bone with the given name and every bone below it.
   * @returns an empty set if the bone is not in the skeleton
   */
  static upper_body_bone_names (skeleton: Skeleton, upper_body_root_bone_name: string): Set<string> {
    const bone_names = new Set<string>()
    const upper_body_root: Bone | undefined = skeleton.bones.find(bone => bone.name === upper_body_root_bone_name)

    upper_body_root?.traverse((child) => {
      bone_names.add(child.name)
    })

    return bone_names
  }

  /**
   * Finds the bones needed to keep the upper body upright.
   * The skeleton's top bone (root) is left out of the parent chain, so turning and moving the
   * whole character still carries the upper body along with it.
   * @returns undefined if the upper body root bone is not in the skeleton
   */
  static upright_upper_body_rig (skeleton: Skeleton, upper_body_root_bone_name: string): UprightUpperBodyRig | undefined {
    const upper_body_root: Bone | undefined = skeleton.bones.find(bone => bone.name === upper_body_root_bone_name)
    if (upper_body_root === undefined) {
      return undefined
    }

    const skeleton_bones = new Set<Object3D>(skeleton.bones)
    const parents: Bone[] = []
    let parent: Object3D | null = upper_body_root.parent
    while (parent !== null && skeleton_bones.has(parent)) {
      parents.unshift(parent as Bone)
      parent = parent.parent
    }

    const rest_rotation = (bone: Bone): BoneRestRotation => ({ name: bone.name, rest_quaternion: bone.quaternion.clone() })
    return {
      upper_body_root: rest_rotation(upper_body_root),
      parent_chain: parents.slice(1).map(rest_rotation)
    }
  }

  /**
   * The longer of the two clips sets the length. The shorter clip is stretched to that length
   * (its key times are scaled up), so both halves start and end together and the result loops cleanly.
   * Both clips are sampled at the same frame times, so tracks with different key times line up.
   */
  static compose_clip (options: ComposeClipOptions): AnimationClip {
    const { upper_clip, lower_clip, upper_body_bone_names, fps, name } = options

    // a single pose (zero length) clip holds its pose for the whole length of the other clip
    const duration: number = Math.max(upper_clip.duration, lower_clip.duration)
    const frame_times: Float32Array = ComposerClipBuilder.frame_times(duration, fps)

    const upper_tracks: KeyframeTrack[] = upper_clip.tracks
      .filter(track => upper_body_bone_names.has(ComposerClipBuilder.bone_name_for_track(track)))
      .map(track => ComposerClipBuilder.resample_track(track, frame_times, upper_clip.duration, duration))

    const lower_tracks: KeyframeTrack[] = lower_clip.tracks
      .filter(track => !upper_body_bone_names.has(ComposerClipBuilder.bone_name_for_track(track)))
      .map(track => ComposerClipBuilder.resample_track(track, frame_times, lower_clip.duration, duration))

    const tracks: KeyframeTrack[] = [...lower_tracks, ...upper_tracks]

    if (options.upright_upper_body !== undefined) {
      const rig: UprightUpperBodyRig = options.upright_upper_body
      const upright_track_name = `${rig.upper_body_root.name}.quaternion`
      const upright_track = new QuaternionKeyframeTrack(
        upright_track_name,
        frame_times.slice(),
        ComposerClipBuilder.upright_rotations(upper_clip, lower_clip, rig, frame_times, duration)
      )

      const existing_index: number = tracks.findIndex(track => track.name === upright_track_name)
      if (existing_index === -1) {
        tracks.push(upright_track)
      } else {
        tracks[existing_index] = upright_track
      }
    }

    return new AnimationClip(name, duration, tracks)
  }

  /**
   * Rotations for the upper body root that cancel out the difference between the lower and upper clip's hips:
   *   upper_root = inverse(lower_chain) * upper_chain * upper_root_from_upper_clip
   * so the upper body faces the same way relative to the character as it did in the upper clip.
   */
  private static upright_rotations (
    upper_clip: AnimationClip,
    lower_clip: AnimationClip,
    rig: UprightUpperBodyRig,
    frame_times: Float32Array,
    duration: number
  ): Float32Array {
    const upper_root_rotations = ComposerClipBuilder.sample_rotations(upper_clip, rig.upper_body_root, frame_times, duration)
    const upper_chain = rig.parent_chain.map(bone => ComposerClipBuilder.sample_rotations(upper_clip, bone, frame_times, duration))
    const lower_chain = rig.parent_chain.map(bone => ComposerClipBuilder.sample_rotations(lower_clip, bone, frame_times, duration))

    const values = new Float32Array(frame_times.length * 4)
    const lower_chain_rotation = new Quaternion()
    const upper_chain_rotation = new Quaternion()
    const bone_rotation = new Quaternion()
    const result = new Quaternion()
    const previous_result = new Quaternion()

    for (let frame = 0; frame < frame_times.length; frame++) {
      lower_chain_rotation.identity()
      upper_chain_rotation.identity()
      for (let i = 0; i < rig.parent_chain.length; i++) {
        lower_chain_rotation.multiply(bone_rotation.fromArray(lower_chain[i], frame * 4))
        upper_chain_rotation.multiply(bone_rotation.fromArray(upper_chain[i], frame * 4))
      }

      result.copy(lower_chain_rotation.invert())
        .multiply(upper_chain_rotation)
        .multiply(bone_rotation.fromArray(upper_root_rotations, frame * 4))
        .normalize()

      // q and -q are the same rotation. keep neighbouring frames on the same side so interpolation doesn't spin the long way round
      if (frame > 0 && result.dot(previous_result) < 0) {
        result.set(-result.x, -result.y, -result.z, -result.w)
      }
      previous_result.copy(result)
      result.toArray(values, frame * 4)
    }

    return values
  }

  // rotation of a bone at every frame time, or its rest rotation if the clip doesn't animate it
  private static sample_rotations (clip: AnimationClip, bone: BoneRestRotation, frame_times: Float32Array, duration: number): Float32Array {
    const track: KeyframeTrack | undefined = clip.tracks.find(t => t.name === `${bone.name}.quaternion`)
    if (track !== undefined) {
      return ComposerClipBuilder.sample_track_values(track, frame_times, clip.duration, duration)
    }

    const values = new Float32Array(frame_times.length * 4)
    for (let frame = 0; frame < frame_times.length; frame++) {
      bone.rest_quaternion.toArray(values, frame * 4)
    }
    return values
  }

  static bone_name_for_track (track: KeyframeTrack): string {
    return PropertyBinding.parseTrackName(track.name).nodeName
  }

  /**
   * Times for every frame from 0 to the duration. The last frame lands exactly on the duration.
   */
  static frame_times (duration: number, fps: number): Float32Array {
    const last_frame: number = Math.max(0, Math.round(duration * fps))
    const times = new Float32Array(last_frame + 1)
    for (let frame = 0; frame <= last_frame; frame++) {
      times[frame] = Math.min(frame / fps, duration)
    }
    return times
  }

  /**
   * Samples the track at each frame time, with the source clip stretched to the combined clip's duration.
   */
  private static resample_track (
    track: KeyframeTrack, frame_times: Float32Array, source_duration: number, duration: number
  ): KeyframeTrack {
    const values: Float32Array = ComposerClipBuilder.sample_track_values(track, frame_times, source_duration, duration)
    const TrackType = track.constructor as KeyframeTrackConstructor
    const resampled_track: KeyframeTrack = new TrackType(track.name, frame_times.slice(), values)
    resampled_track.setInterpolation(track.getInterpolation())
    return resampled_track
  }

  private static sample_track_values (
    track: KeyframeTrack, frame_times: Float32Array, source_duration: number, duration: number
  ): Float32Array {
    const value_size: number = track.getValueSize()
    const values = new Float32Array(frame_times.length * value_size)
    // createInterpolant picks the right interpolation for the track type (slerp for quaternions),
    // but it is assigned at runtime by setInterpolation(), so it is missing from the three.js types
    const interpolant: Interpolant = (track as InterpolatableTrack).createInterpolant()

    // maps a time in the combined clip to the same point in the source clip. a zero length source always samples its first frame
    const time_scale: number = duration > 0 ? source_duration / duration : 0

    frame_times.forEach((time: number, frame: number) => {
      const sample: ArrayLike<number> = interpolant.evaluate(time * time_scale)
      for (let i = 0; i < value_size; i++) {
        values[frame * value_size + i] = sample[i]
      }
    })

    return values
  }
}
