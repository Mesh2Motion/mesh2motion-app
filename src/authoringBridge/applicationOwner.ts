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

import { type AnimationClip } from 'three'
import type { AnimationApplicationOwner } from '../animation-document/applicationCommit'
import type { AnimationDocument } from '../animation-document/types'
import type { TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair'
import type { AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry'

export interface AuthoringApplicationEngine {
  animations_listing_step: {
    add_authored_animation (pair: TransformedAnimationClipPair): AnimationEntry
    remove_authored_animation (animation_id: string): boolean
    current_selection (): string | null
    select_animation (animation_id: string | null): void
  }
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

  constructor (private readonly engine: AuthoringApplicationEngine) {}

  apply_committed_clip (clip: AnimationClip, document: AnimationDocument, select = true): void {
    const previous_selection = this.engine.animations_listing_step.current_selection()
    const pair: TransformedAnimationClipPair = {
      original_animation_clip: clip,
      display_animation_clip: clip.clone(),
      metadata: {
        source_type: 'custom-import',
        tags: [AUTHORED_TAG, `rig:${document.rig.identifier}`, `revision:${document.revision}`]
      }
    }
    const entry = this.engine.animations_listing_step.add_authored_animation(pair)
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
