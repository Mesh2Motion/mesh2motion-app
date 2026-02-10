import { type AnimationClip } from 'three'
import { type ThemeManager } from '../../ThemeManager'
import { SkeletonType } from '../../enums/SkeletonType'
import { type AnimationWithState } from './interfaces/AnimationWithState'

export class AnimationSearch extends EventTarget {
  private all_animations: AnimationWithState[] = []
  private readonly filter_input: HTMLInputElement | null = null
  private readonly animation_list_container: HTMLElement | null = null
  private filtered_animations_list: AnimationWithState[] = []

  private readonly theme_manager: ThemeManager
  private readonly skeleton_type: SkeletonType

  private custom_event: CustomEvent | null = null

  constructor (filter_input_id: string, animation_list_container_id: string, theme_manager: ThemeManager, skeleton_type: SkeletonType) {
    super()
    this.filter_input = document.querySelector(`#${filter_input_id}`)
    this.animation_list_container = document.querySelector(`#${animation_list_container_id}`)
    this.theme_manager = theme_manager
    this.skeleton_type = skeleton_type
    this.setup_event_listeners()
  }

  public initialize_animations (animations: AnimationClip[]): void {
    // Convert to animations with state tracking
    this.all_animations = this.map_animations_to_state(animations)

    this.render_filtered_animations('')
  }

  public add_animations (animations: AnimationClip[]): void {
    const new_animations = this.map_animations_to_state(animations)

    this.all_animations.push(...new_animations)
    const filter_text = this.filter_input?.value.toLowerCase() ?? ''
    this.render_filtered_animations(filter_text)
  }

  private map_animations_to_state (animations: AnimationClip[]): AnimationWithState[] {
    return animations.map((clip) => {
      const animation_with_state = clip as unknown as AnimationWithState
      animation_with_state.isChecked = false
      return animation_with_state
    })
  }

  private setup_event_listeners (): void {
    this.setup_filter_listener()
    this.setup_checkbox_listeners()
    this.setup_theme_change_listener()
  }

  private setup_theme_change_listener (): void {
    // rebuild animation previews so we have the correct theme
    this.theme_manager.addEventListener('theme-changed', (new_theme) => {
      this.render_filtered_animations(this.filter_input?.value || '')
    })
  }

  private setup_filter_listener (): void {
    if (this.filter_input === null) {
      return
    }

    // Add the filter event listener
    this.filter_input.addEventListener('input', (event) => {
      const filter_text = (event.target as HTMLInputElement).value.toLowerCase()
      this.render_filtered_animations(filter_text)

      // emit an event to notify that we have filtered our animation listing
      this.custom_event = new CustomEvent('filtered-animations-listing', { detail: { selectedAnimations: this.get_selected_animation_indices() } })
      this.dispatchEvent(this.custom_event)
    })
  }

