import { AnimationPlayer } from '../lib/processes/animations-listing/AnimationPlayer.ts'
import { AnimationSearch } from '../lib/processes/animations-listing/AnimationSearch.ts'
import { AnimationLoader } from '../lib/processes/animations-listing/AnimationLoader.ts'
import { type AnimationClip, AnimationMixer, type SkinnedMesh, Object3D, type Scene, type AnimationAction } from 'three'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import type { ThemeManager } from '../lib/ThemeManager.ts'
import { type TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair.ts'
import { AnimationRetargetService } from './AnimationRetargetService.ts'
import { type StepBoneMapping } from './steps/StepBoneMapping.ts'
import { StepExportRetargetedAnimations } from './steps/StepExportRetargetedAnimations.ts'

/**
 * RetargetAnimationListing - Handles animation listing and playback specifically for retargeting workflow
 * Reuses AnimationPlayer, AnimationSearch, and AnimationLoader but tailored for retargeting needs
 */
export class RetargetAnimationListing extends EventTarget {
  private readonly theme_manager: ThemeManager
  private readonly animation_player: AnimationPlayer
  private readonly animation_loader: AnimationLoader = new AnimationLoader()
  private readonly step_bone_mapping: StepBoneMapping
  private readonly step_export_retargeted_animations: StepExportRetargetedAnimations = new StepExportRetargetedAnimations()
  private animation_clips_loaded: TransformedAnimationClipPair[] = []
  private animation_mixer: AnimationMixer = new AnimationMixer(new Object3D())

  private skinned_meshes_to_animate: SkinnedMesh[] = []

  private skeleton_type: SkeletonType = SkeletonType.Human

  private _added_event_listeners: boolean = false

  public animation_search: AnimationSearch | null = null

  private is_animations_active: boolean = false

  private target_rig_scene: Scene | null = null
  private export_button: HTMLButtonElement | null = null

  constructor (theme_manager: ThemeManager, step_bone_mapping: StepBoneMapping) {
    super()
    this.theme_manager = theme_manager
    this.animation_player = new AnimationPlayer()
    this.step_bone_mapping = step_bone_mapping
  }

  public begin (skeleton_type: SkeletonType): void {
    this.skeleton_type = skeleton_type

    this.reset_step_data()

    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }
  }

  public reset_step_data (): void {
    this.animation_clips_loaded = []
    this.skinned_meshes_to_animate = []
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.animation_player.clear_animation()
  }

  public mixer (): AnimationMixer {
    return this.animation_mixer
  }

  public animation_clips (): AnimationClip[] {
    return this.animation_clips_loaded.map(clip => clip.display_animation_clip)
  }

  /**
   * This will be called any time we enter the retarget animation listing step
   */
  public start_preview (): void {
    this.is_animations_active = true
  }

  public stop_preview (): void {
    this.is_animations_active = false
  }

  public load_and_apply_default_animation_to_skinned_mesh (retarget_meshes: Scene): void {
    // we will need this later when exporting
    this.target_rig_scene = retarget_meshes

    // load the Group skinned mesh and convert to normal SkinnedMesh array
    // the skinned meshes might be buried deep in the hierarchy, so traverse the scene
    const skinned_meshes: SkinnedMesh[] = []
    retarget_meshes.traverse((child: Object3D) => {
      if ((child as SkinnedMesh).isSkinnedMesh) {
        skinned_meshes.push(child as SkinnedMesh)
      }
    })
    this.skinned_meshes_to_animate = skinned_meshes

    console.log(`Preparing to load animations for ${this.skinned_meshes_to_animate.length} skinned meshes`)

    this.animation_loader.set_animations_file_path('../../animations/')
    this.animation_clips_loaded = []
    this.animation_mixer = new AnimationMixer(new Object3D())

    this.animation_loader.load_animations(this.skeleton_type)
      .then((loaded_clips: TransformedAnimationClipPair[]) => {
        this.animation_clips_loaded = loaded_clips
        this.on_all_animations_loaded()
      })
      .catch((error: Error) => {
        console.error('Failed to load animations for retargeting:', error)
      })
  }

  /**
   * Enable the export button only if there are animations selected
   */
  private update_export_button_enabled_state (): void {
    // if there are no animations selected disable the download button

    const animations_selected_count: number = this.animation_search?.get_selected_animation_indices().length ?? 0

    if (this.export_button !== null) {
      this.export_button.disabled = animations_selected_count === 0
    }

    // update the count inside the export/download button
    const count_element = document.getElementById('animation-selection-count')
    if (count_element !== null) {
      count_element.textContent = animations_selected_count.toString()
    }
  }

  private on_all_animations_loaded (): void {
    // Sort alphabetically
    this.animation_clips_loaded.sort((a: TransformedAnimationClipPair, b: TransformedAnimationClipPair) => {
      if (a.display_animation_clip.name < b.display_animation_clip.name) return -1
      if (a.display_animation_clip.name > b.display_animation_clip.name) return 1
      return 0
    })

    // Build animation UI
    this.build_animation_clip_ui(
      this.animation_clips_loaded.map(clip => clip.display_animation_clip)
    )

    // Update animation selection count when selections change
    this.animation_search?.addEventListener('export-options-changed', () => {
      this.update_export_button_enabled_state()
    })

    // Update animation listing count display
    const listing_count_element = document.getElementById('animation-listing-count')
    if (listing_count_element !== null) {
      listing_count_element.textContent = this.animation_clips_loaded.length.toString()
    }

    // the export button enabled state relies on the animation search being initialized
    // since we created a new one above, we need to recalculate this method
    this.update_export_button_enabled_state()

    console.log(`Loaded ${this.animation_clips_loaded.length} animations for retargeting`)
  }

  private build_animation_clip_ui (animation_clips: AnimationClip[]): void {
    // Initialize AnimationSearch with the loaded clips
    this.animation_search = new AnimationSearch(
      'animation-filter',
      'animations-items',
      this.theme_manager,
      this.skeleton_type
    )

    this.animation_search.initialize_animations(animation_clips)

    // Add click event listeners to animation items for playback
    const animations_container = document.getElementById('animations-items')
    if (animations_container !== null) {
      animations_container.addEventListener('click', (event) => {
        const target = event.target as HTMLElement
        const button = target.closest('.play')

        if (button !== null) {
          const index = parseInt((button as HTMLButtonElement).dataset.index ?? '-1')
          if (index >= 0) {
            this.play_animation(index)
          }
        }
      })
    }
  }

  private play_animation (index: number): void {
    if (index < 0 || index >= this.animation_clips_loaded.length) {
      console.warn('Invalid animation index:', index)
      return
    }

    const animation_pair = this.animation_clips_loaded[index]
    const display_clip = animation_pair.display_animation_clip

    // Stop all current actions
    this.animation_mixer.stopAllAction()

    // Get bone mappings from the bone mapping step
    const bone_mappings = this.step_bone_mapping.get_bone_mapping()

    if (bone_mappings.size === 0) {
      console.warn('No bone mappings available. Cannot play retargeted animation.')
      return
    }

    // Retarget the animation using the shared service
    const retargeted_clip: AnimationClip = AnimationRetargetService.retarget_animation_clip(
      display_clip,
      bone_mappings,
      this.step_bone_mapping.get_target_mapping_template(),
      this.step_bone_mapping.get_source_armature(),
      this.step_bone_mapping.get_target_skeleton_data(),
      this.skinned_meshes_to_animate
    )

    // Create new actions for each skinned mesh with the retargeted animation
    const actions: AnimationAction[] = this.skinned_meshes_to_animate.map((mesh) => {
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

    // configure export animations button
    this.export_button = document.getElementById('export-retargeting-button') as HTMLButtonElement
    this.export_button?.addEventListener('click', () => {
      // send in all the selected animation clips for export
      this.step_export_retargeted_animations.set_animation_clips_to_export(
        this.animation_clips_loaded.map(clip => clip.display_animation_clip),
        this.get_selected_animation_indices()
      )

      // configure the export out step with retargeting info
      this.step_export_retargeted_animations.setup_retargeting(
        this.target_rig_scene,
        this.skinned_meshes_to_animate,
        this.step_bone_mapping.get_bone_mapping(),
        this.step_bone_mapping.get_target_mapping_template(),
        this.step_bone_mapping.get_source_armature(),
        this.step_bone_mapping.get_target_skeleton_data()
      )
      this.step_export_retargeted_animations.export('retargeted_animations')
    })
  }

  public get_animation_player (): AnimationPlayer {
    return this.animation_player
  }

  public get_selected_animation_indices (): number[] {
    return this.animation_search?.get_selected_animation_indices() ?? []
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
    // Why do I need this when I don't need it in the main Mesh2Motion engine?
    this.skinned_meshes_to_animate.forEach((skinned_mesh) => {
      skinned_mesh.skeleton.bones.forEach(bone => {
        bone.updateMatrixWorld(true)
      })
    })
  }
}
