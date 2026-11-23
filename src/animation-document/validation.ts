/**
 * M2M-025B — deterministic, pure validation of an AnimationDocument.
 *
 * The same document always produces the same ordered error list. Validation
 * never mutates its input and never touches application state.
 */

import {
  ANIMATION_DOCUMENT_SCHEMA,
  DOCUMENT_LIMITS,
  type AnimationChannel,
  type AnimationDocument,
  type AnimationDocumentValidation
} from './types'

export interface ValidationOptions {
  /**
   * Fingerprint of the live rig. When provided, the document's rig fingerprint
   * must match exactly, otherwise conversion is unsafe.
   */
  live_fingerprint?: string
}

const EXPECTED_VALUE_COUNT = {
  position: 3,
  quaternion: 4,
  scale: 3
} as const

function is_finite_number (value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validate_channel (channel: AnimationChannel, duration: number, bone_ids: Set<string>, errors: string[]): number {
  if (channel.bone_id === '' || channel.bone_id === undefined) {
    errors.push('channel: empty bone_id')
  } else if (!bone_ids.has(channel.bone_id)) {
    errors.push(`channel: unknown bone_id "${channel.bone_id}"`)
  }

  if (!(channel.property in EXPECTED_VALUE_COUNT)) {
    errors.push(`channel: invalid property "${channel.property}"`)
    return 0
  }
  const expected_count = EXPECTED_VALUE_COUNT[channel.property]
  const keyframes = channel.keyframes

  if (!Array.isArray(keyframes) || keyframes.length === 0) {
    errors.push(`channel ${channel.bone_id}.${channel.property}: no keyframes`)
    return 0
  }

  let previous_time = -Infinity
  for (let i = 0; i < keyframes.length; i++) {
    const keyframe = keyframes[i]
    const label = `channel ${channel.bone_id}.${channel.property} keyframe ${i}`

    if (!is_finite_number(keyframe.time_seconds)) {
      errors.push(`${label}: non-finite time`)
    } else {
      if (keyframe.time_seconds < 0) {
        errors.push(`${label}: negative time`)
      }
      if (keyframe.time_seconds > duration) {
        errors.push(`${label}: time exceeds clip duration`)
      }
      if (keyframe.time_seconds <= previous_time) {
        errors.push(`${label}: time not strictly increasing`)
      }
      previous_time = keyframe.time_seconds
    }

    if (!Array.isArray(keyframe.values) || keyframe.values.length !== expected_count) {
      errors.push(`${label}: expected ${expected_count} values, got ${
        Array.isArray(keyframe.values) ? keyframe.values.length : 'none'
      }`)
    } else {
      for (let v = 0; v < keyframe.values.length; v++) {
        if (!is_finite_number(keyframe.values[v])) {
          errors.push(`${label}: non-finite value at index ${v}`)
        }
      }
      if (channel.property === 'quaternion') {
        const [x, y, z, w] = keyframe.values
        const length_squared = x * x + y * y + z * z + w * w
        if (!is_finite_number(length_squared) || length_squared <= 0) {
          errors.push(`${label}: zero-length quaternion`)
        }
      }
    }

    if (!['linear', 'step', 'slerp'].includes(keyframe.interpolation)) {
      errors.push(`${label}: invalid interpolation "${keyframe.interpolation}"`)
    }
  }
  return keyframes.length
}

/**
 * Validate a document. Deterministic: identical inputs yield identical errors.
 */
export function validate_document (document: AnimationDocument, options: ValidationOptions = {}): AnimationDocumentValidation {
  const errors: string[] = []

  if (document.schema_version !== ANIMATION_DOCUMENT_SCHEMA) {
    errors.push(`schema_version: expected "${ANIMATION_DOCUMENT_SCHEMA}", got "${document.schema_version}"`)
  }

  if (typeof document.clip.name !== 'string' || document.clip.name.trim() === '') {
    errors.push('clip.name: empty clip name')
  }
  if (!is_finite_number(document.clip.duration_seconds) ||
      document.clip.duration_seconds < DOCUMENT_LIMITS.min_duration_seconds ||
      document.clip.duration_seconds > DOCUMENT_LIMITS.max_duration_seconds) {
    errors.push('clip.duration_seconds: out of bounds')
  }

  if (!Number.isInteger(document.revision) || document.revision < 1) {
    errors.push('revision: must be a positive integer')
  }

  const bones = document.bones
  if (!Array.isArray(bones) || bones.length === 0) {
    errors.push('bones: no bones defined')
  } else {
    if (bones.length > DOCUMENT_LIMITS.max_bones) {
      errors.push(`bones: ${bones.length} exceeds limit ${DOCUMENT_LIMITS.max_bones}`)
    }
    const bone_ids = new Set<string>()
    const indices = new Set<number>()
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i]
      if (typeof bone.id !== 'string' || bone.id === '') {
        errors.push(`bones[${i}]: empty id`)
      } else if (bone_ids.has(bone.id)) {
        errors.push(`bones[${i}]: duplicate id "${bone.id}"`)
      }
      bone_ids.add(bone.id)

      if (!Number.isInteger(bone.index) || bone.index < 0 || indices.has(bone.index)) {
        errors.push(`bones[${i}]: invalid or duplicate skeleton index ${bone.index}`)
      }
      indices.add(bone.index)

      if (bone.parent_id !== null && bone.parent_id !== undefined && bone.parent_id !== '') {
        if (bone.parent_id === bone.id) {
          errors.push(`bones[${i}]: self-parent`)
        } else if (!bones.some((candidate) => candidate.id === bone.parent_id)) {
          errors.push(`bones[${i}]: unknown parent_id "${bone.parent_id}"`)
        }
      }
    }

    const channels = document.channels
    if (!Array.isArray(channels)) {
      errors.push('channels: not an array')
    } else {
      if (channels.length > DOCUMENT_LIMITS.max_channels) {
        errors.push(`channels: ${channels.length} exceeds limit ${DOCUMENT_LIMITS.max_channels}`)
      }
      let total_keyframes = 0
      for (const channel of channels) {
        total_keyframes += validate_channel(channel, document.clip.duration_seconds, bone_ids, errors)
      }
      if (total_keyframes > DOCUMENT_LIMITS.max_keyframes) {
        errors.push(`channels: ${total_keyframes} keyframes exceeds limit ${DOCUMENT_LIMITS.max_keyframes}`)
      }
    }
  }

  if (options.live_fingerprint !== undefined &&
      document.rig.fingerprint !== options.live_fingerprint) {
    errors.push(`rig.fingerprint: incompatible with live rig (${document.rig.fingerprint} != ${options.live_fingerprint})`)
  }

  return { state: errors.length === 0 ? 'valid' : 'invalid', errors }
}

/**
 * Return a copy of the document with its validation field recomputed.
 * The input object and its nested arrays are not modified.
 */
export function with_validation (document: AnimationDocument, options: ValidationOptions = {}): AnimationDocument {
  return { ...document, validation: validate_document(document, options) }
}
