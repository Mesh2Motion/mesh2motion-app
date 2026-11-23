/**
 * M2M-028A — AnimationApplicationOwner bound to the real animation library.
 *
 * Committed documents are inserted through StepAnimationsListing's new
 * application-owned `add_authored_animation()` method, which updates the
 * library, the search UI and the count label. Entries are tagged so they can
 * never be confused with a Remix clip or a default-library animation.
 */

import { type AnimationClip } from 'three'
import type { AnimationApplicationOwner } from '../animation-document/applicationCommit'
import type { AnimationDocument } from '../animation-document/types'
import type { TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair'
import type { AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry'

export interface AuthoringApplicationEngine {
  animations_listing_step: {
    add_authored_animation (pair: TransformedAnimationClipPair): AnimationEntry
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
  private readonly last_entries: AuthoredEntryRecord[] = []

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
    this.last_entries.push({
      entry_id: entry.id,
      document_name: document.clip.name,
      rig_identifier: document.rig.identifier,
      revision: document.revision
    })
    this.engine.animations_listing_step.select_animation(entry.id)
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
    return this.last_entries.map((entry) => ({ ...entry }))
  }
}

export function is_authored_entry (entry: AnimationEntry): boolean {
  return entry.metadata?.tags?.includes(AUTHORED_TAG) === true
}
