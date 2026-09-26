import { StarRating } from './StarRating'
import { SURVEY_WORKER_URL } from '../../SurveyWorkerUrl'

export class DownloadSuccessDialog {
  private dialog_element: HTMLDivElement | null = null
  private star_rating: StarRating | null = null
  private readonly content_html = `


    <div class="download-success-dialog-content">
      <h2>Enjoy the free animations</h2>
      <div class="download-success-dialog-body">
        <div class="download-success-section">
          <h3>Support the Project</h3>
          <p>If you find this application helpful, consider contributing to keep improving the tool
            and adding new features.</p>
          <a href="https://support.mesh2motion.org/" class="button">Learn More</a>
        </div>

        <div class="download-success-section">
          <h3>How was your experience?</h3>
          <div class="survey-content">
            <div class="star-rating-container"></div>
            <textarea id="download-success-feedback" name="download-success-feedback" class="download-success-feedback-textarea" placeholder="Add optionalal feedback. (500 character max)" rows="4" maxlength="500"></textarea>
            <button id="survey-submission-button">Submit</button>
          </div>
        </div>

        <div class="download-success-section">
          <h3>Join Our Community</h3>
          <p>Have questions or want to see what is going on? Join us on Discord to connect with
            other animators and get support.</p>
          <a href="https://discord.gg/UChE936q7y" target="_blank" class="button">
            Join Discord Server
          </a>
        </div>
      </div>

      <div class="offline-download-note" style="text-align: center;">
        <p>Did you know there is an offline version available? Visit <a href="https://github.com/Mesh2Motion/mesh2motion-desktop/releases" style="font-size: 100%" target="_blank">the releases page</a>.</p>
      </div>

      <div class="download-success-desktop">
        <p>The animations have been saved to your Downloads folder</p>
      </div>

      <button class="download-success-dialog-close secondary-button">Close</button>
    </div> 
  `

  constructor (private readonly options?: { onClose?: () => void }) {}

  public show (): void {
    this.remove()
    this.dialog_element = document.createElement('div')
    this.dialog_element.className = 'download-success-dialog-overlay'

    this.dialog_element.innerHTML = this.content_html
    document.body.appendChild(this.dialog_element)

    // Initialize star rating
    const rating_container = this.dialog_element.querySelector('.star-rating-container')
    if (rating_container) {
      this.star_rating = new StarRating()

      rating_container.innerHTML = this.star_rating.getHTML()
      this.star_rating.attachEventListeners(rating_container as HTMLElement)
    }

    // Survey submission handler
    const submit_button = this.dialog_element.querySelector('#survey-submission-button')
    submit_button?.addEventListener('click', async () => {
      const feedback_textarea = this.dialog_element?.querySelector('.download-success-feedback-textarea') as HTMLTextAreaElement
      const feedback_text = feedback_textarea?.value?.trim() || ''
      const current_rating = this.star_rating?.getRating() ?? 3
      const survey_content = this.dialog_element?.querySelector('.survey-content') as HTMLDivElement | null

      submit_button.setAttribute('disabled', 'true')

      // Worker requires each submitted item to include a non-empty answer.
      // Build payload with required rating and optional feedback.
      const survey_data: Array<{ question: string, answer: string | number }> = [
        { question: 'Rating', answer: current_rating }
      ]

      if (feedback_text.length > 0) {
        survey_data.push({ question: 'Feedback', answer: feedback_text })
      }

      // Use the Cloudflare Worker endpoint to submit the survey data
      try {
        const res = await fetch(`${SURVEY_WORKER_URL}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ survey: survey_data })
        })
        if (!res.ok) {
          console.error('Survey submission failed:', res.statusText)
          submit_button.removeAttribute('disabled')
        } else {
          console.log('Survey submitted successfully')
          if (survey_content) {
            survey_content.innerHTML = `
            <p class="survey-thank-you">
              Thanks for the feedback. These results will help determine what bugs need fixing, or what features to improve in the future.
            </p>`
          }
        }
      } catch (error) {
        console.error('Error submitting survey:', error)
        submit_button.removeAttribute('disabled')
      }
    })

    // Close button handler
    const close_button = this.dialog_element.querySelector('.download-success-dialog-close')
    close_button?.addEventListener('click', () => { this.remove() })

    // Close on overlay click
    this.dialog_element.addEventListener('click', (e) => {
      if (e.target === this.dialog_element) this.remove()
    })
  }

  private remove (): void {
    if (this.dialog_element && this.dialog_element.parentNode) {
      this.dialog_element.parentNode.removeChild(this.dialog_element)
      this.dialog_element = null
      if (this.options?.onClose) this.options.onClose()
    }
  }
}
