/**
 * M2M-025B — live rig -> AnimationDocument adapter.
 *
 * This is the authoritative bridge from the real THREE.Skeleton to the frozen
 * AnimationDocument v1 contract. It reads the real Skeleton.bones sequence,
 * parent relationships and local rest transforms, computes the SHA-256 rig
 * fingerprint and emits stable, index-derived bone identities.
 *
 * Safety rule: a document is never converted against a rig whose identity has
 * changed. Renaming, reordering, reparenting or changing the rest pose of an
 * unsupported/changed rig is reported, never silently redirected to a
 * different bone by a display-name lookup.
 */

import { type Skeleton } from 'three'
import {
  ANIMATION_DOCUMENT_SCHEMA,
  type AnimationBoneIdentity,
  type AnimationDocument,
  type AnimationDocumentRig
} from './types'
import { bone_identities, bone_rest_transforms, compute_rig_fingerprint, make_bone_id_resolver, rig_descriptor } from './rigIdentity'
import { create_empty_document } from './create'
import { document_to_animation_clip } from './conversion'
import { with_validation } from './validation'
import type { AnimationClip } from 'three'

/** Rigs for which the v1 authoring contract is supported. */
export const SUPPORTED_RIG_IDENTIFIERS = ['human', 'fox', 'horse'] as const
export type SupportedRigIdentifier = typeof SUPPORTED_RIG_IDENTIFIERS[number]

export function is_supported_rig (identifier: string): identifier is SupportedRigIdentifier {
  return (SUPPORTED_RIG_IDENTIFIERS as readonly string[]).includes(identifier)
}

export interface RigBoneCatalogEntry extends AnimationBoneIdentity {
  /** Local rest transform, copied from the live bone (never by reference). */
  local_position: [number, number, number]
  local_quaternion: [number, number, number, number]
  local_scale: [number, number, number]
}

export interface RigBoneCatalog {
  rig: AnimationDocumentRig
  bones: RigBoneCatalogEntry[]
}

export class UnsupportedRigError extends Error {
  constructor (identifier: string) {
    super(`unsupported rig identifier "${identifier}"; supported: ${SUPPORTED_RIG_IDENTIFIERS.join(', ')}`)
    this.name = 'UnsupportedRigError'
  }
}

/**
 * Read the live skeleton into an immutable catalog. This is the rig/bone catalog
 * entry point Codex should publish through its read-side tooling.
 */
export function read_live_rig (skeleton: Skeleton, identifier: string): RigBoneCatalog {
  if (!is_supported_rig(identifier)) {
    throw new UnsupportedRigError(identifier)
  }
  const rig = rig_descriptor(skeleton, identifier)
  const rest_transforms = bone_rest_transforms(skeleton)
  const bones = bone_identities(skeleton, identifier).map((identity, index) => {
    const rest = rest_transforms[index]
    return {
      ...identity,
      local_position: rest.position,
      local_quaternion: rest.quaternion,
      local_scale: rest.scale
    }
  })
  return { rig, bones }
}

export interface NewLiveDocumentOptions {
  skeleton: Skeleton
  rig_identifier: string
  clip_name: string
  duration_seconds: number
}

/** Create an empty draft bound to the real live rig. */
export function create_document_from_live_rig (options: NewLiveDocumentOptions): AnimationDocument {
  if (!is_supported_rig(options.rig_identifier)) {
    throw new UnsupportedRigError(options.rig_identifier)
  }
  const draft = create_empty_document(options)
  return with_validation(draft, { live_fingerprint: compute_rig_fingerprint(options.skeleton) })
}

export type RigCompatibilityKind =
  | 'compatible'
  | 'unsupported-rig'
  | 'bone-count-changed'
  | 'reordered-or-missing-bones'
  | 'reparented'
  | 'renamed'
  | 'rest-transform-changed'
  | 'fingerprint-mismatch'

export interface RigCompatibility {
  compatible: boolean
  kind: RigCompatibilityKind
  document_fingerprint: string
  live_fingerprint: string
  details: string[]
}

/**
 * Determine whether a document can safely be converted against a live rig.
 * Checks index-derived IDs, hierarchy, display names, rest transforms and the
 * full fingerprint. Any mismatch is reported; no name-based fallback is used.
 */
export function check_rig_compatibility (document: AnimationDocument, skeleton: Skeleton): RigCompatibility {
  const details: string[] = []
  const document_fingerprint = document.rig.fingerprint
  const live_fingerprint = compute_rig_fingerprint(skeleton)

  if (!is_supported_rig(document.rig.identifier)) {
    return {
      compatible: false,
      kind: 'unsupported-rig',
      document_fingerprint,
      live_fingerprint,
      details: [`unsupported rig identifier "${document.rig.identifier}"`]
    }
  }

  const catalog = read_live_rig(skeleton, document.rig.identifier)

  if (document.bones.length !== catalog.bones.length) {
    details.push(`bone count ${document.bones.length} != live ${catalog.bones.length}`)
    return { compatible: false, kind: 'bone-count-changed', document_fingerprint, live_fingerprint, details }
  }

  let kind: RigCompatibilityKind = 'compatible'
  for (let index = 0; index < catalog.bones.length; index++) {
    const stored = document.bones[index]
    const live = catalog.bones[index]
    if (stored.id !== live.id || stored.index !== index) {
      if (kind === 'compatible') kind = 'reordered-or-missing-bones'
      details.push(`index ${index}: id ${stored.id} != live ${live.id}`)
    }
    if (stored.parent_id !== live.parent_id) {
      if (kind === 'compatible') kind = 'reparented'
      details.push(`index ${index}: parent ${String(stored.parent_id)} != live ${String(live.parent_id)}`)
    }
    if (stored.display_name !== live.display_name) {
      if (kind === 'compatible') kind = 'renamed'
      details.push(`index ${index}: display name "${stored.display_name}" != live "${live.display_name}"`)
    }
  }

  // Rest transforms are included in the fingerprint, so a fingerprint-only
  // difference after IDs, hierarchy and names match means the rest pose changed.
  if (kind === 'compatible' && document_fingerprint !== live_fingerprint) {
    kind = 'rest-transform-changed'
    details.push('fingerprint differs although identities, hierarchy and names match (rest transform changed)')
  }

  return {
    compatible: kind === 'compatible',
    kind,
    document_fingerprint,
    live_fingerprint,
    details
  }
}

export interface DraftClipOptions {
  binding_prefix?: string
}

/**
 * Draft AnimationDocument -> THREE.AnimationClip, guarded by live-rig identity.
 * This is the only supported conversion path for authoring drafts.
 */
export function draft_document_to_clip (
  document: AnimationDocument,
  skeleton: Skeleton,
  options: DraftClipOptions = {}
): AnimationClip {
  const compatibility = check_rig_compatibility(document, skeleton)
  if (!compatibility.compatible) {
    throw new Error(`incompatible live rig (${compatibility.kind}): ${compatibility.details.join('; ')}`)
  }
  const validated = with_validation(document, { live_fingerprint: compatibility.live_fingerprint })
  if (validated.validation.state !== 'valid') {
    throw new Error(`invalid AnimationDocument: ${validated.validation.errors.join('; ')}`)
  }
  return document_to_animation_clip(validated, {
    resolve_bone_name: make_bone_id_resolver(validated.bones),
    binding_prefix: options.binding_prefix
  })
}

/** Re-export the schema marker so downstream tooling has one import site. */
export { ANIMATION_DOCUMENT_SCHEMA }
