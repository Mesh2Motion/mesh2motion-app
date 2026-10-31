import { type ThemeManager } from '../../ThemeManager'
import { SkeletonType } from '../../enums/SkeletonType'
import { RigConfig } from '../../RigConfig'
import { type AnimationWithState } from './interfaces/AnimationWithState'
import { type AnimationEntry } from './interfaces/AnimationEntry'
import { type AnimationExportSelection, type AnimationMirrorExportMode } from './interfaces/AnimationExportSelection'
import { AnimationRequestDialog } from '../../components/animation-request/AnimationRequestDialog'
import { ModalDialog } from '../../ModalDialog'

export class AnimationSearch extends EventTarget {
  private all_animations: AnimationWithState[] = []
  private readonly filter_input: HTMLInputElement | null = null
  private readonly tag_filter_button: HTMLButtonElement | null = null
  private readonly animation_list_container: HTMLElement | null = null
  private filtered_animations_list: AnimationWithState[] = []

  // tags used by the current animations, and the ones checked in the tag filter dialog
  private available_tags: string[] = []
  private readonly selected_tags = new Set<string>()

  private readonly theme_manager: ThemeManager
  private readonly skeleton_type: SkeletonType

  private custom_event: CustomEvent | null = null
  private show_selected_only: boolean = false

  private static readonly mirror_mode_cycle: AnimationMirrorExportMode[] = ['none', 'mirrored', 'both']

  private static readonly mirror_mode_icons: Record<AnimationMirrorExportMode, string> = {
    none: '/images/icons/mirror.svg',
    mirrored: '/images/icons/mirror.svg',
    both: '/images/icons/mirror-both.svg'
  }

  constructor (filter_input_id: string, animation_list_container_id: string, theme_manager: ThemeManager, skeleton_type: SkeletonType, tag_filter_button_id: string = 'animation-tag-filter-button') {
    super()
    this.filter_input = document.querySelector(`#${filter_input_id}`)
    this.tag_filter_button = document.querySelector(`#${tag_filter_button_id}`)
    this.animation_list_container = document.querySelector(`#${animation_list_container_id}`)
    this.theme_manager = theme_manager
    this.skeleton_type = skeleton_type
    this.setup_event_listeners()
    AnimationRequestDialog.enable_request_links()
  }

  public initialize_animations (animations: AnimationEntry[]): void {
    // Convert to animations with state tracking
    this.all_animations = this.map_animations_to_state(animations)

    this.update_available_tags()
    this.render_filtered_animations('')
  }

  public add_animations (animations: AnimationEntry[]): void {
    const new_animations = this.map_animations_to_state(animations)

    this.all_animations.push(...new_animations)
    this.all_animations.sort((a, b) => {
      if (a.name < b.name) { return -1 }
      if (a.name > b.name) { return 1 }
      return 0
    })
    this.update_available_tags()
    const filter_text = this.filter_input?.value.toLowerCase() ?? ''
    this.render_filtered_animations(filter_text)
  }

  /**
   * Collects every tag used by the current animations for the tag filter dialog.
   * The tag button is hidden when no animations have tags (most non-human rigs).
   */
  private update_available_tags (): void {
    const unique_tags = new Set<string>()
    this.all_animations.forEach(animation => {
      animation.metadata.tags.forEach(tag => unique_tags.add(tag.toLowerCase()))
    })
    this.available_tags = Array.from(unique_tags).sort()

    // drop any checked tags that no longer exist after adding animations
    this.selected_tags.forEach(tag => {
      if (!unique_tags.has(tag)) {
        this.selected_tags.delete(tag)
      }
    })

    if (this.tag_filter_button !== null) {
      this.tag_filter_button.style.display = this.available_tags.length > 0 ? '' : 'none'
    }
    this.update_tag_filter_button_state()
  }

  /** Shows how many tags are checked on the tag button so it is clear a filter is active */
  private update_tag_filter_button_state (): void {
    if (this.tag_filter_button === null) {
      return
    }

    const selected_count = this.selected_tags.size
    this.tag_filter_button.classList.toggle('active', selected_count > 0)

    const count_element = this.tag_filter_button.querySelector<HTMLElement>('#animation-tag-filter-count')
    if (count_element !== null) {
      count_element.textContent = selected_count.toString()
      count_element.style.display = selected_count > 0 ? '' : 'none'
    }
  }

  private tag_display_name (tag: string): string {
    return tag.charAt(0).toUpperCase() + tag.slice(1)
  }

