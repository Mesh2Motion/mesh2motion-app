/**
 * M2M-030A — pose observation service.
 *
 * One request evaluates the authoritative AnimationDocument at ONE timestamp and
 * renders the requested views from that single evaluated pose. The document is
 * the same one the GUI and the authoring bridge use: no second animation system,
 * no separate timeline source of truth.
 */

import { Vector3 } from 'three'
import { camera_metadata, bone_group_indices, compute_framing, create_observation_camera, project_joint } from './cameraGeometry'
import { OffscreenCapture, type CaptureHost, type EncodedImage, type PixelEncoder } from './capture'
import {
  apply_evaluated_pose,
  collect_joints,
  evaluate_document_at_time,
  pose_digest,
  type EvaluatedValue
} from './poseEvaluation'
import {
  OBSERVATION_LIMITS,
  OBSERVATION_OPERATIONS,
  OBSERVATION_PROTOCOL,
  OBSERVATION_VIEWS,
  ObservationError,
  utf8_byte_length,
  type JointObservation,
  type ObservationErrorCode,
  type ObservationPoseSource,
  type ObservationView,
  type PoseCapturePayload,
  type PoseCaptureResult,
  type PoseCancelPayload,
  type PoseDisposePayload,
  type PoseObservationRequest,
  type PoseObservationResponse,
  type ViewCapture
} from './types'

export interface ObservationEngine extends CaptureHost {
  camera?: import('three').PerspectiveCamera
  load_skeleton_step?: { skeleton_type? (): string }
}

export type PoseSourceProvider = () => ObservationPoseSource | null

export interface ObservationServiceOptions {
  engine: ObservationEngine
  source_provider: PoseSourceProvider
  encoder?: PixelEncoder
  now?: () => number
  make_id?: (prefix: string) => string
}

interface RetainedCapture {
  result: PoseCaptureResult
  images: Map<string, EncodedImage>
  created_at: number
  expires_at: number
  bytes: number
}

