import { Group, Object3D, Scene, SkeletonHelper } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SkeletonType } from '../../lib/enums/SkeletonType.ts'
import type GLTFResult from '../../lib/processes/load-skeleton/interfaces/GLTFResult.ts'
import { ModalDialog } from '../../lib/ModalDialog.ts'

export class StepLoadSourceSkeleton extends EventTarget {
  private readonly loader: GLTFLoader = new GLTFLoader() // all skeletons are in GLB format
  private readonly _main_scene: Scene
  private loaded_source_armature: Group = new Group()
  private skeleton_helper: SkeletonHelper | null = null
  private _added_event_listeners: boolean = false

  private skeleton_type: SkeletonType = SkeletonType.None

  // DOM references
  private skeleton_type_select: HTMLSelectElement | null = null

  constructor (main_scene: Scene) {
    super()
    this._main_scene = main_scene
  }

  public begin (): void {
    // Get DOM references
    this.skeleton_type_select = document.getElementById('skeleton-type-select') as HTMLSelectElement

    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    // Auto-load the default human skeleton
    this.load_default_skeleton()
  }

  private load_default_skeleton (): void {
    // Set the skeleton type to human and load it automatically
    this.skeleton_type = SkeletonType.Human

    this.load_skeleton_from_path(`/${SkeletonType.Human}`).catch((error) => {
      console.error('Failed to load default human skeleton:', error)
    })

    // Dispatch event to notify that skeleton is being loaded
    this.dispatchEvent(new CustomEvent('skeleton-loading'))
  }

  private add_event_listeners (): void {
    // Skeleton selection change listener
    this.skeleton_type_select?.addEventListener('change', () => {
      this.handle_skeleton_selection_change()
    })
  }

  private handle_skeleton_selection_change (): void {
    if (this.skeleton_type_select === null) return

    const selected_value = this.skeleton_type_select.value

    // Map selection to skeleton type enum
    this.skeleton_type = this.get_skeleton_type_enum(selected_value)

    // Clear any previously loaded skeleton
    this.clear_previous_skeleton()

    // Load the selected skeleton using the file path from the enum
    this.load_skeleton_from_path(`/${this.skeleton_type}`).catch((error) => {
      console.error('Failed to load skeleton:', error)
    })

    // Dispatch event to notify that skeleton is being loaded
    this.dispatchEvent(new CustomEvent('skeleton-loading'))
  }

  private get_skeleton_type_enum (selection: string): SkeletonType {
    switch (selection) {
      case 'human':
        return SkeletonType.Human
      case 'quadraped':
        return SkeletonType.Quadraped
      case 'bird':
        return SkeletonType.Bird
      case 'dragon':
        return SkeletonType.Dragon
      default:
        return SkeletonType.None
    }
  }

  private async load_skeleton_from_path (file_path: string): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        this.loader.load(
          file_path,
          (gltf: GLTFResult) => {
            this.process_loaded_skeleton(gltf)
            resolve()
          },
          undefined,
          (error) => {
            reject(error)
          }
        )
      })
    } catch (error) {
      console.error('Error loading skeleton:', error)
      this.show_error_dialog('Error loading skeleton file.')
    }
  }

  private process_loaded_skeleton (gltf: GLTFResult): void {
    // Validate and extract armature from skeleton file
    if (!this.is_skeleton_valid(gltf)) {
      this.show_error_dialog('No bones found in skeleton file. Please select a valid skeleton.')
      return
    }

    this.loaded_source_armature = gltf.scene.clone() as Group
    this.loaded_source_armature.name = 'Source Skeleton Scene (Mesh2Motion)'

    // Offset position to the side so it's visible next to the target skeleton
    this.loaded_source_armature.position.set(2.5, 0, 0)
    this.loaded_source_armature.updateWorldMatrix(true, true)

    console.log('Source skeleton (Mesh2Motion) loaded successfully:', this.loaded_source_armature)

    // Add to scene and create skeleton helper
    this.add_skeleton_and_helper_to_scene()

    // Dispatch event to notify that skeleton has been loaded successfully
    this.dispatchEvent(new CustomEvent('skeleton-loaded'))
  }

  private is_skeleton_valid (gltf: GLTFResult): boolean {
    let has_bones: boolean = false

    // We have full control over the skeleton files, but do this
    // just in case things change in the future with validation
    gltf.scene.traverse((child: Object3D) => {
      if (child.type === 'Bone') {
        has_bones = true
      }
    })

    return has_bones
  }

  public show_skeleton_helper (visible: boolean): void {
    if (this.skeleton_helper !== null) {
      this.skeleton_helper.visible = visible
    }
  }

  private add_skeleton_and_helper_to_scene (): void {
    // Add the source skeleton to the scene
    this._main_scene.add(this.loaded_source_armature)

    // Create skeleton helper for visualization
    this.skeleton_helper = new SkeletonHelper(this.loaded_source_armature)
    this.skeleton_helper.name = 'Source Skeleton Helper (Mesh2Motion)'
    this._main_scene.add(this.skeleton_helper)

    console.log('Source skeleton added to scene with helper')
  }

  private clear_previous_skeleton (): void {
    // Remove previous armature from scene
    if (this.loaded_source_armature.parent !== null) {
      this._main_scene.remove(this.loaded_source_armature)
      console.log('Removed previous source armature from scene')
    }

    // Remove previous skeleton helper from scene
    if (this.skeleton_helper !== null) {
      if (this.skeleton_helper.parent !== null) {
        this._main_scene.remove(this.skeleton_helper)
        console.log('Removed previous skeleton helper from scene')
      }
    }
  }

  private show_error_dialog (message: string): void {
    new ModalDialog(message, 'Error').show()
  }

  // Getters to be used by main retarget module
  public get_loaded_source_armature (): Object3D {
    return this.loaded_source_armature
  }

  public get_skeleton_type (): SkeletonType {
    return this.skeleton_type
  }
}
