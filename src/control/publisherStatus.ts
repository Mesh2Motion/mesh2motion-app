/**
 * Small, transport-neutral status snapshot shared with the settings UI.
 *
 * Contains only values observed locally in the webview. It never claims a
 * connected MCP client or host capability that Rust did not report.
 */

import { CONTROL_SCHEMA_VERSION } from './contracts.ts'

export interface PublisherStatus {
  schema_version: string
  bridge_available: boolean
  publisher_opted_in: boolean
  attached: boolean
  disposed: boolean
  published_count: number
  last_publish_epoch_ms: number | null
  sequence: number | null
  phase: string | null
  last_error: string | null
}

const initial: PublisherStatus = {
  schema_version: CONTROL_SCHEMA_VERSION,
  bridge_available: false,
  publisher_opted_in: false,
  attached: false,
  disposed: false,
  published_count: 0,
  last_publish_epoch_ms: null,
  sequence: null,
  phase: null,
  last_error: null
}

let status: PublisherStatus = { ...initial }

/** Defensive copy so UI code cannot mutate the shared state. */
export function get_publisher_status (): PublisherStatus {
  return { ...status }
}

export function update_publisher_status (patch: Partial<PublisherStatus>): void {
  status = { ...status, ...patch }
}

export function reset_publisher_status (): void {
  status = { ...initial }
}
