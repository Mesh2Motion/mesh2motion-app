/**
 * M2M-028B — frontend authoring bridge service.
 *
 * Wires the frozen AnimationDocument domain to the real running engine and
 * animation library. All client input is data-only and bounded by the
 * dispatcher. MCP requests grant an in-memory app-session permission.
 * Commit/undo approvals are bound to request, session, revision and a SHA-256
 * document digest.
 */

import { type Skeleton } from 'three'
import {
  AUTHORING_BRIDGE_PROTOCOL,
  is_authoring_request,
  is_animation_document,
  type AuthoringOperation,
  type AuthoringRequest,
  type AuthoringResponse
} from './types'
import { AuthoringDispatcher, type AuthoringHandlers } from './dispatcher'
import { publish_live_rig_catalog, type AuthoringEngine } from './rigCatalog'
import { LiveDraftPreview } from './livePreview'
import { NativeConfirmationPanel } from './confirmationPanel'
import { AuthoringPermission } from './permission'
import { RealApplicationOwner } from './applicationOwner'
import { create_live_agent_wave } from './liveWave'
import { InMemoryAnimationDocumentStore } from '../animation-document/store'
import { validate_document, with_validation } from '../animation-document/validation'
import { with_animation_channel } from '../animation-document/create'
import { check_rig_compatibility, draft_document_to_clip } from '../animation-document/liveRigAdapter'
import { compute_rig_fingerprint } from '../animation-document/rigIdentity'
import { create_document_from_live_rig } from '../animation-document/liveRigAdapter'
import { sha256_hex } from '../animation-document/sha256'
import { create_confirmation_request, type ConfirmationBinding } from '../animation-document/confirmation'
import type { PreviewEngine } from '../animation-document/enginePreview'
import type { AnimationDocument, AnimationProperty, AnimationKeyframe } from '../animation-document/types'
import type { AuthoringApplicationEngine } from './applicationOwner'

export interface AuthoringBridgeApp {
  engine: AuthoringEngine & AuthoringApplicationEngine & {
    add_frame_listener (listener: (delta_time: number) => void): void
    load_skeleton_step?: { skeleton_type? (): string }
  }
  skeleton: Skeleton
  rig_identifier: string
}

const PERMISSION_GATED: readonly AuthoringOperation[] = [
  'draft.create', 'draft.set_keyframes', 'draft.preview.start', 'draft.preview.stop',
  'draft.commit', 'draft.cancel', 'draft.undo', 'draft.export', 'draft.import',
  'session.status', 'session.cancel'
]

function document_digest (document: AnimationDocument): string {
  return sha256_hex(JSON.stringify(document))
}

export class FrontendAuthoringBridge {
  private readonly app: AuthoringBridgeApp
  private readonly panel: NativeConfirmationPanel
  private readonly permission: AuthoringPermission
  private readonly preview: LiveDraftPreview
  private readonly owner: RealApplicationOwner
  private readonly dispatcher: AuthoringDispatcher
  private store: InMemoryAnimationDocumentStore | null = null
  private draft: AnimationDocument | null = null
  private current_session: string | null = null
  private deadline_at = 0

  constructor (
    app: AuthoringBridgeApp,
    panel: NativeConfirmationPanel = new NativeConfirmationPanel(),
    permission: AuthoringPermission = new AuthoringPermission()
  ) {
    this.app = app
    this.panel = panel
    this.permission = permission
    this.preview = new LiveDraftPreview({
      engine: app.engine as unknown as PreviewEngine,
      skeleton: app.skeleton,
      rig_identifier: app.rig_identifier
    })
    this.owner = new RealApplicationOwner(app.engine)
    this.dispatcher = new AuthoringDispatcher(this.build_handlers())
  }

  is_permission_enabled (): boolean {
    return this.permission.is_enabled()
  }

  handle (request: unknown): Promise<AuthoringResponse> {
    const typed = request as AuthoringRequest | null
    if (typed !== null && typeof typed === 'object' && PERMISSION_GATED.includes(typed.operation) &&
        !this.permission.is_enabled()) {
      return Promise.resolve({
        protocol: AUTHORING_BRIDGE_PROTOCOL,
        request_id: typeof typed.request_id === 'string' ? typed.request_id : '',
        session_id: typeof typed.session_id === 'string' ? typed.session_id : '',
        sequence: typeof typed.sequence === 'number' ? typed.sequence : 0,
        ok: false,
        error: { code: 'AUTHORING_DISABLED', message: 'authoring permission is granted by a valid native MCP authoring request' }
      })
    }
    if (typed !== null && typeof typed === 'object') {
      this.current_session = typed.session_id
      this.deadline_at = Date.now() + (typeof typed.deadline_ms === 'number' ? typed.deadline_ms : 30000)
    }
    return this.dispatcher.handle(request)
  }

  /** Called only by the Rust-to-Tauri MCP event adapter, never by DOM events. */
  handle_mcp_request (request: unknown): Promise<AuthoringResponse> {
    if (is_authoring_request(request) && request.operation !== 'rig.catalog.get') {
      this.permission.authorize_from_mcp_request()
    }
    return this.handle(request)
  }

