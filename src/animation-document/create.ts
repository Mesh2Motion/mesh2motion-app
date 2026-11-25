/**
 * M2M-025B — constructors for original AnimationDocuments.
 *
 * Documents are created from scratch from a skeleton descriptor and keyframes;
 * no existing AnimationClip is ever used as a source.
 */

import { type Skeleton } from 'three'
import {
  ANIMATION_DOCUMENT_SCHEMA,
  type AnimationChannel,
  type AnimationDocument,
  type AnimationKeyframe
} from './types'
import { bone_identities, rig_descriptor } from './rigIdentity'
import { with_validation } from './validation'

export interface NewDocumentOptions {
  skeleton: Skeleton
  rig_identifier: string
  clip_name: string
  duration_seconds: number
}

/** Create a valid, empty revision-1 document bound to a live skeleton. */
export function create_empty_document (options: NewDocumentOptions): AnimationDocument {
  const descriptor = rig_descriptor(options.skeleton, options.rig_identifier)
  return with_validation({
    schema_version: ANIMATION_DOCUMENT_SCHEMA,
    rig: descriptor,
    bones: bone_identities(options.skeleton, options.rig_identifier),
    clip: { name: options.clip_name, duration_seconds: options.duration_seconds },
    channels: [],
    revision: 1,
    validation: { state: 'draft', errors: [] }
  })
}

/**
 * Return a copy of the document with one channel added or replaced.
 * The document is revalidated; the revision is not changed here — that is the
 * application-level commit's responsibility.
 */
export function with_channel (
  document: AnimationDocument,
  bone_id: string,
  property: AnimationChannel['property'],
  keyframes: AnimationKeyframe[]
): AnimationDocument {
  const channel: AnimationChannel = { bone_id, property, keyframes }
  const others = document.channels.filter((existing) =>
    !(existing.bone_id === bone_id && existing.property === property))
  return with_validation({ ...document, channels: [...others, channel] })
}

/** Add or replace a pre-built channel (convenience for authored fixtures). */
export function with_animation_channel (document: AnimationDocument, channel: AnimationChannel): AnimationDocument {
  const others = document.channels.filter((existing) =>
    !(existing.bone_id === channel.bone_id && existing.property === channel.property))
  return with_validation({ ...document, channels: [...others, channel] })
}
