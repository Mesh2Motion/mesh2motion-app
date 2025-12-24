import { type Mesh2MotionEngine } from '../Mesh2MotionEngine'
import { ModelPreviewDisplay } from './enums/ModelPreviewDisplay'
import { ProcessStep } from './enums/ProcessStep'
import { TransformSpace } from './enums/TransformSpace'
import { Utility } from './Utilities'
import { ModelCleanupUtility } from './processes/load-model/ModelCleanupUtility'

export class EventListeners {
  constructor (private readonly bootstrap: Mesh2MotionEngine) {}

  public addEventListeners (): void {
    // monitor theme changes
    this.bootstrap.theme_manager.addEventListener('theme-changed', (event: any) => {
      this.bootstrap.regenerate_floor_grid()
    })

    this.bootstrap.load_skeleton_step.addEventListener('skeletonLoaded', () => {
      this.bootstrap.edit_skeleton_step.load_original_armature_from_model(this.bootstrap.load_skeleton_step.armature())
      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.EditSkeleton)
    })

    // Listen for skeleton transformation events to update UI and visuals
    // this can happen with undo/redo system
    this.bootstrap.edit_skeleton_step.addEventListener('skeletonTransformed', () => {
      // Update skeleton helper if it exists
      if (this.bootstrap.skeleton_helper !== undefined) {
        this.bootstrap.regenerate_skeleton_helper(this.bootstrap.edit_skeleton_step.skeleton(), 'Skeleton Helper')
      }

      // Refresh weight painting if in weight painted mode
      if (this.bootstrap.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
        this.bootstrap.regenerate_weight_painted_preview_mesh()
      }
    })

