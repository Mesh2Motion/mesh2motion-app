import { UI } from '../../UI.ts'
import { AnimationPlayer } from './AnimationPlayer.ts'

import {
  type AnimationClip, AnimationMixer, type SkinnedMesh, type AnimationAction, Object3D, type Scene
} from 'three'

import { AnimationUtility } from './AnimationUtility.ts'
import { ArmExtensionControl } from './ArmExtensionControl.ts'
import { AnimationLoader, type AnimationLoadProgress } from './AnimationLoader.ts'
import { AnimationLibrary, type AnimationLibraryLoadProgress } from './AnimationLibrary.ts'
import { AnimationLibraryProgressBar } from './AnimationLibraryProgressBar.ts'
import { CustomAnimationImporter } from './CustomAnimationImporter.ts'
import { type ModelVariationSwitcher } from './ModelVariationSwitcher.ts'

import { SkeletonType } from '../../enums/SkeletonType.ts'
import { RigConfig } from '../../RigConfig.ts'
import { Utility } from '../../Utilities.ts'
import { type ThemeManager } from '../../ThemeManager.ts'
import { AnimationSearch } from './AnimationSearch.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { type AnimationClipExportSelection } from './interfaces/AnimationExportSelection.ts'
import { PropsManager } from './props/PropsManager.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepAnimationsListing extends EventTarget {
  private readonly theme_manager: ThemeManager
  private readonly ui: UI
  private readonly animation_player: AnimationPlayer
  private readonly animation_loader: AnimationLoader = new AnimationLoader()
  private readonly animation_library: AnimationLibrary = new AnimationLibrary(this.animation_loader)

  private animation_mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private skinned_meshes_to_animate: SkinnedMesh[] = []
  private model_variation_switcher: ModelVariationSwitcher | null = null
  private current_playing_id: string | null = null
  private skeleton_type: SkeletonType = SkeletonType.Human

  // prefix that points from the current page to the static root, e.g. '../' for pages in a sub-folder
  private static_root_path: string = ''

  // retrieved from load skeleton step
  // we will use this to scale all position animation keyframes (uniform scale)
  private skeleton_scale: number = 1.0

  // per model variation multiplier for the position tracking bone (pelvis/hips) keyframes
  private model_variation_pelvis_position_scale: number = 1.0

  private readonly custom_animation_importer: CustomAnimationImporter
  private readonly props_manager: PropsManager = new PropsManager()

  private _added_event_listeners: boolean = false

  // enable status for mirroring animations
  public mirror_animations_enabled: boolean = false

  // Animation search functionality
  public animation_search: AnimationSearch | null = null

  public set_static_root_path (path: string): void {
    this.static_root_path = path
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

    // applied to every clip as it loads, and again to loaded clips whenever a warp setting changes
    this.animation_library.set_display_transform((clip_pairs: TransformedAnimationClipPair[]) => {
      this.apply_display_warps(clip_pairs)
    })

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
      const new_entries = this.animation_library.add_loaded_clips(new_clips)
      this.animation_search?.add_animations(new_entries)
      this.update_filtered_animation_listing_ui()

      // show the first imported animation
      if (new_entries.length > 0) {
        this.play_animation(new_entries[0].id)
      }
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
    this.custom_animation_importer.set_enabled(true)

    this.skeleton_type = skeleton_type
    this.props_manager.begin(skeleton_type, skeleton_scale)

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
    this.props_manager.detach_all()
    this.animation_library.clear()
    this.skinned_meshes_to_animate = []
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.current_playing_id = null
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

    if (this.animation_library.all().length === 0) {
      return
    }

    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_id)
  }

  /**
   * Applies the pelvis/hips position scale for the active model variation.
   * Taller variations need their hips raised so their feet stay on the ground.
   */
  public apply_model_variation_pelvis_position_scale (value: number): void {
    this.model_variation_pelvis_position_scale = value

    if (this.animation_library.all().length === 0) {
      return
    }

    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_id)
  }

  /**
   * Removes the current skinned meshes from the scene, adds the new ones,
   * and replays the current animation on them.
   */
  public swap_skinned_meshes (scene: Scene, new_skinned_meshes: SkinnedMesh[]): void {
    const is_variation_active = this.model_variation_switcher?.is_variation_active ?? false
    this.props_manager.detach_all()
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
    this.props_manager.attach_to_skinned_meshes(new_skinned_meshes)

    // replay current animation on the new meshes
    this.play_animation(this.current_playing_id)
    this.animation_player.play()
  }

  /**
   * Clears any variation model root that was injected during model variation swapping.
   * This should be called before doing a full model load flow.
   */
  public clear_variation_model_from_scene (): void {
    const is_variation_active = this.model_variation_switcher?.is_variation_active ?? false
    if (is_variation_active) {
      this.props_manager.detach_all()
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
    this.props_manager.attach_to_skinned_meshes(final_skinned_meshes)

    // animation file paths are relative to the static root
    this.animation_loader.set_static_root_path(this.static_root_path)

    // Create an animation mixer to do the playback. Play the first by default
    this.animation_mixer = new AnimationMixer(new Object3D())

    // lists every animation for the rig right away. Each GLB downloads the first time it is played or exported
    this.animation_library.reset(this.skeleton_type, this.skeleton_scale)
    this.on_animation_library_ready()
  }

  private on_animation_library_ready (): void {
    // create user interface with all available animation clips
    this.build_animation_clip_ui(this.theme_manager)

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

    // play the first animation by default
    this.play_animation(this.animation_library.all()[0]?.id ?? null)
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
   * Rebuilds all of the loaded warped animations by applying the specified warps.
   */
  private rebuild_warped_animations (): void {
    this.animation_library.rebuild_display_clips()
  }

  /**
   * Applies the current warps to display clips that start out as copies of their original clip.
   */
  private apply_display_warps (clip_pairs: TransformedAnimationClipPair[]): void {
    if (this.mirror_animations_enabled) {
      AnimationUtility.apply_animation_mirroring(clip_pairs)
    }

    /// Apply the arm extension warp:
    AnimationUtility.apply_arm_extension_warp(clip_pairs, this.arm_extension_control.value())

    /// Raise/lower the hips to match the proportions of the active model variation:
    AnimationUtility.apply_position_tracking_bone_scale(
      clip_pairs,
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

  private play_animation (animation_id: string | null): void {
    if (animation_id === null) {
      return
    }

    this.current_playing_id = animation_id

    const clip_pair = this.animation_library.find(animation_id)?.clip_pair
    if (clip_pair === undefined) {
      return
    }

    // download the animation the first time it is played, then play it if it is still the one picked
    if (clip_pair === null) {
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

    const clip_to_play: AnimationClip = clip_pair.display_animation_clip

    // animation mixer has internal cache with animations. doing this helps clear it
    // otherwise modifications like arm extension will not update
    this.animation_mixer = new AnimationMixer(new Object3D())

    const all_animation_actions: AnimationAction[] = []

    this.skinned_meshes_to_animate.forEach((skinned_mesh: SkinnedMesh) => {
      this.reset_root_motion_position(skinned_mesh)

      const anim_action: AnimationAction = this.animation_mixer.clipAction(clip_to_play, skinned_mesh)

      anim_action.stop()
      anim_action.play()

      // Collect all animation actions for the animation player
      all_animation_actions.push(anim_action)
    })

    // Update the animation player with the current animation and all actions
    if (all_animation_actions.length > 0) {
      this.animation_player.set_animation(clip_to_play, all_animation_actions)
    }
  }

  private update_download_button_enabled (): void {
    // see if any animations are selected for export, including ones hidden by filtering.
    // if not we need to disable the "Download" button
    const is_any_animation_selected: boolean = (this.animation_search?.get_selected_animation_ids().length ?? 0) > 0
    if (this.ui.dom_export_button != null) {
      this.ui.dom_export_button.disabled = !is_any_animation_selected
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

    // Add progress event for when a custom animation GLB file is importing
    this.animation_loader.addEventListener('progress', (event: Event) => {
      const progress = (event as CustomEvent<AnimationLoadProgress>).detail
      this.onAnimationLoadProgress(progress)
    })

    // progress for downloading many library animations at once, like before an export
    this.animation_library.addEventListener('progress', (event: Event) => {
      AnimationLibraryProgressBar.update((event as CustomEvent<AnimationLibraryLoadProgress>).detail)
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

          const animation_id = play_button.getAttribute('data-animation-id')
          if (animation_id != null) {
            this.play_animation(animation_id)
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
      this.play_animation(this.current_playing_id)
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
    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_id)
  }

  public build_animation_clip_ui (theme_manager: ThemeManager): void {
    // Initialize AnimationSearch if not already done
    // we could switch skeleton types using navigation, so need to re-create in case this happens
    this.animation_search = new AnimationSearch('animation-filter', 'animations-items', theme_manager, this.skeleton_type)

    // Use the animation search class to handle the UI
    this.animation_search.initialize_animations(this.animation_library.all())
  }

  /**
   * Downloads any selected animations that are not loaded yet, then returns the display
   * clip for each selection so the export includes the current warps.
   */
  public async get_animation_clips_to_export (): Promise<AnimationClipExportSelection[]> {
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
}
