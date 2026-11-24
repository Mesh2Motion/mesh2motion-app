/**
 * M2M-028B — typed, bounded request dispatcher for authoring-bridge/v1.
 *
 * Transport rules (M2M-028B amendments):
 * - maximum 256 KiB for the ENTIRE serialized UTF-8 request (byte count, not JS char count);
 * - strictly increasing per-session `sequence`, echoed in every response;
 * - at most 4096 distinct request IDs retained per app launch, then fail closed;
 * - one in-flight request, closed operation set, bounded deadlines.
 * No eval, no dynamic import by client data, no filesystem paths.
 */

import {
  AUTHORING_BRIDGE_PROTOCOL,
  BRIDGE_LIMITS,
  is_authoring_request,
  type AuthoringErrorCode,
  type AuthoringOperation,
  type AuthoringRequest,
  type AuthoringResponse
} from './types'

export interface AuthoringHandlers {
  rig_catalog_get (): Promise<Record<string, unknown>>
  draft_create (payload: Record<string, unknown>): Promise<Record<string, unknown>>
  draft_set_keyframes (payload: Record<string, unknown>): Promise<Record<string, unknown>>
  draft_validate (payload: Record<string, unknown>): Promise<Record<string, unknown>>
  draft_preview_start (payload: Record<string, unknown>): Promise<Record<string, unknown>>
  draft_preview_stop (): Promise<Record<string, unknown>>
  draft_commit (payload: Record<string, unknown>): Promise<Record<string, unknown>>
  draft_cancel (): Promise<Record<string, unknown>>
  draft_undo (payload: Record<string, unknown>): Promise<Record<string, unknown>>
  draft_export (): Promise<Record<string, unknown>>
  draft_import (payload: Record<string, unknown>): Promise<Record<string, unknown>>
  session_status (session_id: string): Promise<Record<string, unknown>>
  session_cancel (): Promise<Record<string, unknown>>
  application_set_page? (payload: Record<string, unknown>): Promise<Record<string, unknown>>
}

function error_response (request: AuthoringRequest, code: AuthoringErrorCode, message: string): AuthoringResponse {
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: request.request_id,
    session_id: request.session_id,
    sequence: request.sequence,
    ok: false,
    error: { code, message }
  }
}

function success_response (request: AuthoringRequest, result: Record<string, unknown>): AuthoringResponse {
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: request.request_id,
    session_id: request.session_id,
    sequence: request.sequence,
    ok: true,
    result
  }
}

function with_deadline<T> (promise: Promise<T>, deadline_ms: number, timers: Set<ReturnType<typeof setTimeout>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      reject(new Error('DEADLINE_EXCEEDED'))
    }, deadline_ms)
    timers.add(timer)
    promise.then(
      (value) => { clearTimeout(timer); timers.delete(timer); resolve(value) },
      (reason) => { clearTimeout(timer); timers.delete(timer); reject(reason) }
    )
  })
}

export class AuthoringDispatcher {
  private readonly handlers: AuthoringHandlers
  private readonly seen_request_ids = new Set<string>()
  private readonly last_sequence = new Map<string, number>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private in_flight: string | null = null
  private current_session: string | null = null
  private disposed = false

  constructor (handlers: AuthoringHandlers) {
    this.handlers = handlers
  }

