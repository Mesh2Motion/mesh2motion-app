/**
 * Versioned, platform-neutral contracts for read-only application inspection.
 *
 * This module has NO imports from the animation engine, Tauri, or any MCP
 * library. It is safe to use in web builds; it only defines data shapes.
 */

/** Bump only with a coordinated frontend/Rust schema change. */
export const CONTROL_SCHEMA_VERSION = '1.0' as const

export type SkeletonTypeValue =
  | 'human' | 'fox' | 'bird' | 'dragon' | 'kaiju'
  | 'spider' | 'snake' | 'fish' | 'horse' | 'error' | 'none'

export type ProcessStepValue =
  | 'load-model' | 'load-skeleton' | 'edit-skeleton' | 'weight-skin'
  | 'animations-export' | 'export-to-file' | 'BindPose'

/** v1.0-compatible additive value for the upstream Remix/Composer page. */
export type PageValue = 'explore' | 'create' | 'retarget' | 'remix' | 'preview-generator' | 'unknown'
export type AnimationSourceValue = 'default-library' | 'custom-import'
export type ApplicationPhase = 'uninitialized' | 'loading' | 'ready' | 'degraded' | 'fatal' | 'closed'

/** Stable error codes shared with the Rust/MCP bridge (see MCP-001 §7). */
export const CONTROL_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
  INVALID_PARAMS: 'INVALID_PARAMS',
  STATE_UNAVAILABLE: 'STATE_UNAVAILABLE',
  NOT_READY: 'NOT_READY',
  STALE_STATE: 'STALE_STATE',
  ENGINE_FATAL: 'ENGINE_FATAL',
  RENDER_LOOP_STOPPED: 'RENDER_LOOP_STOPPED',
  UNSUPPORTED_CAPABILITY: 'UNSUPPORTED_CAPABILITY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const

export type ControlErrorCode = typeof CONTROL_ERROR_CODES[keyof typeof CONTROL_ERROR_CODES]

export interface ControlErrorDetails {
  phase?: ApplicationPhase
  command?: ControlCommand
  snapshot_age_ms?: number
  reason?: string
}

export interface ControlError {
  code: ControlErrorCode
  message: string
  retryable: boolean
  details?: ControlErrorDetails
}

export interface SnapshotMeta {
  schema_version: typeof CONTROL_SCHEMA_VERSION
  sequence: number
  captured_at: string
  /** Frontend reports 0; the server recomputes age from captured_at. */
  age_ms: number
}

export interface ApplicationInfo {
  phase: ApplicationPhase
  page: PageValue
  version: string
  build: string
  uptime_ms: number
  diagnostics_enabled: boolean
  last_error?: string
}

export interface RendererGlInfo {
  vendor?: string
  renderer?: string
  version?: string
}

export interface RendererInfo {
  created: boolean
  context_lost: boolean
  loop: { active: boolean, stopped: boolean, consecutive_failures: number }
  canvas: { width: number, height: number }
  /** Omitted unless actually measured; never fabricated by the frontend. */
  gl?: RendererGlInfo
  last_error?: string
}

export interface RigInfo {
  key: SkeletonTypeValue
  display_name: string
  /** Relative bundle keys, never absolute filesystem paths. */
  model_asset: string
  rig_asset: string
  animation_assets: readonly string[]
}

export interface AnimationInfo {
  index: number
  name: string
  duration_s: number
  track_count: number
  source_type: AnimationSourceValue
  tags: readonly string[]
  rig?: SkeletonTypeValue
  origin: 'loaded' | 'manifest'
}

export interface SceneInfo {
  process_step: ProcessStepValue
  model: { loaded: boolean, mesh_count: number, vertex_count: number, triangle_count: number }
  skeleton: {
    loaded: boolean
    type: SkeletonTypeValue
    bone_count: number
    root_name?: string
    truncated?: boolean
  }
  animations: { loaded_count: number, active_index?: number }
  camera: { position: [number, number, number] }
  object_count: number
}

export interface ControlSnapshot {
  meta: SnapshotMeta
  application: ApplicationInfo
  renderer: RendererInfo
  rigs: readonly RigInfo[]
  animations: readonly AnimationInfo[]
  scene: SceneInfo
}

/** Discriminated read-only request union. `kind` maps to MCP tool `name`. */
export type ControlRequest =
  | { readonly kind: 'application_get_status', readonly params?: { readonly includeDiagnostics?: boolean } }
  | { readonly kind: 'renderer_get_state' }
  | { readonly kind: 'rigs_list', readonly params?: { readonly includeAssetPaths?: boolean } }
  | {
      readonly kind: 'animations_list'
      readonly params?: {
        readonly rig?: SkeletonTypeValue
        readonly includeCustom?: boolean
        readonly includeManifest?: boolean
      }
    }
  | {
      readonly kind: 'scene_inspect'
      readonly params?: { readonly includeCounts?: boolean, readonly maxBones?: number }
    }

export type ControlCommand = ControlRequest['kind']

/** Tool availability by lifecycle phase (MCP-001 §3). */
export const TOOL_ALLOWED_PHASES: Readonly<Record<ControlCommand, readonly ApplicationPhase[]>> = {
  application_get_status: ['uninitialized', 'loading', 'ready', 'degraded', 'fatal', 'closed'],
  renderer_get_state: ['loading', 'ready', 'degraded', 'fatal'],
  rigs_list: ['loading', 'ready', 'degraded'],
  animations_list: ['ready', 'degraded'],
  scene_inspect: ['ready', 'degraded']
}

export interface ApplicationStatusData extends ApplicationInfo {
  snapshot: { sequence: number, captured_at: string, age_ms: number }
  /** Empty until a marker ring is provided; never enables diagnostics. */
  last_markers?: readonly string[]
}

export interface RigsListData {
  rigs: readonly RigInfo[]
  count: number
}

export interface AnimationsListData {
  animations: readonly AnimationInfo[]
  count: number
}

export interface ControlResponseMap {
  application_get_status: ApplicationStatusData
  renderer_get_state: RendererInfo
  rigs_list: RigsListData
  animations_list: AnimationsListData
  scene_inspect: SceneInfo
}

export type ControlResponseData = ControlResponseMap[ControlCommand]

export type ControlResult<T> =
  | { readonly ok: true, readonly data: T, readonly meta: SnapshotMeta }
  | { readonly ok: false, readonly error: ControlError, readonly meta?: SnapshotMeta }
