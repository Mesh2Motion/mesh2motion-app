/**
 * M2M-030A — optional Tauri transport adapter for pose observations.
 *
 * Transport names are PROVISIONAL in the shared contract and must be confirmed
 * by Codex. The callable service API never depends on this adapter, so a browser
 * or JSDOM caller can use the service directly.
 */

import type { ObservationView, PoseObservationRequest, PoseObservationResponse } from './types'

export const OBSERVATION_REQUEST_EVENT = 'm2m-pose-observation-request'
export const OBSERVATION_CANCEL_EVENT = 'm2m-pose-observation-cancel'
export const OBSERVATION_RESPOND_COMMAND = 'mcp_pose_observation_respond'
export const OBSERVATION_IMAGE_REQUEST_EVENT = 'm2m-pose-observation-image-request'
export const OBSERVATION_IMAGE_RESPOND_COMMAND = 'mcp_pose_observation_image_respond'
const MAX_IMAGE_CHUNK_BYTES = 32 * 1024
const OBSERVATION_VIEWS: readonly ObservationView[] = ['front', 'back', 'left', 'right', 'top', 'bottom']

export interface PoseImageChunkRequest {
  request_id: string
  session_id: string
  capture_id: string
  image_ref: string
  view: ObservationView
  offset: number
  max_bytes: number
}

export interface PoseImageChunkResponse {
  request_id: string
  session_id: string
  capture_id: string
  image_ref: string
  view: ObservationView
  offset: number
  mime?: string
  total_bytes?: number
  bytes_base64?: string
  error?: { code: 'BAD_REQUEST' | 'CAPTURE_EXPIRED' | 'CAPTURE_NOT_FOUND' | 'RESOURCE_LIMIT_EXCEEDED', message: string }
}

export interface CapturedImage {
  mime: string
  bytes: Uint8Array
}

interface TauriInternals {
  invoke?: (command: string, args: unknown) => Promise<unknown>
  transformCallback?: (handler: (event: { event: string, payload: unknown }) => void, once?: boolean) => number
}

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: TauriInternals
}

export interface TauriPoseObservationAdapter {
  dispose: () => Promise<void>
  listening: () => boolean
}

/** Installs listeners only when the real Tauri bridge is present. */
export async function attachTauriPoseObservationAdapter (
  handle: (request: unknown) => Promise<PoseObservationResponse>,
  handle_cancel: (payload: unknown) => void,
  get_capture_image: (capture_id: string, view: ObservationView) => CapturedImage | null
): Promise<TauriPoseObservationAdapter> {
  const internals = (window as TauriWindow).__TAURI_INTERNALS__
  if (internals?.invoke === undefined || internals.transformCallback === undefined) {
    return { dispose: async () => {}, listening: () => false }
  }
  const capture_sessions = new Map<string, string>()
  const request_handler = internals.transformCallback((event) => {
    const request = event.payload as Partial<PoseObservationRequest> | null
    void handle(event.payload).then((response) => {
      if (request?.operation === 'pose.capture' && response.ok &&
          typeof response.result === 'object' && response.result !== null &&
          typeof (response.result as { capture_id?: unknown }).capture_id === 'string') {
        capture_sessions.set((response.result as { capture_id: string }).capture_id, request.session_id ?? '')
      } else if ((request?.operation === 'pose.dispose' || request?.operation === 'pose.cancel') &&
          typeof request.payload === 'object' && request.payload !== null) {
        const capture_id = (request.payload as { capture_id?: unknown }).capture_id
        if (typeof capture_id === 'string') capture_sessions.delete(capture_id)
      }
      void internals.invoke?.(OBSERVATION_RESPOND_COMMAND, { response }).catch((error: unknown) => {
        console.error('M2M pose observation response acknowledgement failed', error)
      })
    })
  })
  const cancel_handler = internals.transformCallback((event) => {
    const payload = event.payload as { capture_id?: unknown, session_id?: unknown } | null
    if (payload !== null && typeof payload === 'object' && typeof payload.capture_id === 'string' &&
        (typeof payload.session_id !== 'string' || capture_sessions.get(payload.capture_id) === payload.session_id)) {
      capture_sessions.delete(payload.capture_id)
    }
    handle_cancel(event.payload)
  })
  const image_handler = internals.transformCallback((event) => {
    const request = validate_image_request(event.payload)
    if (request === null) return
    const response = image_chunk_response(request, capture_sessions, get_capture_image)
    void internals.invoke?.(OBSERVATION_IMAGE_RESPOND_COMMAND, { response }).catch((error: unknown) => {
      console.error('M2M pose observation image chunk acknowledgement failed', error)
    })
  })
  try {
    await internals.invoke('plugin:event|listen', {
      event: OBSERVATION_REQUEST_EVENT,
      target: { kind: 'Any' },
      handler: request_handler
    })
    await internals.invoke('plugin:event|listen', {
      event: OBSERVATION_CANCEL_EVENT,
      target: { kind: 'Any' },
      handler: cancel_handler
    })
    await internals.invoke('plugin:event|listen', {
      event: OBSERVATION_IMAGE_REQUEST_EVENT,
      target: { kind: 'Any' },
      handler: image_handler
    })
  } catch (error) {
    await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_REQUEST_EVENT, eventId: request_handler }).catch(() => {})
    await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_CANCEL_EVENT, eventId: cancel_handler }).catch(() => {})
    await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_IMAGE_REQUEST_EVENT, eventId: image_handler }).catch(() => {})
    throw error
  }
  let active = true
  return {
    listening: () => active,
    dispose: async () => {
      if (!active) return
      active = false
      await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_REQUEST_EVENT, eventId: request_handler })
      await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_CANCEL_EVENT, eventId: cancel_handler })
      await internals.invoke?.('plugin:event|unlisten', { event: OBSERVATION_IMAGE_REQUEST_EVENT, eventId: image_handler })
      capture_sessions.clear()
    }
  }
}

