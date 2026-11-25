/**
 * M2M-030A — mcp-pose-observation/v1 protocol types.
 *
 * The canonical contract is coordination/contracts/mcp-pose-observation-v1.md.
 * These types are the executable mirror. They describe internal-only observations
 * of ONE evaluated pose; no user-facing camera control is exposed anywhere.
 */

import type { AnimationDocument, AnimationKeyframe, AnimationProperty } from '../animation-document/types'

export const OBSERVATION_PROTOCOL = 'mcp-pose-observation/v1' as const

export const OBSERVATION_VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const
export type ObservationView = typeof OBSERVATION_VIEWS[number]

export const OBSERVATION_OPERATIONS = ['pose.capture', 'pose.cancel', 'pose.dispose', 'pose.status'] as const
export type ObservationOperation = typeof OBSERVATION_OPERATIONS[number]

export type ObservationProjection = 'orthographic' | 'perspective'
export type ImageMime = 'image/png' | 'image/jpeg'
export type OcclusionKind = 'none' | 'self' | 'other' | 'unknown'
export type OcclusionReason = 'off_frame' | 'behind_near' | 'beyond_far' | 'occluded' | 'no_geometry'

export const OBSERVATION_LIMITS = {
  min_dimension: 64,
  max_dimension: 1024,
  default_dimension: 512,
  max_views: 6,
  max_concurrent_captures: 1,
  max_retained_captures: 4,
  max_retained_image_bytes: 8 * 1024 * 1024,
  default_ttl_ms: 30000,
  max_frame_bytes: 256 * 1024,
  max_id_bytes: 64,
  min_deadline_ms: 100,
  max_deadline_ms: 30000,
  max_png_bytes: 1024 * 1024,
  max_jpeg_bytes: 256 * 1024,
  max_sequence: Number.MAX_SAFE_INTEGER
} as const

export const OBSERVATION_ERROR_CODES = [
  'BAD_PROTOCOL', 'UNKNOWN_OPERATION', 'BAD_REQUEST', 'PAYLOAD_TOO_LARGE', 'DEADLINE_EXCEEDED',
  'DUPLICATE_REQUEST_ID', 'SESSION_CONFLICT', 'RIG_UNAVAILABLE', 'RIG_MISMATCH', 'STALE_REVISION',
  'UNSUPPORTED_BONE', 'CAPTURE_CANCELLED', 'CAPTURE_EXPIRED', 'CAPTURE_NOT_FOUND',
  'RESOURCE_LIMIT_EXCEEDED', 'PREVIEW_ACTIVE', 'RENDER_FAILED', 'CONTEXT_LOST', 'INTERNAL'
] as const
export type ObservationErrorCode = typeof OBSERVATION_ERROR_CODES[number]

export interface ImageOptions {
  mime: ImageMime
  quality?: number
}

export interface OverlayOptions {
  bone_labels?: boolean
  skeleton?: boolean
}

export interface PoseCapturePayload {
  rig_fingerprint: string
  draft_id: string
  expected_revision: number
  timestamp_seconds: number
  views: ObservationView[]
  focus_bone_id?: string
  width?: number
  height?: number
  projection?: ObservationProjection
  image?: ImageOptions
  overlays?: OverlayOptions
  include_joints?: boolean
  max_image_bytes?: number
}

export interface PoseCancelPayload {
  capture_id?: string
  request_id?: string
}

export interface PoseDisposePayload {
  capture_id: string
}

export interface PoseObservationRequest {
  protocol: typeof OBSERVATION_PROTOCOL
  request_id: string
  session_id: string
  sequence: number
  deadline_ms: number
  operation: ObservationOperation
  payload: PoseCapturePayload | PoseCancelPayload | PoseDisposePayload | Record<string, never>
}

export interface ObservationErrorDetail {
  code: ObservationErrorCode
  message: string
}

export interface PoseObservationResponse {
  protocol: typeof OBSERVATION_PROTOCOL
  request_id: string
  session_id: string
  sequence: number
  ok: boolean
  result?: unknown
  error?: ObservationErrorDetail
}

export interface CameraMetadata {
  projection: ObservationProjection
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  near: number
  far: number
  left?: number
  right?: number
  top?: number
  bottom?: number
  fov_degrees?: number
  aspect?: number
  view_matrix: number[]
  projection_matrix: number[]
}

export interface ProjectedJoint {
  u: number
  v: number
  depth: number
  in_frame: boolean
  visible: boolean
  occlusion: OcclusionKind
  reason?: OcclusionReason
}

export interface JointObservation {
  bone_id: string
  display_name: string
  parent_id: string | null
  world_position: [number, number, number]
  local_position: [number, number, number]
  local_quaternion: [number, number, number, number]
  local_scale: [number, number, number]
  projected: ProjectedJoint
}

export interface ViewCapture {
  view: ObservationView
  mime: ImageMime
  image_bytes: number
  image_base64?: string
  image_ref?: string
  camera: CameraMetadata
  joints: JointObservation[]
}

export interface PoseCaptureResult {
  protocol_version: typeof OBSERVATION_PROTOCOL
  capture_id: string
  expires_at_ms: number
  rig: { identifier: string, fingerprint: string }
  draft_id: string
  revision: number
  timestamp_seconds: number
  pose_digest: string
  width: number
  height: number
  projection: ObservationProjection
  views: ViewCapture[]
}

export interface JointEdit {
  bone_id: string
  property: AnimationProperty
  keyframes: AnimationKeyframe[]
}

export interface EvaluatedJoint {
  index: number
  bone_id: string
  display_name: string
  parent_id: string | null
  local_position: [number, number, number]
  local_quaternion: [number, number, number, number]
  local_scale: [number, number, number]
  world_position: [number, number, number]
}

/** A snapshot of the authoritative document plus live rig identity used by one capture. */
export interface ObservationPoseSource {
  document: AnimationDocument
  skeleton: import('three').Skeleton
  rig_identifier: string
  fingerprint: string
}

export class ObservationError extends Error {
  constructor (public readonly code: ObservationErrorCode, message: string, cause?: unknown) {
    super(message)
    this.name = 'ObservationError'
    if (cause !== undefined) (this as Error & { cause?: unknown }).cause = cause
  }
}

export function is_observation_view (value: unknown): value is ObservationView {
  return typeof value === 'string' && (OBSERVATION_VIEWS as readonly string[]).includes(value)
}

export function utf8_byte_length (value: string): number {
  return new TextEncoder().encode(value).byteLength
}