function default_make_id (prefix: string): string {
  return `${prefix}-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

function error_response (
  request: PoseObservationRequest,
  code: ObservationErrorCode,
  message: string
): PoseObservationResponse {
  return {
    protocol: OBSERVATION_PROTOCOL,
    request_id: request.request_id,
    session_id: request.session_id,
    sequence: request.sequence,
    ok: false,
    error: { code, message }
  }
}

function success_response (request: PoseObservationRequest, result: unknown): PoseObservationResponse {
  return {
    protocol: OBSERVATION_PROTOCOL,
    request_id: request.request_id,
    session_id: request.session_id,
    sequence: request.sequence,
    ok: true,
    result
  }
}

function is_plain_object (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Envelope validation mirroring authoring-bridge/v1 limits. */
function validate_request (value: unknown): PoseObservationRequest {
  if (!is_plain_object(value)) throw new ObservationError('BAD_PROTOCOL', 'request must be an object')
  const allowed = ['protocol', 'request_id', 'session_id', 'sequence', 'deadline_ms', 'operation', 'payload']
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ObservationError('BAD_PROTOCOL', `unknown envelope field "${key}"`)
  }
  const { protocol, request_id, session_id, sequence, deadline_ms, operation, payload } = value
  if (protocol !== OBSERVATION_PROTOCOL) throw new ObservationError('BAD_PROTOCOL', 'unsupported protocol')
  if (typeof request_id !== 'string' || utf8_byte_length(request_id) < 1 ||
      utf8_byte_length(request_id) > OBSERVATION_LIMITS.max_id_bytes) {
    throw new ObservationError('BAD_REQUEST', 'request_id must be 1..64 UTF-8 bytes')
  }
  if (typeof session_id !== 'string' || utf8_byte_length(session_id) < 1 ||
      utf8_byte_length(session_id) > OBSERVATION_LIMITS.max_id_bytes) {
    throw new ObservationError('BAD_REQUEST', 'session_id must be 1..64 UTF-8 bytes')
  }
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1 ||
      sequence > OBSERVATION_LIMITS.max_sequence) {
    throw new ObservationError('BAD_REQUEST', 'sequence must be a JSON-safe positive integer')
  }
  if (typeof deadline_ms !== 'number' || !Number.isSafeInteger(deadline_ms) ||
      deadline_ms < OBSERVATION_LIMITS.min_deadline_ms || deadline_ms > OBSERVATION_LIMITS.max_deadline_ms) {
    throw new ObservationError('BAD_REQUEST', 'deadline_ms must be 100..30000')
  }
  if (typeof operation !== 'string' || !(OBSERVATION_OPERATIONS as readonly string[]).includes(operation)) {
    throw new ObservationError('UNKNOWN_OPERATION', 'unsupported operation')
  }
  if (!is_plain_object(payload)) throw new ObservationError('BAD_REQUEST', 'payload must be an object')
  const request: PoseObservationRequest = {
    protocol: OBSERVATION_PROTOCOL,
    request_id,
    session_id,
    sequence,
    deadline_ms,
    operation: operation as PoseObservationRequest['operation'],
    payload: payload as PoseObservationRequest['payload']
  }
  if (utf8_byte_length(JSON.stringify(request)) > OBSERVATION_LIMITS.max_frame_bytes) {
    throw new ObservationError('PAYLOAD_TOO_LARGE', 'serialized request exceeds 256 KiB')
  }
  return request
}

function validate_capture_payload (value: unknown): PoseCapturePayload {
  if (!is_plain_object(value)) throw new ObservationError('BAD_REQUEST', 'capture payload must be an object')
  const {
    rig_fingerprint, draft_id, expected_revision, timestamp_seconds, views,
    focus_bone_id, width, height, projection, image, overlays, include_joints, max_image_bytes
  } = value
  if (typeof rig_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(rig_fingerprint)) {
    throw new ObservationError('RIG_MISMATCH', 'rig_fingerprint must be a 64-char lowercase SHA-256')
  }
  if (typeof draft_id !== 'string' || draft_id.length === 0 || draft_id.length > 64) {
    throw new ObservationError('BAD_REQUEST', 'draft_id must be 1..64 chars')
  }
  if (typeof expected_revision !== 'number' || !Number.isSafeInteger(expected_revision) || expected_revision < 1) {
    throw new ObservationError('STALE_REVISION', 'expected_revision must be a positive integer')
  }
  if (typeof timestamp_seconds !== 'number' || !Number.isFinite(timestamp_seconds) || timestamp_seconds < 0) {
    throw new ObservationError('BAD_REQUEST', 'timestamp_seconds must be finite and non-negative')
  }
  if (!Array.isArray(views) || views.length < 1 || views.length > OBSERVATION_LIMITS.max_views) {
    throw new ObservationError('BAD_REQUEST', 'views must contain 1..6 entries')
  }
  const seen = new Set<string>()
  for (const view of views) {
    if (typeof view !== 'string' || !(OBSERVATION_VIEWS as readonly string[]).includes(view)) {
      throw new ObservationError('BAD_REQUEST', `unsupported view ${String(view)}`)
    }
    if (seen.has(view)) throw new ObservationError('BAD_REQUEST', `duplicate view ${view}`)
    seen.add(view)
  }
  const dimension_ok = (item: unknown): boolean =>
    item === undefined || (typeof item === 'number' && Number.isInteger(item) &&
      item >= OBSERVATION_LIMITS.min_dimension && item <= OBSERVATION_LIMITS.max_dimension)
  if (!dimension_ok(width) || !dimension_ok(height)) {
    throw new ObservationError('BAD_REQUEST', 'capture dimensions must be 64..1024')
  }
  if (projection !== undefined && projection !== 'orthographic' && projection !== 'perspective') {
    throw new ObservationError('BAD_REQUEST', 'unsupported projection')
  }
  if (image !== undefined && !is_plain_object(image)) throw new ObservationError('BAD_REQUEST', 'invalid image options')
  const image_options = image as Record<string, unknown> | undefined
  if (image_options !== undefined && image_options.mime !== 'image/png' && image_options.mime !== 'image/jpeg') {
    throw new ObservationError('BAD_REQUEST', 'image mime must be image/png or image/jpeg')
  }
  if (max_image_bytes !== undefined && (typeof max_image_bytes !== 'number' || max_image_bytes < 1)) {
    throw new ObservationError('BAD_REQUEST', 'max_image_bytes must be positive')
  }
  return {
    rig_fingerprint,
    draft_id,
    expected_revision,
    timestamp_seconds,
    views: views as ObservationView[],
    focus_bone_id: typeof focus_bone_id === 'string' ? focus_bone_id : undefined,
    width: width as number | undefined,
    height: height as number | undefined,
    projection: projection as PoseCapturePayload['projection'],
    image: image_options as PoseCapturePayload['image'],
    overlays: overlays as PoseCapturePayload['overlays'],
    include_joints: include_joints !== false,
    max_image_bytes: max_image_bytes as number | undefined
  }
}

/**
 * The service is the single entry point for MCP pose observations. Codex owns
 * the transport; this object owns rendering, framing and pose identity.
 */
export class PoseObservationService {
  private readonly source_provider: PoseSourceProvider
  private readonly capture_renderer: OffscreenCapture
  private readonly now: () => number
  private readonly make_id: (prefix: string) => string
  private readonly retained: RetainedCapture[] = []
  private readonly seen_ids = new Set<string>()
  private readonly last_sequence = new Map<string, number>()
  private in_flight: string | null = null
  private disposed = false
  private request_counter = 0

  constructor (options: ObservationServiceOptions) {
    this.source_provider = options.source_provider
    this.now = options.now ?? (() => Date.now())
    this.make_id = options.make_id ?? default_make_id
    this.capture_renderer = new OffscreenCapture(options.engine, options.encoder)
  }

  /** Total retained bytes, exposed for diagnostics/tests. */
  retained_bytes (): number {
    return this.retained.reduce((sum, entry) => sum + entry.bytes, 0)
  }

  is_busy (): boolean {
    return this.in_flight !== null
  }

  async handle (value: unknown): Promise<PoseObservationResponse> {
    let request: PoseObservationRequest
    try {
      request = validate_request(value)
    } catch (error) {
      const failure = error instanceof ObservationError
        ? error
        : new ObservationError('BAD_PROTOCOL', error instanceof Error ? error.message : String(error))
      // Without a valid envelope there is nothing safe to echo.
      const partial = is_plain_object(value) ? value : {}
      return error_response({
        protocol: OBSERVATION_PROTOCOL,
        request_id: typeof partial.request_id === 'string' ? partial.request_id : '',
        session_id: typeof partial.session_id === 'string' ? partial.session_id : '',
        sequence: typeof partial.sequence === 'number' ? partial.sequence : 0,
        deadline_ms: 0,
        operation: 'pose.status',
        payload: {}
      }, failure.code, failure.message)
    }
    if (this.disposed) return error_response(request, 'INTERNAL', 'observation service is disposed')
    if (this.seen_ids.has(request.request_id)) {
      return error_response(request, 'DUPLICATE_REQUEST_ID', 'request_id was already used')
    }
    if (this.seen_ids.size >= 4096) {
      return error_response(request, 'SESSION_CONFLICT', 'request ID retention limit reached')
    }
    const last = this.last_sequence.get(request.session_id) ?? 0
    if (request.sequence <= last) {
      return error_response(request, 'BAD_REQUEST', 'sequence must strictly increase per session')
    }
    this.seen_ids.add(request.request_id)
    this.last_sequence.set(request.session_id, request.sequence)

    try {
      switch (request.operation) {
        case 'pose.capture':
          return success_response(request, await this.capture(request))
        case 'pose.cancel': {
          const payload = request.payload as PoseCancelPayload
          const cancelled = this.cancel(payload.capture_id ?? payload.request_id)
          return success_response(request, { cancelled })
        }
        case 'pose.dispose': {
          const payload = request.payload as PoseDisposePayload
          this.dispose_capture(payload.capture_id)
          return success_response(request, { disposed: true })
        }
        case 'pose.status':
          return success_response(request, {
            busy: this.is_busy(),
            retained_captures: this.retained.length,
            retained_bytes: this.retained_bytes(),
            rig_fingerprint: this.source_provider()?.fingerprint ?? null
          })
      }
    } catch (error) {
      const failure = error instanceof ObservationError
        ? error
        : new ObservationError('INTERNAL', error instanceof Error ? error.message : String(error), error)
      return error_response(request, failure.code, failure.message)
    }
  }

  /** Alias used by transport adapters and GUI callers. */
  capturePose (request: unknown): Promise<PoseObservationResponse> {
    return this.handle(request)
  }

  private capture (request: PoseObservationRequest): PoseCaptureResult {
    if (this.in_flight !== null) throw new ObservationError('RESOURCE_LIMIT_EXCEEDED', 'another capture is in flight')
    const payload = validate_capture_payload(request.payload)
    const deadline_at = this.now() + request.deadline_ms
    this.in_flight = request.request_id
    try {
      const source = this.source_provider()
      if (source === null) throw new ObservationError('RIG_UNAVAILABLE', 'no live supported rig is loaded')
      if (source.fingerprint !== payload.rig_fingerprint) {
        throw new ObservationError('RIG_MISMATCH', 'live rig fingerprint does not match the request')
      }
      if (source.document.revision !== payload.expected_revision) {
        throw new ObservationError('STALE_REVISION',
          `expected revision ${payload.expected_revision}, current ${source.document.revision}`)
      }
      if (payload.timestamp_seconds > source.document.clip.duration_seconds) {
        throw new ObservationError('BAD_REQUEST', 'timestamp exceeds the draft clip duration')
      }

      const evaluated = evaluate_document_at_time(source.document, payload.timestamp_seconds)
      const focus_indices = this.resolve_focus(source, payload.focus_bone_id)
      // One pose, evaluated once. The synchronous transaction below has no await
      // boundary, so the application's render loop cannot advance playback.
      const pose = apply_evaluated_pose(source.skeleton, evaluated)
      try {
        const digest = pose_digest(evaluated)
        const width = payload.width ?? OBSERVATION_LIMITS.default_dimension
        const height = payload.height ?? OBSERVATION_LIMITS.default_dimension
        const projection = payload.projection ?? 'orthographic'
        const mime = payload.image?.mime ?? 'image/png'
        const quality = payload.image?.quality ?? 0.85
        const capture_id = this.make_id('capture')
        const images = new Map<string, EncodedImage>()
        const views: ViewCapture[] = []

        for (const view of payload.views) {
          if (this.now() >= deadline_at) throw new ObservationError('DEADLINE_EXCEEDED', 'capture deadline exceeded')
          const framing = compute_framing(source.skeleton, width, height, focus_indices)
          if (framing === null) throw new ObservationError('RIG_UNAVAILABLE', 'live rig has no measurable bones')
          const camera = create_observation_camera({ view, framing, width, height, projection })
          const metadata = camera_metadata(camera, projection)
          const joints: JointObservation[] = []
          if (payload.include_joints !== false) {
            for (const joint of collect_joints(source, evaluated)) {
              const occlusion = this.capture_renderer.occlusion_for(
                { ...joint, world_position: joint.world_position }, camera
              )
              const reason = occlusion === 'self' ? 'occluded' : occlusion === 'unknown' ? 'no_geometry' : undefined
              const projected = project_joint(
                new Vector3(joint.world_position[0], joint.world_position[1], joint.world_position[2]),
                camera, occlusion, reason
              )
              joints.push({ ...joint, projected })
            }
          }
          const encoded = this.capture_renderer.render(camera, width, height, mime, quality,
            joints.length > 0 ? { joints, options: payload.overlays ?? {} } : null)
          const ceiling = Math.min(payload.max_image_bytes ?? Number.MAX_SAFE_INTEGER,
            mime === 'image/png' ? OBSERVATION_LIMITS.max_png_bytes : OBSERVATION_LIMITS.max_jpeg_bytes)
          if (encoded.bytes.byteLength > ceiling) {
            throw new ObservationError('RESOURCE_LIMIT_EXCEEDED', 'encoded image exceeds the byte ceiling')
          }
          const image_ref = `${capture_id}:${view}`
          images.set(image_ref, encoded)
          const view_capture: ViewCapture = {
            view,
            mime: encoded.mime,
            image_bytes: encoded.bytes.byteLength,
            image_ref,
            camera: metadata,
            joints
          }
          if (encoded.bytes.byteLength <= 64 * 1024) {
            view_capture.image_base64 = this.base64(encoded.bytes)
          }
          views.push(view_capture)
        }

        const expires_at_ms = this.now() + OBSERVATION_LIMITS.default_ttl_ms
        const bytes = [...images.values()].reduce((sum, image) => sum + image.bytes.byteLength, 0)
        const result: PoseCaptureResult = {
          protocol_version: OBSERVATION_PROTOCOL,
          capture_id,
          expires_at_ms,
          rig: { identifier: source.rig_identifier, fingerprint: source.fingerprint },
          draft_id: payload.draft_id,
          revision: source.document.revision,
          timestamp_seconds: payload.timestamp_seconds,
          pose_digest: digest,
          width,
          height,
          projection,
          views
        }
        this.retained.push({ result, images, created_at: this.now(), expires_at: expires_at_ms, bytes })
        this.prune()
        this.request_counter++
        return result
      } finally {
        pose.restore()
      }
    } finally {
      this.in_flight = null
    }
  }

  private resolve_focus (source: ObservationPoseSource, focus_bone_id: string | undefined): number[] | undefined {
    if (focus_bone_id === undefined) return undefined
    const direct = source.document.bones.find((bone) => bone.id === focus_bone_id)
    if (direct !== undefined) return bone_group_indices(source.skeleton, direct.index)
    const alias = focus_bone_id.split(':').pop() ?? ''
    const group_patterns: Record<string, RegExp> = {
      hand: /hand/i,
      foot: /foot/i,
      finger: /finger/i,
      head: /head/i,
      pelvis: /pelvis|hips/i
    }
    const pattern = group_patterns[alias.toLowerCase()]
    const bone = pattern === undefined
      ? undefined
      : source.document.bones.find((entry) => pattern.test(entry.display_name))
    if (bone === undefined) {
      throw new ObservationError('UNSUPPORTED_BONE',
        `focus bone or joint group "${focus_bone_id}" is not supported by this rig`,
        source.document.bones.map((entry) => entry.id))
    }
    return bone_group_indices(source.skeleton, bone.index)
  }

  private base64 (bytes: Uint8Array): string {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }

  private prune (): void {
    const now = this.now()
    for (let index = this.retained.length - 1; index >= 0; index--) {
      if (this.retained[index].expires_at <= now) this.retained.splice(index, 1)
    }
    while (this.retained.length > OBSERVATION_LIMITS.max_retained_captures ||
           this.retained_bytes() > OBSERVATION_LIMITS.max_retained_image_bytes) {
      this.retained.shift()
    }
  }

  getCaptureImage (capture_id: string, view: ObservationView): { mime: string, bytes: Uint8Array } | null {
    const entry = this.retained.find((item) => item.result.capture_id === capture_id)
    if (entry === undefined) return null
    if (entry.expires_at <= this.now()) {
      this.dispose_capture(capture_id)
      return null
    }
    const image = entry.images.get(`${capture_id}:${view}`)
    return image === undefined ? null : { mime: image.mime, bytes: image.bytes.slice() }
  }

  getJointProjection (capture_id: string, view: ObservationView): JointObservation[] | null {
    const entry = this.retained.find((item) => item.result.capture_id === capture_id)
    if (entry === undefined || entry.expires_at <= this.now()) return null
    return entry.result.views.find((item) => item.view === view)?.joints ?? null
  }

  cancel (id: string | undefined): boolean {
    if (id === undefined) return false
    if (this.in_flight === id) {
      // The capture transaction is synchronous; cancellation takes effect at
      // the next request boundary. No partial image is retained.
      return true
    }
    const before = this.retained.length
    this.dispose_capture(id)
    return this.retained.length < before
  }

  dispose_capture (capture_id: string): void {
    const index = this.retained.findIndex((item) => item.result.capture_id === capture_id)
    if (index >= 0) this.retained.splice(index, 1)
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.retained.length = 0
    this.capture_renderer.dispose()
  }
}

/** Single module-level service instance; set up by attachObservation(). */
let active_service: PoseObservationService | null = null

export function set_pose_observation_service (service: PoseObservationService | null): void {
  active_service = service
}

export function get_pose_observation_service (): PoseObservationService | null {
  return active_service
}
