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
    select_animation (animation_id: string): void
  }
}

export interface AuthoredEntryRecord {
  entry_id: string
  document_name: string
  rig_identifier: string
  revision: number
}

/** Metadata tag marking authored entries; distinct from Remix/default clips. */
export const AUTHORED_TAG = 'authored-animation-document'

export class RealApplicationOwner implements AnimationApplicationOwner {
  private readonly records: AuthoredEntryRecord[] = []

  constructor (private readonly engine: AuthoringApplicationEngine) {}

  apply_committed_clip (clip: AnimationClip, document: AnimationDocument): void {
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
      revision: document.revision
    })
    try {
      this.engine.animations_listing_step.select_animation(entry.id)
    } catch {
      // Selection failure must not turn a successful library insertion into a
      // thrown error that would desynchronise the store from the library.
    }
  }

  /** M2M-028B: remove the library entry created by a failed commit. */
  rollback_last (): boolean {
    const record = this.records.pop()
    if (record === undefined) return false
    return this.engine.animations_listing_step.remove_authored_animation(record.entry_id)
  }

  /** M2M-028B: undo really removes the undone entry before applying the restored one. */
  remove_revision (revision: number): boolean {
    const index = this.records.findIndex((record) => record.revision === revision)
    if (index < 0) return false
    const record = this.records[index]
    const removed = this.engine.animations_listing_step.remove_authored_animation(record.entry_id)
    if (removed) this.records.splice(index, 1)
    return removed
  }

  capture_selection (): unknown {
    return this.engine.animations_listing_step.current_selection()
  }

  restore_selection (snapshot: unknown): void {
    if (typeof snapshot === 'string' && snapshot.length > 0) {
      this.engine.animations_listing_step.select_animation(snapshot)
    }
  }

  authored_entries (): ReadonlyArray<AuthoredEntryRecord> {
    return this.records.map((entry) => ({ ...entry }))
  }
}

export function is_authored_entry (entry: AnimationEntry): boolean {
  return entry.metadata?.tags?.includes(AUTHORED_TAG) === true
}
