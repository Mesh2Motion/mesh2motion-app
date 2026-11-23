/**
 * M2M-025B — Agent_Wave_01 fixture.
 *
 * An ORIGINAL two-second Human upper-body wave authored from scratch as new
 * rotation keyframes. No existing animation clip is read, copied or retargeted.
 * The skeleton here is a minimal synthetic human rig used to make the fixture
 * self-contained and deterministic; bone identity is index-based as defined by
 * the M2M-025B bone-ID contract.
 */

import { Bone, Euler, Quaternion, Skeleton } from 'three'
import type { AnimationDocument } from '../types'
import { create_empty_document, with_animation_channel } from '../create'
import { normalize_quaternion } from '../conventions'
import { stable_bone_id } from '../rigIdentity'

export const AGENT_WAVE_01_CLIP_NAME = 'Agent_Wave_01'
export const AGENT_WAVE_01_DURATION = 2
export const AGENT_WAVE_01_RIG = 'human'

/** Bone names in deterministic order; index defines the stable bone ID. */
export const AGENT_WAVE_01_BONE_NAMES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder.L', 'upperarm.L', 'forearm.L', 'hand.L',
  'shoulder.R', 'upperarm.R', 'forearm.R', 'hand.R'
] as const

/** Build a minimal, deterministic human upper-body skeleton. */
export function create_agent_wave_skeleton (): Skeleton {
  const bones: Bone[] = AGENT_WAVE_01_BONE_NAMES.map((name) => {
    const bone = new Bone()
    bone.name = name
    return bone
  })

  const by_name = new Map(bones.map((bone) => [bone.name, bone]))
  const attach = (child: string, parent: string, x: number, y: number, z: number): void => {
    const child_bone = by_name.get(child)
    const parent_bone = by_name.get(parent)
    if (child_bone === undefined || parent_bone === undefined) {
      throw new Error(`invalid fixture skeleton link ${child} -> ${parent}`)
    }
    child_bone.position.set(x, y, z)
    parent_bone.add(child_bone)
  }

  by_name.get('hips')?.position.set(0, 1, 0)
  attach('spine', 'hips', 0, 0.2, 0)
  attach('chest', 'spine', 0, 0.2, 0)
  attach('neck', 'chest', 0, 0.2, 0)
  attach('head', 'neck', 0, 0.1, 0)
  attach('shoulder.L', 'chest', 0.2, 0.1, 0)
  attach('upperarm.L', 'shoulder.L', 0.1, 0, 0)
  attach('forearm.L', 'upperarm.L', 0.25, 0, 0)
  attach('hand.L', 'forearm.L', 0.25, 0, 0)
  attach('shoulder.R', 'chest', -0.2, 0.1, 0)
  attach('upperarm.R', 'shoulder.R', -0.1, 0, 0)
  attach('forearm.R', 'upperarm.R', -0.25, 0, 0)
  attach('hand.R', 'forearm.R', -0.25, 0, 0)

  return new Skeleton(bones)
}

function rotation_values (x_degrees: number, y_degrees: number, z_degrees: number): number[] {
  const quaternion = new Quaternion().setFromEuler(
    new Euler(
      x_degrees * Math.PI / 180,
      y_degrees * Math.PI / 180,
      z_degrees * Math.PI / 180,
      'XYZ'
    )
  )
  return normalize_quaternion([quaternion.x, quaternion.y, quaternion.z, quaternion.w])
}

function rotation_channel (
  bone_index: number,
  keyframe_angles: ReadonlyArray<readonly [number, number, number, number]>
) {
  return {
    bone_id: stable_bone_id(AGENT_WAVE_01_RIG, bone_index),
    property: 'quaternion' as const,
    keyframes: keyframe_angles.map(([time, x, y, z]) => ({
      time_seconds: time,
      values: rotation_values(x, y, z),
      interpolation: 'slerp' as const
    }))
  }
}

/**
 * Create the original Agent_Wave_01 document with new rotation keyframes.
 * Every channel is authored here; none comes from a pre-existing clip.
 */
export function create_agent_wave_01_document (): AnimationDocument {
  const skeleton = create_agent_wave_skeleton()
  let document = create_empty_document({
    skeleton,
    rig_identifier: AGENT_WAVE_01_RIG,
    clip_name: AGENT_WAVE_01_CLIP_NAME,
    duration_seconds: AGENT_WAVE_01_DURATION
  })

  // Right upper arm: raises then sweeps side-to-side twice; returns to rest.
  document = with_animation_channel(document, rotation_channel(10, [
    [0.00, 0, 0, -10], [0.25, 0, 0, -55], [0.50, 0, 0, -70],
    [0.75, 0, 0, -45], [1.00, 0, 0, -70], [1.25, 0, 0, -45],
    [1.50, 0, 0, -70], [1.75, 0, 0, -40], [2.00, 0, 0, -10]
  ]))

  // Right forearm: elbow bend oscillates with the wave.
  document = with_animation_channel(document, rotation_channel(11, [
    [0.00, 0, 0, -15], [0.25, 0, 0, -45], [0.50, 0, 0, -20],
    [0.75, 0, 0, -50], [1.00, 0, 0, -20], [1.25, 0, 0, -50],
    [1.50, 0, 0, -20], [1.75, 0, 0, -45], [2.00, 0, 0, -15]
  ]))

  // Right hand: wrist flick at each sweep extreme.
  document = with_animation_channel(document, rotation_channel(12, [
    [0.00, 0, 0, 0], [0.50, 0, 0, 20], [1.00, 0, 0, -20],
    [1.50, 0, 0, 20], [2.00, 0, 0, 0]
  ]))

  // Upper body: subtle counter-rotation of chest and head.
  document = with_animation_channel(document, rotation_channel(2, [
    [0.00, 0, 0, 0], [0.50, 0, 4, 0], [1.00, 0, -4, 0],
    [1.50, 0, 4, 0], [2.00, 0, 0, 0]
  ]))
  document = with_animation_channel(document, rotation_channel(4, [
    [0.00, 0, 0, 0], [0.50, 0, -6, 0], [1.00, 0, 6, 0],
    [1.50, 0, -6, 0], [2.00, 0, 0, 0]
  ]))

  return document
}

/** Expose the rotated-channel helper for focused tests. */
export { rotation_channel }
