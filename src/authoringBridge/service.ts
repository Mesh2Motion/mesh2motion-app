/**
 * M2M-028A — frontend authoring bridge service.
 *
 * Wires the frozen AnimationDocument domain to the real running engine and
 * animation library. All client input is data-only and goes through the typed
 * bounded dispatcher; commit/undo require a native user click.
 */

import { type Skeleton } from 'three'
import {
  AUTHORING_BRIDGE_PROTOCOL,
  is_animation_document,
  type AuthoringResponse
} from './types'
import { AuthoringDispatcher, type AuthoringHandlers } from './dispatcher'
import { publish_live_rig_catalog, type AuthoringEngine } from './rigCatalog'
import { LiveDraftPreview } from './livePreview'
import { NativeConfirmationPanel } from './confirmationPanel'
import { RealApplicationOwner } from './applicationOwner'
import { create_live_agent_wave } from './liveWave'
import { InMemoryAnimationDocumentStore } from '../animation-document/store'
import { validate_document, with_validation } from '../animation-document/validation'
import { check_rig_compatibility, draft_document_to_clip } from '../animation-document/liveRigAdapter'
import { compute_rig_fingerprint } from '../animation-document/rigIdentity'
import type { PreviewEngine } from '../animation-document/enginePreview'
import { create_confirmation_request, type NativeConfirmationRequest } from '../animation-document/confirmation'
import type { AnimationDocument } from '../animation-document/types'
import type { AuthoringApplicationEngine } from './applicationOwner'

export interface AuthoringBridgeApp {
  engine: AuthoringEngine & AuthoringApplicationEngine & {
    add_frame_listener (listener: (delta_time: number) => void): void
    load_skeleton_step?: { skeleton_type? (): string }
  }
  skeleton: Skeleton
  rig_identifier: string
}

export class FrontendAuthoringBridge {
  private readonly app: AuthoringBridgeApp
  private readonly panel: NativeConfirmationPanel
  private readonly preview: LiveDraftPreview
  private readonly owner: RealApplicationOwner
  private readonly dispatcher: AuthoringDispatcher
  private store: InMemoryAnimationDocumentStore | null = null
  private draft: AnimationDocument | null = null

  constructor (app: AuthoringBridgeApp, panel: NativeConfirmationPanel = new NativeConfirmationPanel()) {
    this.app = app
    this.panel = panel
    this.preview = new LiveDraftPreview({
      engine: app.engine as unknown as PreviewEngine,
      skeleton: app.skeleton,
      rig_identifier: app.rig_identifier
    })
    this.owner = new RealApplicationOwner(app.engine)
    this.dispatcher = new AuthoringDispatcher(this.build_handlers())
  }

  handle (request: unknown): Promise<AuthoringResponse> {
    return this.dispatcher.handle(request)
  }

  dispose (): void {
    this.preview.dispose()
    this.panel.dispose()
    this.dispatcher.dispose()
    this.store = null
    this.draft = null
  }

  private assert_live_rig (): void {
    this.preview.assert_rig_unchanged()
    if (compute_rig_fingerprint(this.app.skeleton) !== this.preview.fingerprint()) {
      throw new Error('RIG_MISMATCH')
    }
  }

  private require_document (payload: Record<string, unknown>): AnimationDocument {
    if (!is_animation_document(payload.document)) throw new Error('INVALID_DOCUMENT')
    const document = payload.document
    const compatibility = check_rig_compatibility(document, this.app.skeleton)
    if (!compatibility.compatible) throw new Error(`RIG_MISMATCH: ${compatibility.kind}`)
    const validation = validate_document(document, { live_fingerprint: this.preview.fingerprint() })
    if (validation.state !== 'valid') throw new Error('INVALID_DOCUMENT')
    return document
  }

