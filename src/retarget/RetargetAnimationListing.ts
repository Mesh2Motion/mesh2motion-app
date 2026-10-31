import { AnimationPlayer } from '../lib/processes/animations-listing/AnimationPlayer.ts'
import { AnimationSearch } from '../lib/processes/animations-listing/AnimationSearch.ts'
import { AnimationLoader } from '../lib/processes/animations-listing/AnimationLoader.ts'
import { AnimationLibrary, type AnimationLibraryLoadProgress } from '../lib/processes/animations-listing/AnimationLibrary.ts'
import { AnimationLibraryProgressBar } from '../lib/processes/animations-listing/AnimationLibraryProgressBar.ts'
import { AnimationUtility } from '../lib/processes/animations-listing/AnimationUtility.ts'
import { ArmExtensionControl } from '../lib/processes/animations-listing/ArmExtensionControl.ts'
import { type AnimationClip, AnimationMixer, type SkinnedMesh, Object3D, type AnimationAction } from 'three'
import type { ThemeManager } from '../lib/ThemeManager.ts'
import { type TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair.ts'
import { type AnimationClipExportSelection } from '../lib/processes/animations-listing/interfaces/AnimationExportSelection.ts'
import { AnimationRetargetService } from './AnimationRetargetService.ts'
import { StepExportRetargetedAnimations } from './steps/StepExportRetargetedAnimations.ts'
import { UI } from '../lib/UI.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { DownloadSettings } from '../lib/processes/export-to-file/DownloadSettings.ts'
import { ModalDialog } from '../lib/ModalDialog.ts'

/**
 * RetargetAnimationListing - Handles animation listing and playback specifically for retargeting workflow
 * Reuses AnimationPlayer, AnimationSearch, and AnimationLibrary but tailored for retargeting needs
 */
export class RetargetAnimationListing extends EventTarget {
  private readonly theme_manager: ThemeManager
  private readonly animation_player: AnimationPlayer
  private readonly animation_loader: AnimationLoader = new AnimationLoader()
  private readonly step_export_retargeted_animations: StepExportRetargetedAnimations = new StepExportRetargetedAnimations()
  private readonly download_settings: DownloadSettings
  private readonly animation_library: AnimationLibrary = new AnimationLibrary(this.animation_loader)
  private animation_mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private readonly ui: UI = UI.getInstance()

  // shared "Expand / Contract Arms" controls. owns the current arm extension amount
  private readonly arm_extension_control: ArmExtensionControl = ArmExtensionControl.getInstance()

  // null means nothing has been played yet, so there is nothing to re-play when the
  // arm extension changes. unlike the create workflow, this step does not auto-play
  private current_playing_id: string | null = null

  private _added_event_listeners: boolean = false

  public animation_search: AnimationSearch | null = null

  private is_animations_active: boolean = false

  private export_button: HTMLButtonElement | null = null

  constructor (theme_manager: ThemeManager, download_settings: DownloadSettings) {
    super()
    this.theme_manager = theme_manager
    this.download_settings = download_settings
    this.animation_player = new AnimationPlayer()

    // The warp is applied to the source-space display clip, so both the preview
    // and the export (which each retarget the display clip) pick it up.
    this.animation_library.set_display_transform((clip_pairs: TransformedAnimationClipPair[]) => {
      AnimationUtility.apply_arm_extension_warp(clip_pairs, this.arm_extension_control.value())
    })
  }

  public begin (): void {
    this.reset_step_data()

    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    // the arm extension markup is static, so it survives leaving and re-entering this
    // step. re-point it at this instance and clear whatever the last visit left behind
    this.arm_extension_control.initialize(() => {
      this.update_arm_extension_value()
    })
    this.arm_extension_control.reset()
    this.arm_extension_control.set_visible(
      AnimationRetargetService.getInstance().get_skeleton_type() === SkeletonType.Human
    )

    this.show_bone_toggle_button(true)
  }

  public end (): void {
    this.show_bone_toggle_button(false) // cannot toggle bone display in configuration area
    this.stop_preview() // stop any playing animations in the listing
  }

  private show_bone_toggle_button (show: boolean): void {
    if (this.ui.dom_show_skeleton_container != null) {
      this.ui.dom_show_skeleton_container.style.display = show ? 'inline-flex' : 'none'
    }
  }

  public reset_step_data (): void {
    this.animation_library.clear()
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.current_playing_id = null
    this.animation_player.clear_animation()
  }

  public mixer (): AnimationMixer {
    return this.animation_mixer
  }

  /**
   * This will be called any time we enter the retarget animation listing step
   */
  public start_preview (): void {
    this.is_animations_active = true
  }

  public stop_preview (): void {
    this.is_animations_active = false

    // Stop all active animations in the mixer
    // this is really important if we go back to the bone mapping
    // this makes sure to stop any running animations in listing
    if (this.animation_mixer !== null) {
      this.animation_mixer.stopAllAction()
    }

    // Clear the animation player UI
    this.animation_player.clear_animation()
  }

  public load_and_apply_default_animation_to_skinned_mesh (): void {
    this.animation_loader.set_static_root_path('../')
    this.animation_mixer = new AnimationMixer(new Object3D())

    // lists every animation for the source rig right away. Each GLB downloads the first time it is played or exported
    this.animation_library.reset(AnimationRetargetService.getInstance().get_skeleton_type(), 1.0)
    this.on_all_animations_loaded()
  }

  /**
   * Enable the export button only if there are animations selected
   */
  private update_export_button_enabled_state (): void {
    // if there are no animations selected disable the download button

    const animations_selected_count: number = this.animation_search?.get_selected_animation_ids().length ?? 0
    const export_count: number = this.animation_search?.get_selected_export_animation_count() ?? 0

    if (this.export_button !== null) {
      this.export_button.disabled = animations_selected_count === 0
    }

    // update the count inside the export/download button
    const count_element = document.getElementById('animation-selection-count')
    if (count_element !== null) {
      count_element.textContent = export_count.toString()
    }
  }

  private on_all_animations_loaded (): void {
    // Build animation UI
    this.build_animation_clip_ui()

    // Update animation selection count when selections change
    this.animation_search?.addEventListener('export-options-changed', () => {
      this.update_export_button_enabled_state()
    })

    // Update animation listing count display
    const listing_count_element = document.getElementById('animation-listing-count')
    if (listing_count_element !== null) {
      listing_count_element.textContent = this.animation_library.all().length.toString() + ' animations'
    }

    // the export button enabled state relies on the animation search being initialized
    // since we created a new one above, we need to recalculate this method
    this.update_export_button_enabled_state()

    console.log(`Listed ${this.animation_library.all().length} animations for retargeting`)
  }

  private build_animation_clip_ui (): void {
    // Initialize AnimationSearch with every animation in the library
    this.animation_search = new AnimationSearch(
      'animation-filter',
      'animations-items',
      this.theme_manager,
      AnimationRetargetService.getInstance().get_skeleton_type()
    )

    this.animation_search.initialize_animations(this.animation_library.all())

    // Add click event listeners to animation items for playback
    const animations_container = document.getElementById('animations-items')
    if (animations_container !== null) {
      animations_container.addEventListener('click', (event) => {
        const target = event.target as HTMLElement
        const button = target.closest('.play')

        const animation_id = (button as HTMLButtonElement | null)?.dataset.animationId
        if (animation_id !== undefined) {
          this.play_animation(animation_id)
        }
      })
    }
  }

  // called by ArmExtensionControl whenever the arm extension amount changes
  private update_arm_extension_value (): void {
    this.animation_library.rebuild_display_clips()

    // nothing auto-plays in this step, so only re-play if the user picked an animation
    if (this.current_playing_id !== null) {
      this.play_animation(this.current_playing_id)
    }
  }

  private play_animation (animation_id: string): void {
    const animation_pair = this.animation_library.find(animation_id)?.clip_pair
    if (animation_pair === undefined) {
      console.warn('Invalid animation id:', animation_id)
      return
    }

    this.current_playing_id = animation_id

    // download the animation the first time it is played, then play it if it is still the one picked
    if (animation_pair === null) {
      this.animation_library.load(animation_id)
        .then(() => {
          if (this.current_playing_id === animation_id) {
            this.play_animation(animation_id)
          }
        })
        .catch((error: unknown) => {
          console.error('Failed to load animation:', animation_id, error)
        })
      return
    }

    const display_clip = animation_pair.display_animation_clip

    // the mixer keeps an internal cache of every clip it has been handed. dragging the
    // arm extension slider fires an input event per pixel, and each one produces a new
    // retargeted clip, so replace the mixer instead of letting dead clips pile up
    this.animation_mixer.stopAllAction()
    this.animation_mixer = new AnimationMixer(new Object3D())

    // Retarget the animation using the shared service
    const retargeted_clip: AnimationClip = AnimationRetargetService.getInstance().retarget_animation_clip(
      display_clip
    )

    // Create new actions for each skinned mesh with the retargeted animation
    const skinned_meshes_to_animate: SkinnedMesh[] = AnimationRetargetService.getInstance().get_target_skinned_meshes()
    const actions: AnimationAction[] = skinned_meshes_to_animate.map((mesh) => {
      const action = this.animation_mixer.clipAction(retargeted_clip, mesh)
      action.reset()
      action.play()
      return action
    })

    // Update the animation player UI
    this.animation_player.set_animation(retargeted_clip, actions)

    console.log('Playing retargeted animation:', retargeted_clip.name)
  }

  private add_event_listeners (): void {
    // Add any retarget-specific event listeners here
    // For now, keeping it minimal
    this.setup_animation_loop()

    // progress for downloading many animations at once before an export
    this.animation_library.addEventListener('progress', (event: Event) => {
      AnimationLibraryProgressBar.update((event as CustomEvent<AnimationLibraryLoadProgress>).detail)
    })

    // configure export animations button
    this.export_button = document.getElementById('export-retargeting-button') as HTMLButtonElement
    this.export_button?.addEventListener('click', () => {
      // send in all the selected animation clips for export
      this.get_animation_clips_to_export()
        .then(async (export_selections) => {
          this.step_export_retargeted_animations.set_animation_clips_to_export(export_selections)

          // configure the export out step with retargeting info
          await this.step_export_retargeted_animations.export('retargeted_animations', this.download_settings)
        })
        .catch((error: unknown) => {
          const error_message = error instanceof Error ? error.message : 'Unknown export error'
          new ModalDialog('Retarget export failed', error_message).show()
        })
    })

    // event listener for animation view mode tabs (Library vs Selected)
    const animation_view_radios = document.querySelectorAll('input[name="animation-view-mode"]')
    animation_view_radios.forEach((radio) => {
      radio.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement
        const show_selected_only = target.value === 'selected'
        this.animation_search?.set_show_selected_only(show_selected_only)
      })
    })

    // event listener for select all / deselect all button
    const toggle_select_all_button = document.querySelector('#toggle-select-all-animations')
    toggle_select_all_button?.addEventListener('click', () => {
      this.animation_search?.toggle_select_all_animations()
      // Update the export button disabled state and count, including selections hidden by filtering
      this.update_export_button_enabled_state()
    })
  }

  public get_animation_player (): AnimationPlayer {
    return this.animation_player
  }

  public get_selected_animation_ids (): string[] {
    return this.animation_search?.get_selected_animation_ids() ?? []
  }

  /**
   * Downloads any selected animations that are not loaded yet, then returns the display
   * clip for each selection so the export includes the current arm extension.
   */
  private async get_animation_clips_to_export (): Promise<AnimationClipExportSelection[]> {
    const export_selections = this.animation_search?.get_selected_animation_export_selections() ?? []
    await this.animation_library.load_many(export_selections.map(selection => selection.animation_id))

    return export_selections.flatMap((selection) => {
      const clip_pair = this.animation_library.find(selection.animation_id)?.clip_pair
      if (clip_pair === undefined || clip_pair === null) {
        return []
      }
      return [{ clip: clip_pair.display_animation_clip, mirror_export_mode: selection.mirror_export_mode }]
    })
  }

  private setup_animation_loop (): void {
    let last_time = performance.now()
    const animate = (): void => {
      requestAnimationFrame(animate)

      // calculate delta time and pass it into preview
      const current_time = performance.now()
      const delta_time = (current_time - last_time) / 1000 // Convert to seconds
      last_time = current_time

      if (this.is_animations_active) {
        this.animation_frame_logic(delta_time)
      }
    }
    animate()
  }

  private animation_frame_logic (delta_time: number): void {
    if (this.animation_mixer === null) return

    this.animation_mixer.update(delta_time)
    this.animation_player.update(delta_time)

    // CRITICAL: Update the skeleton and skinned meshes after animation changes the bones
    // const skinned_meshes: SkinnedMesh[] = AnimationRetargetService.getInstance().get_target_skinned_meshes()
    // skinned_meshes.forEach((skinned_mesh) => {
    //   skinned_mesh.skeleton.bones.forEach(bone => {
    //     bone.updateMatrixWorld(true)
    //   })
    // })
  }
}
