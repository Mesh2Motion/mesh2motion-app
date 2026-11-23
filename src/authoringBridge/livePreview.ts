/**
 * M2M-028A — live draft preview against the real running engine.
 *
 * Uses the existing DraftPreviewSession (isolated mixer + engine frame
 * listener) and the existing guarded converter. It checks the exact live rig
 * fingerprint before and during preview and never touches animation selection.
 */

import { type Skeleton } from 'three'
import type { AnimationDocument } from '../animation-document/types'
import { check_rig_compatibility, draft_document_to_clip } from '../animation-document/liveRigAdapter'
import { compute_rig_fingerprint } from '../animation-document/rigIdentity'
import { create_engine_preview, type PreviewEngine } from '../animation-document/enginePreview'
import { DraftPreviewSession } from '../animation-document/preview'

export interface LivePreviewOptions {
  engine: PreviewEngine
  skeleton: Skeleton
  rig_identifier: string
}

export class LiveDraftPreview {
  private readonly engine: PreviewEngine
  private readonly skeleton: Skeleton
  private readonly rig_identifier: string
  private readonly expected_fingerprint: string
  private readonly session: DraftPreviewSession
  private previewing = false

  constructor (options: LivePreviewOptions) {
    this.engine = options.engine
    this.skeleton = options.skeleton
    this.rig_identifier = options.rig_identifier
    this.expected_fingerprint = compute_rig_fingerprint(options.skeleton)
    this.session = create_engine_preview(options.engine)
  }

  /** The fingerprint captured when this session was created. */
  fingerprint (): string {
    return this.expected_fingerprint
  }

  /** Check that the live rig has not changed since the session was created. */
  assert_rig_unchanged (): void {
    if (compute_rig_fingerprint(this.skeleton) !== this.expected_fingerprint) {
      this.stop()
      throw new Error('RIG_MISMATCH')
    }
  }

  start (document: AnimationDocument): void {
    this.assert_rig_unchanged()
    const compatibility = check_rig_compatibility(document, this.skeleton)
    if (!compatibility.compatible) throw new Error(`RIG_MISMATCH: ${compatibility.kind}`)
    const clip = draft_document_to_clip(document, this.skeleton)
    this.session.show(clip)
    this.previewing = true
  }

  stop (): void {
    if (!this.previewing) return
    this.session.stop()
    this.previewing = false
  }

  is_previewing (): boolean {
    return this.previewing
  }

  /** Release listeners/mixer state when the app or session exits. */
  dispose (): void {
    this.stop()
    this.session.stop()
  }
}