  /**
   * Opens a dialog listing every tag as a checkbox. Checking a tag applies the filter
   * right away, so the dialog only needs a close button.
   */
  private show_tag_filter_dialog (): void {
    const tag_checkboxes_html = this.available_tags.map(tag => {
      const checked_attribute = this.selected_tags.has(tag) ? 'checked' : ''
      return `
        <label class="styled-checkbox">
          <input type="checkbox" value="${tag}" ${checked_attribute}>
          <span>${this.tag_display_name(tag)}</span>
        </label>`
    }).join('')

    const dialog = new ModalDialog('Filter by Tag', `<div class="tag-filter-list">${tag_checkboxes_html}</div>`, { customClass: 'tag-filter-dialog' })
    dialog.show()

    dialog.get_body_element()?.addEventListener('change', (event) => {
      const checkbox = event.target as HTMLInputElement
      if (checkbox.checked) {
        this.selected_tags.add(checkbox.value)
      } else {
        this.selected_tags.delete(checkbox.value)
      }
      this.apply_tag_filter()
    })
  }

  private apply_tag_filter (): void {
    this.update_tag_filter_button_state()

    const filter_text = this.filter_input?.value.toLowerCase() ?? ''
    this.render_filtered_animations(filter_text)

    this.custom_event = new CustomEvent('filtered-animations-listing', { detail: { selectedAnimations: this.get_selected_animation_ids() } })
    this.dispatchEvent(this.custom_event)
  }

  /**
   * Convert the animation listing data to a format
   * that works for what the UI needs
   * @param animations The list of animations to convert to a format with state for the UI
   * @returns A list of animations with state for the UI to track which animations are selected for export and filtering
   */
  private map_animations_to_state (animations: AnimationEntry[]): AnimationWithState[] {
    return animations.map((entry) => ({
      id: entry.id,
      name: entry.name,
      metadata: entry.metadata, // enhanced searching/display with custom animations
      isChecked: false,
      mirror_export_mode: 'none'
    }))
  }

  private find_animation (animation_id: string | null): AnimationWithState | undefined {
    return this.all_animations.find(animation => animation.id === animation_id)
  }

