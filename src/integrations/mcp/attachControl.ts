/**
 * Tiny desktop-only activation gate.
 *
 * Statically imported by the three page bootstraps; it contains no MCP or
 * Tauri library import and loads the publisher chunk only when a Tauri IPC
 * bridge AND an explicit opt-in are present. Web builds therefore do not load
 * the publisher at all.
 */

import type { ControlEngineLike, ControlPublisherHandle, ControlPublisherOptions } from './ControlPublisher.ts'
import { is_desktop_control_enabled } from './desktopGate.ts'

// Re-export for existing consumers (McpSettingsPanel, control/index.ts, tests).
export { has_tauri_bridge, is_desktop_control_enabled } from './desktopGate.ts'

/**
 * M2M-028A: install the typed authoring bridge on every page that already
 * attaches desktop control. It is a no-op until a live skeleton exists.
 */
import { attachAuthoringBridge } from '../../authoringBridge/attach.ts'
import { attachPoseObservation } from '../../authoringObservation/attach.ts'

/**
 * Attach the publisher when enabled. No-op otherwise. Failures are swallowed
 * because application-control is strictly auxiliary.
 */
export function maybe_attach_desktop_control (
  engine: ControlEngineLike,
  options: ControlPublisherOptions = {}
): Promise<ControlPublisherHandle | null> {
  attachAuthoringBridge(engine as unknown as Parameters<typeof attachAuthoringBridge>[0])
  // M2M-030A: internal-only pose observation cameras. No UI is created.
  attachPoseObservation(engine as unknown as Parameters<typeof attachPoseObservation>[0])
  if (!is_desktop_control_enabled()) {
    return Promise.resolve(null)
  }
  return import('./ControlPublisher.ts')
    .then(({ attach_control_publisher }) => attach_control_publisher(engine, options))
    .catch(() => null) // diagnostics are optional; never propagate
}
