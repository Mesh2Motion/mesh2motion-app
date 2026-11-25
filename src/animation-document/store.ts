/**
 * M2M-025B — atomic commit / undo interface for AnimationDocuments.
 *
 * The application owns animation state. This module defines the contract that
 * the application's state owner must implement (or delegate to) so that a
 * draft can be committed atomically or rolled back without ever leaving the
 * store in a half-updated state. The bundled in-memory implementation is a
 * reference implementation; integrating it with the live app is a separate,
 * explicit step and is NOT done here.
 */

import type { AnimationDocument, DocumentCommitReceipt } from './types'
import { validate_document, with_validation } from './validation'

export interface AnimationDocumentStore {
  /** Current committed document. */
  current (): AnimationDocument
  /**
   * Atomically replace the document. Returns a receipt only on success.
   * Throws and leaves state untouched on validation failure or revision jump.
   */
  commit (next: AnimationDocument): DocumentCommitReceipt
  /** Atomic rollback to a previously committed revision. */
  undo (revision: number): DocumentCommitReceipt
  /** Full append-only history, oldest first. */
  history (): ReadonlyArray<AnimationDocument>
}

export class InvalidDocumentCommitError extends Error {
  constructor (public readonly errors: string[]) {
    super(`invalid AnimationDocument commit: ${errors.join('; ')}`)
    this.name = 'InvalidDocumentCommitError'
  }
}

export class RevisionMismatchError extends Error {
  constructor (expected: number, got: number) {
    super(`revision mismatch: expected ${expected}, got ${got}`)
    this.name = 'RevisionMismatchError'
  }
}

export class RevisionNotFoundError extends Error {
  constructor (revision: number) {
    super(`revision ${revision} not found in commit history`)
    this.name = 'RevisionNotFoundError'
  }
}

/**
 * Reference atomic store. All mutations go through commit/undo; snapshots are
 * never shared by reference, so a caller cannot mutate history from outside.
 */
export class InMemoryAnimationDocumentStore implements AnimationDocumentStore {
  private readonly revisions: AnimationDocument[] = []

  constructor (initial: AnimationDocument) {
    const validated = with_validation(initial)
    if (validated.validation.state !== 'valid') {
      throw new InvalidDocumentCommitError(validated.validation.errors)
    }
    this.revisions.push(deep_copy(validated))
  }

  current (): AnimationDocument {
    return deep_copy(this.revisions[this.revisions.length - 1])
  }

  commit (next: AnimationDocument): DocumentCommitReceipt {
    const candidate = with_validation(next)
    if (candidate.validation.state !== 'valid') {
      throw new InvalidDocumentCommitError(candidate.validation.errors)
    }
    const current_revision = this.revisions[this.revisions.length - 1].revision
    if (candidate.revision !== current_revision + 1) {
      throw new RevisionMismatchError(current_revision + 1, candidate.revision)
    }
    const stored = deep_copy(candidate)
    this.revisions.push(stored)
    return { revision: stored.revision, document: deep_copy(stored) }
  }

  undo (revision: number): DocumentCommitReceipt {
    const target = this.revisions.find((document) => document.revision === revision)
    if (target === undefined) {
      throw new RevisionNotFoundError(revision)
    }
    // Undo is itself an atomic commit and increments the revision again.
    const current_revision = this.revisions[this.revisions.length - 1].revision
    const restored: AnimationDocument = {
      ...deep_copy(target),
      revision: current_revision + 1
    }
    const validated = with_validation(restored)
    if (validated.validation.state !== 'valid') {
      throw new InvalidDocumentCommitError(validated.validation.errors)
    }
    this.revisions.push(deep_copy(validated))
    return { revision: validated.revision, document: deep_copy(validated) }
  }

  history (): ReadonlyArray<AnimationDocument> {
    return this.revisions.map((document) => deep_copy(document))
  }

  /**
   * M2M-028B: compensating rollback of a failed application commit.
   * Drops the named receipt and every later snapshot so the store returns to
   * the document that was current before the failed owner insertion.
   */
  rollback (receipt: DocumentCommitReceipt): void {
    const index = this.revisions.findIndex((document) => document.revision === receipt.revision)
    if (index >= 0) this.revisions.length = index
  }
}

function deep_copy (document: AnimationDocument): AnimationDocument {
  return {
    ...document,
    rig: { ...document.rig },
    bones: document.bones.map((bone) => ({ ...bone })),
    clip: { ...document.clip },
    channels: document.channels.map((channel) => ({
      ...channel,
      keyframes: channel.keyframes.map((keyframe) => ({
        ...keyframe,
        values: [...keyframe.values]
      }))
    })),
    validation: { ...document.validation, errors: [...document.validation.errors] }
  }
}

/** Utility for callers that want to stage the next revision from current(). */
export function next_revision_of (document: AnimationDocument): AnimationDocument {
  return { ...document, revision: document.revision + 1 }
}

/** Re-export for tests that need to assert raw validation of a staged doc. */
export { validate_document }
