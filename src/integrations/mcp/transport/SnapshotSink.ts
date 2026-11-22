/**
 * Platform-neutral sink contract for publishing snapshots.
 *
 * The control session never imports a transport; a platform integration may
 * pass a sink explicitly. Web builds use NoopSnapshotSink and load no bridge.
 */

import type { ControlSnapshot } from '../contracts.ts'

export interface SnapshotSink {
  /**
   * Sends a snapshot. Return a promise resolving to `true` only when the
   * transport positively observed acceptance; resolve to `false` on a known
   * rejection. Return `void` when the outcome cannot be observed (inert sinks)
   * so callers never claim an acceptance they did not observe.
   */
  publish(snapshot: ControlSnapshot): void | Promise<boolean>
  /** Optional real transport error, when the sink can observe one. */
  last_error?(): string | null
}

/** Default sink: keeps the ordinary web build completely inert. */
export class NoopSnapshotSink implements SnapshotSink {
  public publish (snapshot: ControlSnapshot): void {
    // Intentionally empty; referencing the argument keeps this a valid implementation.
    void snapshot
  }
}

/** Useful for tests and in-page diagnostic hooks. */
export class CallbackSnapshotSink implements SnapshotSink {
  constructor (private readonly callback: (snapshot: ControlSnapshot) => void) {}

  public publish (snapshot: ControlSnapshot): void {
    this.callback(snapshot)
  }
}
