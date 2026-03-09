import { UI } from '../../UI.ts'
import { Object3D, type Scene, type Object3DEventMap } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SkeletonType, type HandSkeletonType } from '../../enums/SkeletonType.js'
import type GLTFResult from './interfaces/GLTFResult.ts'
import { add_origin_markers, remove_origin_markers } from './OriginMarkerManager'
import { add_preview_skeleton, remove_preview_skeleton } from './PreviewSkeletonManager.ts'
import { HandHelper } from './HandHelper.ts'

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
  private skeleton_offset_z: number = 0.0

  // this was invented since this value is stored on a DOM element
  // this helps the marketing page set the type and doesn't rely on a DOM value
  // probably could refactor this a bit to be cleaner later.
  private manual_set_skeleton_type: SkeletonType = SkeletonType.None

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

    // if we are navigating back to this step, we don't want to add the event listeners again
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    // when we come back to this step, there is a good chance we already selected a skeleton
    // so just use that and load the preview right when we enter this step
    if (!this.has_select_skeleton_ui_option()) {
      add_preview_skeleton(this._main_scene, this.skeleton_file_path(),
        this.hand_skeleton_type(), this.skeleton_scale_percentage, this.skeleton_offset_z).catch((err) => {
        console.error('error loading preview skeleton: ', err)
      })

      // restore the offset slider and display to the stored value
      if (this.ui.dom_skeleton_offset_input !== null) {
        this.ui.dom_skeleton_offset_input.value = this.skeleton_offset_z.toFixed(2)
      }
      if (this.ui.dom_skeleton_offset_display !== null) {
        this.ui.dom_skeleton_offset_display.textContent = this.skeleton_offset_z.toFixed(2)
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

        // show the scale and offset skeleton options in case they are hidden
        if (this.ui.dom_scale_skeleton_controls !== null) {
          this.ui.dom_scale_skeleton_controls.style.display = 'flex'
        }
        if (this.ui.dom_skeleton_offset_controls !== null) {
          this.ui.dom_skeleton_offset_controls.style.display = 'flex'
        }

        // force the slider to render at the correct position after becoming visible
        if (this.ui.dom_skeleton_offset_input !== null) {
          this.ui.dom_skeleton_offset_input.value = this.skeleton_offset_z.toFixed(2)
        }

        // load the preview skeleton
        // need to get the file name for the correct skeleton
        // we pass the skeleton scale in the case where we set a skeleton, change scale, then change the skeleton
        add_preview_skeleton(this._main_scene, this.skeleton_file_path(), this.hand_skeleton_type(), this.skeleton_scale(), this.skeleton_offset_z).then(() => {
          // enable the ability to progress to next step
          this.allow_proceeding_to_next_step(true)
        }).catch((err) => {
          console.error('error loading preview skeleton: ', err)
        })
      })
    }

    if (this.ui.dom_load_skeleton_button !== null) {
      this.ui.dom_load_skeleton_button.addEventListener('click', () => {
        if (this.ui.dom_skeleton_drop_type === null) {
          console.warn('could not find skeleton selection drop down HTML element')
          return
        }

        // add back loading information here
        this.load_skeleton_file(this.skeleton_file_path())
      })
    }// end if statement

    // when hand skeleton type changes. update the preview skeleton
    this.ui.dom_hand_skeleton_selection?.addEventListener('change', () => {
      // rebuild the preview skeleton with the new hand skeleton type
      // make sure we keep existing scale if we made a change to that
      add_preview_skeleton(this._main_scene, this.skeleton_file_path(), this.hand_skeleton_type(), this.skeleton_scale(), this.skeleton_offset_z).catch((err) => {
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

    // skeleton offset controls
    this.ui.dom_skeleton_offset_input?.addEventListener('input', (event) => {
      const new_value: number = Number((event.target as HTMLInputElement).value)
      this.update_skeleton_offset_to_value(new_value)
    })

    // reset the skeleton offset button
    this.ui.dom_reset_skeleton_offset_button?.addEventListener('click', () => {
      this.update_skeleton_offset_to_value(0.0)
    })
  }

  private update_skeleton_scale_to_value (new_value: number): void {
    this.skeleton_scale_percentage = Number(new_value)
    const display_value: string = Math.round(new_value * 100).toString() + '%'

    if (this.ui.dom_scale_skeleton_percentage_display !== null) {
      this.ui.dom_scale_skeleton_percentage_display.textContent = display_value
    }
    // re-add the preview skeleton with the new scale, preserving the existing Z offset
    add_preview_skeleton(this._main_scene, this.skeleton_file_path(), this.hand_skeleton_type(), this.skeleton_scale_percentage, this.skeleton_offset_z)
      .catch((err) => {
        console.error('error loading preview skeleton: ', err)
      })
  }

  private update_skeleton_offset_to_value (new_value: number): void {
    this.skeleton_offset_z = new_value

    if (this.ui.dom_skeleton_offset_input !== null) {
      this.ui.dom_skeleton_offset_input.value = new_value.toFixed(2)
    }

    if (this.ui.dom_skeleton_offset_display !== null) {
      this.ui.dom_skeleton_offset_display.textContent = new_value.toFixed(2)
    }

    add_preview_skeleton(this._main_scene, this.skeleton_file_path(), this.hand_skeleton_type(), this.skeleton_scale_percentage, this.skeleton_offset_z)
      .catch((err) => {
        console.error('error loading preview skeleton: ', err)
      })
  }

  public load_skeleton_file (file_path: string): void {
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

      // reset the armature position and apply Z offset from the slider
      this.loaded_armature.position.set(0, 0, this.skeleton_offset_z)
      this.loaded_armature.updateWorldMatrix(true, true)

      // scale the armature to what we picked using the scale slider/preview
      this.loaded_armature.scale.set(this.skeleton_scale(), this.skeleton_scale(), this.skeleton_scale())

      this.dispatchEvent(new CustomEvent('skeletonLoaded', { detail: this.loaded_armature }))
    })
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
  // bakes scale into bone positions and bakes root position offset into the first bone
  // this ensures the Z offset and scale carry through the weight skinning pipeline
  // which only uses children[0] and ignores the root armature's transform
  private bake_scale_for_armature (armature: Object3D): Object3D {
    const scale = armature.scale.x // assumes uniform scale
    const position_offset = armature.position.clone()
    const has_offset = position_offset.lengthSq() !== 0

    const cloned_armature: Object3D = armature.clone()

    // bake scale into all child bone positions
    if (scale !== 1) {
      cloned_armature.traverse((obj) => {
        if (obj instanceof Object3D && obj !== cloned_armature) {
          obj.position.multiplyScalar(scale)
        }
      })
      cloned_armature.scale.set(1, 1, 1)
    }

    // bake root position offset into first bone so it carries through the skinning pipeline
    if (has_offset && cloned_armature.children.length > 0) {
      cloned_armature.children[0].position.add(position_offset)
      cloned_armature.position.set(0, 0, 0)
    }

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
