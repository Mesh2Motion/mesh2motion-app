import { type Mesh2MotionEngine } from '../Mesh2MotionEngine'
import { ModelPreviewDisplay } from './enums/ModelPreviewDisplay'
import { ProcessStep } from './enums/ProcessStep'
import { TransformSpace } from './enums/TransformSpace'
import { Utility } from './Utilities'
import { ModelCleanupUtility } from './processes/load-model/ModelCleanupUtility'
import { ModelAnalysisReport } from './processes/load-model/ModelAnalysisReport'
import { DownloadSuccessDialog } from './components/download-success/DownloadSuccessDialog'
import { ModalDialog } from './ModalDialog.ts'
import { type Bone, type Material, type MeshBasicMaterial, type MeshPhongMaterial, type MeshStandardMaterial } from 'three'

export class EventListeners {
  // Track the pointer that started canvas drag so touch/pencil moves stay consistent
  // and we can ignore unrelated pointers before releasing capture on pointerup/cancel.
  private active_canvas_pointer_id: number | null = null

  constructor (private readonly bootstrap: Mesh2MotionEngine) {}

  private update_weight_painting_cursor (): void {
    if (this.bootstrap.weight_painting_step.is_bone_picking_enabled()) {
      const icon = document.querySelector<HTMLImageElement>('#weight-paint-step-pick-bone img')
      let icon_url = 'images/icons/color-picker-cursor.svg'
      if (icon !== null) {
        const replaced_url = icon.src.replace('color-picker.svg', 'color-picker-cursor.svg')
        if (replaced_url.includes('color-picker-cursor.svg')) {
          icon_url = replaced_url
        }
      }

      // tip of the pipette is the hotspot; crosshair is the fallback
      this.bootstrap.renderer.domElement.style.cursor = `url("${icon_url}") 2 22, crosshair`
      return
    }

    // the crosshair is only shown while hovering a paintable mesh; empty space
    // keeps the normal pointer so rotating the canvas matches the other steps
    this.bootstrap.renderer.domElement.style.cursor = ''
  }

  private is_typing_target (target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
  }

  /**
   * True while a press that missed the mesh is dragging the camera. The press
   * is left to OrbitControls, so paint previews should not follow the pointer.
   */
  private is_camera_rotation_drag (event: PointerEvent): boolean {
    return event.buttons !== 0 && this.active_canvas_pointer_id === null
  }

  public addEventListeners (): void {
    // monitor theme changes
    this.bootstrap.theme_manager.addEventListener('theme-changed', (event: any) => {
      this.bootstrap.regenerate_floor_grid()
    })

    this.bootstrap.load_skeleton_step.addEventListener('skeletonLoaded', () => {
      this.bootstrap.edit_skeleton_step.load_original_armature_from_model(this.bootstrap.load_skeleton_step.armature())
      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.EditSkeleton)
    })

    this.bootstrap.edit_skeleton_step.addEventListener('weightPaintModeChanged', (event: Event) => {
      const enabled = (event as CustomEvent<{ enabled: boolean }>).detail.enabled
      if (enabled) {
        this.bootstrap.transform_controls.detach()
        this.bootstrap.transform_controls.enabled = false
        this.bootstrap.ui.hide_selected_bone_overlay()
      } else {
        this.bootstrap.update_edit_bone_interaction_mode()
      }
      this.bootstrap.renderer.domElement.style.cursor = ''
    })
    this.bootstrap.edit_skeleton_step.addEventListener('weightPaintChanged', () => {
      if (this.bootstrap.process_step === ProcessStep.EditSkeleton &&
        this.bootstrap.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
        this.bootstrap.regenerate_weight_painted_preview_mesh()
      }
    })
    this.bootstrap.weight_painting_step.addEventListener('weightPaintModeChanged', () => {
      this.bootstrap.ui.hide_selected_bone_overlay()
      this.update_weight_painting_cursor()
    })
    this.bootstrap.weight_painting_step.addEventListener('bonePickModeChanged', () => {
      this.update_weight_painting_cursor()
    })

