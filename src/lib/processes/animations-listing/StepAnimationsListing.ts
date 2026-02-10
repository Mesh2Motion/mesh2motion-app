import { UI } from '../../UI.ts'
import { AnimationPlayer } from './AnimationPlayer.ts'

import {
  type AnimationClip, AnimationMixer, type SkinnedMesh, type AnimationAction, Object3D
} from 'three'

import { AnimationUtility } from './AnimationUtility.ts'
import { AnimationLoader, type AnimationLoadProgress } from './AnimationLoader.ts'

import { SkeletonType } from '../../enums/SkeletonType.ts'
import { Utility } from '../../Utilities.ts'
import { type ThemeManager } from '../../ThemeManager.ts'
import { AnimationSearch } from './AnimationSearch.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { skeletonStorage } from '../../services/SkeletonStorage.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepAnimationsListing extends EventTarget {
  private readonly theme_manager: ThemeManager
  private readonly ui: UI
  private readonly animation_player: AnimationPlayer
  private animation_clips_loaded: TransformedAnimationClipPair[] = []
  private readonly animation_loader: AnimationLoader = new AnimationLoader()

  private animation_mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private skinned_meshes_to_animate: SkinnedMesh[] = []
  private current_playing_index: number = 0
  private skeleton_type: SkeletonType = SkeletonType.Human
  private custom_skeleton_id: string | null = null

  private animations_file_path: string = 'animations/'

  // retrieved from load skeleton step
  // we will use this to scale all position animation keyframes (uniform scale)
  private skeleton_scale: number = 1.0

  private _added_event_listeners: boolean = false

  // enable status for mirroring animations
  public mirror_animations_enabled: boolean = false

  // Animation search functionality
  public animation_search: AnimationSearch | null = null

  public set_animations_file_path (path: string): void {
    this.animations_file_path = path
  }

  /**
   * The amount to raise the arms.
   */
  private warp_arm_amount: number = 0.0

  private has_added_event_listeners: boolean = false

  constructor (theme_manager: ThemeManager) {
    super()
    this.ui = UI.getInstance()
    this.animation_player = new AnimationPlayer()
    this.theme_manager = theme_manager
  }

  public begin (skeleton_type: SkeletonType, skeleton_scale: number, custom_skeleton_id: string | null = null): void {
    this.skeleton_scale = skeleton_scale
    this.custom_skeleton_id = custom_skeleton_id


    if (this.ui.dom_current_step_index != null) {
      this.ui.dom_current_step_index.innerHTML = '4'
    }

    if (this.ui.dom_current_step_element != null) {
      this.ui.dom_current_step_element.innerHTML = 'Test animations'
    }

    if (this.ui.dom_skinned_mesh_tools != null) {
      this.ui.dom_skinned_mesh_tools.style.display = 'flex'
    }

    if (this.ui.dom_skinned_mesh_animation_tools != null) {
      this.ui.dom_skinned_mesh_animation_tools.style.display = 'flex'
    }

    this.reset_step_data()

    this.skeleton_type = skeleton_type

    // if we are navigating back to this step, we don't want to add the event listeners again
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    this.update_download_button_enabled()
  }

  private apply_rest_pose_rotation_corrections (): void {
    const corrections = skeletonStorage.getRestPoseRotationCorrections()
    if (corrections === null || corrections.size === 0) {
      return
    }

    this.animation_clips_loaded.forEach((clip_pair) => {
      AnimationUtility.apply_rest_pose_rotation_corrections([clip_pair.original_animation_clip], corrections)
      AnimationUtility.apply_rest_pose_rotation_corrections([clip_pair.display_animation_clip], corrections)
    })
  }

  public reset_step_data (): void {
    // reset previous state if we are re-entering this step
    // this will happen if we are reskinning the mesh after changes
    this.animation_clips_loaded = []
    this.skinned_meshes_to_animate = []
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.current_playing_index = 0
    this.animation_player.clear_animation()
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

  public async load_and_apply_default_animation_to_skinned_mesh (final_skinned_meshes: SkinnedMesh[]): Promise<void> {
    this.skinned_meshes_to_animate = final_skinned_meshes

    // Set the animations file path on the loader
    this.animation_loader.set_animations_file_path(this.animations_file_path)

    // Handle custom skeleton - load animations from storage
    if (this.skeleton_type === SkeletonType.Custom && this.custom_skeleton_id) {
      const storedSkeleton = await skeletonStorage.getSkeleton(this.custom_skeleton_id)
      if (storedSkeleton && storedSkeleton.animations.length > 0) {
        this.load_custom_animations(storedSkeleton.animations)
        return
      } else {
        console.warn('No animations found for custom skeleton:', this.custom_skeleton_id)
        return
      }
    }

    // The AnimationLoader handles GLB selection internally now

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
        // You could emit an error event here or show a user-friendly message
      })
  }

  private onAllAnimationsLoaded (): void {
    this.apply_rest_pose_rotation_corrections()
    // sort all animation names alphabetically
    this.animation_clips_loaded.sort((a: TransformedAnimationClipPair, b: TransformedAnimationClipPair) => {
      if (a.display_animation_clip.name < b.display_animation_clip.name) { return -1 }
      if (a.display_animation_clip.name > b.display_animation_clip.name) { return 1 }
      return 0
    })

    // create user interface with all available animation clips
    this.build_animation_clip_ui(
      this.animation_clips_loaded.map(clip => clip.display_animation_clip),
      this.theme_manager
    )

    // add event listener to listem for checkbox changes when we change
    // the amount of animations to export
    this.animation_search?.addEventListener('export-options-changed', () => {
      // update the count for the download button
      if (this.ui.dom_animation_count != null) {
        this.ui.dom_animation_count.innerHTML = this.animation_search?.get_selected_animation_indices().length.toString() ?? '0'
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

    const corrections = skeletonStorage.getRestPoseRotationCorrections()
    if (corrections !== null && corrections.size > 0) {
      AnimationUtility.apply_rest_pose_rotation_corrections(
        this.animation_clips_loaded.map(clip => clip.display_animation_clip),
        corrections
      )
    }

    if (this.mirror_animations_enabled) {
      AnimationUtility.apply_animation_mirroring(this.animation_clips_loaded)
    }

    /// Apply the arm extension warp:
    AnimationUtility.apply_arm_extension_warp(this.animation_clips_loaded, this.warp_arm_amount)
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

        if ((event.target != null) && (event.target as HTMLElement).tagName === 'BUTTON') {
          const animation_index_str = (event.target as HTMLElement).getAttribute('data-index')
          if (animation_index_str != null) {
            const animation_index: number = Number(animation_index_str)
            this.play_animation(animation_index)
          }
        }
      })
    }

    // reset A-Pose arm extension button
    this.ui.dom_reset_a_pose_button?.addEventListener('click', (event) => {
      const extend_arm_value: number = 0 // reset to zero
      if (this.ui.dom_extend_arm_numeric_input !== null) {
        this.ui.dom_extend_arm_numeric_input.value = extend_arm_value.toString()
      }
      if (this.ui.dom_extend_arm_range_input !== null) {
        this.ui.dom_extend_arm_range_input.value = extend_arm_value.toString()
      }
      this.update_a_pose_value(extend_arm_value)
    })

    // A-Pose arm extension event listener
    this.ui.dom_extend_arm_numeric_input?.addEventListener('input', (event) => {
      const extend_arm_value: number = Utility.parse_input_number(this.ui.dom_extend_arm_numeric_input?.value)
      if (this.ui.dom_extend_arm_range_input !== null) {
        this.ui.dom_extend_arm_range_input.value = extend_arm_value.toString()
      }
      this.update_a_pose_value(extend_arm_value)
    })

    this.ui.dom_extend_arm_range_input?.addEventListener('input', (event) => {
      const extend_arm_value: number = Utility.parse_input_number(this.ui.dom_extend_arm_range_input?.value)
      if (this.ui.dom_extend_arm_numeric_input !== null) {
        this.ui.dom_extend_arm_numeric_input.value = extend_arm_value.toString()
      }
      this.update_a_pose_value(extend_arm_value)
    })

    // check for changes to mirror animations checkbox
    this.ui.dom_mirror_animations_checkbox?.addEventListener('change', (event) => {
      const is_checked: boolean = this.ui.dom_mirror_animations_checkbox?.checked ?? false
      this.mirror_animations_enabled = is_checked
      // Rebuild animations with or without mirroring
      this.rebuild_warped_animations()
      this.play_animation(this.current_playing_index)
    })

    // helps ensure we don't add event listeners multiple times
    this.has_added_event_listeners = true
  }

  // three different things might update this value: numeric input, range input, or reset button
  private update_a_pose_value (new_value: number): void {
    this.warp_arm_amount = new_value
    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_index)
  }

  public build_animation_clip_ui (animation_clips_to_load: AnimationClip[], theme_manager: ThemeManager): void {
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

  /**
   * Load custom animations from imported skeleton storage
   */
  private load_custom_animations (animations: AnimationClip[]): void {
    this.animation_clips_loaded = []
    this.animation_mixer = new AnimationMixer(new Object3D())

    // Process the custom animations through the same pipeline
    const cloned_anims: AnimationClip[] = AnimationUtility.deep_clone_animation_clips(animations)

    // Clean track data
    AnimationUtility.clean_track_data(cloned_anims)

    // Apply skeleton scaling
    AnimationUtility.apply_skeleton_scale_to_position_keyframes(cloned_anims, this.skeleton_scale)

    // Add to animation clips loaded
    this.animation_clips_loaded.push(...cloned_anims.map(clip => ({
      original_animation_clip: clip,
      display_animation_clip: AnimationUtility.deep_clone_animation_clip(clip)
    })))

    console.log(`Loaded ${this.animation_clips_loaded.length} custom animations`)

    this.onAllAnimationsLoaded()
    this.play_animation(0)
  }
}
