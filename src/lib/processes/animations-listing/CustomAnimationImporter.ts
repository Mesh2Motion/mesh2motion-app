import { UI } from '../../UI.ts'
import { ModalDialog } from '../../ModalDialog.ts'
import { type AnimationClip, type SkinnedMesh } from 'three'
import { type AnimationLoader, type LoadedAnimationSource } from './AnimationLoader.ts'
import CustomAnimationValidation from './CustomAnimationValidation.ts'
import { IncompatibleSkeletonError } from './AnimationImportErrors.ts'
import { ImportedAnimationRetargeter } from './ImportedAnimationRetargeter.ts'
import { type AnimationClipMetadata, type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { SkeletonType } from '../../enums/SkeletonType.ts'

export interface AnimationImportContext {
  skinned_meshes_to_animate: SkinnedMesh[]
  skeleton_scale: number
  skeleton_type: SkeletonType
}

/**
 * Handles the importing of custom animations from GLB and FBX files.
 * This class encapsulates the UI and logic for the import process.
 *
 * Animations authored on the Mesh2Motion rig are used as they are. Animations authored on
 * another humanoid rig (Mixamo, etc) are retargeted onto the human skeleton.
 */
export class CustomAnimationImporter extends EventTarget {
  private readonly ui: UI
  private readonly animation_loader: AnimationLoader
  private skinned_meshes_to_animate: SkinnedMesh[] = []
  private skeleton_scale: number = 1.0
  private skeleton_type: SkeletonType = SkeletonType.None
  private import_context_provider: (() => AnimationImportContext) | null = null
  private enabled: boolean = true
  private has_added_event_listeners: boolean = false

  constructor (animation_loader: AnimationLoader) {
    super()
    this.ui = UI.getInstance()
    this.animation_loader = animation_loader
    this.add_event_listeners()
  }

  public set_import_context (context: AnimationImportContext): void {
    this.skinned_meshes_to_animate = context.skinned_meshes_to_animate
    this.skeleton_scale = context.skeleton_scale
    this.skeleton_type = context.skeleton_type
  }

  public set_import_context_provider (provider: () => AnimationImportContext): void {
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
        if (!file_name.endsWith('.glb') && !file_name.endsWith('.fbx')) {
          new ModalDialog('Unsupported file type. Please select a GLB or FBX file.', 'Error').show()
          continue
        }
        await this.import_animation_file(file)
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

    this.set_import_context(this.import_context_provider())
  }

  private async import_animation_file (file: File): Promise<{ success: boolean, clipCount: number }> {
    // tell the animation data these are custom animations to help differentiate for custom video previews
    // tags are unused right now, but I want to eventually use them to help filtering
    const metadata_override: Partial<AnimationClipMetadata> = {
      source_type: 'custom-import',
      tags: []
    }

    try {
      const source: LoadedAnimationSource = await this.animation_loader.load_animation_source_file(file)

      let new_animation_clips: TransformedAnimationClipPair[]
      let success_note: string = ''

      try {
        new_animation_clips = this.process_mesh2motion_animations(source, metadata_override)
      } catch (error) {
        // not authored on our rig. See if it is a rig we can retarget from
        if (!(error instanceof IncompatibleSkeletonError) || !this.can_retarget()) {
          throw error
        }

        const retargeter = ImportedAnimationRetargeter.create(source.scene, this.skinned_meshes_to_animate[0])
        new_animation_clips = this.process_retargeted_animations(source, retargeter, file.name, metadata_override)
        success_note = ` (retargeted from a ${retargeter.mapping_type} rig)`
      }

      this.dispatchEvent(new CustomEvent<TransformedAnimationClipPair[]>('import-success', {
        detail: new_animation_clips
      }))

      const animation_clip_names_imported = new_animation_clips.map(clip_pair => clip_pair.display_animation_clip.name).join(', ')
      const animation_count = new_animation_clips.length
      const animation_word = animation_count === 1 ? 'animation' : 'animations'
      new ModalDialog(
        'Import Success',
        `${animation_count} ${animation_word} Imported successfully${success_note}: ${animation_clip_names_imported}`
      ).show()

      return { success: true, clipCount: new_animation_clips.length }
    } catch (error) {
      return CustomAnimationValidation.handle_import_error(error)
    }
  }

  /**
   * Animations authored on the Mesh2Motion rig play as they are
   * @throws {IncompatibleSkeletonError} If the bones don't match our skeleton
   */
  private process_mesh2motion_animations (
    source: LoadedAnimationSource,
    metadata_override: Partial<AnimationClipMetadata>
  ): TransformedAnimationClipPair[] {
    const clip_pairs = this.animation_loader.process_loaded_animations(
      source.animations,
      this.skeleton_scale,
      metadata_override
    )

    // Validate custom animations against our target skeleton
    const clips_to_validate: AnimationClip[] = clip_pairs.map((clip_pair) => clip_pair.display_animation_clip)
    CustomAnimationValidation.validate_animation_bones_match(clips_to_validate, this.skinned_meshes_to_animate)

    return clip_pairs
  }

  /**
   * Animations from other rigs get baked onto our skeleton first
   * @throws {IncompatibleSkeletonError} If the file's rig can't be mapped onto ours
   */
  private process_retargeted_animations (
    source: LoadedAnimationSource,
    retargeter: ImportedAnimationRetargeter,
    file_name: string,
    metadata_override: Partial<AnimationClipMetadata>
  ): TransformedAnimationClipPair[] {
    // Mixamo names every clip "mixamo.com", so a single clip is better off named after its file
    const file_base_name: string = file_name.replace(/\.[^.]+$/, '')
    const retargeted_clips: AnimationClip[] = source.animations.map((clip) =>
      retargeter.retarget(clip, source.animations.length === 1 ? file_base_name : clip.name))

    // baked against the final skeleton, which already has the skeleton scale in it
    return this.animation_loader.process_loaded_animations(retargeted_clips, 1.0, metadata_override)
  }

  /**
   * Retargeting maps onto human chains (arms, legs, spine), so it only works for the human skeleton
   */
  private can_retarget (): boolean {
    return this.skeleton_type === SkeletonType.Human && this.skinned_meshes_to_animate.length > 0
  }
}
