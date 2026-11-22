/**
 * Read-only host adapter for the already-constructed Mesh2MotionEngine.
 *
 * It uses a structural interface (no import of Mesh2MotionEngine or Three.js)
 * and only calls public getters. A test can pass a small mock with the same
 * shape; the real engine satisfies it without any engine refactoring.
 */

import { RigConfig } from '../lib/RigConfig.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { startup_debug_enabled } from '../lib/StartupDiagnostics.ts'
import { ControlHost, ControlObservation } from './ControlHost.ts'
import {
  AnimationInfo,
  AnimationSourceValue,
  PageValue,
  ProcessStepValue,
  RigInfo,
  SceneInfo,
  SkeletonTypeValue
} from './contracts.ts'

interface Vector3Like { x: number, y: number, z: number }
interface Object3DContainerLike { children: readonly unknown[] }
interface CanvasLike { width: number, height: number }
interface RendererLike { domElement: CanvasLike }
interface MeshStepLike {
  vertex_count: number
  triangle_count: number
  model_meshes(): Object3DContainerLike
}
interface AnimationEntryLike {
  name: string
  state: string
  metadata: { source_type: string, tags: readonly string[] }
  clip_pair: { display_animation_clip: { duration: number, tracks: readonly unknown[] } } | null
}
interface AnimationStepLike {
  /** Additive read-only getter on upstream StepAnimationsListing. */
  loaded_animation_entries(): readonly AnimationEntryLike[]
}
interface SkeletonLike { bones: readonly { name: string }[] }
interface SkeletonStepLike { skeleton_type(): string }
interface EditStepLike { skeleton(): SkeletonLike }
interface EngineStateLike {
  first_frame_rendered: boolean
  context_lost: boolean
  render_loop_stopped: boolean
  render_failures: number
}

/** Minimal structural shape required from the application engine. */
export interface EngineLike {
  renderer: RendererLike
  camera: { position: Vector3Like }
  scene: Object3DContainerLike
  process_step: string
  load_model_step: MeshStepLike
  load_skeleton_step: SkeletonStepLike
  edit_skeleton_step: EditStepLike
  animations_listing_step: AnimationStepLike
  control_state(): EngineStateLike
}

export interface EngineHostOptions {
  page?: PageValue
  version?: string
  build?: string
  diagnostics_enabled?: boolean
  fatal?: boolean
  closed?: boolean
}

const SKELETON_TYPES: readonly SkeletonTypeValue[] = [
  'human', 'fox', 'bird', 'dragon', 'kaiju', 'spider', 'snake', 'fish', 'horse', 'error', 'none'
]

function as_skeleton_type (value: string): SkeletonTypeValue {
  return SKELETON_TYPES.includes(value as SkeletonTypeValue) ? value as SkeletonTypeValue : 'none'
}

function as_process_step (value: string): ProcessStepValue {
  const allowed: readonly string[] = [
    'load-model', 'load-skeleton', 'edit-skeleton', 'weight-skin',
    'animations-export', 'export-to-file', 'BindPose'
  ]
  return allowed.includes(value) ? value as ProcessStepValue : 'load-model'
}

function as_source_type (value: string | undefined): AnimationSourceValue {
  return value === 'custom-import' ? 'custom-import' : 'default-library'
}

function fatal_panel_text (): string | undefined {
  try {
    if (typeof document === 'undefined') {
      return undefined
    }
    const panel = document.getElementById('m2m-startup-error')
    return panel === null ? undefined : (panel.textContent ?? 'startup failure')
  } catch {
    return undefined
  }
}

export class EngineControlHost implements ControlHost {
  constructor (private readonly engine: EngineLike, private readonly options: EngineHostOptions = {}) {}

  public observe (): ControlObservation {
    const engine = this.engine
    const state = engine.control_state()
    const skeleton_type = as_skeleton_type(engine.load_skeleton_step.skeleton_type())
    const has_model = engine.load_model_step.vertex_count > 0
    const loaded_animations = this.loaded_animations(skeleton_type)
    const rigs: readonly RigInfo[] = RigConfig.all.map(rig => ({
      key: as_skeleton_type(rig.skeleton_type),
      display_name: rig.rig_display_name,
      model_asset: rig.model_file,
      rig_asset: rig.rig_file,
      animation_assets: rig.animations.map(animation => animation.file)
    }))
    const scene: SceneInfo = {
      process_step: as_process_step(engine.process_step),
      model: {
        loaded: has_model,
        mesh_count: has_model ? engine.load_model_step.model_meshes().children.length : 0,
        vertex_count: engine.load_model_step.vertex_count,
        triangle_count: engine.load_model_step.triangle_count
      },
      skeleton: {
        loaded: skeleton_type !== 'none',
        type: skeleton_type,
        bone_count: engine.edit_skeleton_step.skeleton().bones.length,
        root_name: engine.edit_skeleton_step.skeleton().bones[0]?.name
      },
      animations: {
        loaded_count: loaded_animations.length,
        active_index: loaded_animations.length > 0 ? 0 : undefined
      },
      camera: {
        position: [engine.camera.position.x, engine.camera.position.y, engine.camera.position.z]
      },
      object_count: engine.scene.children.length
    }
    const panel_text = fatal_panel_text()
    const fatal = this.options.fatal ?? (panel_text !== undefined)

    return {
      page: this.options.page ?? 'unknown',
      version: this.options.version ?? 'unknown',
      build: this.options.build ?? 'unknown',
      diagnostics_enabled: this.options.diagnostics_enabled ?? startup_debug_enabled(),
      engine_attached: true,
      first_frame_rendered: state.first_frame_rendered,
      has_loaded_model: has_model,
      renderer_created: true,
      context_lost: state.context_lost,
      render_loop_stopped: state.render_loop_stopped,
      render_failures: state.render_failures,
      canvas_width: engine.renderer.domElement.width,
      canvas_height: engine.renderer.domElement.height,
      animations: [...loaded_animations, ...this.manifest_animations(skeleton_type)],
      rigs,
      scene: has_model ? scene : null,
      last_error: fatal ? (panel_text ?? 'startup failure') : undefined,
      fatal,
      closed: this.options.closed
    }
  }

  private loaded_animations (rig: SkeletonTypeValue): readonly AnimationInfo[] {
    return this.engine.animations_listing_step.loaded_animation_entries().map((entry, index) => ({
      index,
      name: entry.name,
      duration_s: entry.clip_pair?.display_animation_clip.duration ?? 0,
      track_count: entry.clip_pair?.display_animation_clip.tracks.length ?? 0,
      source_type: as_source_type(entry.metadata.source_type),
      tags: entry.metadata.tags,
      rig,
      origin: 'loaded'
    }))
  }

  private manifest_animations (rig: SkeletonTypeValue): readonly AnimationInfo[] {
    if (rig === 'none') {
      return []
    }
    // Upstream now exposes per-animation manifest entries via animations_for().
    return RigConfig.animations_for(rig as SkeletonType).map((animation, index) => ({
      index,
      name: animation.name,
      duration_s: animation.duration,
      track_count: 0, // manifest entries do not expose track counts
      source_type: 'default-library',
      tags: animation.tags,
      rig,
      origin: 'manifest'
    }))
  }
}

/** Factory for platform integration and tests. */
export function create_engine_control_host (
  engine: EngineLike,
  options?: EngineHostOptions
): ControlHost {
  return new EngineControlHost(engine, options)
}
