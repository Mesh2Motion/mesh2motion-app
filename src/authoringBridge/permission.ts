/**
 * M2M-028B — in-memory permission state for the live MCP authoring session.
 *
 * The native app grants this state only after a valid authoring-bridge request
 * arrives through the Rust Tauri event adapter. It is never persisted, and a
 * browser CustomEvent cannot grant it. Commit and undo still use the native
 * digest-bound confirmation panel.
 */

export class AuthoringPermission {
  private enabled = false

  is_enabled (): boolean {
    return this.enabled
  }

  authorize_from_mcp_request (): void {
    this.enabled = true
  }

  dispose (): void {
    this.enabled = false
  }
}
