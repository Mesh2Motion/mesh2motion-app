import { UI } from '../../UI.ts'
import { Object3D, type Scene, type AnimationClip } from 'three'
import { BVHImporter, type BVHImportResult } from './BVHImporter'
import { ModalDialog } from '../../ModalDialog'
import { SkeletonType } from '../../enums/SkeletonType'
import { add_preview_skeleton_from_bvh, remove_preview_skeleton } from '../load-skeleton/PreviewSkeletonManager'

export class StepImport extends EventTarget {
  private readonly ui: UI = UI.getInstance()
  private readonly _main_scene: Scene
  private readonly bvh_importer: BVHImporter = new BVHImporter()

  private _added_event_listeners: boolean = false
  private loaded_armature: Object3D = new Object3D()
  private loaded_animations: AnimationClip[] = []
  private has_imported_skeleton: boolean = false

  constructor (main_scene: Scene) {
    super()
    this._main_scene = main_scene
  }

  public begin (): void {
    if (this.ui.dom_current_step_index !== null) {
      this.ui.dom_current_step_index.innerHTML = '2'
    }

    if (this.ui.dom_current_step_element !== null) {
      this.ui.dom_current_step_element.innerHTML = 'Import Skeleton'
    }

    if (this.ui.dom_import_tools !== null) {
      this.ui.dom_import_tools.style.display = 'flex'
    }

    // if we are navigating back to this step, we don't want to add the event listeners again
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    // Disable proceed button until skeleton is imported
    this.allow_proceeding_to_next_step(false)

    // If we already have an imported skeleton, show it
    if (this.has_imported_skeleton) {
      this.show_preview_skeleton()
      this.allow_proceeding_to_next_step(true)
    }
  }

  public dispose (): void {
    remove_preview_skeleton(this._main_scene)
  }

  private add_event_listeners (): void {
    // BVH file upload event listener
    if (this.ui.dom_import_bvh_button !== null) {
      this.ui.dom_import_bvh_button.addEventListener('change', async (event: Event) => {
        const file_input = event.target as HTMLInputElement
        const file = file_input.files?.[0]

        if (!file) {
          return
        }

        // Check if it's a BVH file
        if (!file.name.toLowerCase().endsWith('.bvh')) {
          new ModalDialog('Invalid file type', 'Please select a .bvh file.').show()
          return
        }

        try {
          await this.import_bvh_file(file)
        } catch (error) {
          console.error('Failed to import BVH:', error)
        } finally {
          // Clear the input so the same file can be imported again if needed
          file_input.value = ''
        }
      })
    }
  }

  private async import_bvh_file (file: File): Promise<void> {
    console.log('Importing BVH file:', file.name)

    const result = await this.bvh_importer.importFromFile(file)

    if (!result) {
      console.error('Failed to import BVH - no result returned')
      return
    }

    // Store the imported data
    this.loaded_armature = result.armature.clone()
    this.loaded_armature.name = 'Imported BVH Armature'
    this.loaded_animations = result.animations
    this.has_imported_skeleton = true

    // Update UI
    if (this.ui.dom_imported_skeleton_name !== null) {
      this.ui.dom_imported_skeleton_name.textContent = file.name
    }

    // Show the preview
    this.show_preview_skeleton()

    // Enable proceeding to next step
    this.allow_proceeding_to_next_step(true)

    // Dispatch event with the imported data
    this.dispatchEvent(new CustomEvent('skeletonImported', {
      detail: {
        armature: this.loaded_armature,
        animations: this.loaded_animations
      }
    }))

    console.log('BVH imported successfully:', {
      boneCount: result.skeleton.bones.length,
      animationCount: result.animations.length
    })
  }

  private show_preview_skeleton (): void {
    if (!this.has_imported_skeleton) {
      return
    }

    // Use the existing preview skeleton manager to show the imported skeleton
    add_preview_skeleton_from_bvh(this._main_scene, this.loaded_armature).catch((err) => {
      console.error('Error showing preview skeleton:', err)
    })
  }

  private allow_proceeding_to_next_step (allow: boolean): void {
    if (this.ui.dom_import_skeleton_button !== null) {
      this.ui.dom_import_skeleton_button.disabled = !allow
    }
  }

  // Public getters for other steps to access the imported data
  public armature (): Object3D {
    return this.loaded_armature
  }

  public animations (): AnimationClip[] {
    return this.loaded_animations
  }

  public skeleton_type (): SkeletonType {
    // Return Custom type for imported skeletons
    return SkeletonType.Custom
  }

  public has_skeleton (): boolean {
    return this.has_imported_skeleton
  }

  public skeleton_scale (): number {
    // For BVH imports, we use scale of 1.0 (no scaling needed as bones are imported as-is)
    return 1.0
  }
}
