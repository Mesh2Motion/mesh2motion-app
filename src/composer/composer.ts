/// <reference types="vite/client" />
import { type AnimationClip, type Skeleton, type SkinnedMesh, Vector3 } from 'three'
import { RigConfig } from '../lib/RigConfig.ts'
import { Utility } from '../lib/Utilities.ts'
import { Mesh2MotionEngine } from '../Mesh2MotionEngine.ts'
import { AnimationLoader } from '../lib/processes/animations-listing/AnimationLoader.ts'
import { AnimationLibrary } from '../lib/processes/animations-listing/AnimationLibrary.ts'
import { type AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry.ts'
import { CustomAnimationImporter } from '../lib/processes/animations-listing/CustomAnimationImporter.ts'
import { ImportAnimationsButton } from '../lib/processes/animations-listing/ImportAnimationsButton.ts'
import { type TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair.ts'
import { ComposerClipBuilder } from './ComposerClipBuilder.ts'
import { ComposerConfig } from './ComposerConfig.ts'
import { ComposerModelLoader } from './ComposerModelLoader.ts'
import { ComposerPreview } from './ComposerPreview.ts'
import { ComposerLibraryList } from './ComposerLibraryList.ts'
import { ComposerSlots, type ComposerSlotName, type SlotAnimationDroppedDetail } from './ComposerSlots.ts'
import { ComposerExport } from './ComposerExport.ts'

/**
 * Composer page: combines the upper half of one animation with the lower half
 * of another, previews the result, and exports it as a new animation.
 */
class ComposerModule {
  private static readonly fallback_fps: number = 24

  private readonly mesh2motion_engine: Mesh2MotionEngine
  private readonly model_loader: ComposerModelLoader = new ComposerModelLoader()
  private readonly animation_loader: AnimationLoader = new AnimationLoader()
  private readonly animation_library: AnimationLibrary = new AnimationLibrary(this.animation_loader)
  private readonly preview: ComposerPreview
  private readonly slots: ComposerSlots = new ComposerSlots()
  private readonly library_list: ComposerLibraryList | null = null
  private readonly composer_export: ComposerExport

  // same GLB/FBX import the Explore page uses. imported animations join the library list
  private readonly custom_animation_importer: CustomAnimationImporter
  private readonly import_animations_button: ImportAnimationsButton

  // preview model. the composed animation plays on it and it is what gets exported
  private skinned_meshes: SkinnedMesh[] = []

  // animation id (from the animation library) assigned to each slot
  private readonly slot_animation_ids: Record<ComposerSlotName, string | null> = { upper: null, lower: null }

  // bones driven by the upper slot. found from the model's skeleton once it loads
  private upper_body_bone_names: Set<string> = new Set<string>()

  // result of combining both slots. this is what the preview plays and what gets exported
  private composed_clip: AnimationClip | null = null
  private composition_request_id: number = 0

  private readonly dom_status: HTMLElement | null = document.querySelector('#composer-status')

  constructor () {
    this.mesh2motion_engine = new Mesh2MotionEngine()
    this.mesh2motion_engine.set_camera_position(new Vector3().set(6, 5, 11))

    this.preview = new ComposerPreview()
    this.mesh2motion_engine.add_frame_listener((delta_time: number) => {
      this.preview.frame_change(delta_time)
    })
    this.mesh2motion_engine.set_active_skinned_meshes_provider(() => this.skinned_meshes)

    const library_container = document.querySelector<HTMLElement>('#composer-library-items')
    if (library_container !== null) {
      this.library_list = new ComposerLibraryList(
        library_container,
        document.querySelector<HTMLInputElement>('#composer-library-filter'),
        document.querySelector<HTMLElement>('#composer-library-count'),
        this.mesh2motion_engine.get_theme_manager(),
        ComposerConfig.skeleton_type
      )
    }

    this.composer_export = new ComposerExport(
      this.mesh2motion_engine.file_export_step,
      this.mesh2motion_engine.download_settings,
      () => {
        if (this.composed_clip === null || this.skinned_meshes.length === 0) {
          return null
        }
        return { clip: this.composed_clip, skinned_meshes: this.skinned_meshes }
      }
    )

    this.custom_animation_importer = new CustomAnimationImporter(this.animation_loader)
    this.custom_animation_importer.set_import_context_provider(() => {
      return {
        skinned_meshes_to_animate: this.skinned_meshes,
        skeleton_scale: 1.0, // the Composer model is not rescaled
        skeleton_type: ComposerConfig.skeleton_type
      }
    })
    this.import_animations_button = new ImportAnimationsButton(
      this.custom_animation_importer,
      this.mesh2motion_engine.ui.dom_import_animations_button,
      this.mesh2motion_engine.ui.dom_import_animations_input
    )
    // imports are validated against the model's skeleton, so wait until it loads
    this.import_animations_button.set_enabled(false)

    this.add_event_listeners()
  }

  public start (): void {
    this.init().catch((error: unknown) => {
      console.error('Failed to start the Composer:', error)
      this.set_status('Something went wrong loading Remix. Try reloading the page.')
    })
  }

  private async init (): Promise<void> {
    this.mesh2motion_engine.show_animation_player(true)
    this.mesh2motion_engine.download_settings.update_download_settings_ui_visibility(ComposerConfig.skeleton_type)

    // lists every animation right away. each one downloads the first time it goes into a slot
    this.animation_loader.set_static_root_path(ComposerConfig.static_root_path)
    this.animation_library.reset(ComposerConfig.skeleton_type, 1.0)
    this.library_list?.set_animations(this.animation_library.all())

    const default_entry: AnimationEntry | undefined = this.find_default_animation()
    if (default_entry === undefined) {
      throw new Error(`Default animation ${ComposerConfig.default_animation_name} is not in the animation library`)
    }
    this.slot_animation_ids.upper = default_entry.id
    this.slot_animation_ids.lower = default_entry.id
    this.render_slots()

    // shared header controls. the skeleton toggle is hidden until a page turns it on
    if (this.mesh2motion_engine.ui.dom_show_skeleton_container !== null) {
      this.mesh2motion_engine.ui.dom_show_skeleton_container.style.display = 'inline-flex'
    }

    this.set_status('Loading model…')
    this.use_skinned_meshes(await this.model_loader.load())
    this.import_animations_button.set_enabled(true)

    this.set_status('')
    await this.update_composition()
  }

  /**
   * Shows the given model. The composed animation plays on it and it is what gets exported.
   */
  private use_skinned_meshes (skinned_meshes: SkinnedMesh[]): void {
    const skeleton = skinned_meshes[0]?.skeleton
    if (skeleton === undefined) {
      throw new Error('The model has no skinned meshes')
    }

    const upper_body_bone_names = ComposerClipBuilder.upper_body_bone_names(skeleton, ComposerConfig.upper_body_root_bone_name)
    if (upper_body_bone_names.size === 0) {
      throw new Error(`Bone ${ComposerConfig.upper_body_root_bone_name} is not in the model's skeleton`)
    }
    this.upper_body_bone_names = upper_body_bone_names

    this.skinned_meshes.forEach((mesh) => { Utility.remove_object_with_children(mesh) })
    this.skinned_meshes = skinned_meshes
    this.mesh2motion_engine.get_scene().add(...skinned_meshes)
    this.preview.set_skinned_meshes(skinned_meshes)

    this.rebuild_skeleton_helper(skeleton)
    this.apply_wireframe_setting()
  }

  private rebuild_skeleton_helper (skeleton: Skeleton): void {
    this.mesh2motion_engine.regenerate_skeleton_helper(skeleton)
    this.mesh2motion_engine.sync_skeleton_helper_joint_visibility()

    if (this.mesh2motion_engine.skeleton_helper !== undefined) {
      this.mesh2motion_engine.skeleton_helper.visible = this.mesh2motion_engine.ui.dom_show_skeleton_checkbox?.checked ?? false
    }
  }

  // a newly loaded model should match the wireframe toggle
  private apply_wireframe_setting (): void {
    const is_wireframe: boolean = this.mesh2motion_engine.ui.dom_wireframe_checkbox?.checked ?? false
    this.skinned_meshes.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        if ('wireframe' in material) {
          material.wireframe = is_wireframe
        }
      })
    })
  }

  private add_event_listeners (): void {
    this.slots.addEventListener('slot-animation-dropped', (event: Event) => {
      const { slot, animation_id } = (event as CustomEvent<SlotAnimationDroppedDetail>).detail
      this.change_slot_animation(slot, animation_id)
    })

    this.custom_animation_importer.addEventListener('import-success', (event: Event) => {
      const new_clips = (event as CustomEvent<TransformedAnimationClipPair[]>).detail
      this.add_imported_animations(new_clips)
    })
  }

  /**
   * Adds imported animations to the library list so they can be dragged onto a slot.
   */
  private add_imported_animations (clip_pairs: TransformedAnimationClipPair[]): void {
    const new_entries: AnimationEntry[] = this.animation_library.add_loaded_clips(clip_pairs)
    this.library_list?.set_animations(this.animation_library.all())
    this.render_slots()

    if (new_entries.length > 0) {
      this.library_list?.scroll_to_animation(new_entries[0].id)
    }
  }

  /**
   * Puts an animation from the library into one of the slots and rebuilds the preview.
   * If the animation fails to download, the slot goes back to what it had before.
   */
  public async set_slot_animation (slot: ComposerSlotName, animation_id: string): Promise<void> {
    if (this.animation_library.find(animation_id) === undefined) {
      throw new Error(`Unknown animation: ${animation_id}`)
    }

    const previous_animation_id: string | null = this.slot_animation_ids[slot]
    this.slot_animation_ids[slot] = animation_id

    try {
      await this.update_composition()
    } catch (error) {
      // the preview still plays the previous result, which matches the restored slot
      this.slot_animation_ids[slot] = previous_animation_id
      this.render_slots()
      this.composer_export.set_export_ready(this.composed_clip !== null)
      throw error
    }
  }

  public get_composed_clip (): AnimationClip | null {
    return this.composed_clip
  }

  // UI handlers don't wait for the result, so failures are reported here
  private change_slot_animation (slot: ComposerSlotName, animation_id: string): void {
    this.set_status('')
    this.set_slot_animation(slot, animation_id).catch((error: unknown) => {
      console.error(`Failed to put ${animation_id} in the ${slot} slot:`, error)
      const name = ComposerLibraryList.display_name(this.animation_library.find(animation_id)?.name ?? animation_id)
      this.set_status(`Couldn't load ${name}. Check your connection and try again.`)
    })
  }

  /**
   * Downloads the animations in both slots (if needed) and plays the result.
   */
  private async update_composition (): Promise<void> {
    // shows the new animation name right away, with a loading marker until it downloads
    this.render_slots()

    const upper_id = this.slot_animation_ids.upper
    const lower_id = this.slot_animation_ids.lower

    // before the model loads there is nothing to preview yet. init() composes once it is ready
    if (upper_id === null || lower_id === null || this.upper_body_bone_names.size === 0) {
      return
    }

    // slots can change again while animations download. only the newest request gets to update the preview
    const request_id: number = ++this.composition_request_id

    // the current result no longer matches the slots, so don't let it be downloaded
    this.composer_export.set_export_ready(false)

    const [upper_entry, lower_entry] = await this.animation_library.load_many([upper_id, lower_id])
    if (request_id !== this.composition_request_id) {
      return
    }
    this.render_slots()

    const upper_clip = upper_entry.clip_pair?.display_animation_clip
    const lower_clip = lower_entry.clip_pair?.display_animation_clip
    if (upper_clip === undefined || lower_clip === undefined) {
      throw new Error('Slot animations finished loading without animation data')
    }

    this.composed_clip = ComposerClipBuilder.compose_clip({
      upper_clip,
      lower_clip,
      upper_body_bone_names: this.upper_body_bone_names,
      fps: RigConfig.by_skeleton_type(ComposerConfig.skeleton_type)?.fps ?? ComposerModule.fallback_fps,
      name: `${upper_entry.name}_${lower_entry.name}_Remix`
    })
    this.preview.play_clip(this.composed_clip)

    this.composer_export.set_export_name(this.composed_clip.name)
    this.composer_export.set_export_ready(true)
  }

  private render_slots (): void {
    ComposerSlots.slot_names.forEach((slot) => {
      const animation_id = this.slot_animation_ids[slot]
      const entry = animation_id === null ? undefined : this.animation_library.find(animation_id)
      if (entry === undefined) {
        return
      }

      this.slots.show(slot, {
        animation_name: entry.name,
        is_loading: entry.state !== 'loaded'
      })
    })

    this.library_list?.set_slot_markers(this.slot_animation_ids.upper, this.slot_animation_ids.lower)
  }

  private find_default_animation (): AnimationEntry | undefined {
    return this.animation_library.all().find(entry => entry.name === ComposerConfig.default_animation_name)
  }

  private set_status (message: string): void {
    if (this.dom_status !== null) {
      this.dom_status.textContent = message
      this.dom_status.style.display = message === '' ? 'none' : 'block'
    }
  }
}

const composer_app = new ComposerModule()

// handy for trying combinations from the browser console during development
if (import.meta.env.DEV) {
  (window as unknown as { composer_app: ComposerModule }).composer_app = composer_app
}

document.addEventListener('DOMContentLoaded', () => {
  composer_app.start()
})
