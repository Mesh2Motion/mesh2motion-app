/**
 * M2M-030A — deterministic pose evaluation for observation snapshots.
 *
 * One call evaluates the authoritative AnimationDocument at ONE timestamp and
 * applies it to the live Skeleton inside a save/restore transaction. Bones without
 * authored channels keep their rest transform; values are local to the correct
 * bone rest orientation (quaternion convention XYZW, slerp for rotations).
 */

import { type Bone, type Skeleton, Vector3, Quaternion } from 'three'
import type { AnimationChannel, AnimationDocument, AnimationProperty } from '../animation-document/types'
import { bone_rest_transforms } from '../animation-document/rigIdentity'
import { lerp_vector, slerp_quaternion } from '../animation-document/conventions'
import { sha256_hex } from '../animation-document/sha256'
import type { EvaluatedJoint, ObservationPoseSource } from './types'

export interface EvaluatedValue {
  bone_id: string
  index: number
  property: AnimationProperty
  values: number[]
}

export interface LocalTransform {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}

function values_at_time (channel: AnimationChannel, timestamp: number): number[] {
  const keys = channel.keyframes
  if (keys.length === 0) throw new Error(`channel ${channel.bone_id}/${channel.property} has no keyframes`)
  if (timestamp <= keys[0].time_seconds) return [...keys[0].values]
  const last = keys[keys.length - 1]
  if (timestamp >= last.time_seconds) return [...last.values]

  let lower = 0
  for (let index = 0; index < keys.length - 1; index++) {
    if (timestamp < keys[index + 1].time_seconds) {
      lower = index
      break
    }
  }
  const a = keys[lower]
  const b = keys[lower + 1]
  if (a.interpolation === 'step') return [...a.values]
  const span = b.time_seconds - a.time_seconds
  const t = span <= 0 ? 0 : (timestamp - a.time_seconds) / span
  if (a.interpolation === 'slerp') return slerp_quaternion(a.values, b.values, t)
  return lerp_vector(a.values, b.values, t)
}

/** Evaluate every authored channel at one timestamp. Pure and deterministic. */
export function evaluate_document_at_time (document: AnimationDocument, timestamp: number): EvaluatedValue[] {
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > document.clip.duration_seconds) {
    throw new Error(`timestamp ${timestamp} outside clip duration ${document.clip.duration_seconds}`)
  }
  const index_of = new Map<string, number>(document.bones.map((bone) => [bone.id, bone.index]))
  const result: EvaluatedValue[] = []
  for (const channel of document.channels) {
    const index = index_of.get(channel.bone_id)
    if (index === undefined) throw new Error(`unknown bone id ${channel.bone_id}`)
    result.push({
      bone_id: channel.bone_id,
      index,
      property: channel.property,
      values: values_at_time(channel, timestamp)
    })
  }
  return result
}

interface SavedTransform {
  bone: Bone
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

export interface AppliedPose {
  restore: () => void
}

function update_world_matrices (skeleton: Skeleton): void {
  for (const bone of skeleton.bones) bone.updateWorldMatrix(true, false)
  // Bone transforms alone are not enough: a SkinnedMesh renders from
  // skeleton.boneMatrices / boneTexture, which three.js only refreshes once per
  // render frame. Refresh them here so an offscreen capture of the SAME frame as
  // the visible render can never show the previous (animation-driven) pose while
  // joint metadata already describes the evaluated draft pose.
  skeleton.update()
}

/** Apply a pose transaction to the live skeleton. The returned function always restores it. */
export function apply_evaluated_pose (
  skeleton: Skeleton,
  evaluated: readonly EvaluatedValue[]
): AppliedPose {
  const saved: SavedTransform[] = skeleton.bones.map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone()
  }))
  try {
    // A capture must describe the draft pose, not the currently playing library
    // animation. Reset every bone to its bind-pose local transform first; the
    // authored channels below then override the relevant bones. Without this,
    // unauthored bones keep whatever the mixer wrote this frame, so the same
    // draft/timestamp renders differently over time while the pose digest stays
    // identical.
    const rest = bone_rest_transforms(skeleton)
    for (let index = 0; index < skeleton.bones.length; index++) {
      const transform = rest[index]
      const bone = skeleton.bones[index]
      if (transform === undefined || bone === undefined) continue
      bone.position.set(transform.position[0], transform.position[1], transform.position[2])
      bone.quaternion.set(
        transform.quaternion[0], transform.quaternion[1],
        transform.quaternion[2], transform.quaternion[3]
      )
      bone.scale.set(transform.scale[0], transform.scale[1], transform.scale[2])
    }
    for (const value of evaluated) {
      const bone = skeleton.bones[value.index]
      if (bone === undefined) continue
      if (value.property === 'position') {
        bone.position.set(value.values[0], value.values[1], value.values[2])
      } else if (value.property === 'quaternion') {
        bone.quaternion.set(value.values[0], value.values[1], value.values[2], value.values[3])
      } else {
        bone.scale.set(value.values[0], value.values[1], value.values[2])
      }
    }
    update_world_matrices(skeleton)
  } catch (error) {
    for (const entry of saved) {
      entry.bone.position.copy(entry.position)
      entry.bone.quaternion.copy(entry.quaternion)
      entry.bone.scale.copy(entry.scale)
    }
    update_world_matrices(skeleton)
    throw error
  }
  return {
    restore: () => {
      for (const entry of saved) {
        entry.bone.position.copy(entry.position)
        entry.bone.quaternion.copy(entry.quaternion)
        entry.bone.scale.copy(entry.scale)
      }
      update_world_matrices(skeleton)
    }
  }
}

/** SHA-256 over the canonical evaluated local transforms; identical for every view. */
export function pose_digest (evaluated: readonly EvaluatedValue[]): string {
  const canonical = [...evaluated]
    .sort((a, b) => a.index - b.index || a.property.localeCompare(b.property))
    .map((value) => [
      value.index,
      value.bone_id,
      value.property,
      ...value.values.map((number) => number.toFixed(6))
    ].join(':'))
    .join('|')
  return sha256_hex(canonical)
}

/** Read joint observations from the live skeleton after the pose has been applied. */
export function collect_joints (source: ObservationPoseSource, evaluated: readonly EvaluatedValue[]): EvaluatedJoint[] {
  const by_index = new Map<number, Partial<Record<AnimationProperty, number[]>>>()
  for (const value of evaluated) {
    const entry = by_index.get(value.index) ?? {}
    entry[value.property] = value.values
    by_index.set(value.index, entry)
  }
  return source.document.bones.map((bone) => {
    const skeleton_bone = source.skeleton.bones[bone.index]
    if (skeleton_bone === undefined) {
      throw new Error(`live skeleton is missing index ${bone.index}`)
    }
    const world = skeleton_bone.getWorldPosition(new Vector3())
    const authored = by_index.get(bone.index) ?? {}
    return {
      index: bone.index,
      bone_id: bone.id,
      display_name: bone.display_name,
      parent_id: bone.parent_id,
      local_position: (authored.position ?? [
        skeleton_bone.position.x, skeleton_bone.position.y, skeleton_bone.position.z
      ]) as [number, number, number],
      local_quaternion: (authored.quaternion ?? [
        skeleton_bone.quaternion.x, skeleton_bone.quaternion.y,
        skeleton_bone.quaternion.z, skeleton_bone.quaternion.w
      ]) as [number, number, number, number],
      local_scale: (authored.scale ?? [
        skeleton_bone.scale.x, skeleton_bone.scale.y, skeleton_bone.scale.z
      ]) as [number, number, number],
      world_position: [world.x, world.y, world.z]
    }
  })
}
