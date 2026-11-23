/**
 * M2M-028A addendum — attach/re-attach the authoring bridge to the ACTUAL rig.
 *
 * The bridge must appear when a rig finishes loading, and must reset when the
 * rig is unloaded, replaced, or the model is switched. Re-entering a page is
 * never required. All listeners and frame callbacks are removable.
 */

import { type Skeleton } from 'three'
import { compute_rig_fingerprint } from '../animation-document/rigIdentity'
import { live_rig_identifier, live_skeleton_from_engine, type AuthoringEngine } from './rigCatalog'

interface MaybeEventTarget {
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void
}

export interface RigLifecycleEngine extends AuthoringEngine {
  add_frame_listener (listener: (delta_time: number) => void): void
  remove_frame_listener? (listener: (delta_time: number) => void): void
  load_model_step?: MaybeEventTarget
  load_skeleton_step?: MaybeEventTarget & { skeleton_type? (): string }
}

export interface RigSnapshot {
  identifier: string
  fingerprint: string
  skeleton: Skeleton
}

export interface RigLifecycleHandle {
  dispose (): void
  current (): RigSnapshot | null
}

function snapshot (engine: RigLifecycleEngine): RigSnapshot | null {
  const identifier = live_rig_identifier(engine)
  const skeleton = live_skeleton_from_engine(engine)
  if (identifier === null || skeleton === null) return null
  return { identifier, fingerprint: compute_rig_fingerprint(skeleton), skeleton }
}

/**
 * Watch the live rig and invoke on_change whenever its identity changes.
 * An EventTarget signal and a per-frame identity check cover both explicit
 * load/unload events and silent swaps (e.g. StepAnimationsListing mesh swap).
 */
export function watch_rig_lifecycle (
  engine: RigLifecycleEngine,
  on_change: (snapshot: RigSnapshot | null) => void
): RigLifecycleHandle {
  let last: RigSnapshot | null = null
  let disposed = false

  const check = (): void => {
    if (disposed) return
    const next = snapshot(engine)
    const same = next !== null && last !== null &&
      next.identifier === last.identifier && next.fingerprint === last.fingerprint
    if (same) return
    last = next
    on_change(next)
  }

  const events: Array<[MaybeEventTarget | undefined, string]> = [
    [engine.load_skeleton_step, 'skeletonLoaded'],
    [engine.load_model_step, 'modelLoaded'],
    [engine.load_model_step, 'modelLoadError']
  ]
  for (const [target, name] of events) {
    if (target?.addEventListener !== undefined) target.addEventListener(name, check)
  }
  engine.add_frame_listener?.(check)
  check()

  return {
    current: () => last,
    dispose: () => {
      if (disposed) return
      disposed = true
      for (const [target, name] of events) {
        if (target?.removeEventListener !== undefined) target.removeEventListener(name, check)
      }
      engine.remove_frame_listener?.(check)
    }
  }
}
