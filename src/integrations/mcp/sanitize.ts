/**
 * Defensive sanitizer for published control snapshots.
 *
 * The control contract is read-only and data-minimizing: asset identifiers are
 * relative bundle keys and no absolute filesystem path may leave the webview.
 * Sanitization never changes the schema version and never fabricates values.
 */

import { CONTROL_SCHEMA_VERSION, ControlSnapshot } from './contracts.ts'

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /^file:/i,
  /^\\\\/,
  /^[A-Za-z]:\\/,
  /^\//,
  /~[/\\]/,
  /\/home\//i,
  /\/Users\//i,
  /\/root\//i,
  /C:\\Users\\/i
]

export const REDACTED = '[redacted]'

function redact (value: string): string {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(value)) ? REDACTED : value
}

function redact_optional (value: string | undefined): string | undefined {
  return value === undefined ? undefined : redact(value)
}

/** Return a deep-copied snapshot with every string checked for path leakage. */
export function sanitize_snapshot (snapshot: ControlSnapshot): ControlSnapshot {
  return {
    meta: {
      schema_version: CONTROL_SCHEMA_VERSION,
      sequence: snapshot.meta.sequence,
      captured_at: snapshot.meta.captured_at,
      age_ms: snapshot.meta.age_ms
    },
    application: {
      phase: snapshot.application.phase,
      page: snapshot.application.page,
      version: redact(snapshot.application.version),
      build: redact(snapshot.application.build),
      uptime_ms: snapshot.application.uptime_ms,
      diagnostics_enabled: snapshot.application.diagnostics_enabled,
      ...(snapshot.application.phase_inputs === undefined
        ? {}
        : { phase_inputs: snapshot.application.phase_inputs }),
      ...(snapshot.application.last_error === undefined
        ? {}
        : { last_error: redact(snapshot.application.last_error) })
    },
    renderer: {
      created: snapshot.renderer.created,
      context_lost: snapshot.renderer.context_lost,
      loop: {
        active: snapshot.renderer.loop.active,
        stopped: snapshot.renderer.loop.stopped,
        consecutive_failures: snapshot.renderer.loop.consecutive_failures
      },
      canvas: {
        width: snapshot.renderer.canvas.width,
        height: snapshot.renderer.canvas.height
      },
      ...(snapshot.renderer.gl === undefined
        ? {}
        : {
            gl: {
              ...(snapshot.renderer.gl.vendor === undefined ? {} : { vendor: redact(snapshot.renderer.gl.vendor) }),
              ...(snapshot.renderer.gl.renderer === undefined ? {} : { renderer: redact(snapshot.renderer.gl.renderer) }),
              ...(snapshot.renderer.gl.version === undefined ? {} : { version: redact(snapshot.renderer.gl.version) })
            }
          }),
      ...(snapshot.renderer.last_error === undefined
        ? {}
        : { last_error: redact(snapshot.renderer.last_error) })
    },
    rigs: snapshot.rigs.map(rig => ({
      key: rig.key,
      display_name: redact(rig.display_name),
      model_asset: redact(rig.model_asset),
      rig_asset: redact(rig.rig_asset),
      animation_assets: rig.animation_assets.map(redact)
    })),
    animations: snapshot.animations.map(animation => ({
      index: animation.index,
      name: redact(animation.name),
      duration_s: animation.duration_s,
      track_count: animation.track_count,
      source_type: animation.source_type,
      tags: animation.tags.map(redact),
      rig: animation.rig,
      origin: animation.origin
    })),
    scene: {
      process_step: snapshot.scene.process_step,
      model: {
        loaded: snapshot.scene.model.loaded,
        mesh_count: snapshot.scene.model.mesh_count,
        vertex_count: snapshot.scene.model.vertex_count,
        triangle_count: snapshot.scene.model.triangle_count
      },
      skeleton: {
        loaded: snapshot.scene.skeleton.loaded,
        type: snapshot.scene.skeleton.type,
        bone_count: snapshot.scene.skeleton.bone_count,
        ...(redact_optional(snapshot.scene.skeleton.root_name) === undefined
          ? {}
          : { root_name: redact(snapshot.scene.skeleton.root_name as string) }),
        ...(snapshot.scene.skeleton.truncated === undefined
          ? {}
          : { truncated: snapshot.scene.skeleton.truncated })
      },
      animations: {
        loaded_count: snapshot.scene.animations.loaded_count,
        ...(snapshot.scene.animations.active_index === undefined
          ? {}
          : { active_index: snapshot.scene.animations.active_index })
      },
      camera: { position: [...snapshot.scene.camera.position] as [number, number, number] },
      object_count: snapshot.scene.object_count
    }
  }
}
