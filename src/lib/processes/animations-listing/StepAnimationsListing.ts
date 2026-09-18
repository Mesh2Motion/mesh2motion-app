import { UI } from '../../UI.ts'
import { AnimationPlayer } from './AnimationPlayer.ts'

import {
  type AnimationClip, AnimationMixer, type SkinnedMesh, type AnimationAction, Object3D, type Scene
} from 'three'

import { AnimationUtility } from './AnimationUtility.ts'
import { ArmExtensionControl } from './ArmExtensionControl.ts'
import { AnimationLoader, type AnimationLoadProgress } from './AnimationLoader.ts'
import { CustomAnimationImporter } from './CustomAnimationImporter.ts'
import { type ModelVariationSwitcher } from './ModelVariationSwitcher.ts'

import { SkeletonType } from '../../enums/SkeletonType.ts'
import { RigConfig } from '../../RigConfig.ts'
import { Utility } from '../../Utilities.ts'
import { type ThemeManager } from '../../ThemeManager.ts'
import { AnimationSearch } from './AnimationSearch.ts'
import { type AnimationClipMetadata, type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { type AnimationExportSelection } from './interfaces/AnimationExportSelection.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepAnimationsListing extends EventTarget {
  private readonly theme_manager: ThemeManager
  private readonly ui: UI
  private readonly animation_player: AnimationPlayer
  private animation_clips_loaded: TransformedAnimationClipPair[] = []
  private readonly animation_loader: AnimationLoader = new AnimationLoader()

  private animation_mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private skinned_meshes_to_animate: SkinnedMesh[] = []
  private model_variation_switcher: ModelVariationSwitcher | null = null
  private current_playing_index: number = 0
  private skeleton_type: SkeletonType = SkeletonType.Human

  private animations_file_path: string = 'animations/'

  // retrieved from load skeleton step
  // we will use this to scale all position animation keyframes (uniform scale)
  private skeleton_scale: number = 1.0

  // per model variation multiplier for the position tracking bone (pelvis/hips) keyframes
  private model_variation_pelvis_position_scale: number = 1.0

  private readonly custom_animation_importer: CustomAnimationImporter

  private _added_event_listeners: boolean = false
  private is_loading_default_animations: boolean = false
  private a_pose_debounce_timer: ReturnType<typeof setTimeout> | null = null

  // enable status for mirroring animations
  public mirror_animations_enabled: boolean = false

  // Animation search functionality
  public animation_search: AnimationSearch | null = null

  public set_animations_file_path (path: string): void {
    this.animations_file_path = path
  }

  // shared "Expand / Contract Arms" controls. owns the current arm extension amount
  private readonly arm_extension_control: ArmExtensionControl = ArmExtensionControl.getInstance()

  private has_added_event_listeners: boolean = false

  constructor (theme_manager: ThemeManager) {
    super()
    this.ui = UI.getInstance()
    this.animation_player = new AnimationPlayer()
    this.theme_manager = theme_manager

    this.custom_animation_importer = new CustomAnimationImporter(this.animation_loader)

    // fancy way to bind the import context by implementing the function
    // from the CustomAnimationImporter and passing in the current context values. this allows
    // the CustomAnimationImporter to be decoupled from the StepAnimationsListing
    this.custom_animation_importer.set_import_context_provider(() => {
      return {
        skinned_meshes_to_animate: this.skinned_meshes_to_animate,
        skeleton_scale: this.skeleton_scale
      }
    })

    this.custom_animation_importer.addEventListener('import-success', (event: Event) => {
      const new_clips = (event as CustomEvent<TransformedAnimationClipPair[]>).detail
      this.animation_clips_loaded.push(...new_clips)
      this.onAllAnimationsLoaded()
    })
  }

  public begin (skeleton_type: SkeletonType, skeleton_scale: number): void {
    this.skeleton_scale = skeleton_scale

    if (this.ui.dom_current_step_element != null) {
      this.ui.dom_current_step_element.innerHTML = 'Test animations'
    }

    if (this.ui.dom_skinned_mesh_tools != null) {
      this.ui.dom_skinned_mesh_tools.style.display = 'flex'
    }

    if (this.ui.dom_skinned_mesh_animation_tools != null) {
      this.ui.dom_skinned_mesh_animation_tools.style.display = 'flex'
    }

    // bone display toggle only works in animation preview since
    // everything is setup by now
    if (this.ui.dom_show_skeleton_container != null) {
      this.ui.dom_show_skeleton_container.style.display = 'inline-flex'
    }

    this.reset_step_data()
    this.custom_animation_importer.set_enabled(!this.is_loading_default_animations)

    this.skeleton_type = skeleton_type

    // if we are navigating back to this step, we don't want to add the event listeners again
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    this.update_download_button_enabled()
  }

  public reset_step_data (): void {
    // reset previous state if we are re-entering this step
    // this will happen if we are reskinning the mesh after changes
    this.animation_clips_loaded = []
    this.skinned_meshes_to_animate = []
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.current_playing_index = 0
    this.animation_search = null
    this.model_variation_pelvis_position_scale = 1.0
    this.reset_ui_elements()
    this.animation_player.clear_animation()
  }

  // If we change skeleton types, we need to reset some of the state 
  // in the case we selected animations. This clears the UI state associated with that.
  private reset_ui_elements (): void {
    if (this.ui.dom_animation_clip_list !== null) {
      this.ui.dom_animation_clip_list.innerHTML = ''
    }

    if (this.ui.dom_animation_count !== null) {
      this.ui.dom_animation_count.innerHTML = '0'
    }

    if (this.ui.dom_animations_listing_count !== null) {
      this.ui.dom_animations_listing_count.innerHTML = '0 animations'
    }

    if (this.ui.dom_export_button !== null) {
      this.ui.dom_export_button.disabled = true
    }
  }

  public mixer (): AnimationMixer {
    return this.animation_mixer
  }

  // setup in the bootstrap.ts file and only called if we are actively
  // on this step
  public frame_change (delta_time: number): void {
    this.mixer().update(delta_time)
    this.animation_player.update(delta_time)
  }

  /**
   * Returns a list of all of the currently-displayed animation clips.
   */
  public animation_clips (): AnimationClip[] {
    return this.animation_clips_loaded.map(clip => clip.display_animation_clip)
  }

  public get_animation_metadata (index: number): AnimationClipMetadata | null {
    if (index < 0 || index >= this.animation_clips_loaded.length) {
      return null
    }

    return this.animation_clips_loaded[index].metadata
  }

  public is_animation_custom (index: number): boolean {
    return this.get_animation_metadata(index)?.source_type === 'custom-import'
  }

  /**
   * Returns the skinned meshes currently used for animation playback.
   * This is used during the download/export process to retrieved final skinned mesh
   */
  public active_skinned_meshes (): SkinnedMesh[] {
    return this.skinned_meshes_to_animate
  }

  public set_model_variation_switcher (switcher: ModelVariationSwitcher): void {
    this.model_variation_switcher = switcher
  }

  /**
   * Applies the current arm-extension deformation for the active model variation
   * and immediately replays the current animation when the Explore page swaps models.
   */
  public apply_model_variation_arm_extension (value: number): void {
    this.arm_extension_control.set_value(value)

    if (this.animation_clips_loaded.length === 0) {
      return
    }

    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_index)
  }

  /**
   * Applies the pelvis/hips position scale for the active model variation.
   * Taller variations need their hips raised so their feet stay on the ground.
   */
  public apply_model_variation_pelvis_position_scale (value: number): void {
    this.model_variation_pelvis_position_scale = value

    if (this.animation_clips_loaded.length === 0) {
      return
    }

    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_index)
  }

  /**
   * Removes the current skinned meshes from the scene, adds the new ones,
   * and replays the current animation on them.
   */
  public swap_skinned_meshes (scene: Scene, new_skinned_meshes: SkinnedMesh[]): void {
    const is_variation_active = this.model_variation_switcher?.is_variation_active ?? false
    this.clear_variation_model_from_scene()

    if (!is_variation_active) {
      // remove the original skinned meshes that were added individually
      for (const mesh of this.skinned_meshes_to_animate) {
        Utility.remove_object_with_children(mesh)
      }
    }

    // add individual skinned meshes to scene (bones are children of the mesh after normalization)
    if (this.model_variation_switcher !== null) {
      this.model_variation_switcher.is_variation_active = true
    }
    for (const mesh of new_skinned_meshes) {
      scene.add(mesh)
    }

    this.skinned_meshes_to_animate = new_skinned_meshes

    // replay current animation on the new meshes
    this.play_animation(this.current_playing_index)
    this.animation_player.play()
  }

  /**
   * Clears any variation model root that was injected during model variation swapping.
   * This should be called before doing a full model load flow.
   */
  public clear_variation_model_from_scene (): void {
    const is_variation_active = this.model_variation_switcher?.is_variation_active ?? false
    if (is_variation_active) {
      for (const mesh of this.skinned_meshes_to_animate) {
        Utility.remove_object_with_children(mesh)
      }
      if (this.model_variation_switcher !== null) {
        this.model_variation_switcher.is_variation_active = false
      }
    }
  }

  public load_and_apply_default_animation_to_skinned_mesh (final_skinned_meshes: SkinnedMesh[]): void {
    this.skinned_meshes_to_animate = final_skinned_meshes

    // Set the animations file path on the loader
    this.animation_loader.set_animations_file_path(this.animations_file_path)

    this.is_loading_default_animations = true
    this.custom_animation_importer.set_enabled(false)

    // Reset the animation clips loaded
    this.animation_clips_loaded = []
    // Create an animation mixer to do the playback. Play the first by default
    this.animation_mixer = new AnimationMixer(new Object3D())

    // Load animations using the new AnimationLoader
    this.animation_loader.load_animations(this.skeleton_type, this.skeleton_scale)
      .then((loaded_clips: TransformedAnimationClipPair[]) => {
        this.animation_clips_loaded = loaded_clips
        this.onAllAnimationsLoaded()
      })
      .catch((error: Error) => {
        console.error('Failed to load animations:', error)
        this.is_loading_default_animations = false
        this.custom_animation_importer.set_enabled(true)
        // You could emit an error event here or show a user-friendly message
      })
  }

  private onAllAnimationsLoaded (): void {
    this.is_loading_default_animations = false
    this.custom_animation_importer.set_enabled(true)
    // sort all animation names alphabetically
    this.animation_clips_loaded.sort((a: TransformedAnimationClipPair, b: TransformedAnimationClipPair) => {
      if (a.display_animation_clip.name < b.display_animation_clip.name) { return -1 }
      if (a.display_animation_clip.name > b.display_animation_clip.name) { return 1 }
      return 0
    })

    // create user interface with all available animation clips
    this.build_animation_clip_ui(
      this.animation_clips_loaded,
      this.theme_manager
    )

    // add event listener to listem for checkbox changes when we change
    // the amount of animations to export
    this.animation_search?.addEventListener('export-options-changed', () => {
      // update the count for the download button
      if (this.ui.dom_animation_count != null) {
        this.ui.dom_animation_count.innerHTML = this.animation_search?.get_selected_export_animation_count().toString() ?? '0'
      }
    })

    // add event listener to listen for filtered animations listing
    this.update_filtered_animation_listing_ui()
    this.animation_search?.addEventListener('filtered-animations-listing', () => {
      this.update_filtered_animation_listing_ui()
    })

    this.play_animation(0) // play the first animation by default
  }

  private onAnimationLoadProgress (progress: AnimationLoadProgress): void {
    if (this.ui.dom_loading_progress_bar !== null) {
      this.ui.dom_loading_progress_bar.style.width = `${progress.percentage}%`

      const mb_loaded: string = (progress.overallBytesLoaded / (1024 * 1024)).toFixed(1)
      const mb_total: string = (progress.overallBytesTotal / (1024 * 1024)).toFixed(1)
      this.ui.dom_loading_progress_bar.textContent = `${mb_loaded} / ${mb_total} MB`
    }

    if (this.ui.dom_current_file_progress_bar !== null) {
      this.ui.dom_current_file_progress_bar.style.width = `${progress.currentFileProgress}%`
    }

    // if we are done loading, we can hide the container
    if (progress.percentage >= 100) {
      if (this.ui.dom_animation_progress_loader_container !== null) {
        this.ui.dom_animation_progress_loader_container.style.display = 'none'
      }
    } else {
      // make sure it is visible while loading
      if (this.ui.dom_animation_progress_loader_container !== null) {
        this.ui.dom_animation_progress_loader_container.style.display = 'flex'
      }
    }

    // can potentially shows file name loading...not sure if we need to actually show this.
    // if (this.ui.dom_loading_status_text !== null && progress.currentFile !== '') {
    //   const file_name = progress.currentFile.split('/').pop() ?? progress.currentFile
    //   this.ui.dom_loading_status_text.textContent = `Loading ${file_name}...`
    // }
  }

  private update_filtered_animation_listing_ui (): void {
    const animation_length_string: string = this.animation_search?.filtered_animations().length.toString() ?? '0'
    if (this.ui.dom_animations_listing_count != null) {
      this.ui.dom_animations_listing_count.innerHTML = animation_length_string + ' animations'
    }
  }

  /**
   * Rebuilds all of the warped animations by applying the specified warps.
   */
  private rebuild_warped_animations (): void {
    // Reset all of the warped clips to the corresponding original clip.
    this.animation_clips_loaded.forEach((warped_clip: TransformedAnimationClipPair) => {
      warped_clip.display_animation_clip = AnimationUtility.deep_clone_animation_clip(warped_clip.original_animation_clip)
    })

    if (this.mirror_animations_enabled) {
      AnimationUtility.apply_animation_mirroring(this.animation_clips_loaded)
    }

    /// Apply the arm extension warp:
    AnimationUtility.apply_arm_extension_warp(this.animation_clips_loaded, this.arm_extension_control.value())

    /// Raise/lower the hips to match the proportions of the active model variation:
    AnimationUtility.apply_position_tracking_bone_scale(
      this.animation_clips_loaded,
      RigConfig.by_skeleton_type(this.skeleton_type)?.position_tracking_bone_name,
      this.model_variation_pelvis_position_scale
    )
  }

  /**
   * Not all animation files have root bone keyframes, so we need to make
   * sure this is reset between animations to fully reset the animation state
   * @param skinned_mesh
   */
  private reset_root_motion_position (skinned_mesh: SkinnedMesh): void {
    if (skinned_mesh.skeleton.bones.length > 0) {
      const root_bone = skinned_mesh.skeleton.bones[0] // should always be root bone
      root_bone.position.set(0, 0, 0)
      root_bone.updateMatrixWorld(true)
    }
  }

  private play_animation (index: number = 0): void {
    this.current_playing_index = index

    // animation mixer has internal cache with animations. doing this helps clear it
    // otherwise modifications like arm extension will not update
    this.animation_mixer = new AnimationMixer(new Object3D())

    const all_animation_actions: AnimationAction[] = []

    this.skinned_meshes_to_animate.forEach((skinned_mesh: SkinnedMesh) => {
      this.reset_root_motion_position(skinned_mesh)

      const clip_to_play: AnimationClip = this.animation_clips_loaded[this.current_playing_index].display_animation_clip
      const anim_action: AnimationAction = this.animation_mixer.clipAction(clip_to_play, skinned_mesh)

      anim_action.stop()
      anim_action.play()

      // Collect all animation actions for the animation player
      all_animation_actions.push(anim_action)
    })

    // Update the animation player with the current animation and all actions
    if (all_animation_actions.length > 0) {
      const clip_to_play: AnimationClip = this.animation_clips_loaded[this.current_playing_index].display_animation_clip
      this.animation_player.set_animation(clip_to_play, all_animation_actions)
    }
  }

  private update_download_button_enabled (): void {
    // see if any of the "export" checkboxes are active. if not we need to disable the "Download" button
    const animation_checkboxes = this.get_animated_selected_elements()
    const is_any_checkbox_checked: boolean = Array.from(animation_checkboxes).some((checkbox) => {
      return (checkbox as HTMLInputElement).checked
    })
    if (this.ui.dom_export_button != null) {
      this.ui.dom_export_button.disabled = !is_any_checkbox_checked
    }
  }

  private add_event_listeners (): void {
    // make sure to only add the event listeners once
    // this could be potentially called multiple times when going back and forth
    // between editing skeleton and this step
    if (this.has_added_event_listeners) {
      console.info('Event listeners already added to animation step. Skipping.')
      return
    }

    // Add progress event for when animation GLB file is downloading for skeleton
    this.animation_loader.addEventListener('progress', (event: Event) => {
      const progress = (event as CustomEvent<AnimationLoadProgress>).detail
      this.onAnimationLoadProgress(progress)
    })

    // event listener for animation clip list with changing the current animation
    if (this.ui.dom_animation_clip_list != null) {
      this.ui.dom_animation_clip_list.addEventListener('click', (event) => {
        this.update_download_button_enabled()

        if (event.target != null) {
          const play_button = (event.target as HTMLElement).closest('button[data-action="play-animation"]')
          if (play_button === null) {
            return
          }

          const animation_index_str = play_button.getAttribute('data-index')
          if (animation_index_str != null) {
            const animation_index: number = Number(animation_index_str)
            this.play_animation(animation_index)
          }
        }
      })
    }

    // shared A-Pose arm extension controls (reset button, numeric input, range input)
    this.arm_extension_control.initialize(() => {
      this.update_a_pose_value()
    })

    // check for changes to mirror animations checkbox
    this.ui.dom_mirror_animations_checkbox?.addEventListener('change', () => {
      const is_checked: boolean = this.ui.dom_mirror_animations_checkbox?.checked ?? false
      this.mirror_animations_enabled = is_checked
      // Rebuild animations with or without mirroring
      this.rebuild_warped_animations()
      this.play_animation(this.current_playing_index)
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
      this.update_download_button_enabled()
    })

    // helps ensure we don't add event listeners multiple times
    this.has_added_event_listeners = true
  }

  // called by ArmExtensionControl whenever the arm extension amount changes
  private update_a_pose_value (): void {
    if (this.a_pose_debounce_timer !== null) {
      clearTimeout(this.a_pose_debounce_timer)
    }
    this.a_pose_debounce_timer = setTimeout(() => {
      this.a_pose_debounce_timer = null
      this.rebuild_warped_animations()
      this.play_animation(this.current_playing_index)
    }, 100)
  }

  public build_animation_clip_ui (animation_clips_to_load: TransformedAnimationClipPair[], theme_manager: ThemeManager): void {
    // Initialize AnimationSearch if not already done
    // we could switch skeleton types using navigation, so need to re-create in case this happens
    this.animation_search = new AnimationSearch('animation-filter', 'animations-items', theme_manager, this.skeleton_type)

    // Use the animation search class to handle the UI
    this.animation_search.initialize_animations(animation_clips_to_load)
  }

  public get_animated_selected_elements (): NodeListOf<Element> {
    // this needs to be called ad-hoc as selections might change
    return document.querySelectorAll('#animations-items input[type="checkbox"]')
  }

  public get_animation_indices_to_export (): number[] {
    if (this.animation_search === null) {
      return []
    }
    return this.animation_search.get_selected_animation_indices()
  }

  public get_animation_export_selections (): AnimationExportSelection[] {
    if (this.animation_search === null) {
      return []
    }

    return this.animation_search.get_selected_animation_export_selections()
  }
}
