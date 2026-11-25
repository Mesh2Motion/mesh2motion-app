/**
 * M2M-025B — stable bone identities derived from the actual current rig.
 *
 * Display names are kept for readability but never used as identity. A bone's
 * stable ID is `<rig identifier>:bone:<zero-padded Skeleton.bones index>`, and
 * the rig fingerprint is a SHA-256 over the ordered bone names, parent indices
 * and local rest transforms. Renaming a bone does not change its ID, but any
 * structural change to the skeleton changes the fingerprint.
 */

import { Matrix4, Quaternion, Vector3, type Bone, type Skeleton } from 'three'
import type { AnimationBoneIdentity, AnimationDocumentRig } from './types'
import { sha256_hex } from './sha256'

/** Only these rig identifiers are recognized as canonical. */
export type RigIdentifier = 'human' | 'fox' | 'horse'

const ID_PAD_WIDTH = 3

export function stable_bone_id (rig_identifier: string, index: number): string {
  return `${rig_identifier}:bone:${String(index).padStart(ID_PAD_WIDTH, '0')}`
}

/** Round to 6 decimals so equivalent transforms produce identical fingerprints. */
function quantize (value: number): string {
  return value.toFixed(6)
}

function clean_zero (value: number): number {
  return value === 0 ? 0 : value
}

export interface BoneRestTransform {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}

/**
 * Recover local bind-pose transforms from Skeleton.boneInverses. The live Bone
 * objects are mutated by AnimationMixer while clips play, so their current
 * position/quaternion/scale cannot be used as rig identity or document rest
 * transforms. Root bones are expressed relative to their current non-bone
 * parent; descendants are expressed relative to their parent's bind transform.
 */
export function bone_rest_transforms (skeleton: Skeleton): BoneRestTransform[] {
  const bones = skeleton.bones
  if (skeleton.boneInverses.length !== bones.length || bones.length === 0) {
    return bones.map((bone) => ({
      position: [bone.position.x, bone.position.y, bone.position.z] as [number, number, number],
      quaternion: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w] as [number, number, number, number],
      scale: [bone.scale.x, bone.scale.y, bone.scale.z] as [number, number, number]
    }))
  }

  const world_rest = skeleton.boneInverses.map((inverse) => inverse.clone().invert())
  const parent_indices = bones.map((bone) => bone.parent === null
    ? -1
    : bones.findIndex((candidate) => candidate === bone.parent))
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()

  return bones.map((bone, index) => {
    const parent_index = parent_indices[index]
    let local_rest: Matrix4
    if (parent_index >= 0) {
      local_rest = world_rest[parent_index].clone().invert().multiply(world_rest[index])
    } else if (bone.parent !== null) {
      bone.parent.updateWorldMatrix(true, false)
      local_rest = bone.parent.matrixWorld.clone().invert().multiply(world_rest[index])
    } else {
      local_rest = world_rest[index].clone()
    }
    local_rest.decompose(position, quaternion, scale)
    return {
      position: [clean_zero(position.x), clean_zero(position.y), clean_zero(position.z)],
      quaternion: [clean_zero(quaternion.x), clean_zero(quaternion.y), clean_zero(quaternion.z), clean_zero(quaternion.w)],
      scale: [clean_zero(scale.x), clean_zero(scale.y), clean_zero(scale.z)]
    }
  })
}

function bone_rest_signature (bone: Bone, skeleton: Skeleton, rest: BoneRestTransform): string {
  const parent_index = bone.parent === null
    ? -1
    : skeleton.bones.findIndex((candidate) => candidate === bone.parent)
  return [
    bone.name,
    parent_index,
    ...rest.position.map(quantize),
    ...rest.quaternion.map(quantize),
    ...rest.scale.map(quantize)
  ].join('|')
}

/**
 * Deterministic fingerprint of a skeleton's structure and rest pose.
 * Two skeletons with the same bones, hierarchy and local transforms produce
 * the same fingerprint regardless of object identity or creation order.
 */
export function compute_rig_fingerprint (skeleton: Skeleton): string {
  const rest = bone_rest_transforms(skeleton)
  const signature = skeleton.bones.map((bone, index) => bone_rest_signature(bone, skeleton, rest[index])).join('\n')
  return sha256_hex(signature)
}

export function rig_descriptor (skeleton: Skeleton, identifier: string): AnimationDocumentRig {
  return { identifier, fingerprint: compute_rig_fingerprint(skeleton) }
}

/**
 * Extract stable bone identities from a live skeleton.
 * `display_name` is informational; `id` and `index` are the stable contract.
 */
export function bone_identities (skeleton: Skeleton, identifier: string): AnimationBoneIdentity[] {
  return skeleton.bones.map((bone, index) => {
    const parent_index = bone.parent === null
    ? -1
    : skeleton.bones.findIndex((candidate) => candidate === bone.parent)
    return {
      id: stable_bone_id(identifier, index),
      display_name: bone.name,
      index,
      parent_id: parent_index < 0 ? null : stable_bone_id(identifier, parent_index)
    }
  })
}

/**
 * Resolve a stable bone ID to the live bone name expected by Three's
 * PropertyBinding. Returns undefined when the ID is not in this document.
 */
export function make_bone_id_resolver (bones: AnimationBoneIdentity[]): (bone_id: string) => string | undefined {
  const by_id = new Map(bones.map((bone) => [bone.id, bone]))
  return (bone_id: string) => by_id.get(bone_id)?.display_name
}
