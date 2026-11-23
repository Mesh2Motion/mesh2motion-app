/**
 * M2M-028A — frontend side of authoring-bridge/v1.
 *
 * Contract: coordination/contracts/authoring-bridge-v1.md.
 * This module is data-only: no eval, no dynamic import, no filesystem access.
 */

import type { AnimationDocument } from '../animation-document/types'

export const AUTHORING_BRIDGE_PROTOCOL = 'authoring-bridge/v1' as const

export const BRIDGE_LIMITS = {
  max_request_bytes: 512 * 1024,
  max_id_length: 64,
  min_deadline_ms: 100,
  max_deadline_ms: 30000,
  max_sessions: 1
} as const

export type AuthoringOperation =
  | 'rig.catalog.get'
  | 'draft.create'
  | 'draft.validate'
  | 'draft.preview.start'
  | 'draft.preview.stop'
  | 'draft.commit'
  | 'draft.cancel'
  | 'draft.undo'
  | 'draft.export'
  | 'draft.import'
  | 'session.status'
  | 'session.cancel'

export const AUTHORING_OPERATIONS: readonly AuthoringOperation[] = [
  'rig.catalog.get', 'draft.create', 'draft.validate', 'draft.preview.start',
  'draft.preview.stop', 'draft.commit', 'draft.cancel', 'draft.undo',
  'draft.export', 'draft.import', 'session.status', 'session.cancel'
]

export type AuthoringErrorCode =
  | 'BAD_PROTOCOL'
  | 'UNKNOWN_OPERATION'
  | 'BAD_REQUEST'
  | 'PAYLOAD_TOO_LARGE'
  | 'DEADLINE_EXCEEDED'
  | 'DUPLICATE_REQUEST_ID'
  | 'SESSION_CONFLICT'
  | 'RIG_UNAVAILABLE'
  | 'RIG_MISMATCH'
  | 'INVALID_DOCUMENT'
  | 'PREVIEW_ACTIVE'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_DENIED'
  | 'CONFIRMATION_EXPIRED'
  | 'COMMIT_FAILED'
  | 'UNDO_FAILED'
  | 'INTERNAL'

export interface AuthoringRequest {
  protocol: typeof AUTHORING_BRIDGE_PROTOCOL
  request_id: string
  session_id: string
  deadline_ms: number
  operation: AuthoringOperation
  payload: Record<string, unknown>
}

export interface AuthoringError {
  code: AuthoringErrorCode
  message: string
}

export interface AuthoringResponse {
  protocol: typeof AUTHORING_BRIDGE_PROTOCOL
  request_id: string
  session_id: string
  ok: boolean
  result?: Record<string, unknown>
  error?: AuthoringError
}

export interface RigCatalogResult {
  rig: { identifier: string, fingerprint: string }
  bones: Array<{
    id: string
    display_name: string
    index: number
    parent_id: string | null
    local_position: [number, number, number]
    local_quaternion: [number, number, number, number]
    local_scale: [number, number, number]
  }>
}

export function is_authoring_request (value: unknown): value is AuthoringRequest {
  if (typeof value !== 'object' || value === null) return false
  const request = value as Record<string, unknown>
  return request.protocol === AUTHORING_BRIDGE_PROTOCOL &&
    typeof request.request_id === 'string' &&
    typeof request.session_id === 'string' &&
    typeof request.deadline_ms === 'number' &&
    typeof request.operation === 'string' &&
    (AUTHORING_OPERATIONS as readonly string[]).includes(request.operation) &&
    typeof request.payload === 'object' && request.payload !== null
}

export function is_animation_document (value: unknown): value is AnimationDocument {
  if (typeof value !== 'object' || value === null) return false
  const document = value as Record<string, unknown>
  return document.schema_version === 'animation-document/v1' &&
    typeof document.rig === 'object' && document.rig !== null &&
    Array.isArray(document.bones) && Array.isArray(document.channels) &&
    typeof document.clip === 'object' && document.clip !== null &&
    typeof document.revision === 'number'
}
