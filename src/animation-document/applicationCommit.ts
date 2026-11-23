/**
 * M2M-025B — application-owned commit / cancel / undo controller.
 *
 * Draft authoring is separate from the Remix workflow: this controller only
 * mutates an AnimationDocument draft and asks the application (through an
 * injected owner) to apply a committed clip. It never calls
 * StepAnimationsListing.play_animation(), never edits the animation library,
 * and never touches composer/Remix state.
 *
 * Commit and undo require a native user-confirmation bridge. Cancel is a local
 * discard and needs no confirmation because it does not mutate application state.
 */

import { type AnimationClip, type Skeleton } from 'three'
import type { AnimationDocument, DocumentCommitReceipt } from './types'
import type { AnimationDocumentStore } from './store'
import { with_validation } from './validation'
import type { DraftPreviewSession } from './preview'
import { draft_document_to_clip } from './liveRigAdapter'
import { compute_rig_fingerprint } from './rigIdentity'
import {
  create_confirmation_request,
  type NativeConfirmationBridge,
  type NativeConfirmationResult
} from './confirmation'

/** Supplied by the application; owns the real animation state. */
export interface AnimationApplicationOwner {
  apply_committed_clip (clip: AnimationClip, document: AnimationDocument): void
  capture_selection (): unknown
  restore_selection (snapshot: unknown): void
}

export interface ApplicationCommitDependencies {
  store: AnimationDocumentStore
  preview: DraftPreviewSession
  owner: AnimationApplicationOwner
  confirmation: NativeConfirmationBridge
  skeleton: Skeleton
}

export type CommitOutcome =
  | { status: 'committed', receipt: DocumentCommitReceipt }
  | { status: 'cancelled', request_id: string, rejection_reason?: string }
  | { status: 'rejected', errors: string[] }

function clone_document (document: AnimationDocument): AnimationDocument {
  return {
    ...document,
    rig: { ...document.rig },
    bones: document.bones.map((bone) => ({ ...bone })),
    clip: { ...document.clip },
    channels: document.channels.map((channel) => ({
      ...channel,
      keyframes: channel.keyframes.map((keyframe) => ({ ...keyframe, values: [...keyframe.values] }))
    })),
    validation: { ...document.validation, errors: [...document.validation.errors] }
  }
}

export class ApplicationCommitController {
  private readonly store: AnimationDocumentStore
  private readonly preview: DraftPreviewSession
  private readonly owner: AnimationApplicationOwner
  private readonly confirmation: NativeConfirmationBridge
  private readonly skeleton: Skeleton

  private working: AnimationDocument | null = null
  private selection_snapshot: unknown = undefined
  private has_selection_snapshot = false

  constructor (dependencies: ApplicationCommitDependencies) {
    this.store = dependencies.store
    this.preview = dependencies.preview
    this.owner = dependencies.owner
    this.confirmation = dependencies.confirmation
    this.skeleton = dependencies.skeleton
  }

  /** Start authoring a draft. No application state is touched. */
  begin_draft (document: AnimationDocument): AnimationDocument {
    const validated = with_validation(document)
    if (validated.validation.state !== 'valid') {
      throw new Error(`cannot begin draft: ${validated.validation.errors.join('; ')}`)
    }
    this.working = { ...clone_document(validated), revision: this.store.current().revision + 1 }
    return clone_document(this.working)
  }

  draft (): AnimationDocument | null {
    return this.working === null ? null : clone_document(this.working)
  }

  /** Replace the working draft; the revision is preserved for commit. */
  update_draft (mutator: (draft: AnimationDocument) => AnimationDocument): AnimationDocument {
    if (this.working === null) {
      throw new Error('no active draft')
    }
    const candidate = with_validation(mutator(clone_document(this.working)))
    if (candidate.validation.state !== 'valid') {
      throw new Error(`invalid draft update: ${candidate.validation.errors.join('; ')}`)
    }
    this.working = { ...candidate, revision: this.working.revision }
    return clone_document(this.working)
  }

  /** Preview the draft in an isolated mixer, capturing selection once. */
  show_preview (): void {
    if (this.working === null) {
      throw new Error('no active draft')
    }
    if (!this.has_selection_snapshot) {
      this.selection_snapshot = this.owner.capture_selection()
      this.has_selection_snapshot = true
    }
    const clip = draft_document_to_clip(this.working, this.skeleton)
    this.preview.show(clip)
  }

  async commit (): Promise<CommitOutcome> {
    if (this.working === null) {
      return { status: 'rejected', errors: ['no active draft'] }
    }
    const validated = with_validation(this.working, { live_fingerprint: compute_rig_fingerprint(this.skeleton) })
    if (validated.validation.state !== 'valid') {
      return { status: 'rejected', errors: validated.validation.errors }
    }

    const request = create_confirmation_request('commit', validated, validated.revision)
    const decision = await this.confirmation.request_confirmation(request)
    if (!decision.approved) {
      this.discard_preview(true)
      return { status: 'cancelled', request_id: request.request_id, rejection_reason: decision.rejection_reason }
    }

    // Conversion happens before the atomic store commit so a conversion error
    // cannot leave a committed document that the application cannot apply.
    const clip = draft_document_to_clip(validated, this.skeleton)
    const receipt = this.store.commit(validated)
    this.discard_preview(false)
    this.owner.apply_committed_clip(clip, receipt.document)
    this.working = null
    return { status: 'committed', receipt }
  }

  /** Discard the draft and restore the pre-preview application selection. */
  cancel (): void {
    this.discard_preview(true)
    this.working = null
  }

  async undo (target_revision: number): Promise<CommitOutcome> {
    const target = this.store.history().find((document) => document.revision === target_revision)
    if (target === undefined) {
      return { status: 'rejected', errors: [`revision ${target_revision} not found`] }
    }
    const request = create_confirmation_request('undo', target, this.store.current().revision + 1, target_revision)
    const decision: NativeConfirmationResult = await this.confirmation.request_confirmation(request)
    if (!decision.approved) {
      return { status: 'cancelled', request_id: request.request_id, rejection_reason: decision.rejection_reason }
    }
    const clip = draft_document_to_clip(target, this.skeleton)
    const receipt = this.store.undo(target_revision)
    this.discard_preview(false)
    this.owner.apply_committed_clip(clip, receipt.document)
    this.working = null
    return { status: 'committed', receipt }
  }

  history (): ReadonlyArray<AnimationDocument> {
    return this.store.history()
  }

  private discard_preview (restore_selection: boolean): void {
    this.preview.stop()
    if (this.has_selection_snapshot && restore_selection) {
      this.owner.restore_selection(this.selection_snapshot)
    }
    this.selection_snapshot = undefined
    this.has_selection_snapshot = false
  }
}
