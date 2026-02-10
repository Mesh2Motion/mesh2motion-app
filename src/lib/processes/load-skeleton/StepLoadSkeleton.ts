import { UI } from '../../UI.ts'
import { Object3D, type Scene, type Object3DEventMap } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SkeletonType, type HandSkeletonType } from '../../enums/SkeletonType.js'
import type GLTFResult from './interfaces/GLTFResult.ts'
import { add_origin_markers, remove_origin_markers } from './OriginMarkerManager'
import { add_preview_skeleton, remove_preview_skeleton, add_preview_skeleton_from_bvh } from './PreviewSkeletonManager.ts'
import { HandHelper } from './HandHelper.ts'
import { skeletonStorage } from '../../services/SkeletonStorage.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepLoadSkeleton extends EventTarget {
  private readonly loader: GLTFLoader = new GLTFLoader()
  private readonly ui: UI = UI.getInstance()
  private loaded_armature: Object3D = new Object3D()

  private _added_event_listeners: boolean = false
  private readonly _main_scene: Scene

  // used to help scale animations later
  // this is useful since position keyframes will need to be scaled
  // to prevent large offsets
  private skeleton_scale_percentage: number = 1.0

  // this was invented since this value is stored on a DOM element
  // this helps the marketing page set the type and doesn't rely on a DOM value
  // probably could refactor this a bit to be cleaner later.
  private manual_set_skeleton_type: SkeletonType = SkeletonType.None

  // Store the ID of the selected custom skeleton from storage
  private selected_custom_skeleton_id: string | null = null

  public get_selected_custom_skeleton_id (): string | null {
    return this.selected_custom_skeleton_id
  }

  public skeleton_type (): SkeletonType {
    if (this.skeleton_file_path() === SkeletonType.None) {
      return this.manual_set_skeleton_type
    }

    return this.skeleton_file_path() // this is actually the type/filepath combo
  }

  public set_skeleton_type (type: SkeletonType): void {
    this.manual_set_skeleton_type = type
  }

  // The edit skeleton step will use this to scale the skeleton when loading editable skeleton
  // animations listing will use this to scale all position keyframes
  public skeleton_scale (): number {
    return this.skeleton_scale_percentage
  }

  constructor (main_scene: Scene) {
    super()
    this._main_scene = main_scene
  }

  public begin (): void {
    if (this.ui.dom_current_step_index !== null) {
      this.ui.dom_current_step_index.innerHTML = '2'
    }

    if (this.ui.dom_current_step_element !== null) {
      this.ui.dom_current_step_element.innerHTML = 'Load Skeleton'
    }

    if (this.ui.dom_load_skeleton_tools !== null) {
      this.ui.dom_load_skeleton_tools.style.display = 'flex'
    }

    // Populate the dropdown with any imported skeletons from storage
    this.populate_skeleton_dropdown()

    // if we are navigating back to this step, we don't want to add the event listeners again
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    // when we come back to this step, there is a good chance we already selected a skeleton
    // so just use that and load the preview right when we enter this step
    if (!this.has_select_skeleton_ui_option()) {
      const selectedValue = this.ui.dom_skeleton_drop_type?.value
      if (selectedValue?.startsWith('custom:')) {
        // Load custom skeleton from storage
        this.load_custom_skeleton_preview(selectedValue)
      } else {
        // Load standard skeleton
        add_preview_skeleton(this._main_scene, this.skeleton_file_path(),
          this.hand_skeleton_type(), this.skeleton_scale_percentage).catch((err) => {
          console.error('error loading preview skeleton: ', err)
        })
      }
    }

    // Initialize hand skeleton hand options visibility
    this.toggle_ui_hand_skeleton_options()

    // add origin markers for debugging model loading issues
    add_origin_markers(this._main_scene)

    // if there is a "select skeleton" option, disable proceeding
    // putting this check here helps us if we come back to this step later
    if (this.has_select_skeleton_ui_option()) {
      this.allow_proceeding_to_next_step(false)
    } else {
      this.allow_proceeding_to_next_step(true)
    }
  }

  /**
   * Populate the skeleton dropdown with imported skeletons from storage
   */
  private populate_skeleton_dropdown (): void {
    const dropdown = this.ui.dom_skeleton_drop_type
    if (!dropdown) return

    // Remove any existing custom skeleton options (keep the standard ones)
    const optionsToRemove: HTMLOptionElement[] = []
    for (let i = 0; i < dropdown.options.length; i++) {
      const option = dropdown.options[i]
      if (option.value.startsWith('custom:')) {
        optionsToRemove.push(option)
      }
    }
    optionsToRemove.forEach(option => dropdown.removeChild(option))

    // Add imported skeletons from storage (using sync metadata method)
    const storedSkeletons = skeletonStorage.getAllSkeletonsInfo()
    if (storedSkeletons.length > 0) {
      // Add a separator option
      const separator = document.createElement('option')
      separator.disabled = true
      separator.textContent = '--- Imported ---'
      dropdown.appendChild(separator)

      // Add each stored skeleton
      storedSkeletons.forEach(skeleton => {
        const option = document.createElement('option')
        option.value = `custom:${skeleton.id}`
        option.textContent = skeleton.name
        dropdown.appendChild(option)
      })
    }
  }

  /**
   * Load a custom skeleton from storage and show preview
   */
  private async load_custom_skeleton_preview (customId: string): Promise<void> {
    const id = customId.replace('custom:', '')
    const storedSkeleton = await skeletonStorage.getSkeleton(id)

    if (!storedSkeleton) {
      console.error('Custom skeleton not found:', id)
      return
    }

    this.selected_custom_skeleton_id = id

    // Clone and bake scale into armature positions (scale 1.0 since we bake it)
    const clonedArmature = storedSkeleton.armature.clone()
    clonedArmature.name = storedSkeleton.name
    clonedArmature.position.set(0, 0, 0)

    // Bake scale into positions
    if (this.skeleton_scale_percentage !== 1) {
      clonedArmature.traverse((obj) => {
        if (obj instanceof Object3D && obj !== clonedArmature) {
          obj.position.multiplyScalar(this.skeleton_scale_percentage)
        }
      })
    }
    clonedArmature.updateMatrixWorld(true)

    // Show preview with scale 1.0 (scale is baked into positions)
    add_preview_skeleton_from_bvh(this._main_scene, clonedArmature, 1.0)
      .catch((err) => {
        console.error('Error loading custom skeleton preview:', err)
      })
  }

  public regenerate_origin_markers (): void {
    add_origin_markers(this._main_scene)
  }

  public dispose (): void {
    remove_origin_markers(this._main_scene)
    remove_preview_skeleton(this._main_scene)
  }

  private skeleton_file_path (): SkeletonType {
    // get currently selected option out of the model-selection drop-down
    const skeleton_selection = this.ui.dom_skeleton_drop_type.options
    const skeleton_file: string = skeleton_selection[skeleton_selection.selectedIndex].value

    // Check if it's a custom skeleton
    if (skeleton_file.startsWith('custom:')) {
      return SkeletonType.Custom
    }

    // set the skeleton type. This will be used for the animations listing later
    // so it knows what animations to load
    switch (skeleton_file) {
      case 'quadraped':
        return SkeletonType.Quadraped
      case 'human':
        return SkeletonType.Human
      case 'bird':
        return SkeletonType.Bird
      case 'select-skeleton':
        return SkeletonType.None
      case 'dragon':
        return SkeletonType.Dragon
      case 'kaiju':
        return SkeletonType.Kaiju
      default:
        console.error('unknown skeleton type selected: ', skeleton_file)
        return SkeletonType.Error
    }
  }

  private hand_skeleton_type (): HandSkeletonType {
    const hand_selection = this.ui.dom_hand_skeleton_selection?.options
    return hand_selection[hand_selection.selectedIndex].value as HandSkeletonType
  }

  private add_event_listeners (): void {
    // Add event listener for skeleton type changes to show/hide hand options
    if (this.ui.dom_skeleton_drop_type !== null) {
      this.ui.dom_skeleton_drop_type.addEventListener('change', () => {
        // get selected value from skeleton options
        // const skeleton_selection = this.ui.dom_skeleton_drop_type.options
        // this.skeleton_t = skeleton_selection[skeleton_selection.selectedIndex].value as SkeletonType

        // hand options only apply to human skeletons, so we need to show/hide when skeleton type changes
        this.toggle_ui_hand_skeleton_options()

        // remove the "select a skeleton" option if we picked something else
        if (this.has_select_skeleton_ui_option()) {
          this.ui.dom_skeleton_drop_type?.options.remove(0)
        }

        // show the scale skeleton options in case they are hidden
        this.ui.dom_scale_skeleton_controls!.style.display = 'flex'

        // Get the selected value
        const selectedValue = this.ui.dom_skeleton_drop_type?.value

        // Check if it's a custom skeleton
        if (selectedValue?.startsWith('custom:')) {
          const customId = selectedValue.replace('custom:', '')
          this.selected_custom_skeleton_id = customId
          this.load_custom_skeleton_preview(selectedValue)
          this.allow_proceeding_to_next_step(true)
        } else {
          // Reset custom skeleton selection
          this.selected_custom_skeleton_id = null

          // load the preview skeleton
          // need to get the file name for the correct skeleton
          // we pass the skeleton scale in the case where we set a skeleton, change scale, then change the skeleton
          add_preview_skeleton(this._main_scene, this.skeleton_file_path(), this.hand_skeleton_type(), this.skeleton_scale()).then(() => {
            // enable the ability to progress to next step
            this.allow_proceeding_to_next_step(true)
          }).catch((err) => {
            console.error('error loading preview skeleton: ', err)
          })
        }
      })
    }

    if (this.ui.dom_load_skeleton_button !== null) {
      this.ui.dom_load_skeleton_button.addEventListener('click', async () => {
        if (this.ui.dom_skeleton_drop_type === null) {
          console.warn('could not find skeleton selection drop down HTML element')
          return
        }

        // add back loading information here
        await this.load_skeleton_file(this.skeleton_file_path())
      })
    }// end if statement

    // when hand skeleton type changes. update the preview skeleton
    this.ui.dom_hand_skeleton_selection?.addEventListener('change', () => {
      // rebuild the preview skeleton with the new hand skeleton type
      // make sure we keep existing scale if we made a change to that
      add_preview_skeleton(this._main_scene, this.skeleton_file_path(), this.hand_skeleton_type(), this.skeleton_scale()).catch((err) => {
        console.error('error loading preview skeleton: ', err)
      })
    })

    // scale skeleton controls
    this.ui.dom_scale_skeleton_input?.addEventListener('input', (event) => {
      // range sliders have rounding errors, so we round the value to avoid issues
      const new_value: number = Number((event.target as HTMLInputElement).value)
      this.update_skeleton_scale_to_value(new_value)
    })

    // reset the skeleton scale button
    this.ui.dom_reset_skeleton_scale_button?.addEventListener('click', () => {
      this.update_skeleton_scale_to_value(1.0)
    })
  }

  private update_skeleton_scale_to_value (new_value: number): void {
    this.skeleton_scale_percentage = Number(new_value)
    const display_value: string = Math.round(new_value * 100).toString() + '%'

    if (this.ui.dom_scale_skeleton_percentage_display !== null) {
      this.ui.dom_scale_skeleton_percentage_display.textContent = display_value
    }

    // re-add the preview skeleton with the new scale
    if (this.selected_custom_skeleton_id) {
      // For custom skeletons, reload from storage with new scale
      const customId = `custom:${this.selected_custom_skeleton_id}`
      this.load_custom_skeleton_preview(customId)
        .catch((err) => {
          console.error('error loading custom skeleton preview: ', err)
        })
    } else {
      // For standard skeletons, use the existing function
      add_preview_skeleton(this._main_scene, this.skeleton_file_path(), this.hand_skeleton_type(), this.skeleton_scale_percentage)
        .catch((err) => {
          console.error('error loading preview skeleton: ', err)
        })
    }
  }

  public async load_skeleton_file (file_path: string): Promise<void> {
    // Check if this is a custom skeleton from storage
    if (this.selected_custom_skeleton_id) {
      await this.load_custom_skeleton_from_storage()
      return
    }

    // load skeleton from GLB file
    this.loader.load(file_path, (gltf: GLTFResult) => {
      // traverse scene and find first bone object
      // we will go to the parent and mark that as the original armature
      let armature_found = false
      let original_armature: Object3D = new Object3D()

      gltf.scene.traverse((child: Object3D) => {
        // Note: three.js removes punctuation characters from names object names like `-` and `.` for sanitization
        // Our 3D source files will need to account fo this if we are relying on that later for parsing
        // https://discourse.threejs.org/t/avoid-dots-and-colons-being-deleted-from-models-name/15304/2
        if (child.type === 'Bone' && !armature_found) {
          armature_found = true

          if (child.parent != null) {
            original_armature = child.parent
          } else {
            console.warn('could not find armature parent while loading skeleton')
          }
        }
      })

      this.loaded_armature = original_armature.clone()
      this.loaded_armature.name = 'Loaded Armature'

      // Apply hand skeleton modifications for human skeletons
      if (this.skeleton_file_path() === SkeletonType.Human) {
        const helper = new HandHelper()
        helper.modify_hand_skeleton(this.loaded_armature, this.hand_skeleton_type())
      }

      // reset the armature to 0,0,0 in case it is off for some reason
      this.loaded_armature.position.set(0, 0, 0)
      this.loaded_armature.updateWorldMatrix(true, true)

      // scale the armature to what we picked using the scale slider/preview
      this.loaded_armature.scale.set(this.skeleton_scale(), this.skeleton_scale(), this.skeleton_scale())

      this.dispatchEvent(new CustomEvent('skeletonLoaded', { detail: this.loaded_armature }))
    })
  }

  /**
   * Load a custom skeleton from storage
   */
  private async load_custom_skeleton_from_storage (): Promise<void> {
    if (!this.selected_custom_skeleton_id) {
      console.error('No custom skeleton ID selected')
      return
    }

    const storedSkeleton = await skeletonStorage.getSkeleton(this.selected_custom_skeleton_id)
    if (!storedSkeleton) {
      console.error('Custom skeleton not found in storage:', this.selected_custom_skeleton_id)
      return
    }

    // Clone the stored armature
    this.loaded_armature = storedSkeleton.armature.clone()
    this.loaded_armature.name = storedSkeleton.name

    // reset the armature to 0,0,0 in case it is off for some reason
    this.loaded_armature.position.set(0, 0, 0)
    this.loaded_armature.updateWorldMatrix(true, true)

    // For custom skeletons, we bake the scale into bone positions directly
    // This avoids the double-scaling issue when going back and forth between steps
    this.bake_scale_into_armature(this.loaded_armature, this.skeleton_scale())

    // Dispatch event with the loaded armature
    this.dispatchEvent(new CustomEvent('skeletonLoaded', { detail: this.loaded_armature }))
  }

  /**
   * Bake scale directly into bone positions (for custom skeletons)
   */
  private bake_scale_into_armature (armature: Object3D, scale: number): void {
    if (scale === 1) return

    armature.scale.set(1, 1, 1)
    armature.traverse((obj) => {
      if (obj instanceof Object3D && obj !== armature) {
        obj.position.multiplyScalar(scale)
      }
    })
    armature.updateMatrixWorld(true)
  }

  private has_select_skeleton_ui_option (): boolean {
    return this.ui.dom_skeleton_drop_type?.options[0].value === 'select-skeleton'
  }

  private allow_proceeding_to_next_step (allow: boolean): void {
    const btn = this.ui.dom_load_skeleton_button as HTMLButtonElement | null
    if (!btn) return
    btn.disabled = !allow // disable when not allowed
  }

  // returns a skeleton object that has been baked (applied) for scale 
  public armature (): Object3D<Object3DEventMap> {
    return this.bake_scale_for_armature(this.loaded_armature)
  }

  // this does not mutate armature that goes in
  // update all positions for bones and resets scale to 1
  private bake_scale_for_armature (armature: Object3D): Object3D {
    const scale = armature.scale.x // assumes uniform scale
    if (scale === 1) return armature.clone() // no changes. just return existing skeleton

    const cloned_armature: Object3D = armature.clone()
    cloned_armature.traverse((obj) => {
      if (obj instanceof Object3D && obj !== cloned_armature) {
        obj.position.multiplyScalar(scale)
      }
    })
    cloned_armature.scale.set(1, 1, 1)
    cloned_armature.updateMatrixWorld(true)

    return cloned_armature
  }

  private toggle_ui_hand_skeleton_options (): void {
    if (this.ui.dom_skeleton_drop_type === null || this.ui.dom_hand_skeleton_options === null) {
      return
    }

    if (this.skeleton_file_path() === SkeletonType.Human) {
      this.ui.dom_hand_skeleton_options.style.display = 'flex'
    } else {
      this.ui.dom_hand_skeleton_options.style.display = 'none'
    }
  }
}
