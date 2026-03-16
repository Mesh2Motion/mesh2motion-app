import { UI } from '../../UI.ts'
import { Generators } from '../../Generators.ts'
import { Utility } from '../../Utilities.ts'
import { UndoRedoSystem } from './UndoRedoSystem.ts'
import { PreviewPlaneManager } from './PreviewPlaneManager.ts'
import { IndependentBoneMovement } from './IndependentBoneMovement.ts'
import {
  Vector3,
  Euler,
  Object3D,
  Skeleton,
  type Scene,
  type Bone,
  BufferGeometry,
  PointsMaterial,
  Points,
  Float32BufferAttribute,
  TextureLoader,
  type Camera
} from 'three'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { RigConfig } from '../../RigConfig.ts'

/*
 * StepEditSkeleton
 * Handles editing the skeleton of the model
 * Overview of workflow:
 * 1. Load original armature from model
 * 2. Create a skeleton that Three.js can use and we can manipulate
 * 3. Allow user to edit the three.js skeleton
 */
export class StepEditSkeleton extends EventTarget {
  private readonly ui: UI
  private readonly undo_redo_system: UndoRedoSystem
  // Original armature data from the model data. A Skeleton type object is not
  // part of the original model data that is loaded
  private edited_armature: Object3D = new Object3D()

  // Skeleton created from the armature that Three.js uses
  private threejs_skeleton: Skeleton = new Skeleton()
  private mirror_mode_enabled: boolean = true
  private mesh_drag_placement_enabled: boolean = true
  private skinning_algorithm: string | null = null
  private show_debug: boolean = true

  private currently_selected_bone: Bone | null = null

  private joint_hover_point: Object3D | null = null
  private _main_scene_ref: Scene | null = null

  // Preview plane state
  private enable_head_weight_correction: boolean = false
  private head_weight_correction_height: number = 1.4 // default

  private readonly joint_texture = new TextureLoader().load('/images/skeleton-joint-point.png')

  private _added_event_listeners: boolean = false
  private readonly preview_plane_manager: PreviewPlaneManager = PreviewPlaneManager.getInstance()
  public readonly independent_bone_movement: IndependentBoneMovement = new IndependentBoneMovement()

  constructor () {
    super()
    this.ui = UI.getInstance()
    this.undo_redo_system = new UndoRedoSystem(50) // Store up to 50 undo states
  }

  /**
   * Store the current bone state before making changes
   * Call this before any bone transformations
   */
  public store_bone_state_for_undo (): void {
    this.undo_redo_system.store_current_state()
  }

  /**
   * Undo the last bone transformation
   */
  public undo_bone_transformation (): boolean {
    const result = this.undo_redo_system.undo()
    if (result) {
      // Update skeleton helper and any UI elements that depend on bone positions
      this.dispatchEvent(new CustomEvent('skeletonTransformed'))
      console.log('Undo successful')
    }
    return result
  }

  /**
   * Redo the last undone bone transformation
   */
  public redo_bone_transformation (): boolean {
    const result = this.undo_redo_system.redo()
    if (result) {
      // Update skeleton helper and any UI elements that depend on bone positions
      this.dispatchEvent(new CustomEvent('skeletonTransformed'))
      console.log('Redo successful')
    } else {
      console.log('No redo states available')
    }
    return result
  }

  private update_ui_options_on_begin (skeleton_type: SkeletonType): void {
    // keep track of skeleton type to show/hide certain UI elements
    // only human skeletons have the head weight correction option
    if (this.ui.dom_use_head_weight_correction_container != null) {
      const config = RigConfig.by_skeleton_type(skeleton_type)
      if (config?.has_head_weight_correction === true) {
        this.ui.dom_use_head_weight_correction_container.style.display = 'block'
      } else {
        this.ui.dom_use_head_weight_correction_container.style.display = 'none'
        this.enable_head_weight_correction = false // force setting to false in case it was enabled before
      }
    }

    // show/hide settings for the head correct depending on if it is checked
    this.show_preview_plane_options()
  }

