/**
 * M2M-028B — AnimationApplicationOwner bound to the real animation library.
 *
 * Committed documents are inserted through StepAnimationsListing's
 * application-owned `add_authored_animation()` method. Entries are tagged so
 * they can never be confused with a Remix clip or a default-library animation.
 *
 * M2M-028B adds a compensating rollback boundary and real undo: the entry that
 * represented the undone revision is removed from the library (and UI), the
 * restored document is inserted, and the previous selection is restored.
 */

import { type AnimationClip, type Scene, type SkinnedMesh, type WebGLRenderer } from 'three'
import type { AnimationApplicationOwner } from '../animation-document/applicationCommit'
import type { AnimationDocument } from '../animation-document/types'
import type { TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair'
import type { AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry'
import {
  generate_authored_preview,
  generate_skeleton_preview,
  save_authored_document_once,
  set_authored_preview_frames,
  set_stored_preview_frames
} from '../animation-document/authoredLibrary.ts'
import { check_rig_compatibility } from '../animation-document/liveRigAdapter'
import { live_skeleton_from_engine } from './rigCatalog'

export interface AuthoringApplicationEngine {
  animations_listing_step: {
    add_authored_animation (pair: TransformedAnimationClipPair): AnimationEntry
    remove_authored_animation (animation_id: string): boolean
    current_selection (): string | null
    select_animation (animation_id: string | null): void
  }
  renderer?: WebGLRenderer
  scene?: Scene
  active_skinned_meshes? (): SkinnedMesh[]
  load_skeleton_step?: { skeleton_type? (): string }
  edit_skeleton_step?: { skeleton? (): import('three').Skeleton }
}

export interface AuthoredEntryRecord {
  entry_id: string
  document_name: string
  rig_identifier: string
  revision: number
  previous_selection: string | null
}

/** Metadata tag marking authored entries; distinct from Remix/default clips. */
export const AUTHORED_TAG = 'authored-animation-document'

export class RealApplicationOwner implements AnimationApplicationOwner {
  private readonly records: AuthoredEntryRecord[] = []
  private readonly attribution = new Map<string, string>()

  constructor (private readonly engine: AuthoringApplicationEngine) {}

  /** M2M-031: preserve "From Existing Animation" source attribution where supported. */
  set_attribution (document_name: string, source_name: string): void {
    this.attribution.set(document_name, source_name)
  }

  apply_committed_clip (clip: AnimationClip, document: AnimationDocument, select = true): void {
    const previous_selection = this.engine.animations_listing_step.current_selection()
    const source = this.attribution.get(document.clip.name)
    const pair: TransformedAnimationClipPair = {
      original_animation_clip: clip,
      display_animation_clip: clip.clone(),
      metadata: {
        source_type: 'custom-import',
        tags: [
          AUTHORED_TAG,
          `rig:${document.rig.identifier}`,
          `revision:${document.revision}`,
          ...(source === undefined ? [] : [`source:${source}`])
        ]
      }
    }
    const entry = this.engine.animations_listing_step.add_authored_animation(pair)
    // MCP-authored clips are persisted too, so they are inspectable/deletable in
    // a fresh Explore session. Deduplicated to avoid undo re-applying revisions.
    const stored_id = save_authored_document_once(document, source ?? null)
    this.generate_preview(entry.id, document, stored_id)
    this.records.push({
      entry_id: entry.id,
      document_name: document.clip.name,
      rig_identifier: document.rig.identifier,
      revision: document.revision,
      previous_selection
    })
    if (select) {
      try {
        this.engine.animations_listing_step.select_animation(entry.id)
      } catch {
        // Selection failure must not turn insertion into a store/library split.
      }
    }
  }

  /** Generate and register a real poster/flipbook as part of the commit. */
  private generate_preview (entry_id: string, document: AnimationDocument, stored_id: string | null): void {
    try {
      const skeleton = live_skeleton_from_engine(this.engine)
      if (skeleton === null || !check_rig_compatibility(document, skeleton).compatible) return
      const meshes = this.engine.active_skinned_meshes?.() ?? []
      const rendered = this.engine.renderer !== undefined && this.engine.scene !== undefined && meshes.length > 0
        ? generate_authored_preview(document, skeleton, this.engine.renderer, this.engine.scene, meshes)
        : []
      const frames = rendered.length > 0 ? rendered : generate_skeleton_preview(document, skeleton)
      if (frames.length === 0) return
      set_authored_preview_frames(entry_id, frames)
      if (stored_id !== null) set_stored_preview_frames(stored_id, frames)
    } catch (error) {
      console.warn('[M2M-030] authored preview generation failed:', error instanceof Error ? error.message : String(error))
    }
  }

  /** M2M-028B: remove the library entry created by a failed commit. */
  rollback_last (): boolean {
    const record = this.records[this.records.length - 1]
    if (record === undefined) return false
    const removed = this.engine.animations_listing_step.remove_authored_animation(record.entry_id)
    if (!removed) return false
    this.records.pop()
    this.restore_selection(record.previous_selection)
    return true
  }

  /** M2M-028B: undo really removes the undone entry before applying the restored one. */
  remove_revision (revision: number): { previous_selection: string | null } | null {
    const index = this.records.findIndex((record) => record.revision === revision)
    if (index < 0) return null
    const record = this.records[index]
    const removed = this.engine.animations_listing_step.remove_authored_animation(record.entry_id)
    if (!removed) return null
    this.records.splice(index, 1)
    this.restore_selection(record.previous_selection)
    return { previous_selection: record.previous_selection }
  }

  capture_selection (): unknown {
    return this.engine.animations_listing_step.current_selection()
  }

  restore_selection (snapshot: unknown): void {
    if (snapshot === null || typeof snapshot === 'string') {
      try {
        this.engine.animations_listing_step.select_animation(snapshot)
      } catch {
        // A previously selected entry may have been removed by an undo.
      }
    }
  }

  authored_entries (): ReadonlyArray<AuthoredEntryRecord> {
    return this.records.map((entry) => ({ ...entry }))
  }
}

export function is_authored_entry (entry: AnimationEntry): boolean {
  return entry.metadata?.tags?.includes(AUTHORED_TAG) === true
}
