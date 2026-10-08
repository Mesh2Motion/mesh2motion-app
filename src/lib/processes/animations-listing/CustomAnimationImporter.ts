import { UI } from '../../UI.ts'
import { ModalDialog } from '../../ModalDialog.ts'
import { type AnimationClip, type SkinnedMesh } from 'three'
import { type AnimationLoader } from './AnimationLoader.ts'
import CustomAnimationValidation from './CustomAnimationValidation.ts'
import { type AnimationClipMetadata, type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

/**
 * Handles the importing of custom animations from GLB files.
 * This class encapsulates the UI and logic for the import process.
 */
export class CustomAnimationImporter extends EventTarget {
  private readonly ui: UI
  private readonly animation_loader: AnimationLoader
  private skinned_meshes_to_animate: SkinnedMesh[] = []
  private skeleton_scale: number = 1.0
  private import_context_provider: (() => { skinned_meshes_to_animate: SkinnedMesh[], skeleton_scale: number }) | null = null
  private enabled: boolean = true
  private has_added_event_listeners: boolean = false

  constructor (animation_loader: AnimationLoader) {
    super()
    this.ui = UI.getInstance()
    this.animation_loader = animation_loader
    this.add_event_listeners()
  }

  public set_import_context (skinned_meshes_to_animate: SkinnedMesh[], skeleton_scale: number): void {
    this.skinned_meshes_to_animate = skinned_meshes_to_animate
    this.skeleton_scale = skeleton_scale
  }

  public set_import_context_provider (provider: () => { skinned_meshes_to_animate: SkinnedMesh[], skeleton_scale: number }): void {
    this.import_context_provider = provider
  }

  public set_enabled (enabled: boolean): void {
    this.enabled = enabled
    if (this.ui.dom_import_animations_button != null) {
      this.ui.dom_import_animations_button.disabled = !enabled
    }
  }

  public is_enabled (): boolean {
    return this.enabled
  }

  private add_event_listeners (): void {
    if (this.has_added_event_listeners) {
      return
    }

    this.ui.dom_import_animations_button?.addEventListener('click', () => {
      if (!this.is_enabled()) {
        return
      }
      this.sync_import_context_from_provider()
      this.ui.dom_import_animations_input?.click()
    })

    this.ui.dom_import_animations_input?.addEventListener('change', (event) => {
      void this.handle_import_animations_input_change(event)
    })

    this.has_added_event_listeners = true
  }

  private async handle_import_animations_input_change (event: Event): Promise<void> {
    if (!this.is_enabled()) {
      return
    }

    this.sync_import_context_from_provider()

    // potentially allow multiple files
    const input = event.target as HTMLInputElement
    const files = input.files
    if (files === null || files.length === 0) {
      return
    }

    this.set_enabled(false) // disable to prevent double-clicks during processing

    try {
      for (const file of Array.from(files)) {
        const file_name = file.name.toLowerCase()
        if (!file_name.endsWith('.glb')) {
          new ModalDialog('Unsupported file type. Please select a GLB file.', 'Error').show()
          continue
        }
        await this.import_animation_glb(file)
      }
    } finally {
      input.value = ''
      this.set_enabled(true)
    }
  }

  private sync_import_context_from_provider (): void {
    if (this.import_context_provider === null) {
      return
    }

    const { skinned_meshes_to_animate, skeleton_scale } = this.import_context_provider()
    this.set_import_context(skinned_meshes_to_animate, skeleton_scale)
  }

  private async import_animation_glb (file: File): Promise<{ success: boolean, clipCount: number }> {
    // tell the animation data these are custom animations to help differentiate for custom video previews
    // tags are unused right now, but I want to eventually use them to help filtering
    const metadata_override: Partial<AnimationClipMetadata> = {
      source_type: 'custom-import',
      tags: []
    }

    try {
      const new_animation_clips = await this.animation_loader.load_animations_from_file(
        file,
        this.skeleton_scale,
        metadata_override,
        this.skinned_meshes_to_animate[0] ?? null
      )

      // Validate custom animations against our target skeleton
      const animation_clip_names_imported = new_animation_clips.map(clip_pair => clip_pair.display_animation_clip.name).join(', ')
      const clips_to_validate: AnimationClip[] = new_animation_clips.map((clip_pair) => clip_pair.display_animation_clip)
      CustomAnimationValidation.validate_animation_bones_match(clips_to_validate, this.skinned_meshes_to_animate)

      this.dispatchEvent(new CustomEvent<TransformedAnimationClipPair[]>('import-success', {
        detail: new_animation_clips
      }))

      const animation_count = new_animation_clips.length
      const animation_word = animation_count === 1 ? 'animation' : 'animations'
      new ModalDialog(
        'Import Success',
        `${animation_count} ${animation_word} Imported successfully: ${animation_clip_names_imported}`
      ).show()

      return { success: true, clipCount: new_animation_clips.length }
    } catch (error) {
      return CustomAnimationValidation.handle_import_error(error)
    }
  }
}
