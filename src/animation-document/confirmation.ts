/**
 * M2M-025B — native confirmation contract for application-owned mutations.
 *
 * This is a pure TypeScript contract. Codex will later supply the bridge that
 * forwards a request to the Tauri/native side and returns the user's decision.
 * No Rust or MCP server file is defined or modified here.
 */

import type { AnimationDocument } from './types'

export const NATIVE_CONFIRMATION_SCHEMA = 'native-confirmation/v1' as const

export type AnimationDocumentOperation = 'commit' | 'undo'

export interface NativeConfirmationRequest {
  schema_version: typeof NATIVE_CONFIRMATION_SCHEMA
  request_id: string
  operation: AnimationDocumentOperation
  clip_name: string
  /** Revision that the operation would create. */
  proposed_revision: number
  /** Undo target revision; null for a commit. */
  target_revision: number | null
  reason: 'application-owned-animation-mutation'
  created_at_utc: string
}

/** M2M-028B — immutable binding returned with an approval acknowledgement. */
export interface ConfirmationBinding {
  request_id: string
  session_id: string
  operation: 'commit' | 'undo'
  /** Fingerprint of the live rig the approval was requested against. */
  rig_fingerprint: string
  revision: number
  /** SHA-256 of the serialized document the approval applies to. */
  document_digest: string
  /** Undo only: revision being restored. */
  target_revision: number | null
}

export interface NativeConfirmationResult {
  schema_version: typeof NATIVE_CONFIRMATION_SCHEMA
  request_id: string
  approved: boolean
  decided_by: 'user'
  decided_at_utc: string | null
  rejection_reason?: string
  /** Present only when a native panel click produced this result. */
  binding?: ConfirmationBinding
}

/**
 * Implemented by the application (later: Codex's MCP/native bridge).
 * The request must be shown to the user; an auto-approving implementation is
 * not a valid native confirmation.
 */
export interface NativeConfirmationBridge {
  request_confirmation (request: NativeConfirmationRequest): Promise<NativeConfirmationResult>
}

let request_counter = 0

export function create_confirmation_request (
  operation: AnimationDocumentOperation,
  document: AnimationDocument,
  proposed_revision: number,
  target_revision: number | null = null
): NativeConfirmationRequest {
  request_counter += 1
  return {
    schema_version: NATIVE_CONFIRMATION_SCHEMA,
    request_id: `m2m025b-${request_counter}`,
    operation,
    clip_name: document.clip.name,
    proposed_revision,
    target_revision,
    reason: 'application-owned-animation-mutation',
    created_at_utc: new Date().toISOString()
  }
}

/** Test/demo bridge that always denies; never use in production. */
export class DenyConfirmationBridge implements NativeConfirmationBridge {
  async request_confirmation (request: NativeConfirmationRequest): Promise<NativeConfirmationResult> {
    return {
      schema_version: NATIVE_CONFIRMATION_SCHEMA,
      request_id: request.request_id,
      approved: false,
      decided_by: 'user',
      decided_at_utc: new Date().toISOString(),
      rejection_reason: 'denied by DenyConfirmationBridge'
    }
  }
}