function validate_image_request (value: unknown): PoseImageChunkRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const request = value as Partial<PoseImageChunkRequest>
  if (typeof request.request_id !== 'string' || request.request_id.length < 1 || request.request_id.length > 64 ||
      typeof request.session_id !== 'string' || request.session_id.length < 1 || request.session_id.length > 64 ||
      typeof request.capture_id !== 'string' || request.capture_id.length < 1 || request.capture_id.length > 64 ||
      typeof request.view !== 'string' || !OBSERVATION_VIEWS.includes(request.view as ObservationView) ||
      request.image_ref !== `${request.capture_id}:${request.view}` ||
      !Number.isSafeInteger(request.offset) || (request.offset as number) < 0 ||
      !Number.isSafeInteger(request.max_bytes) || (request.max_bytes as number) < 1 ||
      (request.max_bytes as number) > MAX_IMAGE_CHUNK_BYTES ||
      (request.offset as number) + (request.max_bytes as number) > 1024 * 1024) return null
  return request as PoseImageChunkRequest
}

function image_chunk_response (
  request: PoseImageChunkRequest,
  sessions: Map<string, string>,
  get_capture_image: (capture_id: string, view: ObservationView) => CapturedImage | null
): PoseImageChunkResponse {
  const response: PoseImageChunkResponse = {
    request_id: request.request_id,
    session_id: request.session_id,
    capture_id: request.capture_id,
    image_ref: request.image_ref,
    view: request.view,
    offset: request.offset
  }
  const fail = (code: NonNullable<PoseImageChunkResponse['error']>['code'], message: string): PoseImageChunkResponse => ({
    ...response,
    error: { code, message }
  })
  if (sessions.get(request.capture_id) !== request.session_id) {
    return fail('CAPTURE_NOT_FOUND', 'capture does not belong to this authoring session')
  }
  const image = get_capture_image(request.capture_id, request.view)
  if (image === null) {
    sessions.delete(request.capture_id)
    return fail('CAPTURE_EXPIRED', 'capture image is no longer retained')
  }
  if ((image.mime !== 'image/png' && image.mime !== 'image/jpeg') || image.bytes.byteLength < 1 ||
      image.bytes.byteLength > (image.mime === 'image/png' ? 1024 * 1024 : 256 * 1024)) {
    return fail('RESOURCE_LIMIT_EXCEEDED', 'retained image metadata or byte length is invalid')
  }
  if (request.offset >= image.bytes.byteLength) return fail('BAD_REQUEST', 'image chunk offset is past the image end')
  const chunk = image.bytes.subarray(request.offset, Math.min(request.offset + request.max_bytes, image.bytes.byteLength))
  let binary = ''
  for (const byte of chunk) binary += String.fromCharCode(byte)
  return {
    ...response,
    mime: image.mime,
    total_bytes: image.bytes.byteLength,
    bytes_base64: btoa(binary)
  }
}
