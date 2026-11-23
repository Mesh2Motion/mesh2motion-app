/**
 * M2M-028A — typed, bounded request dispatcher for authoring-bridge/v1.
 *
 * It only parses data and calls injected typed handlers. It never evaluates
 * code, imports modules by name, or interprets filesystem paths supplied by a
 * client. All timers are owned here and cleared on dispose.
 */

import {
  AUTHORING_BRIDGE_PROTOCOL,
  BRIDGE_LIMITS,
  is_authoring_request,
  type AuthoringError,
  type AuthoringErrorCode,
  type AuthoringOperation,
  type AuthoringRequest,
  type AuthoringResponse
} from './types'

export interface AuthoringHandlers {
  rig_catalog_get (): Promise<Record<string, unknown>>
  draft_create (payload: Record<string, unknown>): Promise<Record<string, unknown>>
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
}

function error_response (request: AuthoringRequest, code: AuthoringErrorCode, message: string): AuthoringResponse {
  const error: AuthoringError = { code, message }
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: request.request_id,
    session_id: request.session_id,
    ok: false,
    error
  }
}

function success_response (request: AuthoringRequest, result: Record<string, unknown>): AuthoringResponse {
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: request.request_id,
    session_id: request.session_id,
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
  private readonly active_sessions = new Set<string>()
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
      // A malformed envelope has no trustworthy IDs; echo empty strings.
      return {
        protocol: AUTHORING_BRIDGE_PROTOCOL,
        request_id: '',
        session_id: '',
        ok: false,
        error: { code: 'BAD_PROTOCOL', message: 'request does not match authoring-bridge/v1' }
      }
    }
    const request = input
    if (this.disposed) return error_response(request, 'SESSION_CONFLICT', 'dispatcher disposed')
    if (request.request_id.length === 0 || request.request_id.length > BRIDGE_LIMITS.max_id_length ||
        request.session_id.length === 0 || request.session_id.length > BRIDGE_LIMITS.max_id_length) {
      return error_response(request, 'BAD_REQUEST', 'invalid request_id or session_id length')
    }
    if (!Number.isInteger(request.deadline_ms) ||
        request.deadline_ms < BRIDGE_LIMITS.min_deadline_ms ||
        request.deadline_ms > BRIDGE_LIMITS.max_deadline_ms) {
      return error_response(request, 'BAD_REQUEST', 'deadline_ms out of bounds')
    }
    try {
      if (JSON.stringify(request).length > BRIDGE_LIMITS.max_request_bytes) {
        return error_response(request, 'PAYLOAD_TOO_LARGE', 'request exceeds 512 KiB')
      }
    } catch {
      return error_response(request, 'BAD_REQUEST', 'payload is not serializable data')
    }
    if (this.seen_request_ids.has(request.request_id)) {
      return error_response(request, 'DUPLICATE_REQUEST_ID', 'request_id already used')
    }
    if (this.in_flight !== null) {
      return error_response(request, 'SESSION_CONFLICT', 'another request is in flight')
    }
    if (this.current_session !== null && this.current_session !== request.session_id &&
        this.active_sessions.size >= BRIDGE_LIMITS.max_sessions &&
        request.operation !== 'session.status' && request.operation !== 'session.cancel') {
      return error_response(request, 'SESSION_CONFLICT', 'another authoring session is active')
    }

    this.seen_request_ids.add(request.request_id)
    this.in_flight = request.request_id
    if (this.current_session === null) {
      this.current_session = request.session_id
      this.active_sessions.add(request.session_id)
    }
    try {
      const result = await with_deadline(this.dispatch(request), request.deadline_ms, this.timers)
      return success_response(request, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === 'DEADLINE_EXCEEDED') return error_response(request, 'DEADLINE_EXCEEDED', message)
      const code = this.is_bridge_error_code(message) ? message as AuthoringErrorCode : 'INTERNAL'
      return error_response(request, code, message)
    } finally {
      this.in_flight = null
      if (request.operation === 'session.cancel' && this.current_session === request.session_id) {
        this.current_session = null
        this.active_sessions.delete(request.session_id)
      }
    }
  }

  /** Release all timers and session state. Safe to call repeatedly. */
  dispose (): void {
    this.disposed = true
    this.timers.forEach((timer) => clearTimeout(timer))
    this.timers.clear()
    this.active_sessions.clear()
    this.current_session = null
    this.in_flight = null
  }

  private is_bridge_error_code (value: string): boolean {
    const codes: AuthoringErrorCode[] = [
      'BAD_PROTOCOL', 'UNKNOWN_OPERATION', 'BAD_REQUEST', 'PAYLOAD_TOO_LARGE',
      'DEADLINE_EXCEEDED', 'DUPLICATE_REQUEST_ID', 'SESSION_CONFLICT',
      'RIG_UNAVAILABLE', 'RIG_MISMATCH', 'INVALID_DOCUMENT', 'PREVIEW_ACTIVE',
      'CONFIRMATION_REQUIRED', 'CONFIRMATION_DENIED', 'CONFIRMATION_EXPIRED',
      'COMMIT_FAILED', 'UNDO_FAILED', 'INTERNAL'
    ]
    return codes.includes(value as AuthoringErrorCode)
  }

  private dispatch (request: AuthoringRequest): Promise<Record<string, unknown>> {
    const operation: AuthoringOperation = request.operation
    switch (operation) {
      case 'rig.catalog.get': return this.handlers.rig_catalog_get()
      case 'draft.create': return this.handlers.draft_create(request.payload)
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
      default: return Promise.reject(new Error('UNKNOWN_OPERATION'))
    }
  }
}
