import { SkeletonType } from '../../enums/SkeletonType'
import { RigConfig } from '../../RigConfig'
import { SURVEY_WORKER_URL } from '../../SurveyWorkerUrl'

const MAX_DESCRIPTION_LENGTH = 1000

// Dialog that lets people request new animations for a rig type.
// Submissions are stored by the survey worker in the animation_requests table.
export class AnimationRequestDialog {
  private static request_links_enabled: boolean = false
  private dialog_element: HTMLDivElement | null = null

  constructor (private readonly default_rig_type: SkeletonType) {}

  /**
   * Any ".request-animation-link" element opens this dialog, defaulting to the rig in its
   * data-rig-type attribute. Links get re-rendered often (e.g. the empty animation listing),
   * so a single delegated listener is registered once instead of one per link.
   */
  public static enable_request_links (): void {
    if (this.request_links_enabled) return
    this.request_links_enabled = true

    document.addEventListener('click', (event) => {
      const link = (event.target as HTMLElement | null)?.closest<HTMLElement>('.request-animation-link')
      if (link == null) return

      event.preventDefault()
      const rig_type = (link.dataset.rigType as SkeletonType | undefined) ?? SkeletonType.Human
      new AnimationRequestDialog(rig_type).show()
    })
  }

  public show (): void {
    this.remove()
    this.dialog_element = document.createElement('div')
    this.dialog_element.className = 'modal-dialog-overlay animation-request-dialog'
    this.dialog_element.innerHTML = this.build_html()
    document.body.appendChild(this.dialog_element)

    const description_textarea = this.dialog_element.querySelector<HTMLTextAreaElement>('#animation-request-description')
    const submit_button = this.dialog_element.querySelector<HTMLButtonElement>('#animation-request-submit')

    // only allow submitting once something has been typed in
    description_textarea?.addEventListener('input', () => {
      if (submit_button !== null) {
        submit_button.disabled = description_textarea.value.trim().length === 0
      }
    })
    description_textarea?.focus()

    submit_button?.addEventListener('click', () => { void this.submit_request() })

    const close_button = this.dialog_element.querySelector('.modal-dialog-close')
    close_button?.addEventListener('click', () => { this.remove() })

    this.dialog_element.addEventListener('click', (e) => {
      if (e.target === this.dialog_element) this.remove()
    })
  }

  private build_html (): string {
    const rig_options: string = RigConfig.all.map((rig) => {
      const selected = rig.skeleton_type === this.default_rig_type ? ' selected' : ''
      return `<option value="${rig.skeleton_type}"${selected}>${rig.rig_display_name}</option>`
    }).join('')

    return `
      <div class="modal-dialog-content">
        <h2>Request an Animation</h2>
        <div class="modal-dialog-body animation-request-body">
          <label for="animation-request-rig">Rig type</label>
          <select id="animation-request-rig">
            ${rig_options}
            <option value="other">Other / new rig type</option>
          </select>

          <label for="animation-request-description">What animation(s) would you like?</label>
          <textarea id="animation-request-description" class="animation-request-textarea"
            placeholder="Describe the animation(s) you want. (${MAX_DESCRIPTION_LENGTH} character max)"
            rows="6" maxlength="${MAX_DESCRIPTION_LENGTH}"></textarea>

          <p class="animation-request-error" style="display: none;">Something went wrong submitting your request. Please try again.</p>
          <button id="animation-request-submit" disabled>Submit</button>
        </div>
        <button class="modal-dialog-close secondary-button">Close</button>
      </div>
    `
  }

  private async submit_request (): Promise<void> {
    if (this.dialog_element === null) return

    const rig_select = this.dialog_element.querySelector<HTMLSelectElement>('#animation-request-rig')
    const description_textarea = this.dialog_element.querySelector<HTMLTextAreaElement>('#animation-request-description')
    const submit_button = this.dialog_element.querySelector<HTMLButtonElement>('#animation-request-submit')
    const error_message = this.dialog_element.querySelector<HTMLParagraphElement>('.animation-request-error')
    const body_element = this.dialog_element.querySelector<HTMLDivElement>('.animation-request-body')

    const rig_type = rig_select?.value ?? this.default_rig_type
    const description = description_textarea?.value.trim() ?? ''
    if (description.length === 0) return

    if (submit_button !== null) submit_button.disabled = true
    if (error_message !== null) error_message.style.display = 'none'

    try {
      const res = await fetch(`${SURVEY_WORKER_URL}/animation-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rig_type, description })
      })

      if (!res.ok) {
        throw new Error(res.statusText)
      }

      if (body_element !== null) {
        body_element.innerHTML = `
          <p class="survey-thank-you">
            Request submitted. Can't promise I can do every request, but I will try to focus on areas that I get the most requests for.
          </p>`
      }
    } catch (error) {
      console.error('Error submitting animation request:', error)
      if (submit_button !== null) submit_button.disabled = false
      if (error_message !== null) error_message.style.display = 'block'
    }
  }

  private remove (): void {
    if (this.dialog_element?.parentNode != null) {
      this.dialog_element.parentNode.removeChild(this.dialog_element)
      this.dialog_element = null
    }
  }
}
