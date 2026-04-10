import { type AnimationClip, type AnimationAction } from 'three'
import { UI } from '../../UI'

export class AnimationPlayer {
  private readonly ui: UI
  private current_animation_clip: AnimationClip | null = null
  private current_animation_actions: AnimationAction[] = []
  private is_playing: boolean = false
  /// When the user grabs the scrubber, the animation is paused.
  /// If it was playing before the scrubber was grabbed, it will
  /// resume playing after the user lets go.
  private was_playing_before_user_scrubbed: boolean = false
  private is_user_scrubbing: boolean = false

  private readonly has_added_event_listeners: boolean = false

  constructor () {
    this.ui = UI.getInstance()

    if (!this.has_added_event_listeners) {
      this.setup_event_listeners()
      this.has_added_event_listeners = true
    }
  }

  private setup_event_listeners (): void {
    // Play/Pause button
    if (this.ui.dom_play_pause_button !== null) {
      this.ui.dom_play_pause_button.addEventListener('click', () => {
        this.toggle_play_pause()
      })
    }

    // Animation scrubber
    if (this.ui.dom_animation_scrubber !== null) {
      this.ui.dom_animation_scrubber.addEventListener('input', (event) => {
        this.handle_scrubber_input(event)
      })

      this.ui.dom_animation_scrubber.addEventListener('mousedown', () => {
        this.was_playing_before_user_scrubbed = this.is_playing
        this.pause()
        this.is_user_scrubbing = true
      })

      this.ui.dom_animation_scrubber.addEventListener('mouseup', () => {
        this.is_user_scrubbing = false
        if (this.was_playing_before_user_scrubbed) {
          this.was_playing_before_user_scrubbed = false
          this.play()
        }
      })
    }
  }

  public animation_name_clean (input: string): string {
    return input.replace(/_/g, ' ')
  }

  public set_animation (animation_clip: AnimationClip, animation_actions: AnimationAction[]): void {
    this.current_animation_clip = animation_clip
    this.current_animation_actions = animation_actions

    // Calculate total frames (assuming 30 FPS)
    const fps = 30
    const total_frames = Math.floor(animation_clip.duration * fps)

    // Update UI
    if (this.ui.dom_current_animation_name !== null) {
      this.ui.dom_current_animation_name.textContent = this.animation_name_clean(animation_clip.name)
    }

    if (this.ui.dom_total_time !== null) {
      this.ui.dom_total_time.textContent = `${total_frames}`
    }

    // Enable controls
    if (this.ui.dom_play_pause_button !== null) {
      this.ui.dom_play_pause_button.disabled = false
    }

    if (this.ui.dom_animation_scrubber !== null) {
      this.ui.dom_animation_scrubber.disabled = false
      this.ui.dom_animation_scrubber.max = total_frames.toString()
      this.ui.dom_animation_scrubber.value = '0'
    }

    // Set initial playing state based on first animation action
    this.is_playing = animation_actions.length > 0 ? animation_actions[0].isRunning() : false
    this.update_play_pause_button()
  }

  public clear_animation (): void {
    this.current_animation_clip = null
    this.current_animation_actions = []
    this.is_playing = false

    // Update UI
    if (this.ui.dom_current_animation_name !== null) {
      this.ui.dom_current_animation_name.textContent = 'No animation selected'
    }

    if (this.ui.dom_current_time !== null) {
      this.ui.dom_current_time.textContent = '0'
    }

    if (this.ui.dom_total_time !== null) {
      this.ui.dom_total_time.textContent = '0'
    }

    // Disable controls
    if (this.ui.dom_play_pause_button !== null) {
      this.ui.dom_play_pause_button.disabled = true
    }

    if (this.ui.dom_animation_scrubber !== null) {
      this.ui.dom_animation_scrubber.disabled = true
      this.ui.dom_animation_scrubber.value = '0'
    }

    this.update_play_pause_button()
  }

  public toggle_play_pause (): void {
    if (this.current_animation_actions.length === 0) {
      return
    }

    if (this.is_playing) {
      this.pause()
    } else {
      this.play()
    }
  }

  public play (): void {
    if (this.current_animation_actions.length === 0) {
      return
    }

    // Apply play/unpause to all animation actions
    this.current_animation_actions.forEach((action) => {
      if (action.paused === true) {
        action.paused = false
      } else {
        action.play()
      }
    })

    this.is_playing = true
    this.update_play_pause_button()
  }

  public pause (): void {
    if (this.current_animation_actions.length === 0) {
      return
    }

    // Apply pause to all animation actions
    this.current_animation_actions.forEach((action) => {
      action.paused = true
    })

    this.is_playing = false
    this.update_play_pause_button()
  }

  private update_play_pause_button (): void {
    if (this.ui.dom_play_pause_button === null) {
      return
    }

    const icon = this.ui.dom_play_pause_button.querySelector('.material-symbols-outlined')
    if (icon !== null) {
      icon.textContent = this.is_playing || this.was_playing_before_user_scrubbed ? 'pause' : 'play_arrow'
    }
  }

  private handle_scrubber_input (event: Event): void {
    if (this.current_animation_actions.length === 0 || this.current_animation_clip === null) {
      return
    }

    const target = event.target as HTMLInputElement
    const frame_number = parseFloat(target.value)

    // Convert frame to time (assuming 30 FPS)
    const fps = 30
    const scrub_time = frame_number / fps

    // Set the animation time for all actions
    this.current_animation_actions.forEach((action) => {
      action.time = scrub_time
    })

    // Update current frame display
    if (this.ui.dom_current_time !== null) {
      this.ui.dom_current_time.textContent = `${Math.round(frame_number)}`
    }
  }

  public update (_delta_time: number): void {
    if (this.current_animation_actions.length === 0 || this.current_animation_clip === null || this.is_user_scrubbing) {
      return
    }

    // Use the first action for time tracking (they should all be synchronized)
    const first_action = this.current_animation_actions[0]

    // Convert current time to frame number (assuming 30 FPS)
    const fps = 30
    const current_frame = first_action.time * fps

    // Update scrubber position based on frame number
    if (this.ui.dom_animation_scrubber !== null) {
      this.ui.dom_animation_scrubber.value = current_frame.toString()
    }

    // Update current frame display
    if (this.ui.dom_current_time !== null) {
      this.ui.dom_current_time.textContent = `${Math.round(current_frame)}`
    }

    // Check if animation has finished and loop it
    if (first_action.time >= this.current_animation_clip.duration) {
      this.current_animation_actions.forEach((action) => {
        action.time = 0
      })
    }
  }

  public get_is_playing (): boolean {
    return this.is_playing
  }
}
