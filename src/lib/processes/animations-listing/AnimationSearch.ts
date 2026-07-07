import { type ThemeManager } from '../../ThemeManager'
import { SkeletonType } from '../../enums/SkeletonType'
import { RigConfig } from '../../RigConfig'
import { type AnimationWithState } from './interfaces/AnimationWithState'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair'

export class AnimationSearch extends EventTarget {
  private all_animations: AnimationWithState[] = []
  private readonly filter_input: HTMLInputElement | null = null
  private readonly animation_list_container: HTMLElement | null = null
  private filtered_animations_list: AnimationWithState[] = []

  private readonly theme_manager: ThemeManager
  private readonly skeleton_type: SkeletonType

  private custom_event: CustomEvent | null = null
  private show_selected_only: boolean = false

  /** When false (default), animations that don't have a preview video are
   *  hidden from the list. When true, all animations are shown regardless
   *  of preview availability. Toggled by the "All" checkbox in the panel. */
  private show_all: boolean = false

  /** Set of animation names that have a preview video available, loaded
   *  from animpreviews/manifest.json. null = manifest not yet loaded. */
  private preview_manifest: Record<string, string[]> | null = null

  constructor (filter_input_id: string, animation_list_container_id: string, theme_manager: ThemeManager, skeleton_type: SkeletonType) {
    super()
    this.filter_input = document.querySelector(`#${filter_input_id}`)
    this.animation_list_container = document.querySelector(`#${animation_list_container_id}`)
    this.theme_manager = theme_manager
    this.skeleton_type = skeleton_type
    this.setup_event_listeners()
    this.load_preview_manifest()
  }

  /** Asynchronously load the preview manifest so we know which animations
   *  have a preview video. If it fails to load we treat all animations as
   *  having previews (show everything) so the user isn't penalised. */
  private async load_preview_manifest (): Promise<void> {
    try {
      const resp = await fetch('../animpreviews/manifest.json')
      if (resp.ok) {
        this.preview_manifest = await resp.json()
      }
    } catch {
      // Network / file not found — fall back to null (show all).
    }
    // Re-render in case animations were already initialised before the
    // manifest finished loading. Dispatch the event so the count label
    // and any other listeners pick up the updated filtered list.
    if (this.all_animations.length > 0) {
      const filter_text = this.filter_input?.value.toLowerCase() ?? ''
      this.render_filtered_animations(filter_text)
      this.custom_event = new CustomEvent('filtered-animations-listing', { detail: { selectedAnimations: this.get_selected_animation_indices() } })
      this.dispatchEvent(this.custom_event)
    }
  }

  public initialize_animations (animations: TransformedAnimationClipPair[]): void {
    // Convert to animations with state tracking
    this.all_animations = this.map_animations_to_state(animations)

    this.render_filtered_animations('')
  }

  public add_animations (animations: TransformedAnimationClipPair[]): void {
    const new_animations = this.map_animations_to_state(animations)

    this.all_animations.push(...new_animations)
    const filter_text = this.filter_input?.value.toLowerCase() ?? ''
    this.render_filtered_animations(filter_text)
  }