    // Listen for skeleton transformation events to update UI and visuals
    // this can happen with undo/redo system
    this.bootstrap.edit_skeleton_step.addEventListener('skeletonTransformed', () => {
      // Update skeleton helper if it exists
      if (this.bootstrap.skeleton_helper !== undefined) {
        this.bootstrap.regenerate_skeleton_helper(this.bootstrap.edit_skeleton_step.skeleton(), 'Skeleton Helper')
        this.bootstrap.sync_skeleton_helper_joint_visibility()
      }

      // Refresh weight painting if in weight painted mode
      if (this.bootstrap.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
        this.bootstrap.regenerate_weight_painted_preview_mesh()
      }
    })

    this.bootstrap.edit_skeleton_step.addEventListener('mirrorModeChanged', () => {
      this.bootstrap.sync_skeleton_helper_joint_visibility()
    })

    this.bootstrap.edit_skeleton_step.addEventListener('boneEditModeChanged', () => {
      this.bootstrap.update_edit_bone_interaction_mode()
    })

    // attribution link clicking brings up contributors dialog
    this.bootstrap.ui.dom_attribution_link?.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault()
      this.bootstrap.show_contributors_dialog()
    })

    // Learn link clicking brings up learning resources
    this.bootstrap.ui.dom_learn_link?.addEventListener('click', (event: MouseEvent) => {
      event.preventDefault()
      this.bootstrap.show_learning_resources_dialog()
    })

    // listen for view helper changes
    document.getElementById('view-control-hitbox')?.addEventListener('pointerdown', (event: PointerEvent) => {
      if (this.bootstrap.view_helper.handleClick(event)) {
        event.stopPropagation()
        event.preventDefault()
      }
    })

    // useful for iPad. Without this, when you touch the canvas and drag, 
    // it will scroll the webpage instead of dragging the transform controls or the camera.
    this.bootstrap.renderer.domElement.style.touchAction = 'none'

    // Weight paint modes claim left-button presses only when the initial
    // raycast hits the mesh. A press on empty space is left to OrbitControls,
    // so dragging after it rotates the camera instead of painting. Middle/right
    // mouse and the wheel keep orbiting, panning, and zooming either way.
    this.bootstrap.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
      const edit_step_painting = this.bootstrap.process_step === ProcessStep.EditSkeleton &&
        this.bootstrap.edit_skeleton_step.is_weight_painting_enabled()
      const weight_painting_step_painting = this.bootstrap.process_step === ProcessStep.WeightPainting &&
        this.bootstrap.weight_painting_step.is_draw_mode_active()
      const weight_painting_step_picking = this.bootstrap.process_step === ProcessStep.WeightPainting &&
        this.bootstrap.weight_painting_step.is_bone_picking_enabled()

      // left paints/picks. The right button stays free for panning the camera.
      const should_capture = event.button === 0 &&
        (edit_step_painting || weight_painting_step_painting || weight_painting_step_picking)

      if (!should_capture) {
        // middle/right drags orbit and pan; keep the normal pointer for them
        if (this.bootstrap.process_step === ProcessStep.WeightPainting) {
          this.bootstrap.weight_painting_step.hide_brush_cursor()
          this.bootstrap.renderer.domElement.style.cursor = ''
        }
        return
      }

      // the initial raycast decides whether this press paints or rotates
      if (!this.bootstrap.handle_weight_paint_pointer_down(event)) {
        this.bootstrap.weight_painting_step.hide_brush_cursor()
        this.bootstrap.weight_painting_step.hide_picker_hover()
        this.update_weight_painting_cursor()
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      if (!weight_painting_step_picking) {
        this.bootstrap.renderer.domElement.style.cursor = 'crosshair'
      }
      this.active_canvas_pointer_id = event.pointerId
      this.bootstrap.renderer.domElement.setPointerCapture(event.pointerId)
    }, { capture: true })

    this.bootstrap.renderer.domElement.addEventListener('pointermove', (event: PointerEvent) => {
      if (this.active_canvas_pointer_id !== null && event.pointerId !== this.active_canvas_pointer_id) {
        return
      }

      if (this.bootstrap.process_step === ProcessStep.EditSkeleton &&
        this.bootstrap.edit_skeleton_step.is_weight_painting_enabled()) {
        if (this.is_camera_rotation_drag(event)) {
          this.bootstrap.renderer.domElement.style.cursor = ''
          return
        }
        event.preventDefault()
        const over_mesh = this.bootstrap.handle_weight_paint_pointer_move(event)
        if (this.active_canvas_pointer_id !== null) {
          this.bootstrap.renderer.domElement.style.cursor = over_mesh ? 'crosshair' : ''
        } else {
          this.bootstrap.update_edit_weight_paint_cursor(event)
        }
        return
      }

      // while the picker is armed, preview the bone under the pointer before the click
      if (this.bootstrap.process_step === ProcessStep.WeightPainting &&
        this.bootstrap.weight_painting_step.is_bone_picking_enabled()) {
        if (this.is_camera_rotation_drag(event)) {
          this.bootstrap.weight_painting_step.hide_picker_hover()
          this.bootstrap.renderer.domElement.style.cursor = ''
          return
        }
        event.preventDefault()
        this.bootstrap.update_weight_paint_picker_hover(event)
        return
      }

      if (this.bootstrap.process_step === ProcessStep.WeightPainting &&
        this.bootstrap.weight_painting_step.is_draw_mode_active()) {
        if (this.is_camera_rotation_drag(event)) {
          this.bootstrap.weight_painting_step.hide_brush_cursor()
          this.bootstrap.renderer.domElement.style.cursor = ''
          return
        }
        event.preventDefault()
        const over_mesh = this.active_canvas_pointer_id !== null
          ? this.bootstrap.handle_weight_paint_pointer_move(event)
          : this.bootstrap.update_weight_paint_brush_cursor(event)
        this.bootstrap.renderer.domElement.style.cursor = over_mesh ? 'crosshair' : ''
        return
      }

      if (this.bootstrap.is_transform_controls_dragging) {
        this.bootstrap.handle_transform_controls_moving()
      }

      if (this.bootstrap.is_mesh_drag_mode_dragging) {
        event.preventDefault()
        this.bootstrap.handle_mesh_drag_mode_mouse_move(event)
      }

      // edit skeleton step logic that deals with hovering over bones
      if (this.bootstrap.process_step === ProcessStep.EditSkeleton) {
        const hovered_bone = this.bootstrap.edit_skeleton_step.calculate_bone_hover_effect(event, this.bootstrap.camera, this.bootstrap.transform_controls_hover_distance)

        // show the overlay and use a hand cursor when hovering over a joint
        // the drag handlers control the overlay while dragging, so skip then
        const is_dragging_bone = this.bootstrap.is_transform_controls_dragging || this.bootstrap.is_mesh_drag_mode_dragging
        if (!is_dragging_bone) {
          if (hovered_bone !== null) {
            this.bootstrap.ui.show_selected_bone_overlay(hovered_bone.name)
            this.bootstrap.renderer.domElement.style.cursor = 'grab'
          } else {
            this.bootstrap.ui.hide_selected_bone_overlay()
            this.bootstrap.renderer.domElement.style.cursor = ''
          }
        }
      } else if (this.bootstrap.renderer.domElement.style.cursor !== '') {
        // reset cursor when leaving the edit skeleton step
        this.bootstrap.renderer.domElement.style.cursor = ''
      }
    })

    this.bootstrap.renderer.domElement.addEventListener('pointerleave', () => {
      this.bootstrap.weight_painting_step.hide_brush_cursor()
      this.bootstrap.weight_painting_step.hide_picker_hover()
      this.bootstrap.renderer.domElement.style.cursor = ''
    })

    // keep the context menu out of the way while the paint tools are open, so
    // right-drag can still pan the camera
    this.bootstrap.renderer.domElement.addEventListener('contextmenu', (event: MouseEvent) => {
      if (this.bootstrap.process_step === ProcessStep.WeightPainting &&
        this.bootstrap.weight_painting_step.is_paint_mode_active()) {
        event.preventDefault()
      }
    })

    this.bootstrap.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
      const use_mesh_drag_mode =
        this.bootstrap.process_step === ProcessStep.EditSkeleton &&
        this.bootstrap.edit_skeleton_step.is_mesh_drag_placement_enabled()

      let did_start_bone_drag = false
      if (use_mesh_drag_mode) {
        this.active_canvas_pointer_id = event.pointerId
        this.bootstrap.renderer.domElement.setPointerCapture(event.pointerId)
        event.preventDefault()
        did_start_bone_drag = this.bootstrap.handle_mesh_drag_mode_mouse_down(event)
      } else {
        this.bootstrap.handle_transform_controls_mouse_down(event)
      }

      // show the viewport banner only when we actually started dragging a bone
      const selected_bone = this.bootstrap.edit_skeleton_step.get_currently_selected_bone()
      if (selected_bone !== null && did_start_bone_drag) {
        this.bootstrap.ui.show_selected_bone_overlay(selected_bone.name)
        this.bootstrap.renderer.domElement.style.cursor = 'grabbing'
      }
    }, false)

    document.addEventListener('pointerup', (event: PointerEvent) => {
      if (this.active_canvas_pointer_id !== null && event.pointerId !== this.active_canvas_pointer_id) {
        return
      }

      this.bootstrap.handle_weight_paint_pointer_up(event)
      this.bootstrap.handle_mesh_drag_mode_mouse_up()

      if (this.active_canvas_pointer_id !== null &&
        this.bootstrap.renderer.domElement.hasPointerCapture(this.active_canvas_pointer_id)) {
        this.bootstrap.renderer.domElement.releasePointerCapture(this.active_canvas_pointer_id)
      }

      this.active_canvas_pointer_id = null
      this.bootstrap.ui.hide_selected_bone_overlay()
      this.update_weight_painting_cursor()
    })

    document.addEventListener('pointercancel', (event: PointerEvent) => {
      if (this.active_canvas_pointer_id !== null && event.pointerId !== this.active_canvas_pointer_id) {
        return
      }

      this.bootstrap.handle_weight_paint_pointer_up(event)
      this.bootstrap.handle_mesh_drag_mode_mouse_up()

      if (this.active_canvas_pointer_id !== null &&
        this.bootstrap.renderer.domElement.hasPointerCapture(this.active_canvas_pointer_id)) {
        this.bootstrap.renderer.domElement.releasePointerCapture(this.active_canvas_pointer_id)
      }

      this.active_canvas_pointer_id = null
      this.bootstrap.ui.hide_selected_bone_overlay()
      this.update_weight_painting_cursor()
    })

    // custom event listeners for the transform controls.
    // we can know about the "mouseup" event with this
    this.bootstrap.transform_controls?.addEventListener('dragging-changed', (event: any) => {
      this.bootstrap.is_transform_controls_dragging = event.value
      this.bootstrap.enable_orbit_controls(!event.value)

      // show the overlay when the transform widget drag starts, hide when it ends
      // also switch to a grabbing cursor while dragging a bone
      const dragged_bone = this.bootstrap.edit_skeleton_step.get_currently_selected_bone()
      if (event.value && dragged_bone !== null &&
        this.bootstrap.process_step === ProcessStep.EditSkeleton) {
        this.bootstrap.ui.show_selected_bone_overlay(dragged_bone.name)
        this.bootstrap.renderer.domElement.style.cursor = 'grabbing'
      } else if (!event.value) {
        this.bootstrap.ui.hide_selected_bone_overlay()
        this.bootstrap.renderer.domElement.style.cursor = ''
      }

      // Store undo state when we start dragging (event.value = true)
      if (event.value && this.bootstrap.process_step === ProcessStep.EditSkeleton) {
        this.bootstrap.edit_skeleton_step.store_bone_state_for_undo()

        // Record children's initial world positions for independent bone movement
        if (this.bootstrap.edit_skeleton_step.independent_bone_movement.is_enabled()) {
          const selected_bone = this.bootstrap.transform_controls.object
          if (selected_bone !== undefined && selected_bone !== null) {
            const mirror_bone = this.bootstrap.edit_skeleton_step.is_mirror_mode_enabled()
              ? this.bootstrap.edit_skeleton_step.find_mirror_bone(selected_bone as Bone)
              : undefined
            this.bootstrap.edit_skeleton_step.independent_bone_movement.record_drag_start(selected_bone as Bone, mirror_bone)
          }
        }
      }

      if (!event.value &&
        this.bootstrap.process_step === ProcessStep.EditSkeleton &&
        this.bootstrap.transform_controls.getMode() === 'translate' &&
        this.bootstrap.edit_skeleton_step.independent_bone_movement.is_enabled()) {
        const selected_bone = this.bootstrap.transform_controls.object
        if (selected_bone !== undefined && selected_bone !== null) {
          const mirror_bone = this.bootstrap.edit_skeleton_step.is_mirror_mode_enabled()
            ? this.bootstrap.edit_skeleton_step.find_mirror_bone(selected_bone as Bone)
            : undefined
          this.bootstrap.edit_skeleton_step.independent_bone_movement.finalize_drop(selected_bone as Bone, mirror_bone)
        }
      }

      // if we stopped dragging, that means a mouse up.
      // if we are editing skeleton and viewing weight painted mesh, refresh the weight painting
      if (this.bootstrap.process_step === ProcessStep.EditSkeleton &&
        this.bootstrap.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
        this.bootstrap.regenerate_weight_painted_preview_mesh()
      }
    })

    this.bootstrap.load_model_step.addEventListener('modelLoaded', () => {
      this.bootstrap.edit_skeleton_step.reset_weight_paint_overrides()
      this.bootstrap.process_step = this.bootstrap.process_step_changed(ProcessStep.LoadSkeleton)
    })

    this.bootstrap.ui.dom_bind_pose_button?.addEventListener('click', () => {
      this.bootstrap.setup_weight_skinning_config()

      // the weight painting step is optional, so skip it unless the user
      // enabled it while positioning the bones
      const weight_paint_step_enabled = this.bootstrap.ui.dom_enable_weight_paint_step?.checked ?? false
      this.bootstrap.process_step_changed(
        weight_paint_step_enabled ? ProcessStep.WeightPainting : ProcessStep.BindPose)
    })

    this.bootstrap.ui.dom_back_to_edit_skeleton_from_weight_paint_button?.addEventListener('click', () => {
      this.bootstrap.back_to_edit_skeleton()
    })

    this.bootstrap.ui.dom_continue_to_animations_button?.addEventListener('click', () => {
      this.bootstrap.process_step_changed(ProcessStep.AnimationsListing)
    })

    // rotate model after loading it in to orient it correctly
    this.bootstrap.ui.dom_rotate_model_x_button?.addEventListener('click', () => {
      ModelCleanupUtility.rotate_model_geometry(this.bootstrap.load_model_step.model_meshes(), 'x', 90)
    })

    this.bootstrap.ui.dom_rotate_model_y_button?.addEventListener('click', () => {
      ModelCleanupUtility.rotate_model_geometry(this.bootstrap.load_model_step.model_meshes(), 'y', 90)
    })

    this.bootstrap.ui.dom_rotate_model_z_button?.addEventListener('click', () => {
      ModelCleanupUtility.rotate_model_geometry(this.bootstrap.load_model_step.model_meshes(), 'z', 90)
    })

    // show a breakdown of what was found in the imported file
    this.bootstrap.ui.dom_analyze_model_link?.addEventListener('click', () => {
      ModelAnalysisReport.show_dialog(this.bootstrap.load_model_step.get_import_analysis())
    })

    // Reset model position to import state
    this.bootstrap.ui.dom_reset_model_position_button?.addEventListener('click', () => {
      this.bootstrap.load_model_step.reset_model_position()
    })

    // Auto-align model to floor
    this.bootstrap.ui.dom_auto_align_model_button?.addEventListener('click', () => {
      // move the mesh geometry data to the floor
      const mesh_data = this.bootstrap.load_model_step.model_meshes()
      ModelCleanupUtility.move_model_to_floor(mesh_data)

      // move the transform widget to reset it to the new position on the canvas
      const py = mesh_data.position.y
      if (py !== 0) {
        ModelCleanupUtility.translate_model_vertices(mesh_data, 0, py, 0)
        mesh_data.position.setY(0)
      }
    })

    this.bootstrap.ui.dom_show_skeleton_checkbox?.addEventListener('click', (event: MouseEvent) => {
      if (this.bootstrap.skeleton_helper !== undefined) {
        this.bootstrap.skeleton_helper.visible = event.target.checked
      } else {
        console.warn('Skeleton helper is undefined, so we cannot show it')
      }
    })

    this.bootstrap.ui.dom_wireframe_checkbox?.addEventListener('change', (event: Event) => {
      const is_wireframe = (event.target as HTMLInputElement).checked
      const skinned_meshes = this.bootstrap.active_skinned_meshes()
      skinned_meshes.forEach((mesh) => {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        materials.forEach((mat: Material) => {
          (mat as MeshBasicMaterial | MeshPhongMaterial | MeshStandardMaterial).wireframe = is_wireframe
        })
      })
    })

    this.bootstrap.ui.dom_export_button?.addEventListener('click', () => {
      // selected animations that were never played still need to be downloaded first
      void this.bootstrap.animations_listing_step.get_animation_clips_to_export()
        .then(async (export_selections) => {
          this.bootstrap.file_export_step.set_animation_clips_to_export(export_selections)
          await this.bootstrap.file_export_step.export(
            this.bootstrap.animations_listing_step.active_skinned_meshes(),
            'exported-model',
            this.bootstrap.download_settings
          )
        })
        .then(() => {
          new DownloadSuccessDialog().show()
        })
        .catch((error: unknown) => {
          const error_message = error instanceof Error ? error.message : 'Failed to export file.'
          new ModalDialog('Export failed', error_message).show()
        })
    })

    // going back from the animation listing returns to weight painting when
    // that optional step is enabled, otherwise it goes straight back to the bones
    this.bootstrap.ui.dom_back_to_edit_skeleton_button?.addEventListener('click', () => {
      const weight_paint_step_enabled = this.bootstrap.ui.dom_enable_weight_paint_step?.checked ?? false
      if (weight_paint_step_enabled) {
        this.bootstrap.process_step_changed(ProcessStep.WeightPainting)
        return
      }

      this.bootstrap.back_to_edit_skeleton()
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
      const is_edit_step = this.bootstrap.process_step === ProcessStep.EditSkeleton
      const is_weight_painting_step = this.bootstrap.process_step === ProcessStep.WeightPainting

      // Only handle keyboard shortcuts in these steps
      if (!is_edit_step && !is_weight_painting_step) {
        return
      }

      // Define undo/redo shortcut conditions
      // Ctrl+Z or Cmd+Z for undo
      // Ctrl+Y, Cmd+Y, Ctrl+Shift+Z, or Cmd+Shift+Z for redo
      const is_undo_shortcut_pressed = (event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey
      const is_redo_shortcut_pressed = (event.ctrlKey || event.metaKey) && (event.key === 'y' || (event.key === 'z' && event.shiftKey))

      if (is_undo_shortcut_pressed) {
        event.preventDefault()
        if (is_edit_step) {
          if (this.bootstrap.edit_skeleton_step.is_weight_painting_enabled() &&
            this.bootstrap.edit_skeleton_step.weight_paint_manager.can_undo()) {
            this.bootstrap.edit_skeleton_step.undo_weight_paint_stroke()
          } else {
            this.bootstrap.edit_skeleton_step.undo_bone_transformation()
          }
        } else if (is_weight_painting_step) {
          this.bootstrap.weight_painting_step.undo_weight_paint_stroke()
        }
      }

      if (is_redo_shortcut_pressed) {
        event.preventDefault()
        if (is_edit_step) {
          this.bootstrap.edit_skeleton_step.redo_bone_transformation()
        } else if (is_weight_painting_step) {
          this.bootstrap.weight_painting_step.redo_weight_paint_stroke()
        }
      }
    })
  }
}
