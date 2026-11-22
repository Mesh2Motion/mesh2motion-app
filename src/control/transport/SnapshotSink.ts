/**
 * Platform-neutral sink contract for publishing snapshots.
 *
 * The control session never imports a transport; a platform integration may
 * pass a sink explicitly. Web builds use NoopSnapshotSink and load no bridge.
 */

import type { ControlSnapshot } from '../contracts.ts'

export interface SnapshotSink {
  publish(snapshot: ControlSnapshot): void | Promise<void>
}

/** Default sink: keeps the ordinary web build completely inert. */
export class NoopSnapshotSink implements SnapshotSink {
  public publish (_snapshot: ControlSnapshot): void {
    // Intentionally empty.
  }
}

/** Useful for tests and in-page diagnostic hooks. */
export class CallbackSnapshotSink implements SnapshotSink {
  constructor (private readonly callback: (snapshot: ControlSnapshot) => void) {}

  public publish (snapshot: ControlSnapshot): void {
    this.callback(snapshot)
  }
}