  private setup_checkbox_listeners (): void {
    if (this.animation_list_container === null) {
      return
    }

    // Add event listener to the container for checkbox changes (event delegation)
    this.animation_list_container.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      if (target?.type === 'checkbox') {
        this.save_current_checkbox_states()
      }

      // emit an event to notify other parts of the application that export options have changed
      this.custom_event = new CustomEvent('export-options-changed', { detail: { selectedAnimations: this.get_selected_animation_indices() } })
      this.dispatchEvent(this.custom_event)
    })
  }

  private save_current_checkbox_states (): void {
    if (this.animation_list_container === null) {
      return
    }

    const checkboxes = this.animation_list_container.querySelectorAll('input[type="checkbox"]')
    checkboxes.forEach((checkbox) => {
      const input = checkbox as HTMLInputElement
      const animation_index = parseInt(input.value)

      if (!isNaN(animation_index) && animation_index < this.all_animations.length) {
        this.all_animations[animation_index].isChecked = input.checked
      }
    })
  }

  /* animations that are shown on UI after filtering */
  public filtered_animations (): AnimationWithState[] {
    return this.filtered_animations_list
  }

  private render_filtered_animations (filter_text: string): void {
    if (this.animation_list_container === null) {
      return
    }

    // Filter animations based on search text
    this.filtered_animations_list = this.all_animations.filter(animation => {
      return animation.name.toLowerCase().includes(filter_text)
    })


    // Clear and rebuild the animation list
    this.animation_list_container.innerHTML = ''

    // Show "no animations found" if the filtered list is empty
    if (this.filtered_animations_list.length === 0) {
      this.animation_list_container.innerHTML = '<div class="no-animations-message">No animations found</div>'
      return
    }


    this.filtered_animations_list.forEach((animation_clip) => {
      if (this.animation_list_container == null) {
        return
      }

      // Find the original index in the full list for proper data-index
      const original_index = this.all_animations.findIndex(clip => clip === animation_clip)

      // Check if this animation was previously checked
      const was_checked: boolean = animation_clip.isChecked ?? false
      const checked_attribute = was_checked ? 'checked' : ''

      // build out where the video previews will be stored
      // each skeleton type has its own folder
      let preview_folder: string = ''
      switch (this.skeleton_type) {
        case SkeletonType.Human:
          preview_folder = 'human'
          break
        case SkeletonType.Quadraped:
          preview_folder = 'four-legged'
          break
        case SkeletonType.Bird:
          preview_folder = 'bird'
          break
        case SkeletonType.Dragon:
          preview_folder = 'dragon'
          break
        case SkeletonType.Kaiju:
          preview_folder = 'kaiju'
          break
        default:
          preview_folder = 'error'
          console.error('Unknown skeleton type for animation previews. Update AnimationSearch.ts switch statement.')
          break
      }

      const anim_name: string = animation_clip.name
      const theme_name: string = this.theme_manager.get_current_theme()

      // Use a placeholder for the video preview, to be replaced by IntersectionObserver
      this.animation_list_container.innerHTML +=
        `<div class="anim-item">
            <button class="secondary-button play" data-index="${original_index}" style="display: flex; flex-direction:column">
              <div class="anim-preview-placeholder" data-src="../animpreviews/${preview_folder}/${theme_name}_${anim_name}.webm" style="pointer-events: none;"></div>
            </button>
            <label class="styled-checkbox">
                <input type="checkbox" name="${animation_clip.name}" value="${original_index}" ${checked_attribute}>
                <span class="anim-preview-label">${this.animation_name_clean(animation_clip.name)}</span>
            </label>
        </div>`
    })

    // only so many WebM videos can be playing at the same time
    // so this is an optimization to convert only elements in the active scroll area to video elements
    this.setup_lazy_video_loading()
  }

  /**
   * Sets up lazy loading for video previews using Intersection Observer.
   * Only loads video elements when their placeholders are visible in the viewport.
   */
  private setup_lazy_video_loading (): void {
    // Only set up IntersectionObserver if the container exists
    // any animation entry that is in view will run this code to convert it to a video element
    const observer = new IntersectionObserver((entries: IntersectionObserverEntry[], _obs: IntersectionObserver) => {
      entries.forEach(entry => {
        const placeholder = entry.target as HTMLElement

        // abort if animation entry is outside active viewing area
        if (!entry.isIntersecting) {
          placeholder.innerHTML = ''
          return
        }

        // if element is already a video, and it is in view, don't convert
        // it to a video again, it is ok so abort any further work
        const existing_video = placeholder.querySelector('video')
        if (existing_video != null) {
          return
        }

        // element that just came into view and needs to be converted
        // to a video element
        const video = document.createElement('video')
        video.className = 'anim-preview'
        const src = placeholder.getAttribute('data-src') ?? ''
        video.src = src
        video.width = 100
        video.height = 120
        video.loop = true
        video.muted = true
        video.playsInline = true // tells mobile browsers to play inline instead of going fullscreen
        video.autoplay = true
        placeholder.innerHTML = ''
        placeholder.appendChild(video)
      })
    }, { rootMargin: '100px' }) // rootMargin will make sure partially visible elements are also turned into videos

    // grabs all the animation list elements and tells the observer to start watching them for processing
    const placeholders = this.animation_list_container?.querySelectorAll('.anim-preview-placeholder')
    placeholders?.forEach(ph => { observer.observe(ph) })
  }

  public animation_name_clean (input: string): string {
    return input.replace(/_/g, ' ')
  }

  /**
   * Gets the list of filtered animations. Returns all animations if no filtering
   * @returns An array of selected animations.
   */
  public get_selected_animations (): AnimationWithState[] {
    return this.all_animations.filter(animation => animation.isChecked === true)
  }

  /**
   * Gets the list of animations that are checked to be exported
   * @returns An array of selected animation indices.
   */
  public get_selected_animation_indices (): number[] {
    return this.all_animations
      .map((animation, index) => (animation.isChecked === true) ? index : -1)
      .filter(index => index !== -1)
  }

  public clear_filter (): void {
    if (this.filter_input !== null) {
      this.filter_input.value = ''
      this.render_filtered_animations('')
    }
  }
}