  public begin (main_scene: Scene, skeleton_type: SkeletonType): void {
    this.update_ui_options_on_begin(skeleton_type)

    // show UI elemnents for editing mesh
    if (this.ui.dom_current_step_index != null) {
      this.ui.dom_current_step_index.innerHTML = '3'
    }

    if (this.ui.dom_current_step_element != null) {
      this.ui.dom_current_step_element.innerHTML = 'Position Joints'
    }

    if (this.ui.dom_skeleton_edit_tools != null) {
      this.ui.dom_skeleton_edit_tools.style.display = 'flex'
    }

    if (this.ui.dom_enable_skin_debugging != null) {
      this.show_debug = this.ui.dom_enable_skin_debugging.checked
    } else {
      this.show_debug = false
    }

    let mirror_mode_enabled: boolean = this.mirror_mode_enabled

    if (this.ui.dom_mirror_skeleton_checkbox !== null) {
      mirror_mode_enabled = this.ui.dom_mirror_skeleton_checkbox.checked
    }

    this.set_mirror_mode_enabled(mirror_mode_enabled)

    // Initialize independent bone movement from checkbox state
    if (this.ui.dom_independent_bone_movement_checkbox !== null) {
      this.independent_bone_movement.set_enabled(this.ui.dom_independent_bone_movement_checkbox.checked)
    }

    if (this.ui.dom_mesh_drag_placement_checkbox !== null) {
      this.set_mesh_drag_placement_enabled(this.ui.dom_mesh_drag_placement_checkbox.checked)
    }

    this.update_bind_button_text()

    // Don't add event listeners again if we are navigating back to this step
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    // Initialize undo/redo button states
    this.update_undo_redo_button_states(
      this.undo_redo_system.can_undo(),
      this.undo_redo_system.can_redo()
    )

    this.initialize_preview_plane(main_scene)
  }

  private initialize_preview_plane (main_scene: Scene): void {
    // add the skeleton to the scene
    // Initialize the preview plane manager with the scene and set default height
    this._main_scene_ref = main_scene
    this.preview_plane_manager.initialize(main_scene)

    // if head_weight correct is enabled, show the preview plane
    // it is off by default, but can be enabled if we navigate back to the step
    console.log('is the head weight correction enabled?', this.enable_head_weight_correction)
    this.preview_plane_manager.set_visibility(this.enable_head_weight_correction)
    this.preview_plane_manager.update_height(this.head_weight_correction_height)

    // set default value (and label) for preview plane height on UI
    if (this.ui.dom_preview_plane_height_input !== null && this.ui.dom_preview_plane_height_label !== null) {
      this.ui.dom_preview_plane_height_input.value = this.head_weight_correction_height.toString()
      this.ui.dom_preview_plane_height_label.textContent = this.head_weight_correction_height.toFixed(2)
    }
  }

  private update_bind_button_text (): void {
    if (this.show_debug && this.ui.dom_bind_pose_button !== null) {
      this.ui.dom_bind_pose_button.innerHTML = 'Test Skinning Algorithm &nbsp;&#x203a;'
      return
    }

    if (this.ui.dom_bind_pose_button !== null) {
      this.ui.dom_bind_pose_button.innerHTML = 'Finish &nbsp;&#x203a;'
    }
  }

  public show_debugging (): boolean {
    return this.show_debug
  }

  /**
   * @param bone The currently selected bone
   * @description This is the bone that is currently selected in the UI while editing
   * the skeleton.
   */
  public set_currently_selected_bone (bone: Bone | null): void {
    this.currently_selected_bone = bone
  }

  public get_currently_selected_bone (): Bone | null {
    return this.currently_selected_bone
  }

  public set_mirror_mode_enabled (value: boolean): void {
    this.mirror_mode_enabled = value
    this.dispatchEvent(new CustomEvent('mirrorModeChanged', {
      detail: { enabled: value }
    }))
  }

  public is_mirror_mode_enabled (): boolean {
    return this.mirror_mode_enabled
  }

