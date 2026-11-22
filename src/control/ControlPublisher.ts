/**
 * Event-driven control publisher for the running frontend.
 *
 * Attaches a ControlSession to a real engine and publishes sanitized snapshots
 * through a sink. Publication happens only on real lifecycle events and a
 * 1 Hz visibility-aware heartbeat — never per animation frame. This module
 * has no MCP dependency and does not mutate the engine.
 */

import { create_control_session, ControlSession } from './ControlSession.ts'
import { create_engine_control_host, EngineLike } from './EngineControlHost.ts'
import { sanitize_snapshot } from './sanitize.ts'
import { create_browser_sequence_ledger } from './SequenceLedger.ts'
import { TauriSnapshotSink } from './transport/TauriSnapshotSink.ts'
import type { SnapshotSink } from './transport/SnapshotSink.ts'
import { get_publisher_status, update_publisher_status } from './publisherStatus.ts'
import { is_desktop_control_enabled } from './attachControl.ts'
import type { PageValue } from './contracts.ts'

/** Bounded heartbeat: at most one snapshot per second while visible. */
export const MCP_HEARTBEAT_MS = 1000
/** Coalesce bursts of events so rapid changes cannot flood IPC. */
export const MCP_MIN_PUBLISH_INTERVAL_MS = 250

type EventListenerFn = (event: Event) => void

interface EventTargetLike {
  addEventListener(type: string, listener: EventListenerFn): void
  removeEventListener(type: string, listener: EventListenerFn): void
}

/** Engine shape required by the publisher (the real engine satisfies it). */
export type ControlEngineLike = EngineLike & {
  renderer: EngineLike['renderer'] & { domElement: EngineLike['renderer']['domElement'] & EventTargetLike }
  load_model_step: EngineLike['load_model_step'] & EventTargetLike
  load_skeleton_step: EngineLike['load_skeleton_step'] & EventTargetLike
}

export interface ControlPublisherOptions {
  page?: PageValue
  version?: string
  build?: string
  /** Defaults to TauriSnapshotSink; injectable for tests. */
  sink?: SnapshotSink
  heartbeat_ms?: number
  min_interval_ms?: number
  clock?: () => number
}

export interface ControlPublisherHandle {
  session: ControlSession
  publish_now(): boolean
  request_publish(): void
  dispose(): void
  readonly published_count: number
  readonly is_disposed: boolean
  readonly last_error: string | null
}

export function attach_control_publisher (
  engine: ControlEngineLike,
  options: ControlPublisherOptions = {}
): ControlPublisherHandle {
  const clock = options.clock ?? (() => Date.now())
  const opted_in = is_desktop_control_enabled()
  const sink: SnapshotSink = options.sink ?? new TauriSnapshotSink(
    (error) => {
      update_publisher_status({
        last_error: error instanceof Error ? error.message : String(error)
      })
    },
    () => { update_publisher_status({ last_error: null }) }
  )
  const heartbeat_ms = options.heartbeat_ms ?? MCP_HEARTBEAT_MS
  const min_interval_ms = options.min_interval_ms ?? MCP_MIN_PUBLISH_INTERVAL_MS

  // Persist sequence across reloads so the Rust host never sees a lower value.
  const session = create_control_session(clock, create_browser_sequence_ledger())
  session.attach(create_engine_control_host(engine, {
    page: options.page,
    version: options.version,
    build: options.build
  }))
  update_publisher_status({
    bridge_available: sink instanceof TauriSnapshotSink ? sink.is_available() : true,
    publisher_opted_in: opted_in,
    attached: true,
    disposed: false
  })

  let published_count = 0
  let last_publish_at = Number.NEGATIVE_INFINITY
  let trailing: ReturnType<typeof setTimeout> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let disposed = false

  function request_publish (): void {
    if (disposed) {
      return
    }
    const elapsed = clock() - last_publish_at
    if (elapsed >= min_interval_ms) {
      publish_now()
      return
    }
    if (trailing !== null) {
      return
    }
    trailing = setTimeout(() => {
      trailing = null
      publish_now()
    }, min_interval_ms - elapsed)
  }

  function publish_now (): boolean {
    if (disposed) {
      return false
    }
    const snapshot = session.refresh()
    // No host / no observation: never publish a fabricated snapshot.
    if (snapshot === null) {
      return false
    }
    sink.publish(sanitize_snapshot(snapshot))
    last_publish_at = clock()
    published_count += 1
    update_publisher_status({
      published_count,
      last_publish_epoch_ms: last_publish_at,
      sequence: session.current_sequence(),
      phase: snapshot.application.phase,
      last_error: sink.last_error?.() ?? get_publisher_status().last_error
    })
    return true
  }

  function start_heartbeat (): void {
    if (disposed || heartbeat !== null) {
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return
    }
    heartbeat = setInterval(() => { request_publish() }, heartbeat_ms)
  }

  function stop_heartbeat (): void {
    if (heartbeat !== null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  const on_visibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      start_heartbeat()
    } else {
      stop_heartbeat()
    }
  }

  const on_shutdown = (): void => { dispose() }

  const canvas = engine.renderer.domElement
  canvas.addEventListener('webglcontextlost', request_publish)
  canvas.addEventListener('webglcontextrestored', request_publish)
  engine.load_model_step.addEventListener('modelLoaded', request_publish)
  engine.load_model_step.addEventListener('modelLoadError', request_publish)
  engine.load_skeleton_step.addEventListener('skeletonLoaded', request_publish)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', on_visibility)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', on_shutdown)
  }

  function dispose (): void {
    if (disposed) {
      return
    }
    disposed = true
    stop_heartbeat()
    if (trailing !== null) {
      clearTimeout(trailing)
      trailing = null
    }
    canvas.removeEventListener('webglcontextlost', request_publish)
    canvas.removeEventListener('webglcontextrestored', request_publish)
    engine.load_model_step.removeEventListener('modelLoaded', request_publish)
    engine.load_model_step.removeEventListener('modelLoadError', request_publish)
    engine.load_skeleton_step.removeEventListener('skeletonLoaded', request_publish)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', on_visibility)
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', on_shutdown)
    }
    // Terminal lifecycle: invalidate state. No final snapshot is fabricated.
    session.close()
    update_publisher_status({ attached: false, disposed: true })
  }

  // One real initial observation; phase may still be `loading` until the first frame.
  publish_now()
  start_heartbeat()

  return {
    session,
    publish_now,
    request_publish,
    dispose,
    get published_count (): number { return published_count },
    get is_disposed (): boolean { return disposed },
    get last_error (): string | null { return sink.last_error?.() ?? get_publisher_status().last_error }
  }
}
