/**
 * M2M-025B — canonical typed AnimationDocument (schema v1).
 *
 * This is an original authoring format: documents are built from keyframes and
 * never derived from an existing animation clip. See
 * coordination/reports/M2M-025/animation-document-contract.md for the published
 * contract shared with Codex.
 */

export const ANIMATION_DOCUMENT_SCHEMA = 'animation-document/v1' as const

export const DOCUMENT_LIMITS = {
  max_bones: 256,
  max_channels: 512,
  max_keyframes: 4096,
  min_duration_seconds: 0,
  max_duration_seconds: 3600
} as const

export type AnimationProperty = 'position' | 'quaternion' | 'scale'
export type KeyframeInterpolation = 'linear' | 'step' | 'slerp'
export type ValidationState = 'draft' | 'valid' | 'invalid'

export interface AnimationKeyframe {
  time_seconds: number
  /** 3 values for position/scale, 4 for quaternion (x, y, z, w). */
  values: number[]
  interpolation: KeyframeInterpolation
}

export interface AnimationChannel {
  bone_id: string
  property: AnimationProperty
  keyframes: AnimationKeyframe[]
}

export interface AnimationBoneIdentity {
  /** Stable, rig-derived identifier; independent of display names. */
  id: string
  display_name: string
  /** Index in Skeleton.bones. */
  index: number
  parent_id: string | null
}

export interface AnimationDocumentRig {
  identifier: string
  /** SHA-256 of ordered bone names, parent indices and local rest transforms. */
  fingerprint: string
}

export interface AnimationDocumentValidation {
  state: ValidationState
  errors: string[]
}

export interface AnimationDocument {
  schema_version: typeof ANIMATION_DOCUMENT_SCHEMA
  rig: AnimationDocumentRig
  bones: AnimationBoneIdentity[]
  clip: { name: string, duration_seconds: number }
  channels: AnimationChannel[]
  revision: number
  validation: AnimationDocumentValidation
}

/** Maps stable bone IDs to the bone names used by Three's PropertyBinding. */
export type BoneIdResolver = (bone_id: string) => string | undefined

export interface DocumentCommitReceipt {
  revision: number
  document: AnimationDocument
}
