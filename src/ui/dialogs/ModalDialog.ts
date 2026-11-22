// Generic modal dialog for displaying any content (credits, errors, etc.)
export class ModalDialog {
  private dialog_element: HTMLDivElement | null = null
  private close_button: HTMLButtonElement | null = null

  constructor (
    private readonly title: string,
    private readonly content_html: string,
    private readonly options?: { onClose?: () => void, customClass?: string }
  ) {}

  public show (): void {
    this.remove()
    this.dialog_element = document.createElement('div')
    this.dialog_element.className = 'modal-dialog-overlay' + (this.options?.customClass ? ' ' + this.options.customClass : '')

    // HTML template for the content
    this.dialog_element.innerHTML = `
      <div class="modal-dialog-content">
        <h2>${this.title}</h2>
        <div class="modal-dialog-body">${this.content_html}</div>
        <button class="modal-dialog-close">Close</button>
      </div>
    `
    document.body.appendChild(this.dialog_element)
    this.close_button = this.dialog_element.querySelector('.modal-dialog-close')
    this.close_button?.addEventListener('click', () => { this.remove() })
    this.dialog_element.addEventListener('click', (e) => {
      if (e.target === this.dialog_element) this.remove()
    })
  }

  /** Body element of the open dialog, for wiring up interactive content */
  public get_body_element (): HTMLElement | null {
    return this.dialog_element?.querySelector('.modal-dialog-body') ?? null
  }

  public remove (): void {
    if (this.dialog_element && this.dialog_element.parentNode) {
      this.dialog_element.parentNode.removeChild(this.dialog_element)
      this.dialog_element = null
      if (this.options?.onClose) this.options.onClose()
    }
  }
}