  /** M2M-028B: Rust cancel/disconnect/shutdown event. */
  handle_cancel (payload: unknown): void {
    const data = payload as Partial<{ protocol: string, request_id: string, session_id: string }> | null
    if (data === null || typeof data !== 'object') return
    if (data.protocol !== AUTHORING_BRIDGE_PROTOCOL) return
    if (this.current_session !== null && data.session_id !== this.current_session) return
    this.cleanup_session()
  }

  dispose (): void {
    this.cleanup_session()
    this.permission.dispose()
    this.panel.dispose()
    this.dispatcher.dispose()
  }

  private cleanup_session (): void {
    this.preview.stop()
    this.preview.dispose()
    this.panel.dispose()
    if (this.current_session !== null) this.dispatcher.cancel_session(this.current_session)
    this.current_session = null
    this.draft = null
    this.store = null
  }

  private remaining_ms (): number {
    return Math.max(1, this.deadline_at - Date.now())
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
        // Incremental authoring: an empty live-rig draft can be created from
        // name/duration alone; a full document remains accepted for import.
        const document = is_animation_document(payload.document)
          ? this.require_document(payload)
          : create_document_from_live_rig({
            skeleton: this.app.skeleton,
            rig_identifier: this.app.rig_identifier,
            clip_name: typeof payload.name === 'string' && payload.name.length > 0 ? payload.name : 'Untitled Authored Clip',
            duration_seconds: typeof payload.duration_seconds === 'number' ? payload.duration_seconds : 2
          })
        const validated = with_validation(document, { live_fingerprint: this.preview.fingerprint() })
        if (validated.validation.state !== 'valid') throw new Error('INVALID_DOCUMENT')
        this.store = new InMemoryAnimationDocumentStore(validated)
        this.draft = this.store.current()
        return { revision: this.draft.revision, validation: this.draft.validation } as unknown as Record<string, unknown>
      },
      draft_set_keyframes: async (payload) => {
        this.assert_live_rig()
        if (this.store === null || this.draft === null) throw new Error('INVALID_DOCUMENT')
        const expected_revision = payload.expected_revision
        if (typeof expected_revision !== 'number' || expected_revision !== this.store.current().revision) {
          throw new Error('BAD_REQUEST: stale expected_revision')
        }
        const bone_id = payload.bone_id
        const property = payload.property
        const keyframes = payload.keyframes
        if (typeof bone_id !== 'string' || !this.draft.bones.some((bone) => bone.id === bone_id) ||
            (property !== 'position' && property !== 'quaternion' && property !== 'scale') ||
            !Array.isArray(keyframes) || keyframes.length === 0) {
          throw new Error('INVALID_DOCUMENT')
        }
        const candidate = with_animation_channel(this.draft, {
          bone_id,
          property: property as AnimationProperty,
          keyframes: keyframes as AnimationKeyframe[]
        })
        const validated = with_validation(
          { ...candidate, revision: expected_revision + 1 },
          { live_fingerprint: this.preview.fingerprint() }
        )
        if (validated.validation.state !== 'valid') throw new Error('INVALID_DOCUMENT')
        const receipt = this.store.commit(validated)
        this.draft = receipt.document
        return { revision: receipt.revision, validation: receipt.document.validation } as unknown as Record<string, unknown>
      },
      draft_validate: async (payload) => {
        this.assert_live_rig()
        const document = is_animation_document(payload.document) ? payload.document : this.draft
        if (document === null) throw new Error('INVALID_DOCUMENT')
        return validate_document(document, { live_fingerprint: this.preview.fingerprint() }) as unknown as Record<string, unknown>
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
        const digest = document_digest(next)
        const request = create_confirmation_request('commit', next, next.revision)
        const binding: ConfirmationBinding = {
          request_id: request.request_id,
          session_id: this.current_session ?? '',
          operation: 'commit',
          rig_fingerprint: this.preview.fingerprint(),
          revision: next.revision,
          document_digest: digest,
          target_revision: null
        }
        const decision = await this.request_confirmation(request, next, binding)
        if (!decision.approved) throw new Error(decision.rejection_reason?.toLowerCase().includes('expired') ? 'CONFIRMATION_EXPIRED' : 'CONFIRMATION_DENIED')
        this.verify_binding(decision.binding, binding)
        this.preview.stop()
        const receipt = this.store.commit(next)
        try {
          this.owner.apply_committed_clip(draft_document_to_clip(receipt.document, this.app.skeleton), receipt.document)
        } catch (error) {
          // Compensating boundary: never leave store and library inconsistent.
          this.owner.rollback_last()
          this.store.rollback(receipt)
          this.draft = this.store.current()
          throw Object.assign(new Error(`COMMIT_FAILED: ${error instanceof Error ? error.message : String(error)}`), { cause: error })
        }
        this.draft = null
        return { revision: receipt.revision, entry_id: this.owner.authored_entries().slice(-1)[0]?.entry_id ?? '' } as unknown as Record<string, unknown>
      },
      draft_cancel: async () => {
        this.preview.stop()
        this.panel.dispose()
        this.owner.restore_selection(this.owner.capture_selection())
        this.draft = null
        this.store = null
        return { cancelled: true }
      },
      draft_undo: async (payload) => {
        this.assert_live_rig()
        const target = typeof payload.target_revision === 'number' ? payload.target_revision : -1
        if (this.store === null) throw new Error('INVALID_DOCUMENT')
        const snapshot = this.store.history().find((document) => document.revision === target)
        if (snapshot === undefined) throw new Error('BAD_REQUEST')
        const request = create_confirmation_request('undo', snapshot, this.store.current().revision + 1, target)
        const digest = document_digest(snapshot)
        const binding: ConfirmationBinding = {
          request_id: request.request_id,
          session_id: this.current_session ?? '',
          operation: 'undo',
          rig_fingerprint: this.preview.fingerprint(),
          revision: this.store.current().revision + 1,
          document_digest: digest,
          target_revision: target
        }
        const decision = await this.request_confirmation(request, snapshot, binding)
        if (!decision.approved) throw new Error(decision.rejection_reason?.toLowerCase().includes('expired') ? 'CONFIRMATION_EXPIRED' : 'CONFIRMATION_DENIED')
        this.verify_binding(decision.binding, binding)
        this.preview.stop()
        const current = this.store.current()
        const receipt = this.store.undo(target)
        const authored_count = this.owner.authored_entries().length
        try {
          // Insert the restored clip first so a failed insertion leaves the
          // current application entry intact.
          this.owner.apply_committed_clip(
            draft_document_to_clip(receipt.document, this.app.skeleton),
            receipt.document,
            false
          )
        } catch (error) {
          this.store.rollback(receipt)
          if (error instanceof Error) {
            error.message = `UNDO_FAILED: ${error.message}`
            throw error
          }
          throw error
        }
        const restored_record = this.owner.authored_entries().length > authored_count
        if (!restored_record || this.owner.remove_revision(current.revision) === null) {
          if (restored_record) this.owner.remove_revision(receipt.revision)
          this.store.rollback(receipt)
          throw new Error('UNDO_FAILED: application library could not replace the current revision')
        }
        return { revision: receipt.revision, entry_id: this.owner.authored_entries().slice(-1)[0]?.entry_id ?? '' } as unknown as Record<string, unknown>
      },
      draft_export: async () => {
        const document = this.draft ?? this.store?.current() ?? null
        if (document === null) throw new Error('INVALID_DOCUMENT')
        return { document: JSON.parse(JSON.stringify(document)) } as Record<string, unknown>
      },
      draft_import: async (payload) => {
        this.assert_live_rig()
        const document = this.require_document(payload)
        const validated = with_validation(document, { live_fingerprint: this.preview.fingerprint() })
        this.store = new InMemoryAnimationDocumentStore(validated)
        this.draft = this.store.current()
        return { revision: this.draft.revision, validation: this.draft.validation } as unknown as Record<string, unknown>
      },
      session_status: async (session_id) => ({
        active: this.draft !== null,
        session_id,
        revision: this.store?.current().revision ?? 0,
        rig_fingerprint: this.preview.fingerprint(),
        previewing: this.preview.is_previewing(),
        authoring_enabled: this.permission.is_enabled()
      }) as Record<string, unknown>,
      session_cancel: async () => {
        this.cleanup_session()
        return { cancelled: true }
      }
    }
  }

  create_live_agent_wave (): { document: AnimationDocument, mapping: unknown } {
    return create_live_agent_wave(this.app.skeleton, this.app.rig_identifier)
  }

  private verify_binding (actual: ConfirmationBinding | undefined, expected: ConfirmationBinding): void {
    if (actual === undefined ||
        actual.request_id !== expected.request_id ||
        actual.session_id !== expected.session_id ||
        actual.operation !== expected.operation ||
        actual.rig_fingerprint !== expected.rig_fingerprint ||
        actual.revision !== expected.revision ||
        actual.document_digest !== expected.document_digest ||
        actual.target_revision !== expected.target_revision) {
      throw new Error('CONFIRMATION_DENIED')
    }
  }

  private async request_confirmation (
    request: ReturnType<typeof create_confirmation_request>,
    document: AnimationDocument,
    binding: ConfirmationBinding
  ) {
    const keyframes = document.channels.reduce((sum, channel) => sum + channel.keyframes.length, 0)
    return this.panel.request_confirmation(request, {
      animation_name: document.clip.name,
      rig_identifier: document.rig.identifier,
      fingerprint_prefix: document.rig.fingerprint.slice(0, 12),
      duration_seconds: document.clip.duration_seconds,
      track_count: document.channels.length,
      keyframe_count: keyframes,
      operation: request.operation
    }, binding, this.remaining_ms())
  }
}
