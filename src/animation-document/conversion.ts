/**
 * M2M-025B — pure conversion adapter: AnimationDocument -> THREE.AnimationClip.
 *
 * The adapter never reads or writes application state. It only needs a
 * resolver from stable bone IDs to the bone names used by Three's
 * PropertyBinding. The produced clip can therefore be previewed in memory
 * without affecting the current animation selection.
 */

import {
  AnimationClip,
  NumberKeyframeTrack,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
  type KeyframeTrack
} from 'three'
import type { AnimationChannel, AnimationDocument, BoneIdResolver } from './types'
import { validate_document } from './validation'

export interface ConversionOptions {
  /** Maps stable bone IDs to Three PropertyBinding node names. */
  resolve_bone_name: BoneIdResolver
  /** Optional prefix for track bindings, e.g. 'bones[' or a node path. */
  binding_prefix?: string
  /** Fail if the document does not validate (default true). */
  require_valid?: boolean
}

function build_track (
  channel: AnimationChannel,
  bone_name: string,
  binding_prefix: string,
  duration: number
): KeyframeTrack {
  const property = channel.property
  const track_name = `${binding_prefix}${bone_name}.${property}`
  const keyframes = channel.keyframes
  const is_step = keyframes.some((keyframe) => keyframe.interpolation === 'step')

  const times: number[] = []
  const values: number[] = []

  if (is_step) {
    // Hold each value until the next keyframe, then jump. Duplicate times
    // create a zero-length segment that Three's LinearInterpolant handles.
    times.push(keyframes[0].time_seconds)
    values.push(...keyframes[0].values)
    for (let i = 1; i < keyframes.length; i++) {
      times.push(keyframes[i].time_seconds)
      values.push(...keyframes[i - 1].values)
      times.push(keyframes[i].time_seconds)
      values.push(...keyframes[i].values)
    }
    const last = keyframes[keyframes.length - 1]
    if (last.time_seconds < duration) {
      times.push(duration)
      values.push(...last.values)
    }
  } else {
    for (const keyframe of keyframes) {
      times.push(keyframe.time_seconds)
      values.push(...keyframe.values)
    }
  }

  if (property === 'quaternion') {
    return new QuaternionKeyframeTrack(track_name, times, values)
  }
  if (property === 'position' || property === 'scale') {
    return new VectorKeyframeTrack(track_name, times, values)
  }
  // Unreachable for validated documents, but keeps return type exhaustive.
  return new NumberKeyframeTrack(track_name, times, values)
}

/**
 * Convert an AnimationDocument into a standalone THREE.AnimationClip.
 *
 * Throws when validation fails (unless require_valid is false) or when a
 * bone ID cannot be resolved. Pure: no mutation of the input document.
 */
export function document_to_animation_clip (document: AnimationDocument, options: ConversionOptions): AnimationClip {
  const validation = validate_document(document)
  if (options.require_valid !== false && validation.state !== 'valid') {
    throw new Error(`cannot convert invalid AnimationDocument: ${validation.errors.join('; ')}`)
  }

  const binding_prefix = options.binding_prefix ?? ''
  const tracks: KeyframeTrack[] = []

  for (const channel of document.channels) {
    const bone_name = options.resolve_bone_name(channel.bone_id)
    if (bone_name === undefined) {
      throw new Error(`cannot resolve bone_id "${channel.bone_id}" to a live bone name`)
    }
    tracks.push(build_track(channel, bone_name, binding_prefix, document.clip.duration_seconds))
  }

  if (tracks.length === 0) {
    throw new Error('AnimationDocument has no channels; refusing to create an empty clip')
  }

  return new AnimationClip(document.clip.name, document.clip.duration_seconds, tracks)
}
