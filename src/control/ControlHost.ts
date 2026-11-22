/**
 * Pure, read-only observation source for the control interface.
 *
 * A host is supplied by the platform integration (or by tests). It never
 * mutates the application and never references Tauri/MCP types.
 */

import type {
  AnimationInfo,
  ApplicationPhase,
  PageValue,
  RendererGlInfo,
  RigInfo,
  SceneInfo
} from './contracts.ts'

export interface ControlObservation {
  page: PageValue
  version: string
  build: string
  diagnostics_enabled: boolean
  engine_attached: boolean
  first_frame_rendered: boolean
  has_loaded_model: boolean
  renderer_created: boolean
  context_lost: boolean
  render_loop_stopped: boolean
  render_failures: number
  canvas_width: number
  canvas_height: number
  gl?: RendererGlInfo
  rigs: readonly RigInfo[]
  animations: readonly AnimationInfo[]
  /** Null when no model/skeleton is loaded; never fabricate a scene. */
  scene: SceneInfo | null
  last_error?: string
  fatal?: boolean
  closed?: boolean
}

export interface ControlHost {
  /** Must be side-effect free and safe to call at any lifecycle point. */
  observe(): ControlObservation
}

/** Default observation used before a host is attached. */
export function empty_observation (): ControlObservation {
  return {
    page: 'unknown',
    version: 'unknown',
    build: 'unknown',
    diagnostics_enabled: false,
    engine_attached: false,
    first_frame_rendered: false,
    has_loaded_model: false,
    renderer_created: false,
    context_lost: false,
    render_loop_stopped: false,
    render_failures: 0,
    canvas_width: 0,
    canvas_height: 0,
    rigs: [],
    animations: [],
    scene: null
  }
}

export function derive_phase (
  observation: ControlObservation,
  session_closed: boolean = false
): ApplicationPhase {
  if (session_closed || observation.closed === true) {
    return 'closed'
  }
  if (observation.fatal === true) {
    return 'fatal'
  }
  if (!observation.engine_attached) {
    return 'uninitialized'
  }
  if (observation.context_lost || observation.render_loop_stopped) {
    return 'degraded'
  }
  if (observation.first_frame_rendered && observation.has_loaded_model) {
    return 'ready'
  }
  return 'loading'
}
