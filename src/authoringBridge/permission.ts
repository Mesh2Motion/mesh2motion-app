/**
 * M2M-028B — explicit native authoring opt-in.
 *
 * Permission is disabled on every app start. No MCP request, event payload or
 * client field can enable it; only a real click on the in-application control
 * can do so. Read-only MCP access is unaffected by this flag.
 */

export const AUTHORING_TOGGLE_ID = 'm2m-authoring-toggle'

export class AuthoringPermission {
  private enabled = false
  private readonly button: HTMLButtonElement

  constructor (host: HTMLElement = document.body) {
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.id = AUTHORING_TOGGLE_ID
    this.button.className = 'm2m-authoring-toggle'
    this.button.textContent = 'Enable authoring'
    this.button.setAttribute('aria-pressed', 'false')
    this.button.addEventListener('click', () => { this.set_enabled(true) })
    host.append(this.button)
  }

  is_enabled (): boolean {
    return this.enabled
  }

  /** Programmatic enabling is intentionally not exposed to MCP requests. */
  set_enabled (value: boolean): void {
    this.enabled = value
    this.button.setAttribute('aria-pressed', value ? 'true' : 'false')
    this.button.textContent = value ? 'Authoring enabled' : 'Enable authoring'
    this.button.disabled = value
  }

  dispose (): void {
    this.button.remove()
    this.enabled = false
  }
}
