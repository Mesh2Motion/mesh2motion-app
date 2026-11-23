/**
 * M2M-028B — explicit native authoring opt-in.
 *
 * Permission is disabled on every app start. No MCP request, event payload or
 * client field can enable it; only a real click on the in-application control
 * can do so. Read-only MCP access is unaffected by this flag.
 */

export const AUTHORING_TOGGLE_ID = 'm2m-authoring-toggle'

export type NativePermissionSetter = (enabled: boolean) => Promise<boolean>

export class AuthoringPermission {
  private enabled = false
  private readonly button: HTMLButtonElement
  private readonly set_native_permission: NativePermissionSetter
  private readonly on_change: (enabled: boolean) => void
  private busy = false

  constructor (
    host: HTMLElement = document.body,
    set_native_permission: NativePermissionSetter = async () => false,
    on_change: (enabled: boolean) => void = () => {}
  ) {
    this.set_native_permission = set_native_permission
    this.on_change = on_change
    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.id = AUTHORING_TOGGLE_ID
    this.button.className = 'm2m-authoring-toggle'
    this.button.textContent = 'Enable authoring'
    this.button.setAttribute('aria-pressed', 'false')
    this.button.addEventListener('click', () => { void this.toggle_from_user_click() })
    host.append(this.button)
  }

  is_enabled (): boolean {
    return this.enabled
  }

  /** Programmatic enabling is intentionally not exposed to MCP requests. */
  private set_enabled (value: boolean): void {
    this.enabled = value
    this.button.setAttribute('aria-pressed', value ? 'true' : 'false')
    this.button.textContent = value ? 'Disable authoring' : 'Enable authoring'
    this.button.disabled = false
    this.on_change(value)
  }

  private async toggle_from_user_click (): Promise<void> {
    if (this.busy) return
    this.busy = true
    this.button.disabled = true
    const next = !this.enabled
    try {
      const synchronized = await this.set_native_permission(next)
      if (!synchronized) throw new Error('native authoring permission command unavailable')
      this.set_enabled(next)
    } catch {
      this.button.textContent = this.enabled ? 'Disable authoring' : 'Authoring unavailable'
      this.button.setAttribute('aria-pressed', this.enabled ? 'true' : 'false')
    } finally {
      this.busy = false
      this.button.disabled = false
    }
  }

  dispose (): void {
    if (this.enabled) void this.set_native_permission(false).catch(() => {})
    this.button.remove()
    this.enabled = false
  }
}