  private setup_event_listeners (): void {
    this.setup_filter_listener()
    this.setup_row_state_listeners()
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
      this.custom_event = new CustomEvent('filtered-animations-listing', { detail: { selectedAnimations: this.get_selected_animation_ids() } })
      this.dispatchEvent(this.custom_event)
    })

    // assigned instead of added because a new AnimationSearch is created when switching rigs,
    // and older instances should not open their own copy of the dialog
    if (this.tag_filter_button !== null) {
      this.tag_filter_button.onclick = () => { this.show_tag_filter_dialog() }
    }
  }

  private setup_row_state_listeners (): void {
    if (this.animation_list_container === null) {
      return
    }

    // Add event listener to the container for checkbox changes (event delegation)
    this.animation_list_container.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      if (target?.type === 'checkbox') {
        const row_element = target.closest('.anim-item, .anim-custom-item') as HTMLElement | null
        if (row_element !== null) {
          row_element.setAttribute('data-selected', target.checked ? 'true' : 'false')

          // If a tile is deselected, reset its mirror mode so re-select starts from None.
          if (!target.checked) {
            const animation = this.find_animation(row_element.getAttribute('data-animation-id'))
            if (animation !== undefined) {
              animation.mirror_export_mode = 'none'
            }

            const mirror_toggle = row_element.querySelector('button[data-action="cycle-mirror-mode"]') as HTMLButtonElement | null
            if (mirror_toggle !== null) {
              this.sync_mirror_toggle_button_state(mirror_toggle, 'none')
            }
          }
        }

        this.save_current_row_states()

        // If in "selected only" mode, re-render to remove unchecked animations immediately
        if (this.show_selected_only && target?.type === 'checkbox') {
          const filter_text = this.filter_input?.value.toLowerCase() ?? ''
          this.render_filtered_animations(filter_text)
        }
      }

      // emit an event to notify other parts of the application that export options have changed
      this.custom_event = new CustomEvent('export-options-changed', {
        detail: {
          selectedAnimations: this.get_selected_animation_ids(),
          exportAnimationCount: this.get_selected_export_animation_count()
        }
      })
      this.dispatchEvent(this.custom_event)
    })

    // Add event listener for tri-state mirror toggle button clicks.
    this.animation_list_container.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const toggle_button = target.closest('button[data-action="cycle-mirror-mode"]') as HTMLButtonElement | null
      if (toggle_button === null) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const animation = this.find_animation(toggle_button.getAttribute('data-animation-id'))
      if (animation === undefined) {
        return
      }

      const current_mode: AnimationMirrorExportMode = animation.mirror_export_mode ?? 'none'
      const next_mode = this.get_next_mirror_export_mode(current_mode)
      animation.mirror_export_mode = next_mode

      this.sync_mirror_toggle_button_state(toggle_button, next_mode)

      this.custom_event = new CustomEvent('export-options-changed', {
        detail: {
          selectedAnimations: this.get_selected_animation_ids(),
          exportAnimationCount: this.get_selected_export_animation_count()
        }
      })
      this.dispatchEvent(this.custom_event)
    })
  }

  private get_next_mirror_export_mode (current_mode: AnimationMirrorExportMode): AnimationMirrorExportMode {
    const current_index = AnimationSearch.mirror_mode_cycle.indexOf(current_mode)
    const next_index = current_index < 0
      ? 0
      : (current_index + 1) % AnimationSearch.mirror_mode_cycle.length

    return AnimationSearch.mirror_mode_cycle[next_index]
  }

  private get_mirror_toggle_label (mode: AnimationMirrorExportMode): string {

    const base_label = 'Export Mirrored Animation: '

    if (mode === 'none') {
      return base_label + 'No'
    }

    if (mode === 'mirrored') {
      return base_label + 'Yes'
    }

    return base_label + 'Original and Mirrored' // both options is only other choice
  }

  private sync_mirror_toggle_button_state (toggle_button: HTMLButtonElement, mode: AnimationMirrorExportMode): void {
    const mirror_toggle_label = this.get_mirror_toggle_label(mode)

    toggle_button.setAttribute('data-mirror-mode', mode)
    toggle_button.setAttribute('aria-label', mirror_toggle_label)
    toggle_button.setAttribute('title', mirror_toggle_label)

    const row_element = toggle_button.closest('.anim-item, .anim-custom-item') as HTMLElement | null
    if (row_element !== null) {
      row_element.setAttribute('data-mirror-mode', mode)
    }

    const icon_element = toggle_button.querySelector('img')
    if (icon_element !== null) {
      icon_element.setAttribute('src', AnimationSearch.mirror_mode_icons[mode])
      icon_element.setAttribute('alt', mirror_toggle_label)
    }
  }

  private save_current_row_states (): void {
    if (this.animation_list_container === null) {
      return
    }

    const checkboxes = this.animation_list_container.querySelectorAll('input[type="checkbox"]')
    checkboxes.forEach((checkbox) => {
      const input = checkbox as HTMLInputElement
      const animation = this.find_animation(input.value)

      if (animation !== undefined) {
        animation.isChecked = input.checked
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

  private render_filtered_animations (filter_text: string): void {
    if (this.animation_list_container === null) {
      return
    }

    // Filter animations based on search text, checked tags, and selected-only mode
    this.filtered_animations_list = this.all_animations.filter(animation => {
      // animations only need one of the checked tags to show up
      if (this.selected_tags.size > 0 && !animation.metadata.tags.some(tag => this.selected_tags.has(tag.toLowerCase()))) {
        return false
      }


      // some animation names have underscores (even though that isn't shown on UI), others have spaces. 
      // we need to support both for searching to get a consistent match. Tags like 'combat' match too
      const search_text = filter_text.toLowerCase().trim()
      const matches_search = animation.name.toLowerCase().replace(/_/g, ' ').includes(search_text) ||
        animation.metadata.tags.some(tag => tag.toLowerCase().includes(search_text))

      if (this.show_selected_only) {
        return matches_search && animation.isChecked === true
      }
      return matches_search
    })

    // Clear and rebuild the animation list
    this.animation_list_container.innerHTML = ''

    // Show "no animations found" if the filtered list is empty
    if (this.filtered_animations_list.length === 0) {
      this.animation_list_container.innerHTML = `
        <div class="no-animations-message">
          No animations found.
          <a href="#" class="request-animation-link" data-rig-type="${this.skeleton_type}">Request an animation</a>
        </div>`
      return
    }

    this.filtered_animations_list.forEach((animation_clip) => {
      if (this.animation_list_container == null) {
        return
      }

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

      const preview_data_src_attribute = is_custom_animation
        ? ''
        : ` data-src="../animpreviews/${preview_folder}/${theme_name}_${anim_name}.mp4"`

      const custom_animation_badge_html = is_custom_animation
        ? '<span class="anim-custom-badge" title="Custom animation" aria-label="Custom animation">C</span>'
        : ''

      const mirror_export_mode = animation_clip.mirror_export_mode ?? 'none'
      const mirror_toggle_label = this.get_mirror_toggle_label(mirror_export_mode)
      const animation_entry_html = `
        <div class="${is_custom_animation ? 'anim-custom-item' : 'anim-item'}" data-animation-id="${animation_clip.id}" data-selected="${was_checked ? 'true' : 'false'}" data-mirror-mode="${mirror_export_mode}">
          <button class="secondary-button play anim-play-button" data-action="play-animation" data-animation-id="${animation_clip.id}" aria-label="Play ${this.animation_name_clean(animation_clip.name)}">
            ${custom_animation_badge_html}
            <div class="anim-preview-placeholder"${preview_data_src_attribute}></div>
          </button>

          <label class="styled-checkbox anim-row-checkbox">
            <input type="checkbox" name="${animation_clip.name}" value="${animation_clip.id}" ${checked_attribute}>
            <span class="anim-preview-label">${this.animation_name_clean(animation_clip.name)}</span>
          </label>

          <button
            class="no-style-button anim-mirror-mode-toggle"
            type="button"
            data-action="cycle-mirror-mode"
            data-animation-id="${animation_clip.id}"
            data-mirror-mode="${mirror_export_mode}"
            aria-label="${mirror_toggle_label}"
            title="${mirror_toggle_label}"
          >
            <img src="${AnimationSearch.mirror_mode_icons[mirror_export_mode]}" alt="${mirror_toggle_label}" class="action-icon">
          </button>
        </div>`

      // append the entire item HTML to the DOM element
      this.animation_list_container.innerHTML += animation_entry_html
    })

    // when searching, the results might be close but not what they want (e.g. "wall" but looking for "wall run")
    // so give them a way to request an animation at the end of the results
    //if (filter_text.trim() !== '') {
      this.animation_list_container.insertAdjacentHTML('beforeend', `
        <a href="#" class="request-animation-link anim-request-tile" data-rig-type="${this.skeleton_type}">
          <span>Not finding what you want?</span>
          <span class="anim-request-tile-action">Request an animation</span>
        </a>`)
   // }

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
   * @returns An array of selected animation ids.
   */
  public get_selected_animation_ids (): string[] {
    return this.get_selected_animations().map(animation => animation.id)
  }

  public get_selected_animation_export_selections (): AnimationExportSelection[] {
    return this.get_selected_animations().map((animation): AnimationExportSelection => ({
      animation_id: animation.id,
      mirror_export_mode: animation.mirror_export_mode ?? 'none'
    }))
  }

  public get_selected_export_animation_count (): number {
    return this.all_animations.reduce((count, animation) => {
      if (animation.isChecked !== true) {
        return count
      }

      if (animation.mirror_export_mode === 'both') {
        return count + 2
      }

      return count + 1
    }, 0)
  }

  public clear_filter (): void {
    if (this.filter_input !== null) {
      this.filter_input.value = ''
      this.render_filtered_animations('')
    }
  }

  public toggle_select_all_animations (): void {
    // Only affect the animations currently visible after filtering,
    // so selections hidden by the text or tag filter are left alone
    const visible_animations = this.filtered_animations_list
    const all_selected = visible_animations.every(animation => animation.isChecked === true)

    // Toggle the state: if all are selected, deselect all; otherwise, select all
    const new_state = !all_selected
    visible_animations.forEach(animation => {
      animation.isChecked = new_state
    })

    // Update all checkboxes in the UI
    this.update_all_checkboxes_in_ui(new_state)

    // Save row state to ensure inputs are synced with backing animation state
    this.save_current_row_states()

    // If in "selected only" mode, re-render to update the displayed animations
    if (this.show_selected_only) {
      const filter_text = this.filter_input?.value.toLowerCase() ?? ''
      this.render_filtered_animations(filter_text)
    }

    // Emit event to notify that export options have changed
    this.custom_event = new CustomEvent('export-options-changed', {
      detail: {
        selectedAnimations: this.get_selected_animation_ids(),
        exportAnimationCount: this.get_selected_export_animation_count()
      }
    })
    this.dispatchEvent(this.custom_event)
  }

  private update_all_checkboxes_in_ui (checked_state: boolean): void {
    if (this.animation_list_container === null) {
      return
    }

    const checkboxes = this.animation_list_container.querySelectorAll('input[type="checkbox"]')
    checkboxes.forEach((checkbox) => {
      (checkbox as HTMLInputElement).checked = checked_state
    })
  }
}
