import { StarRating } from './StarRating'

export class DownloadSuccessDialog {
  private dialog_element: HTMLDivElement | null = null
  private star_rating: StarRating | null = null
  private current_rating: number | null = null
  private readonly content_html = `


    <div class="download-success-dialog-content">
      <h2>Export Successful</h2>
      <div class="download-success-dialog-body">
        <div class="download-success-section">
          <h3>Support the Project</h3>
          <p>If you find Mesh2Motion helpful, consider donating to help us keep improving the tool
            and adding new features.</p>
          <a href="https://support.mesh2motion.org/" class="button">Learn More</a>
        </div>

        <div class="download-success-section">
          <h3>Share Your Feedback</h3>
          <div class="star-rating-container"></div>
          <textarea class="download-success-feedback-textarea" placeholder="Add optionalal feedback. (500 character max)" rows="4" maxlength="500"></textarea>
          <button id="survey-submission-button">Submit</button>
        </div>

        <div class="download-success-section">
          <h3>Join Our Community</h3>
          <p>Have questions or want to share your creations? Join us on Discord to connect with
            other animators and get support.</p>
          <a href="https://discord.gg/UChE936q7y" target="_blank" class="button">
            Join Discord Server
          </a>
        </div>

      </div>
      <a href="#" class="download-success-dialog-close">Not today, maybe tomorrow</a>
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
      this.star_rating = new StarRating((rating) => {
        this.current_rating = rating
        console.log('User rated:', rating)
      })
      rating_container.innerHTML = this.star_rating.getHTML()
      this.star_rating.attachEventListeners(rating_container as HTMLElement)
    }

    // Survey submission handler
    const submit_button = this.dialog_element.querySelector('#survey-submission-button')
    submit_button?.addEventListener('click', async () => {
      const feedback_textarea = this.dialog_element?.querySelector('.download-success-feedback-textarea') as HTMLTextAreaElement
      const feedback_text = feedback_textarea?.value?.trim() || ''

      // Worker requires each submitted item to include a non-empty answer.
      if (this.current_rating === null) {
        console.error('Survey submission blocked: rating is required before submitting')
        return
      }

      // Build payload with required rating and optional feedback.
      const survey_data: Array<{ question: string, answer: string | number }> = [
        { question: 'Rating', answer: this.current_rating }
      ]

      if (feedback_text.length > 0) {
        survey_data.push({ question: 'Feedback', answer: feedback_text })
      }

      // Use the Cloudflare Worker endpoint to submit the survey data
      const WORKER_URL = "https://mesh2motion-app.scottpetrovic.workers.dev"

      try {
        const res = await fetch(`${WORKER_URL}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ survey: survey_data })
        })
        if (!res.ok) {
          console.error('Survey submission failed:', res.statusText)
        } else {
          console.log('Survey submitted successfully')
        }
      } catch (error) {
        console.error('Error submitting survey:', error)
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
