/**
 * M2M-028A — Agent_Wave_01 authored against the ACTUAL live Human rig.
 *
 * The synthetic fixture's fingerprint and hardcoded bone IDs are deliberately
 * not reused. Bone IDs and the fingerprint come from the loaded skeleton; only
 * the artistic intent (new two-second upper-body wave keyframes) is carried
 * over. No existing clip is copied or remixed.
 */

import { type Skeleton } from 'three'
import type { AnimationDocument, AnimationKeyframe } from '../animation-document/types'
import { create_document_from_live_rig, read_live_rig } from '../animation-document/liveRigAdapter'
import { with_animation_channel } from '../animation-document/create'
import { normalize_quaternion } from '../animation-document/conventions'
import { Quaternion, Euler } from 'three'

export const LIVE_WAVE_CLIP_NAME = 'Agent_Wave_01'
export const LIVE_WAVE_DURATION = 2

export interface LiveWaveBoneMapping {
  shoulder_r: string | null
  upper_arm_r: string
  forearm_r: string
  hand_r: string
  chest: string | null
  head: string | null
}

function normalized (name: string): string {
  return name.toLowerCase().replace(/[\s_\-.]/g, '')
}

function is_right (name: string): boolean {
  const lower = name.toLowerCase()
  return /\br\b|\.r$|_r$|right/.test(lower) && !/left/.test(lower)
}

function is_left (name: string): boolean {
  const lower = name.toLowerCase()
  return /\bl\b|\.l$|_l$|left/.test(lower)
}

function find_bone (bones: Array<{ id: string, display_name: string }>, patterns: RegExp[], require_right = false): string | null {
  for (const pattern of patterns) {
    const match = bones.find((bone) => {
      const name = normalized(bone.display_name)
      if (!pattern.test(name)) return false
      if (require_right && !is_right(bone.display_name)) return false
      if (require_right && is_left(bone.display_name)) return false
      return true
    })
    if (match !== undefined) return match.id
  }
  return null
}

/** Identify wave bones from the live catalog; never assume fixed indices. */
export function map_live_wave_bones (skeleton: Skeleton, identifier: string): LiveWaveBoneMapping {
  const catalog = read_live_rig(skeleton, identifier)
  const bones = catalog.bones
  const upper_arm_r = find_bone(bones, [/upperarm/, /upperarm/, /arm/, /shoulder/], true)
  const forearm_r = find_bone(bones, [/forearm/, /lowerarm/, /elbow/], true)
  const hand_r = find_bone(bones, [/hand/, /wrist/], true)
  if (upper_arm_r === null || forearm_r === null || hand_r === null) {
    throw new Error('RIG_UNAVAILABLE: live rig lacks right arm bones for Agent_Wave_01')
  }
  return {
    shoulder_r: find_bone(bones, [/shoulder/], true),
    upper_arm_r,
    forearm_r,
    hand_r,
    chest: find_bone(bones, [/chest/, /spine02/, /upperchest/, /torso/]),
    head: find_bone(bones, [/head/, /neck/])
  }
}

function rotation (x_degrees: number, y_degrees: number, z_degrees: number): number[] {
  const quaternion = new Quaternion().setFromEuler(new Euler(
    x_degrees * Math.PI / 180, y_degrees * Math.PI / 180, z_degrees * Math.PI / 180, 'XYZ'
  ))
  return normalize_quaternion([quaternion.x, quaternion.y, quaternion.z, quaternion.w])
}

function rotation_keys (angles: ReadonlyArray<readonly [number, number, number, number]>): AnimationKeyframe[] {
  return angles.map(([time, x, y, z]) => ({
    time_seconds: time,
    values: rotation(x, y, z),
    interpolation: 'slerp' as const
  }))
}

/**
 * Build an original two-second upper-body wave from the live skeleton.
 * Throws RIG_UNAVAILABLE if the live bone set cannot support the demonstration.
 */
export function create_live_agent_wave (skeleton: Skeleton, identifier: string): {
  document: AnimationDocument
  mapping: LiveWaveBoneMapping
} {
  const mapping = map_live_wave_bones(skeleton, identifier)
  let document = create_document_from_live_rig({
    skeleton,
    rig_identifier: identifier,
    clip_name: LIVE_WAVE_CLIP_NAME,
    duration_seconds: LIVE_WAVE_DURATION
  })

  document = with_animation_channel(document, {
    bone_id: mapping.upper_arm_r,
    property: 'quaternion',
    keyframes: rotation_keys([
      [0, 0, 0, -10], [0.25, 0, 0, -55], [0.5, 0, 0, -70], [0.75, 0, 0, -45],
      [1, 0, 0, -70], [1.25, 0, 0, -45], [1.5, 0, 0, -70], [1.75, 0, 0, -40], [2, 0, 0, -10]
    ])
  })
  document = with_animation_channel(document, {
    bone_id: mapping.forearm_r,
    property: 'quaternion',
    keyframes: rotation_keys([
      [0, 0, 0, -15], [0.25, 0, 0, -45], [0.5, 0, 0, -20], [0.75, 0, 0, -50],
      [1, 0, 0, -20], [1.25, 0, 0, -50], [1.5, 0, 0, -20], [1.75, 0, 0, -45], [2, 0, 0, -15]
    ])
  })
  document = with_animation_channel(document, {
    bone_id: mapping.hand_r,
    property: 'quaternion',
    keyframes: rotation_keys([
      [0, 0, 0, 0], [0.5, 0, 0, 20], [1, 0, 0, -20], [1.5, 0, 0, 20], [2, 0, 0, 0]
    ])
  })
  if (mapping.chest !== null) {
    document = with_animation_channel(document, {
      bone_id: mapping.chest,
      property: 'quaternion',
      keyframes: rotation_keys([[0, 0, 0, 0], [0.5, 0, 4, 0], [1, 0, -4, 0], [1.5, 0, 4, 0], [2, 0, 0, 0]])
    })
  }
  if (mapping.head !== null && mapping.head !== mapping.chest) {
    document = with_animation_channel(document, {
      bone_id: mapping.head,
      property: 'quaternion',
      keyframes: rotation_keys([[0, 0, 0, 0], [0.5, 0, -6, 0], [1, 0, 6, 0], [1.5, 0, -6, 0], [2, 0, 0, 0]])
    })
  }
  return { document, mapping }
}
