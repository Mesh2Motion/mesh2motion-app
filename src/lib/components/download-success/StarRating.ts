export class StarRating {
  private rating: number = 3
  private onRatingChange?: (rating: number) => void

  constructor (onRatingChange?: (rating: number) => void) {
    this.onRatingChange = onRatingChange
  }

  public getHTML (): string {
    return `
      <div class="star-rating">
        ${[1, 2, 3, 4, 5].map(star => `
          <button class="star-button" data-star="${star}" aria-label="Rate ${star} stars">
            <span class="star-icon">★</span>
          </button>
        `).join('')}
      </div>
    `
  }

  public attachEventListeners (container: HTMLElement): void {
    const buttons = container.querySelectorAll('.star-button')

    buttons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.preventDefault()
        const star = parseInt((button as HTMLElement).getAttribute('data-star') || '0')
        this.setRating(star, container)
        this.onRatingChange?.(star)
      })

      button.addEventListener('mouseenter', () => {
        const star = parseInt((button as HTMLElement).getAttribute('data-star') || '0')
        this.highlightStars(star, container)
      })
    })

    container.addEventListener('mouseleave', () => {
      this.highlightStars(this.rating, container)
    })

    this.highlightStars(this.rating, container)
  }

  private setRating (rating: number, container: HTMLElement): void {
    this.rating = rating
    this.highlightStars(rating, container)
  }

  private highlightStars (rating: number, container: HTMLElement): void {
    const buttons = container.querySelectorAll('.star-button')
    buttons.forEach(button => {
      const star = parseInt((button as HTMLElement).getAttribute('data-star') || '0')
      if (star <= rating) {
        button.classList.add('active')
      } else {
        button.classList.remove('active')
      }
    })
  }

  public getRating (): number {
    return this.rating
  }
}
