/**
 * M2M-025B — stable bone identities derived from the actual current rig.
 *
 * Display names are kept for readability but never used as identity. A bone's
 * stable ID is `<rig identifier>:bone:<zero-padded Skeleton.bones index>`, and
 * the rig fingerprint is a SHA-256 over the ordered bone names, parent indices
 * and local rest transforms. Renaming a bone does not change its ID, but any
 * structural change to the skeleton changes the fingerprint.
 */

import { type Bone, type Skeleton } from 'three'
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

function bone_rest_signature (bone: Bone, skeleton: Skeleton): string {
  const parent_index = bone.parent === null
    ? -1
    : skeleton.bones.findIndex((candidate) => candidate === bone.parent)
  return [
    bone.name,
    parent_index,
    quantize(bone.position.x), quantize(bone.position.y), quantize(bone.position.z),
    quantize(bone.quaternion.x), quantize(bone.quaternion.y),
    quantize(bone.quaternion.z), quantize(bone.quaternion.w),
    quantize(bone.scale.x), quantize(bone.scale.y), quantize(bone.scale.z)
  ].join('|')
}

/**
 * Deterministic fingerprint of a skeleton's structure and rest pose.
 * Two skeletons with the same bones, hierarchy and local transforms produce
 * the same fingerprint regardless of object identity or creation order.
 */
export function compute_rig_fingerprint (skeleton: Skeleton): string {
  const signature = skeleton.bones.map((bone) => bone_rest_signature(bone, skeleton)).join('\n')
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
