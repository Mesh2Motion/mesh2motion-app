import { type CustomAnimationImporter } from './CustomAnimationImporter.ts'

/**
 * Connects an "Import animations" button and its hidden file input to a CustomAnimationImporter.
 * Only the page (or step) that is currently showing the button should create one, and it
 * should dispose() it when it is done so listeners never stack up on the shared elements.
 */
export class ImportAnimationsButton {
  private readonly importer: CustomAnimationImporter
  private readonly button: HTMLButtonElement | null
  private readonly input: HTMLInputElement | null
  private readonly listeners_abort_controller: AbortController = new AbortController()
  private enabled: boolean = true
  private is_importing: boolean = false

  constructor (
    importer: CustomAnimationImporter,
    button: HTMLButtonElement | null,
    input: HTMLInputElement | null
  ) {
    this.importer = importer
    this.button = button
    this.input = input
    this.add_event_listeners()
    this.update_button_state()
  }

  /**
   * Turns the button off, for example until there is a model to validate imports against
   */
  public set_enabled (enabled: boolean): void {
    this.enabled = enabled
    this.update_button_state()
  }

  /**
   * Removes the listeners from the button and input
   */
  public dispose (): void {
    this.listeners_abort_controller.abort()
  }

  private can_import (): boolean {
    return this.enabled && !this.is_importing
  }

  private update_button_state (): void {
    if (this.button !== null) {
      this.button.disabled = !this.can_import()
    }
  }

  private add_event_listeners (): void {
    const signal: AbortSignal = this.listeners_abort_controller.signal

    this.button?.addEventListener('click', () => {
      if (this.can_import()) {
        this.input?.click()
      }
    }, { signal })

    this.input?.addEventListener('change', () => {
      void this.import_selected_files()
    }, { signal })
  }

  private async import_selected_files (): Promise<void> {
    if (this.input === null || !this.can_import()) {
      return
    }

    const files: File[] = Array.from(this.input.files ?? [])
    if (files.length === 0) {
      return
    }

    // off while importing to prevent double-clicks during processing
    this.is_importing = true
    this.update_button_state()

    try {
      await this.importer.import_files(files)
    } finally {
      this.input.value = '' // lets the same file be picked again
      this.is_importing = false
      this.update_button_state()
    }
  }
}