  /** Validate and dispatch one request. Never throws; always returns a typed response. */
  async handle (input: unknown): Promise<AuthoringResponse> {
    if (!is_authoring_request(input)) {
      return {
        protocol: AUTHORING_BRIDGE_PROTOCOL,
        request_id: '',
        session_id: '',
        sequence: 0,
        ok: false,
        error: { code: 'BAD_PROTOCOL', message: 'request does not match authoring-bridge/v1' }
      }
    }
    const request = input
    if (this.disposed) return error_response(request, 'SESSION_CONFLICT', 'dispatcher disposed')
    // Rust validates ID byte length (str::len), not JS code-unit length.
    const encoder = new TextEncoder()
    if (encoder.encode(request.request_id).byteLength === 0 ||
        encoder.encode(request.request_id).byteLength > BRIDGE_LIMITS.max_id_length ||
        encoder.encode(request.session_id).byteLength === 0 ||
        encoder.encode(request.session_id).byteLength > BRIDGE_LIMITS.max_id_length) {
      return error_response(request, 'BAD_REQUEST', 'invalid request_id or session_id length')
    }
    if (!Number.isSafeInteger(request.deadline_ms) ||
        request.deadline_ms < BRIDGE_LIMITS.min_deadline_ms ||
        request.deadline_ms > BRIDGE_LIMITS.max_deadline_ms) {
      return error_response(request, 'BAD_REQUEST', 'deadline_ms out of bounds')
    }

    let serialized: string
    try {
      serialized = JSON.stringify(request)
    } catch {
      return error_response(request, 'BAD_REQUEST', 'payload is not serializable data')
    }
    const byte_length = new TextEncoder().encode(serialized).byteLength
    if (byte_length > BRIDGE_LIMITS.max_request_bytes) {
      return error_response(request, 'PAYLOAD_TOO_LARGE', 'request exceeds 256 KiB UTF-8 frame limit')
    }

    if (this.seen_request_ids.size >= BRIDGE_LIMITS.max_retained_request_ids &&
        !this.seen_request_ids.has(request.request_id)) {
      return error_response(request, 'SESSION_CONFLICT', 'request-ID retention cap reached; restart required')
    }
    if (this.seen_request_ids.has(request.request_id)) {
      return error_response(request, 'DUPLICATE_REQUEST_ID', 'request_id already used')
    }
    const previous_sequence = this.last_sequence.get(request.session_id) ?? 0
    if (request.sequence <= previous_sequence) {
      return error_response(request, 'BAD_REQUEST', 'sequence must be strictly increasing per session')
    }
    if (this.in_flight !== null) {
      return error_response(request, 'SESSION_CONFLICT', 'another request is in flight')
    }
    if (this.current_session !== null && this.current_session !== request.session_id &&
        this.activeSessionLimitReached(request.operation)) {
      return error_response(request, 'SESSION_CONFLICT', 'another authoring session is active')
    }

    this.seen_request_ids.add(request.request_id)
    this.last_sequence.set(request.session_id, request.sequence)
    this.in_flight = request.request_id
    if (this.current_session === null) this.current_session = request.session_id

    try {
      const result = await with_deadline(this.dispatch(request), request.deadline_ms, this.timers)
      return success_response(request, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'DEADLINE_EXCEEDED') return error_response(request, 'DEADLINE_EXCEEDED', message)
      const code_candidate = message.split(':')[0].trim()
      const code = this.is_bridge_error_code(code_candidate) ? code_candidate as AuthoringErrorCode : 'INTERNAL'
      return error_response(request, code, message)
    } finally {
      this.in_flight = null
      if (request.operation === 'session.cancel') {
        // A trusted Rust/Tauri cancellation can arrive from a new sidecar
        // process after the previous MCP peer disconnected before sending its
        // own cancel. Clear the single app-owned session regardless of which
        // MCP generation supplied the authorized cancellation request.
        const active_session = this.current_session
        if (active_session !== null) this.cancel_session(active_session)
        this.current_session = null
      }
    }
  }

  /** Cancel/disconnect/shutdown: clear session state and all pending timers. */
  cancel_session (session_id: string): void {
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers.clear()
    if (this.current_session === session_id) {
      this.current_session = null
      this.in_flight = null
    }
    this.last_sequence.delete(session_id)
  }

  dispose (): void {
    this.disposed = true
    this.cancel_session(this.current_session ?? '')
    this.seen_request_ids.clear()
  }

  private activeSessionLimitReached (operation: AuthoringOperation): boolean {
    return this.current_session !== null && BRIDGE_LIMITS.max_sessions === 1 &&
      operation !== 'session.status' && operation !== 'session.cancel' &&
      operation !== 'application.set_page'
  }

  private is_bridge_error_code (value: string): boolean {
    const codes: AuthoringErrorCode[] = [
      'BAD_PROTOCOL', 'UNKNOWN_OPERATION', 'BAD_REQUEST', 'PAYLOAD_TOO_LARGE',
      'DEADLINE_EXCEEDED', 'DUPLICATE_REQUEST_ID', 'SESSION_CONFLICT',
      'RIG_UNAVAILABLE', 'RIG_MISMATCH', 'INVALID_DOCUMENT', 'PREVIEW_ACTIVE',
      'CONFIRMATION_REQUIRED', 'CONFIRMATION_DENIED', 'CONFIRMATION_EXPIRED',
      'COMMIT_FAILED', 'UNDO_FAILED', 'INTERNAL', 'AUTHORING_DISABLED', 'APP_DISCONNECTED'
    ]
    return codes.includes(value as AuthoringErrorCode)
  }

  /** Next legal sequence for a session, without consuming it (the handle() call does). */
  peek_sequence (session_id: string): number {
    return (this.last_sequence.get(session_id) ?? 0) + 1
  }

  private dispatch (request: AuthoringRequest): Promise<Record<string, unknown>> {
    switch (request.operation) {
      case 'rig.catalog.get': return this.handlers.rig_catalog_get()
      case 'draft.create': return this.handlers.draft_create(request.payload)
      case 'draft.set_keyframes': return this.handlers.draft_set_keyframes(request.payload)
      case 'draft.validate': return this.handlers.draft_validate(request.payload)
      case 'draft.preview.start': return this.handlers.draft_preview_start(request.payload)
      case 'draft.preview.stop': return this.handlers.draft_preview_stop()
      case 'draft.commit': return this.handlers.draft_commit(request.payload)
      case 'draft.cancel': return this.handlers.draft_cancel()
      case 'draft.undo': return this.handlers.draft_undo(request.payload)
      case 'draft.export': return this.handlers.draft_export()
      case 'draft.import': return this.handlers.draft_import(request.payload)
      case 'session.status': return this.handlers.session_status(request.session_id)
      case 'session.cancel': return this.handlers.session_cancel()
      case 'application.set_page': return this.handlers.application_set_page?.(request.payload)
        ?? Promise.reject(new Error('_PAGE_UNSUPPORTED'))
      default: return Promise.reject(new Error('UNKNOWN_OPERATION'))
    }
  }
}