    // attribution link clicking brings up contributors dialog
    this.bootstrap.ui.dom_attribution_link?.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault()
      this.bootstrap.show_contributors_dialog()
    })

    // listen for view helper changes
    document.getElementById('view-control-hitbox')?.addEventListener('pointerdown', (event: PointerEvent) => {
      if (this.bootstrap.view_helper.handleClick(event)) {
        event.stopPropagation()
        event.preventDefault()
      }
    })

    this.bootstrap.renderer.domElement.addEventListener('mousemove', (event: MouseEvent) => {
      if (this.bootstrap.is_transform_controls_dragging) {
        this.bootstrap.handle_transform_controls_moving()
      }

      // edit skeleton step logic that deals with hovering over bones
      if (this.bootstrap.process_step === ProcessStep.EditSkeleton) {
        this.bootstrap.edit_skeleton_step.calculate_bone_hover_effect(event, this.bootstrap.camera, this.bootstrap.transform_controls_hover_distance)
      }
    })

    this.bootstrap.renderer.domElement.addEventListener('mousedown', (event: MouseEvent) => {
      this.bootstrap.handle_transform_controls_mouse_down(event)

      // update UI with current bone name
      if (this.bootstrap.ui.dom_selected_bone_label !== null &&
        this.bootstrap.edit_skeleton_step.get_currently_selected_bone() !== null) {
        this.bootstrap.ui.dom_selected_bone_label.innerHTML =
          this.bootstrap.edit_skeleton_step.get_currently_selected_bone().name
      }
    }, false)

    // custom event listeners for the transform controls.
    // we can know about the "mouseup" event with this
    this.bootstrap.transform_controls?.addEventListener('dragging-changed', (event: any) => {
      this.bootstrap.is_transform_controls_dragging = event.value
      this.bootstrap.controls.enabled = !event.value

      // Store undo state when we start dragging (event.value = true)
      if (event.value && this.bootstrap.process_step === ProcessStep.EditSkeleton) {
        this.bootstrap.edit_skeleton_step.store_bone_state_for_undo()
      }

      // if we stopped dragging, that means a mouse up.
      // if we are editing skeleton and viewing weight painted mesh, refresh the weight painting
      if (this.bootstrap.process_step === ProcessStep.EditSkeleton &&
        this.bootstrap.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
        this.bootstrap.regenerate_weight_painted_preview_mesh()
      }
    })

    this.bootstrap.load_model_step.addEventListener('modelLoaded', () => {
      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.LoadSkeleton)
    })

    this.bootstrap.ui.dom_bind_pose_button?.addEventListener('click', () => {
      const passed_bone_skinning_test = this.bootstrap.test_bone_weighting_success()
      if (passed_bone_skinning_test) {
        this.bootstrap.process_step_changed(ProcessStep.BindPose)
      }
    })

    // rotate model after loading it in to orient it correctly
    this.bootstrap.ui.dom_rotate_model_x_button?.addEventListener('click', () => {
      this.bootstrap.load_model_step.rotate_model_geometry('x', 90)
    })

    this.bootstrap.ui.dom_rotate_model_y_button?.addEventListener('click', () => {
      this.bootstrap.load_model_step.rotate_model_geometry('y', 90)
    })

    this.bootstrap.ui.dom_rotate_model_z_button?.addEventListener('click', () => {
      this.bootstrap.load_model_step.rotate_model_geometry('z', 90)
    })

    this.bootstrap.ui.dom_move_model_to_floor_button?.addEventListener('click', () => {
      const mesh_data = this.bootstrap.load_model_step.model_meshes()
      ModelCleanupUtility.move_model_to_floor(mesh_data)
    })

    this.bootstrap.ui.dom_show_skeleton_checkbox?.addEventListener('click', (event: MouseEvent) => {
      if (this.bootstrap.skeleton_helper !== undefined) {
        this.bootstrap.skeleton_helper.visible = event.target.checked
      } else {
        console.warn('Skeleton helper is undefined, so we cannot show it')
      }
    })

    this.bootstrap.ui.dom_export_button?.addEventListener('click', () => {
      const all_clips = this.bootstrap.animations_listing_step.animation_clips()
      const animations_to_export: number[] = this.bootstrap.animations_listing_step.get_animation_indices_to_export()

      this.bootstrap.file_export_step.set_animation_clips_to_export(all_clips, animations_to_export)
      this.bootstrap.file_export_step.export(this.bootstrap.weight_skin_step.final_skinned_meshes(), 'exported-model')
    })

    // going back to edit skeleton step after skinning
    // this will do a lot of resetting
    this.bootstrap.ui.dom_back_to_edit_skeleton_button?.addEventListener('click', () => {
      this.bootstrap.remove_skinned_meshes_from_scene() // clear any existing skinned meshes
      this.bootstrap.debugging_visual_object = Utility.regenerate_debugging_scene(this.bootstrap.scene)
      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.EditSkeleton)

      // reset current bone selection for edit skeleton step
      this.bootstrap.edit_skeleton_step.set_currently_selected_bone(null)

      if (this.bootstrap.ui.dom_selected_bone_label !== null) {
        this.bootstrap.ui.dom_selected_bone_label.innerHTML = 'None'
      }

      // reset the undo/redo system
      this.bootstrap.edit_skeleton_step.clear_undo_history()
    })

    // going back to load skeleton step from edit skeleton step
    this.bootstrap.ui.dom_back_to_load_skeleton_button?.addEventListener('click', () => {
      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.LoadSkeleton)
    })

    this.bootstrap.ui.dom_back_to_load_model_button?.addEventListener('click', () => {
      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.LoadModel)
    })

    this.bootstrap.ui.dom_transform_type_radio_group?.addEventListener('change', (event: Event) => {
      const radio_button_selected: string | null = event.target?.value

      if (radio_button_selected === null) {
        console.warn('Null radio button selected for transform type change')
        return
      }

      this.bootstrap.changed_transform_controls_mode(radio_button_selected)
    })

    this.bootstrap.ui.dom_transform_space_radio_group?.addEventListener('change', (event: Event) => {
      const radio_button_selected: string | null = event.target?.value

      if (radio_button_selected === null) {
        console.warn('Null radio button selected for transform space change')
        return
      }

      this.bootstrap.changed_transform_controls_space(Utility.enum_from_value(radio_button_selected, TransformSpace))
    })

    // changing the 3d model preview while editing the skeleton bones
    this.bootstrap.ui.dom_mesh_preview_group?.addEventListener('change', (event: Event) => {
      const radio_button_selected: string | null = event.target?.value

      if (radio_button_selected === null) {
        console.warn('Null radio button selected for mesh preview type change')
        return
      }

      if (radio_button_selected === ModelPreviewDisplay.Textured) {
        this.bootstrap.changed_model_preview_display(ModelPreviewDisplay.Textured)
      } else if (radio_button_selected === ModelPreviewDisplay.WeightPainted) {
        this.bootstrap.changed_model_preview_display(ModelPreviewDisplay.WeightPainted)
      } else {
        console.warn(`Unknown mesh preview type selected: ${radio_button_selected}`)
      }
    })

    // Keyboard shortcuts for undo/redo
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      // Only handle keyboard shortcuts when in EditSkeleton step
      if (this.bootstrap.process_step !== ProcessStep.EditSkeleton) {
        return
      }

      // Define undo/redo shortcut conditions
      // Ctrl+Z or Cmd+Z for undo
      // Ctrl+Y, Cmd+Y, Ctrl+Shift+Z, or Cmd+Shift+Z for redo
      const is_undo_shortcut_pressed = (event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey
      const is_redo_shortcut_pressed = (event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))

      if (is_undo_shortcut_pressed) {
        event.preventDefault()
        this.bootstrap.edit_skeleton_step.undo_bone_transformation()
      }

      if (is_redo_shortcut_pressed) {
        event.preventDefault()
        this.bootstrap.edit_skeleton_step.redo_bone_transformation()
      }
    })
  }
}