  private build_handlers (): AuthoringHandlers {
    return {
      rig_catalog_get: async () => {
        this.assert_live_rig()
        return publish_live_rig_catalog(this.app.engine, this.preview.fingerprint()) as unknown as Record<string, unknown>
      },
      draft_create: async (payload) => {
        this.assert_live_rig()
        const document = this.require_document(payload)
        this.store = new InMemoryAnimationDocumentStore(document)
        this.draft = this.store.current()
        return { revision: this.draft.revision, validation: this.draft.validation } as unknown as Record<string, unknown>
      },
      draft_validate: async (payload) => {
        this.assert_live_rig()
        const document = is_animation_document(payload.document) ? payload.document : this.draft
        if (document === null) throw new Error('INVALID_DOCUMENT')
        const validation = validate_document(document, { live_fingerprint: this.preview.fingerprint() })
        return validation as unknown as Record<string, unknown>
      },
      draft_preview_start: async (payload) => {
        this.assert_live_rig()
        const document = payload.document === undefined ? this.draft : this.require_document(payload)
        if (document === null) throw new Error('INVALID_DOCUMENT')
        this.preview.start(document)
        return { previewing: true, clip_name: document.clip.name } as unknown as Record<string, unknown>
      },
      draft_preview_stop: async () => {
        this.preview.stop()
        return { previewing: false }
      },
      draft_commit: async (payload) => {
        this.assert_live_rig()
        const document = payload.document === undefined ? this.draft : this.require_document(payload)
        if (document === null || this.store === null) throw new Error('INVALID_DOCUMENT')
        const next = with_validation({ ...document, revision: this.store.current().revision + 1 },
          { live_fingerprint: this.preview.fingerprint() })
        if (next.validation.state !== 'valid') throw new Error('INVALID_DOCUMENT')
        const request = create_confirmation_request('commit', next, next.revision)
        const decision = await this.request_confirmation(request, next)
        if (!decision.approved) throw new Error(decision.rejection_reason?.includes('expired') ? 'CONFIRMATION_EXPIRED' : 'CONFIRMATION_DENIED')
        this.preview.stop()
        const receipt = this.store.commit(next)
        this.owner.apply_committed_clip(
          draft_document_to_clip(receipt.document, this.app.skeleton),
          receipt.document
        )
        this.draft = null
        return { revision: receipt.revision, entry_id: this.owner.authored_entries().slice(-1)[0]?.entry_id ?? '' } as unknown as Record<string, unknown>
      },
      draft_cancel: async () => {
        this.preview.stop()
        this.owner.restore_selection(this.owner.capture_selection())
        this.draft = null
        return { cancelled: true }
      },
      draft_undo: async (payload) => {
        this.assert_live_rig()
        const target = typeof payload.target_revision === 'number' ? payload.target_revision : -1
        if (this.store === null) throw new Error('INVALID_DOCUMENT')
        const snapshot = this.store.history().find((document) => document.revision === target)
        if (snapshot === undefined) throw new Error('BAD_REQUEST')
        const request = create_confirmation_request('undo', snapshot, this.store.current().revision + 1, target)
        const decision = await this.request_confirmation(request, snapshot)
        if (!decision.approved) throw new Error(decision.rejection_reason?.includes('expired') ? 'CONFIRMATION_EXPIRED' : 'CONFIRMATION_DENIED')
        this.preview.stop()
        const receipt = this.store.undo(target)
        this.owner.apply_committed_clip(
          draft_document_to_clip(receipt.document, this.app.skeleton),
          receipt.document
        )
        return { revision: receipt.revision, entry_id: this.owner.authored_entries().slice(-1)[0]?.entry_id ?? '' } as unknown as Record<string, unknown>
      },
      draft_export: async () => {
        if (this.draft === null) throw new Error('INVALID_DOCUMENT')
        return { document: JSON.parse(JSON.stringify(this.draft)) } as Record<string, unknown>
      },
      draft_import: async (payload) => {
        this.assert_live_rig()
        const document = this.require_document(payload)
        this.store = new InMemoryAnimationDocumentStore(document)
        this.draft = this.store.current()
        return { revision: this.draft.revision, validation: this.draft.validation } as unknown as Record<string, unknown>
      },
      session_status: async (session_id) => ({
        active: this.draft !== null,
        session_id,
        revision: this.store?.current().revision ?? 0,
        rig_fingerprint: this.preview.fingerprint(),
        previewing: this.preview.is_previewing()
      }) as Record<string, unknown>,
      session_cancel: async () => {
        this.preview.stop()
        this.panel.dispose()
        this.draft = null
        this.store = null
        return { cancelled: true }
      }
    }
  }

  /** Human-first demonstration: build an original wave from the live rig. */
  create_live_agent_wave (): { document: AnimationDocument, mapping: unknown } {
    return create_live_agent_wave(this.app.skeleton, this.app.rig_identifier)
  }

  private async request_confirmation (request: NativeConfirmationRequest, document: AnimationDocument) {
    const keyframes = document.channels.reduce((sum, channel) => sum + channel.keyframes.length, 0)
    return this.panel.request_confirmation(request, {
      animation_name: document.clip.name,
      rig_identifier: document.rig.identifier,
      fingerprint_prefix: document.rig.fingerprint.slice(0, 12),
      duration_seconds: document.clip.duration_seconds,
      track_count: document.channels.length,
      keyframe_count: keyframes,
      operation: request.operation
    })
  }
}

export { AUTHORING_BRIDGE_PROTOCOL }