  public set_mesh_drag_placement_enabled (value: boolean): void {
    this.mesh_drag_placement_enabled = value
    this.update_manual_transform_options_visibility()
    this.dispatchEvent(new CustomEvent('boneEditModeChanged', {
      detail: { enabled: value }
    }))
  }

  public is_mesh_drag_placement_enabled (): boolean {
    return this.mesh_drag_placement_enabled
  }

  private update_manual_transform_options_visibility (): void {
    if (this.ui.dom_transform_manual_options === null) {
      return
    }

    this.ui.dom_transform_manual_options.style.display = this.mesh_drag_placement_enabled ? 'none' : 'flex'
  }

  public is_bone_selectable (bone: Bone | null): boolean {
    if (bone === null) {
      return false
    }

    if (!this.mirror_mode_enabled) {
      return true
    }

    return !this.is_right_side_bone(bone)
  }

  private is_right_side_bone (bone: Bone): boolean {
    const normalized_bone_name = bone.name.toLowerCase()
    return /(^right_|^r_|_right$|_r$|\.right$|\.r$|-right$|-r$)/.test(normalized_bone_name)
  }

  /**
   * Find the mirrored counterpart of a bone by stripping side suffixes and
   * matching against the rest of the skeleton. Returns undefined for centre-line
   * bones (spine, neck, head, etc.) that have no counterpart.
   */
  public find_mirror_bone (bone: Bone): Bone | undefined {
    const base_name = Utility.calculate_bone_base_name(bone.name)
    return this.threejs_skeleton.bones.find((candidate) => {
      const candidate_base = Utility.calculate_bone_base_name(candidate.name)
      return candidate_base === base_name && candidate.name !== bone.name
    })
  }

  public algorithm (): string | null {
    return this.skinning_algorithm
  }

  /**
   * Toggle the visibility of the preview plane
   * @param visible Whether the plane should be visible
   */
  public set_use_head_weight_correction (is_enabled: boolean): void {
    this.enable_head_weight_correction = is_enabled
    this.preview_plane_manager.set_visibility(is_enabled)
    this.preview_plane_manager.update_height(this.head_weight_correction_height)
  }

  /**
   * Get the current visibility state of the preview plane
   */
  public use_head_weight_correction (): boolean {
    return this.enable_head_weight_correction
  }

  /**
   * Set the height of the preview plane
   * @param height The Y coordinate height for the plane
   */
  public set_preview_plane_height (height: number): void {
    this.head_weight_correction_height = height
    this.preview_plane_manager.update_height(height)
  }

  /**
   * Get the current height of the preview plane
   */
  public get_preview_plane_height (): number {
    return this.head_weight_correction_height
  }

