import { WeightPaintManager, type BrushVertex, type ManualWeightOverrides, type WeightPaintMode } from './WeightPaintManager.ts'
import { UI } from '../../UI.ts'
import { Generators } from '../../Generators.ts'
import { Utility } from '../../Utilities.ts'
import { UndoRedoSystem } from './UndoRedoSystem.ts'
import { PreviewPlaneManager } from './PreviewPlaneManager.ts'
import { ArmPlaneManager } from './ArmPlaneManager.ts'
import { ArmWeightCorrector } from '../../solvers/ArmWeightCorrector.ts'
import { IndependentBoneMovement } from './IndependentBoneMovement.ts'
import { ModalDialog } from '../../ModalDialog.ts'
import {
  Vector3,
  Euler,
  Matrix3,
  Mesh,
  Object3D,
  Skeleton,
  type Scene,
  type Bone,
  type Intersection,
  BufferGeometry,
  PointsMaterial,
  Points,
  Float32BufferAttribute,
  TextureLoader,
  type PerspectiveCamera
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

  public readonly weight_paint_manager = new WeightPaintManager()
  private weight_paint_available = false
  private weight_painting_enabled = false
  private weight_paint_bone_name: string | null = null
  private weight_paint_radius = 0.03
  private weight_paint_strength = 0.5
  private weight_paint_mode: WeightPaintMode = 'add'
  private weight_paint_mirror_enabled = true
  private readonly weight_paint_stroke_vertices = new Set<string>()

  private currently_selected_bone: Bone | null = null

  private joint_hover_point: Object3D | null = null
  private _main_scene_ref: Scene | null = null

  // Preview plane state
  private enable_head_weight_correction: boolean = false
  private head_weight_correction_height: number = 1.4 // default

  // Arm plane state. The offset is relative to the shoulder joint's X position,
  // so it has to match the default in create.html's slider.
  private enable_arm_plane_correction: boolean = false
  private arm_plane_offset: number = 0.0

  private readonly joint_texture = new TextureLoader().load('/images/skeleton-joint-point.png')

  private _added_event_listeners: boolean = false
  private readonly preview_plane_manager: PreviewPlaneManager = PreviewPlaneManager.getInstance()
  private readonly arm_plane_manager: ArmPlaneManager = new ArmPlaneManager()
  public readonly independent_bone_movement: IndependentBoneMovement = new IndependentBoneMovement()

  // UI elements specific for this area
  private _current_skeleton_type: SkeletonType | null = null
  private dom_template_image: HTMLElement | null = null

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
      if (skeleton_type === SkeletonType.Human) {
        this.ui.dom_use_head_weight_correction_container.style.display = 'block'
      } else {
        this.ui.dom_use_head_weight_correction_container.style.display = 'none'
        this.enable_head_weight_correction = false // force setting to false in case it was enabled before
      }
    }

    // T-pose / A-pose tips only apply to the human skeleton
    if (this.ui.dom_model_pose_instructions != null) {
      this.ui.dom_model_pose_instructions.style.display = skeleton_type === SkeletonType.Human ? 'block' : 'none'
    }

    // only human skeletons have the arm plane correction option
    if (this.ui.dom_use_arm_plane_container != null) {
      if (skeleton_type === SkeletonType.Human) {
        this.ui.dom_use_arm_plane_container.style.display = 'block'
      } else {
        this.ui.dom_use_arm_plane_container.style.display = 'none'
        this.enable_arm_plane_correction = false // force setting to false in case it was enabled before
      }
    }

    this.update_skeleton_template_image(skeleton_type)

    // show/hide settings for the head correct depending on if it is checked
    this.show_preview_plane_options()
    this.show_arm_plane_options()
  }

  private update_skeleton_template_image(skeleton_type: SkeletonType): void {
    // figure out where the template image URL is at from the Rig Config
    const rig_config_entry = RigConfig.all.find(entry => entry.skeleton_type === skeleton_type)

    this.dom_template_image = document.getElementById('skeleton-template-image')
    if (this.dom_template_image !== null && rig_config_entry !== undefined) {
      // Remove existing click handler to avoid duplicates
      this.dom_template_image.onclick = null

      // Add click handler to open larger image in dialog
      this.dom_template_image.onclick = () => {
        const dialog = new ModalDialog(
          'Rig Template',
          `<img class="ignore-filters" src="${rig_config_entry.skeleton_template_image_url}" style="max-width: 100%; height: auto; border-radius: 8px;">`
        )
        dialog.show()
      }
    }
  }

  public begin (main_scene: Scene, skeleton_type: SkeletonType): void {
    this._current_skeleton_type = skeleton_type
    this.update_weight_paint_bone_options()
    this.update_weight_paint_ui()
    this.update_ui_options_on_begin(skeleton_type)

    // show UI elements for editing mesh

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

    // Initialize independent bone movement from Yes/No radio state
    // "Move Bone Children = No" means children should move independently.
    if (this.ui.dom_independent_bone_movement_checkbox !== null) {
      this.independent_bone_movement.set_enabled(!this.ui.dom_independent_bone_movement_checkbox.checked)
    }

    if (this.ui.dom_mesh_drag_placement_radio !== null) {
      this.set_mesh_drag_placement_enabled(this.ui.dom_mesh_drag_placement_radio.checked)
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
    this.initialize_arm_plane(main_scene)
  }

  private initialize_arm_plane (main_scene: Scene): void {
    this.arm_plane_manager.initialize(main_scene)

    // off by default, but can be enabled if we navigate back to the step
    this.arm_plane_manager.set_visibility(this.enable_arm_plane_correction)
    this.refresh_arm_plane_position()

    // set default value (and label) for arm plane offset on UI
    if (this.ui.dom_arm_plane_offset_input !== null && this.ui.dom_arm_plane_offset_label !== null) {
      this.ui.dom_arm_plane_offset_input.value = this.arm_plane_offset.toString()
      this.ui.dom_arm_plane_offset_label.textContent = this.format_arm_plane_offset_label()
    }

    // the checkbox is forced off for non-human rigs, so keep the DOM in sync
    // with our state instead of leaving a checked box next to a hidden slider
    if (this.ui.dom_arm_plane_checkbox !== null) {
      this.ui.dom_arm_plane_checkbox.checked = this.enable_arm_plane_correction
    }
  }

  /**
   * The offset is a decimal in scene units, but a percentage reads better on a
   * range this small (-0.10 to 0.10 shows as -10.0% to 10.0%). One decimal
   * place so the slider's 0.001 step is actually visible in the label.
   */
  private format_arm_plane_offset_label (): string {
    return `${(this.arm_plane_offset * 100).toFixed(1)}%`
  }

  /**
   * Move the arm planes to wherever the shoulder joint currently is, plus the
   * user's offset. The solver derives its plane the same way at skin time, so
   * what the user sees here is what actually gets applied.
   */
  private refresh_arm_plane_position (): void {
    const bones = this.threejs_skeleton.bones
    if (bones.length === 0) { return }

    const anchor_x = ArmWeightCorrector.shoulder_anchor_x(bones)
    if (anchor_x === null) { return } // no arm bones on this rig

    const shoulder_bone = ArmWeightCorrector.find_shoulder_bone(bones)
    const shoulder_position = shoulder_bone === undefined
      ? new Vector3()
      : Utility.world_position_from_object(shoulder_bone)

    this.arm_plane_manager.update_position(anchor_x + this.arm_plane_offset, shoulder_position.y, shoulder_position.z)
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
    if (this.ui.dom_bind_pose_button === null) { return }

    if (this.ui.dom_enable_weight_paint_step?.checked === true) {
      this.ui.dom_bind_pose_button.innerHTML = 'Weight painting &nbsp;&#x203a;'
      return
    }

    if (this.show_debug) {
      this.ui.dom_bind_pose_button.innerHTML = 'Test Skinning Algorithm &nbsp;&#x203a;'
      return
    }

    this.ui.dom_bind_pose_button.innerHTML = 'Finish &nbsp;&#x203a;'
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

  /**
   * Toggle the arm plane correction and the planes that visualize it
   */
  public set_use_arm_plane_correction (is_enabled: boolean): void {
    this.enable_arm_plane_correction = is_enabled
    this.arm_plane_manager.set_visibility(is_enabled)
    this.refresh_arm_plane_position()
  }

  public use_arm_plane_correction (): boolean {
    return this.enable_arm_plane_correction
  }

  /**
   * Set how far the arm plane sits from the shoulder joint
   * @param offset Distance along X to add to the shoulder joint position
   */
  public set_arm_plane_offset (offset: number): void {
    this.arm_plane_offset = offset
    this.refresh_arm_plane_position()
  }

  public get_arm_plane_offset (): number {
    return this.arm_plane_offset
  }

  public manual_weight_overrides (): ManualWeightOverrides {
    return this.weight_paint_manager.overrides_for_skin()
  }

  public set_weight_paint_available (available: boolean): void {
    this.weight_paint_available = available
    if (!available) {
      this.set_weight_painting_enabled(false)
    }
    this.update_weight_paint_ui()
  }

  public is_weight_painting_enabled (): boolean {
    return this.weight_painting_enabled
  }

  public set_weight_painting_enabled (enabled: boolean): void {
    if (enabled && (!this.weight_paint_available || this.weight_paint_bone_name === null)) {
      return
    }
    if (this.weight_painting_enabled === enabled) {
      this.update_weight_paint_ui()
      return
    }

    this.weight_painting_enabled = enabled
    if (enabled) {
      this.set_currently_selected_bone(null)
    }
    this.dispatchEvent(new CustomEvent('weightPaintModeChanged', { detail: { enabled } }))
    this.update_weight_paint_ui()
  }

  public begin_weight_paint_stroke (): void {
    this.weight_paint_stroke_vertices.clear()
    this.weight_paint_manager.begin_stroke()
    this.update_weight_paint_ui()
  }

  public end_weight_paint_stroke (): void {
    this.weight_paint_stroke_vertices.clear()
    this.update_weight_paint_ui()
  }

  /**
   * Paints the currently selected bone onto the vertices under the brush.
   * Whole strokes are sampled once per vertex so holding still does not keep
   * stacking weight onto the same spot.
   */
  public paint_weights (intersection: Intersection, camera: PerspectiveCamera): void {
    const object = intersection.object
    if (!(object instanceof Mesh)) { return }

    const geometry_index = object.userData.geometry_index
    if (typeof geometry_index !== 'number') { return }

    const bone_name = this.weight_paint_bone_name
    if (bone_name === null) { return }

    object.updateWorldMatrix(true, false)
    const geometry = object.geometry
    const positions = geometry.attributes.position
    const normals = geometry.attributes.normal
    const normal_matrix = new Matrix3().getNormalMatrix(object.matrixWorld)
    const center = intersection.point.clone()
    const ray_direction = center.clone().sub(camera.position).normalize()
    const point = new Vector3()
    const normal = new Vector3()
    const vertices: BrushVertex[] = []

    for (let i = 0; i < positions.count; i++) {
      const key = `${geometry_index}:${i}`
      if (this.weight_paint_stroke_vertices.has(key)) { continue }

      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
      const distance = point.distanceTo(center)
      if (distance > this.weight_paint_radius) { continue }

      // Skip the back side of the model so a brush cannot paint through the head.
      if (normals !== undefined) {
        normal.fromBufferAttribute(normals, i).applyMatrix3(normal_matrix).normalize()
        if (normal.dot(ray_direction) > -0.05) { continue }
      }

      const t = 1 - distance / this.weight_paint_radius
      vertices.push({ vertex_index: i, falloff: t * t * (3 - 2 * t) })
      this.weight_paint_stroke_vertices.add(key)
    }

    if (vertices.length === 0) { return }

    this.weight_paint_manager.paint_vertices(
      object,
      geometry_index,
      vertices,
      bone_name,
      this.threejs_skeleton.bones,
      this.weight_paint_strength,
      this.weight_paint_mode,
      this.weight_paint_mirror_enabled
    )
    this.update_weight_paint_ui()
  }

  public undo_weight_paint_stroke (): void {
    if (!this.weight_paint_manager.undo()) { return }
    this.dispatchEvent(new CustomEvent('weightPaintChanged'))
    this.update_weight_paint_ui()
  }

  public clear_weight_paint (): void {
    this.weight_paint_manager.clear()
    this.dispatchEvent(new CustomEvent('weightPaintChanged'))
    this.update_weight_paint_ui()
  }

  /** Used when a different model is loaded, since vertex indices no longer match. */
  public reset_weight_paint_overrides (): void {
    this.weight_paint_manager.clear()
    this.update_weight_paint_ui()
  }

  private update_weight_paint_bone_options (): void {
    const select = document.getElementById('weight-paint-bone') as HTMLSelectElement | null
    if (select === null) { return }

    const previous = this.weight_paint_bone_name ?? select.value
    select.innerHTML = ''
    for (const bone of this.threejs_skeleton.bones) {
      if (bone.name === 'root' || Utility.is_leaf_bone(bone)) { continue }
      const option = document.createElement('option')
      option.value = bone.name
      option.textContent = bone.name
      select.appendChild(option)
    }

    const previous_still_exists = Array.from(select.options).some(option => option.value === previous)
    select.selectedIndex = previous_still_exists
      ? Array.from(select.options).findIndex(option => option.value === previous)
      : (select.options.length > 0 ? 0 : -1)
    this.weight_paint_bone_name = select.value === '' ? null : select.value
  }

  private update_weight_paint_ui (): void {
    const container = document.getElementById('weight-painting-tools')
    if (container !== null) {
      container.hidden = !this.weight_paint_available
    }

    const toggle = document.getElementById('weight-paint-toggle') as HTMLButtonElement | null
    if (toggle !== null) {
      toggle.textContent = this.weight_painting_enabled ? 'Stop painting' : 'Start painting'
      toggle.setAttribute('aria-pressed', String(this.weight_painting_enabled))
      toggle.disabled = !this.weight_paint_available || this.weight_paint_bone_name === null
    }

    const undo = document.getElementById('weight-paint-undo') as HTMLButtonElement | null
    if (undo !== null) {
      undo.disabled = !this.weight_paint_manager.can_undo()
    }

    const mirror = document.getElementById('weight-paint-mirror') as HTMLInputElement | null
    if (mirror !== null) {
      mirror.checked = this.weight_paint_mirror_enabled
    }

    const clear = document.getElementById('weight-paint-clear') as HTMLButtonElement | null
    if (clear !== null) {
      clear.disabled = !this.weight_paint_manager.has_overrides()
    }
  }

  public add_event_listeners (): void {

    document.getElementById('weight-paint-toggle')?.addEventListener('click', () => {
      this.set_weight_painting_enabled(!this.weight_painting_enabled)
    })
    document.getElementById('weight-paint-bone')?.addEventListener('change', (event) => {
      const select = event.target as HTMLSelectElement
      this.weight_paint_bone_name = select.value === '' ? null : select.value
      this.update_weight_paint_ui()
    })
    document.getElementById('weight-paint-radius')?.addEventListener('input', (event) => {
      this.weight_paint_radius = Number((event.target as HTMLInputElement).value)
    })
    document.getElementById('weight-paint-strength')?.addEventListener('input', (event) => {
      this.weight_paint_strength = Number((event.target as HTMLInputElement).value)
    })
    document.getElementById('weight-paint-mirror')?.addEventListener('change', (event) => {
      this.weight_paint_mirror_enabled = (event.target as HTMLInputElement).checked
      this.update_weight_paint_ui()
    })
    document.querySelectorAll<HTMLInputElement>('input[name="weight-paint-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) {
          this.weight_paint_mode = input.value === 'subtract' ? 'subtract' : 'add'
        }
      })
    })
    document.getElementById('weight-paint-undo')?.addEventListener('click', () => this.undo_weight_paint_stroke())
    document.getElementById('weight-paint-clear')?.addEventListener('click', () => this.clear_weight_paint())

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

    this.ui.dom_independent_bone_movement_group?.addEventListener('change', () => {
      const independent_movement_enabled = this.ui.dom_independent_bone_movement_checkbox?.checked ? false : true
      this.independent_bone_movement.set_enabled(independent_movement_enabled)
    })

    this.ui.dom_mesh_drag_placement_radio?.addEventListener('change', () => {
      const mesh_volume_selected = this.ui.dom_mesh_drag_placement_radio?.checked ?? true
      this.set_mesh_drag_placement_enabled(mesh_volume_selected)
    })

    this.ui.dom_mesh_manual_placement_radio?.addEventListener('change', () => {
      const mesh_volume_selected = this.ui.dom_mesh_drag_placement_radio?.checked ?? true
      this.set_mesh_drag_placement_enabled(mesh_volume_selected)
    })

    this.ui.dom_enable_skin_debugging?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | null

      if (target === null) {
        return
      }

      this.show_debug = target.checked
      this.update_bind_button_text()
    })

    this.ui.dom_enable_weight_paint_step?.addEventListener('change', () => {
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

    // Add arm plane event listeners
    this.ui.dom_arm_plane_checkbox?.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement
      this.set_use_arm_plane_correction(target.checked)

      this.show_arm_plane_options()
    })

    this.ui.dom_arm_plane_offset_input?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement
      const offset = parseFloat(target.value)
      this.set_arm_plane_offset(isNaN(offset) ? 0.00 : offset)

      // Update the label to show current value
      if (this.ui.dom_arm_plane_offset_label !== null) {
        this.ui.dom_arm_plane_offset_label.textContent = this.format_arm_plane_offset_label()
      }
    })

    // keep the arm planes anchored to the shoulder joint when bones get moved
    this.addEventListener('skeletonTransformed', () => {
      this.refresh_arm_plane_position()
    })
  }

  private show_preview_plane_options (): void {
    if (this.ui.dom_preview_plane_setting_container !== null) {
      this.ui.dom_preview_plane_setting_container.style.display = this.use_head_weight_correction() ? 'flex' : 'none'
    }
  }

  private show_arm_plane_options (): void {
    if (this.ui.dom_arm_plane_setting_container !== null) {
      this.ui.dom_arm_plane_setting_container.style.display = this.use_arm_plane_correction() ? 'flex' : 'none'
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

    // Remove arm plane event listeners
    if (this.ui.dom_arm_plane_checkbox !== null) {
      this.ui.dom_arm_plane_checkbox.removeEventListener('change', () => {})
    }

    if (this.ui.dom_arm_plane_offset_input !== null) {
      this.ui.dom_arm_plane_offset_input.removeEventListener('input', () => {})
    }
  }

  public cleanup_on_exit_step (): void {
    this.set_weight_painting_enabled(false)
    this.remove_event_listeners()
    this.clear_hover_point_if_exists()
    this.remove_preview_plane()
    this.arm_plane_manager.cleanup()
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
    this.independent_bone_movement.set_rest_pose(this.threejs_skeleton)

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
   * @returns the bone that is currently hovered over, or null if none
   */
  public calculate_bone_hover_effect (event: MouseEvent | PointerEvent, camera: PerspectiveCamera, hover_distance: number): Bone | null {
    // create a raycaster to detect the bone that is being hovered over
    // we will only have a hover effect if the mouse is close enough to the bone
    const [closest_bone, closest_bone_index, closest_distance] =
      Utility.raycast_closest_bone_test(camera, event, this.threejs_skeleton)

    // only do selection if we are close
    // the orbit controls also have panning with alt-click, so we don't want to interfere with that
    if (closest_distance === null || closest_distance > hover_distance) {
      this.update_bone_hover_point_position(null)
      return null
    }

    if (!this.is_bone_selectable(closest_bone)) {
      this.update_bone_hover_point_position(null)
      return null
    }

    this.update_bone_hover_point_position(closest_bone)
    return closest_bone
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