  /**
   * Convert the animation listing data to a format
   * that works for what the UI needs
   * @param animations The list of animations to convert to a format with state for the UI
   * @returns A list of animations with state for the UI to track which animations are selected for export and filtering
   */
  private map_animations_to_state (animations: TransformedAnimationClipPair[]): AnimationWithState[] {
    return animations.map((pair) => {
      const animation_with_state = pair.display_animation_clip as unknown as AnimationWithState
      animation_with_state.isChecked = false
      animation_with_state.metadata = pair.metadata // enhanced searching/display with custom animations
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
      this.render_filtered_animations(this.filter_input?.value ?? '')
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

        // If in "selected only" mode, re-render to remove unchecked animations immediately
        if (this.show_selected_only) {
          const filter_text = this.filter_input?.value.toLowerCase() ?? ''
          this.render_filtered_animations(filter_text)
        }
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

  public set_show_selected_only (show_selected: boolean): void {
    this.show_selected_only = show_selected
    const filter_text = this.filter_input?.value.toLowerCase() ?? ''
    this.render_filtered_animations(filter_text)
  }

  /** Toggle whether animations without a preview video are shown. */
  public set_show_all (show_all: boolean): void {
    this.show_all = show_all
    const filter_text = this.filter_input?.value.toLowerCase() ?? ''
    this.render_filtered_animations(filter_text)
    // Dispatch event so the count label updates.
    this.custom_event = new CustomEvent('filtered-animations-listing', { detail: { selectedAnimations: this.get_selected_animation_indices() } })
    this.dispatchEvent(this.custom_event)
  }

  /** Check whether an animation has a preview video available, based on
   *  the loaded manifest. Returns true if the manifest isn't loaded yet
   *  (fail-open: don't hide things just because the manifest is slow).
   *  The manifest stores filenames with spaces replaced by underscores,
   *  so we normalise the animation name the same way before checking. */
  private has_preview_video (anim_name: string): boolean {
    if (this.preview_manifest === null) return true
    const folder = RigConfig.by_skeleton_type(this.skeleton_type)?.animation_preview_folder ?? ''
    const names = this.preview_manifest[folder]
    if (names === undefined) return true
    const file_safe_name = anim_name.replace(/ /g, '_')
    return names.indexOf(file_safe_name) !== -1
  }

  private render_filtered_animations (filter_text: string): void {
    if (this.animation_list_container === null) {
      return
    }

    // Filter animations based on search text and selected-only mode
    this.filtered_animations_list = this.all_animations.filter(animation => {
      const matches_search = animation.name.toLowerCase().includes(filter_text)
      if (this.show_selected_only) {
        return matches_search && animation.isChecked === true
      }
      // When show_all is false (default), hide library animations that
      // don't have a preview video. Custom-imported animations are always
      // shown (they're user-added, not from the library).
      const is_custom = animation.metadata?.source_type === 'custom-import'
      if (!this.show_all && !is_custom && !this.has_preview_video(animation.name)) {
        return false
      }
      return matches_search
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
      const preview_folder: string = RigConfig.by_skeleton_type(this.skeleton_type)?.animation_preview_folder ?? 'error'
      if (preview_folder === 'error') {
        console.error('Unknown skeleton type for animation previews. Add the rig to RigConfig.ts.')
      }

      const anim_name: string = animation_clip.name
      const theme_name: string = this.theme_manager.get_current_theme()
      const is_custom_animation = animation_clip.metadata?.source_type === 'custom-import'

      // The preview video filename uses underscores where the animation
      // clip name uses spaces (e.g. clip "Consume Item" -> file
      // "dark_Consume_Item.mp4"). We normalise by replacing spaces with
      // underscores so the URL has no spaces (which browsers/servers
      // mishandle, returning text/html instead of video/mp4).
      const file_safe_anim_name = anim_name.replace(/ /g, '_')
      const preview_data_src_attribute = is_custom_animation
        ? ''
        : ` data-src="../animpreviews/${preview_folder}/${theme_name}_${file_safe_anim_name}.mp4"`

      const custom_animation_badge_html = is_custom_animation
        ? '<span class="anim-custom-badge" title="Custom animation" aria-label="Custom animation">C</span>'
        : ''

      const animation_entry_html = `
        <div class="${is_custom_animation ? 'anim-custom-item' : 'anim-item'}">
          <button class="secondary-button play" data-index="${original_index}" style="display: flex; flex-direction:column; position: relative;">
            ${custom_animation_badge_html}
            <div class="anim-preview-placeholder"${preview_data_src_attribute} style="pointer-events: none;"></div>
            <label class="styled-checkbox">
              <input type="checkbox" name="${animation_clip.name}" value="${original_index}" ${checked_attribute}>
              <span class="anim-preview-label">${this.animation_name_clean(animation_clip.name)}</span>
            </label>
          </button>
        </div>`

      // append the entire item HTML to the DOM element
      this.animation_list_container.innerHTML += animation_entry_html
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

        // abort if animation entry is outside active viewing area (but don't unload - causes popping)
        if (!entry.isIntersecting) {
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
    }, { rootMargin: '300px' }) // rootMargin pre-loads videos before they scroll into view to reduce popping

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