  public add_event_listeners (): void {
    if (this.ui.dom_move_to_origin_button !== null) {
      this.ui.dom_move_to_origin_button.addEventListener('click', () => {
        // the base bone itself is not at the origin, but the parent is the armature object
        this.threejs_skeleton.bones[0].position.set(0, 0, 0)
        this.threejs_skeleton.bones[0].updateWorldMatrix(true, true) // update on renderer
      })
    }

    if (this.ui.dom_mirror_skeleton_checkbox !== null) {
      this.ui.dom_mirror_skeleton_checkbox.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement | null

        if (target === null) {
          return
        }

        // mirror skeleton movements along the X axis
        this.set_mirror_mode_enabled(target.checked)
      })
    }

    if (this.ui.dom_independent_bone_movement_checkbox !== null) {
      this.ui.dom_independent_bone_movement_checkbox.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement | null

        if (target === null) {
          return
        }

        this.independent_bone_movement.set_enabled(target.checked)
      })
    }

    if (this.ui.dom_mesh_drag_placement_checkbox !== null) {
      this.ui.dom_mesh_drag_placement_checkbox.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement | null

        if (target === null) {
          return
        }

        this.set_mesh_drag_placement_enabled(target.checked)
      })
    }

    this.ui.dom_enable_skin_debugging?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | null

      if (target === null) {
        return
      }

      this.show_debug = target.checked
      this.update_bind_button_text()
    })

    // Add undo/redo button event listeners
    this.ui.dom_undo_button?.addEventListener('click', () => {
      this.undo_bone_transformation()
    })

    this.ui.dom_redo_button?.addEventListener('click', () => {
      this.redo_bone_transformation()
    })

    // Listen for undo/redo state changes to update button states
    this.undo_redo_system.addEventListener('undoRedoStateChanged', (event: any) => {
      this.update_undo_redo_button_states(event.detail.canUndo, event.detail.canRedo)
    })

    // Add preview plane event listeners
    this.ui.dom_preview_plane_checkbox?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      this.set_use_head_weight_correction(target.checked)

      this.show_preview_plane_options()
    })

    this.ui.dom_preview_plane_height_input?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      const height = parseFloat(target.value)
      const final_height = isNaN(height) ? 0.00 : height
      this.head_weight_correction_height = final_height

      this.set_preview_plane_height(this.head_weight_correction_height)

      // Update the label to show current value
      if (this.ui.dom_preview_plane_height_label !== null) {
        this.ui.dom_preview_plane_height_label.textContent = this.head_weight_correction_height.toFixed(2)
      }
    })
  }

  private show_preview_plane_options (): void {
    if (this.ui.dom_preview_plane_setting_container !== null) {
      this.ui.dom_preview_plane_setting_container.style.display = this.use_head_weight_correction() ? 'flex' : 'none'
    }
  }

  // returning back to edit skeleton step later will call this to reset undo state
  public clear_undo_history (): void {
    this.undo_redo_system.clear_history()
  }

  /**
   * Update the enabled/disabled state of undo/redo buttons
   */
  private update_undo_redo_button_states (can_undo: boolean, can_redo: boolean): void {
    if (this.ui.dom_undo_button !== null) {
      this.ui.dom_undo_button.disabled = !can_undo
    }
    if (this.ui.dom_redo_button !== null) {
      this.ui.dom_redo_button.disabled = !can_redo
    }
  }

  private remove_event_listeners (): void {
    if (this.ui.dom_move_to_origin_button !== null) {
      this.ui.dom_move_to_origin_button.removeEventListener('click', () => {})
    }

    if (this.ui.dom_scale_skeleton_button !== null) {
      this.ui.dom_scale_skeleton_button.removeEventListener('click', () => {})
    }

    if (this.ui.dom_mirror_skeleton_checkbox !== null) {
      this.ui.dom_mirror_skeleton_checkbox.removeEventListener('change', () => {})
    }

    if (this.ui.dom_enable_skin_debugging !== null) {
      this.ui.dom_enable_skin_debugging.removeEventListener('change', () => {})
    }

    if (this.ui.dom_undo_button !== null) {
      this.ui.dom_undo_button.removeEventListener('click', () => {})
    }

    if (this.ui.dom_redo_button !== null) {
      this.ui.dom_redo_button.removeEventListener('click', () => {})
    }

    // Remove preview plane event listeners
    if (this.ui.dom_preview_plane_checkbox !== null) {
      this.ui.dom_preview_plane_checkbox.removeEventListener('change', () => {})
    }

    if (this.ui.dom_preview_plane_height_input !== null) {
      this.ui.dom_preview_plane_height_input.removeEventListener('input', () => {})
    }
  }

  public cleanup_on_exit_step (): void {
    this.remove_event_listeners()
    this.clear_hover_point_if_exists()
    this.remove_preview_plane()
  }

  /**
   * Remove the preview plane from the scene
   */
  private remove_preview_plane (): void {
    this.preview_plane_manager.cleanup()
  }

  /*
   * Take original armature that we are editing and create a skeleton that Three.js can use
  */
  public load_original_armature_from_model (armature: Object3D): void {
    this.edited_armature = armature.clone()

    this.create_threejs_skeleton_object()

    // Initialize the undo/redo system with the skeleton
    this.undo_redo_system.set_skeleton(this.threejs_skeleton)
  }

  private create_threejs_skeleton_object (): Skeleton {
    // create skeleton and helper to visualize
    this.threejs_skeleton = Generators.create_skeleton(this.edited_armature.children[0])
    this.threejs_skeleton.name = 'Editing Skeleton'

    // update the world matrix for the skeleton
    // without this the skeleton helper won't appear when the bones are first loaded
    this.threejs_skeleton.bones[0].updateWorldMatrix(true, true)

    return this.threejs_skeleton
  }

  public armature (): Object3D {
    return this.edited_armature
  }

  public skeleton (): Skeleton {
    return this.threejs_skeleton
  }

  public apply_mirror_mode (selected_bone: Bone, transform_type: string): void {
    const mirror_bone = this.find_mirror_bone(selected_bone)

    if (mirror_bone === undefined) {
      return // centre-line bone (head, neck, spine) — no counterpart
    }

    if (transform_type === 'translate') {
      // move the mirror bone in the -X value of the transform control
      // this will mirror the movement of the bone
      mirror_bone.position.copy(
        new Vector3(
          -selected_bone.position.x,
          selected_bone.position.y,
          selected_bone.position.z
        ))
    }

    if (transform_type === 'rotate') {
      const euler = new Euler(
        selected_bone.rotation.x,
        -selected_bone.rotation.y,
        -selected_bone.rotation.z
      )
      mirror_bone.quaternion.setFromEuler(euler)
    }

    // updateWorldMatrix(updateParents, updateChildren) - propagate changes up and down the hierarchy
    mirror_bone.updateWorldMatrix(true, true)
  }

  /**
   * @param event This will be called every mouse move event
   * the event listener was originally setup in the EventListener.ts file
   * it is needed for the edit skeleton step, so I added logic here
   */
  public calculate_bone_hover_effect (event: MouseEvent, camera: Camera, hover_distance: number): void {
    // create a raycaster to detect the bone that is being hovered over
    // we will only have a hover effect if the mouse is close enough to the bone
    const [closest_bone, closest_bone_index, closest_distance] =
      Utility.raycast_closest_bone_test(camera, event, this.threejs_skeleton)

    // only do selection if we are close
    // the orbit controls also have panning with alt-click, so we don't want to interfere with that
    if (closest_distance === null || closest_distance > hover_distance) {
      this.update_bone_hover_point_position(null)
      return
    }

    if (!this.is_bone_selectable(closest_bone)) {
      this.update_bone_hover_point_position(null)
      return
    }

    this.update_bone_hover_point_position(closest_bone)
  }

  /**
   * Remove the hover point. This is important when we change steps
   */
  private clear_hover_point_if_exists (): void {
    if (this.joint_hover_point !== null) {
      this._main_scene_ref?.remove(this.joint_hover_point)
      this.joint_hover_point = null
    }
  }

  /**
   * Create a hover effect for the bone that would be selected for bone editing
   * @param bone
   * @param camera
   */
  private update_bone_hover_point_position (bone: Bone | null): void {
    // create hover point sphere for when our mouse gets close to a bone joint
    if (this.joint_hover_point === null) {
      // Create the hover point if it doesn't exist
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3)) // Single vertex at origin

      const material = new PointsMaterial({
        color: 0x69a1d0, // Blue color
        size: 30, // Size of the point in pixels
        sizeAttenuation: false, // Disable size attenuation
        depthTest: false, // always render on top
        map: this.joint_texture, // Use a circular texture
        opacity: 0.7,
        transparent: true // Enable transparency for the circular texture
      })

      this.joint_hover_point = new Points(geometry, material)
      this.joint_hover_point.renderOrder = 100 // render on top of everything else
      this.joint_hover_point.name = 'Joint Hover Point'
      this._main_scene_ref?.add(this.joint_hover_point)
    }

    if (bone !== null) {
      // update the position of the hover point
      const world_position = Utility.world_position_from_object(bone)
      this.joint_hover_point.position.copy(world_position)
      this.joint_hover_point.updateWorldMatrix(true, true)
    } else {
      // remove the hover point if we are not hovering over a bone
      this._main_scene_ref?.remove(this.joint_hover_point)
      this.joint_hover_point = null
    }
  }
}
