/**
 * M2M-031 — application-owned persistence for authored/imported clips.
 *
 * Authored AnimationDocuments survive page reloads so they can be inspected and
 * played in the Explore tab. Bundled manifest animations are never written here;
 * only documents explicitly committed or imported by the user/MCP are stored.
 */

import type { Skeleton } from 'three'
import { AUTHORED_TAG } from '../authoringBridge/applicationOwner'
import type { StepAnimationsListing } from '../lib/processes/animations-listing/StepAnimationsListing'
import type { TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair'
import { check_rig_compatibility, draft_document_to_clip } from './liveRigAdapter'
import type { AnimationDocument } from './types'

const STORAGE_KEY = 'm2m.authored-animations.v1'
const MAX_CLIPS = 20
const MAX_BYTES = 4 * 1024 * 1024
export const AUTHORED_ID_TAG_PREFIX = 'authored-id:'

export interface StoredAuthoredDocument {
  id: string
  document: AnimationDocument
  source_name: string | null
  saved_at: number
}

const restored_ids = new Set<string>()

function is_stored (value: unknown): value is StoredAuthoredDocument {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<StoredAuthoredDocument>
  return typeof entry.id === 'string' && typeof entry.document === 'object' && entry.document !== null
}

/** Read persisted authored documents, dropping malformed entries. */
export function load_authored_documents (): StoredAuthoredDocument[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(is_stored) : []
  } catch {
    return []
  }
}

function write (entries: StoredAuthoredDocument[]): void {
  const serialized = JSON.stringify(entries.slice(0, MAX_CLIPS))
  if (serialized.length > MAX_BYTES) return
  window.localStorage.setItem(STORAGE_KEY, serialized)
}

/** Persist one authored document. Returns its stable authored id. */
export function save_authored_document (
  document: AnimationDocument,
  source_name: string | null = null
): string {
  const id = `authored-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const entries = load_authored_documents()
  entries.push({ id, document, source_name, saved_at: Date.now() })
  write(entries.slice(-MAX_CLIPS))
  return id
}

/** Avoid duplicate persistence when commit/undo re-applies the same revision. */
export function save_authored_document_once (
  document: AnimationDocument,
  source_name: string | null = null
): string | null {
  const duplicate = load_authored_documents().some((entry) =>
    entry.document.clip.name === document.clip.name &&
    entry.document.revision === document.revision &&
    entry.document.channels.length === document.channels.length)
  return duplicate ? null : save_authored_document(document, source_name)
}

export function delete_authored_document (id: string): boolean {
  const entries = load_authored_documents()
  const remaining = entries.filter((entry) => entry.id !== id)
  if (remaining.length === entries.length) return false
  write(remaining)
  restored_ids.delete(id)
  return true
}

/** Bundled manifest entries are protected; only generated custom entries may be deleted. */
export function can_delete_animation (entry: {
  id: string
  file?: string
  metadata?: { source_type?: string, tags?: readonly string[] }
}): boolean {
  return entry.metadata?.source_type === 'custom-import' &&
    entry.file === undefined &&
    entry.id.startsWith('custom-import-')
}

export function authored_id_from_tags (tags: readonly string[] | undefined): string | null {
  const tag = tags?.find((item) => item.startsWith(AUTHORED_ID_TAG_PREFIX))
  return tag === undefined ? null : tag.slice(AUTHORED_ID_TAG_PREFIX.length)
}

/**
 * Rehydrate persisted documents into an engine's application-owned library.
 * Mismatched rigs are skipped, never remapped by bone name.
 */
export function restore_authored_documents (
  listing: StepAnimationsListing,
  skeleton: Skeleton,
  rig_identifier: string
): number {
  let restored = 0
  for (const stored of load_authored_documents()) {
    if (restored_ids.has(stored.id)) continue
    const document = stored.document
    if (document.rig.identifier !== rig_identifier) continue
    if (!check_rig_compatibility(document, skeleton).compatible) continue
    try {
      const clip = draft_document_to_clip(document, skeleton)
      const pair: TransformedAnimationClipPair = {
        original_animation_clip: clip,
        display_animation_clip: clip.clone(),
        metadata: {
          source_type: 'custom-import',
          tags: [
            AUTHORED_TAG,
            `rig:${rig_identifier}`,
            `revision:${document.revision}`,
            `${AUTHORED_ID_TAG_PREFIX}${stored.id}`,
            ...(stored.source_name === null ? [] : [`source:${stored.source_name}`])
          ]
        }
      }
      listing.add_authored_animation(pair)
      restored_ids.add(stored.id)
      restored++
    } catch {
      // A document that cannot be converted against this rig is skipped.
    }
  }
  return restored
}
