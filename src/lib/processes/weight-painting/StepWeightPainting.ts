import { UI } from '../../UI.ts'
import { AnimationLoader } from '../animations-listing/AnimationLoader.ts'
import { type AnimationPlayer } from '../animations-listing/AnimationPlayer.ts'
import { WeightPaintManager, type WeightPaintMode } from './WeightPaintManager.ts'
import { WeightPaintBrush } from './WeightPaintBrush.ts'
import { RigConfig, type RigAnimation } from '../../RigConfig.ts'
import { Utility } from '../../Utilities.ts'
import {
  AnimationMixer, BufferGeometry, Float32BufferAttribute, LoopRepeat, MeshBasicMaterial,
  Object3D, SkinnedMesh, Vector3,
  type AnimationAction, type AnimationClip, type Bone, type Intersection, type PerspectiveCamera,
  type Quaternion
} from 'three'
import { SkeletonType } from '../../enums/SkeletonType.ts'
import { type Mesh2MotionEngine } from '../../../Mesh2MotionEngine.ts'

type WeightPaintStepMode = 'paint' | 'test'

/**
 * Optional step shown between posing the skeleton and the animation listing.
 *
 * It brings the user straight to the part of skinning that benefits from a
 * posed mesh: a couple of simple animations for testing deformation, plus the
 * weight painting brush and a live heatmap.
 */
export class StepWeightPainting extends EventTarget {
  private static readonly max_animations: number = 4
  private static readonly preferred_animation_names: Partial<Record<SkeletonType, string[]>> = {
    // names match the manifest, falling back to the first animations of the rig
    // when one of these is missing
    human: ['Idle_A', 'Walk', 'Run_Female', 'Crouch_Walk'],
    fox: ['Idle', 'Walk', 'Run', 'Trot'],
    bird: ['Flap', 'Walk', 'Glide', 'Hop'],
    dragon: ['Fly Flap', 'Walk', 'Fly Glide', 'Take_Off'],
    kaiju: ['Idle', 'Walk', 'Roar', 'Attack'],
    spider: ['Idle', 'Walk', 'Jump', 'Attack'],
    snake: ['Idle', 'Coiled', 'Dance', 'Side winding'],
    fish: ['Idle', 'Swim Horizontal', 'Swim Vertical', 'Bite'],
    horse: ['Idle', 'Walk', 'Trot', 'Run']
  }

  private readonly ui: UI = UI.getInstance()
  private readonly animation_loader: AnimationLoader = new AnimationLoader()
  private animation_mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private animations: RigAnimation[] = []
  private selected_animation_index = 0
  private animation_speed = 1.0
  private animation_player: AnimationPlayer | null = null
  private readonly loaded_clips = new Map<string, AnimationClip>()

  private skinned_meshes: SkinnedMesh[] = []
  private skeleton_type: SkeletonType = SkeletonType.None
  private skeleton_scale = 1.0
  private weight_paint_manager: WeightPaintManager | null = null

  private active_mode: WeightPaintStepMode = 'paint'
  private is_active = false
  private alt_rotate_active = false
  private weight_paint_brush: WeightPaintBrush | null = null
  private brush_cursor: HTMLElement | null = null
  private weight_paint_bone_name: string | null = null
  private bone_names: string[] = []
  private bone_picking_enabled = false
  private weight_paint_clear_marker = 0
  private readonly weight_paint_overlays = new Map<SkinnedMesh, SkinnedMesh>()
  private readonly geometry_center_cache = new WeakMap<BufferGeometry, number>()
  private readonly original_materials = new Map<SkinnedMesh, SkinnedMesh['material']>()
  private readonly black_material = new MeshBasicMaterial({ color: 0x000000 })
  private rest_bone_transforms: Array<{
    bone: Bone
    position: Vector3
    quaternion: Quaternion
    scale: Vector3
  }> = []
  private bone_overlay_timeout: number | null = null

  private _added_event_listeners = false

  constructor (private readonly engine: Mesh2MotionEngine) {
    super()
  }

  public begin (
    skinned_meshes: SkinnedMesh[],
    skeleton_type: SkeletonType,
    skeleton_scale: number,
    weight_paint_manager: WeightPaintManager,
    animation_player: AnimationPlayer
  ): void {
    this.skinned_meshes = skinned_meshes
    this.skeleton_type = skeleton_type
    this.skeleton_scale = skeleton_scale
    this.weight_paint_manager = weight_paint_manager
    this.animation_player = animation_player
    this.weight_paint_clear_marker = weight_paint_manager.undo_stack_marker()
    this.animation_player.clear_animation()

    this.is_active = true
    this.alt_rotate_active = false
    if (this.weight_paint_brush === null) {
      this.weight_paint_brush = new WeightPaintBrush(weight_paint_manager)
    }
    this.weight_paint_brush.mode = 'add'
    this.weight_paint_brush.mirror_enabled = true

    this.animation_loader.set_skeleton_type(skeleton_type)
    // the create page serves animation assets from the site root
    this.animation_loader.set_static_root_path('')
    // scale or rig changes make previously loaded clips stale
    this.loaded_clips.clear()

    if (this.ui.dom_current_step_element !== null) {
      this.ui.dom_current_step_element.innerHTML = 'Weight painting'
    }
    if (this.ui.dom_weight_paint_step_tools !== null) {
      this.ui.dom_weight_paint_step_tools.style.display = 'flex'
    }
    if (this.ui.dom_show_skeleton_container !== null) {
      this.ui.dom_show_skeleton_container.style.display = 'inline-flex'
    }

    this.set_bone_picking_enabled(false)
    this.animations = this.skinning_animations(skeleton_type)
    this.capture_rest_pose()
    this.update_weight_paint_bone_options()
    this.populate_animation_options()

    // every vertex starts normalized, and every stroke keeps it that way
    this.weight_paint_manager?.normalize_all_weights(this.skinned_meshes)
    this.set_active_mode('paint', true)

    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }
  }

  public active_skinned_meshes (): SkinnedMesh[] {
    return this.skinned_meshes
  }

  public frame_change (delta_time: number): void {
    this.animation_mixer.update(delta_time)
    this.animation_player?.update(delta_time)
  }

  /** Called when the app leaves the weight painting step. */
  public cleanup_on_exit_step (): void {
    this.is_active = false
    this.alt_rotate_active = false
    this.set_bone_picking_enabled(false)
    this.clear_bone_overlay()
    this.hide_brush_cursor()
    this.weight_paint_manager?.finish_stroke()
    this.restore_skinned_mesh_materials()
    this.dispose_weight_paint_overlays()
    this.animation_mixer.stopAllAction()
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.animation_player?.clear_animation()
    this.set_animation_player_visible(false)
    this.skinned_meshes = []
    this.rest_bone_transforms = []
    this.set_animation_status('')
  }

  public current_mode (): WeightPaintStepMode {
    return this.active_mode
  }

  public is_paint_mode_active (): boolean {
    return this.is_active && this.active_mode === 'paint'
  }

  public is_view_rotation_active (): boolean {
    return this.alt_rotate_active
  }

  /**
   * Paint mode paints with the left mouse button. Starting the drag on empty
   * space or holding Alt returns the camera to the user.
   */
  public is_draw_mode_active (): boolean {
    return this.is_active && this.active_mode === 'paint' && !this.alt_rotate_active
  }

  public set_active_mode (mode: WeightPaintStepMode, force: boolean = false): void {
    if (!this.is_active) { return }
    if (!force && this.active_mode === mode) { return }

    this.active_mode = mode
    if (mode === 'paint') {
      this.enter_paint_mode()
    } else {
      this.enter_test_mode()
    }

    this.update_mode_radios()
    this.dispatchEvent(new CustomEvent('weightPaintModeChanged', {
      detail: { enabled: this.is_draw_mode_active() }
    }))
  }

  private enter_paint_mode (): void {
    this.set_bone_picking_enabled(false)
    this.set_alt_rotate_active(false)
    this.clear_bone_overlay()
    this.hide_brush_cursor()
    this.restore_rest_pose()
    this.animation_player?.clear_animation()
    this.darken_skinned_meshes()
    this.create_weight_paint_overlays()
    this.show_paint_ui(true)
    this.show_test_ui(false)
    this.set_animation_player_visible(false)
    this.update_weight_paint_ui()
  }

  private enter_test_mode (): void {
    this.set_bone_picking_enabled(false)
    this.set_alt_rotate_active(false)
    this.clear_bone_overlay()
    this.hide_brush_cursor()
    this.restore_rest_pose()
    this.dispose_weight_paint_overlays()
    this.restore_skinned_mesh_materials()
    this.show_paint_ui(false)
    this.show_test_ui(true)
    this.set_animation_player_visible(true)
    this.play_animation_at(this.selected_animation_index)

    if (this.animations.length === 0) {
      this.set_animation_status('No test animations available for this rig')
    }
  }

  private set_alt_rotate_active (enabled: boolean): void {
    if (this.alt_rotate_active === enabled) { return }
    if (enabled && (!this.is_active || this.active_mode !== 'paint')) { return }

    this.alt_rotate_active = enabled
    if (enabled) {
      this.set_bone_picking_enabled(false)
      this.hide_brush_cursor()
    }

    this.dispatchEvent(new CustomEvent('weightPaintModeChanged', {
      detail: { enabled: this.is_draw_mode_active() }
    }))
  }

  public begin_weight_paint_stroke (): void {
    this.weight_paint_brush?.begin_stroke()
    this.update_weight_paint_ui()
  }

  public end_weight_paint_stroke (): void {
    // normalize first so the redo snapshot captures the final weights
    this.weight_paint_brush?.finish_stroke(this.skinned_meshes)
    this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    this.update_weight_paint_ui()
  }

  /** Paints (or smooths) the selected bone on the posed skinned mesh under the brush. */
  public paint_weights (intersection: Intersection, camera: PerspectiveCamera): void {
    const bone_name = this.weight_paint_bone_name
    if (this.weight_paint_brush === null || bone_name === null) { return }

    this.weight_paint_brush.paint(intersection, camera, bone_name)
    // Mirroring and smoothing can change any vertex, so refresh the whole heatmap.
    this.update_weight_paint_overlay_colors(bone_name)
    this.update_weight_paint_ui()
  }

  /** Re-runs skinning without the manual overrides and re-enters this step. */
  public reset_weights_to_auto (): void {
    if (!this.is_active) { return }
    this.engine.reset_weights_to_auto()
  }

  public undo_weight_paint_stroke (): void {
    if (this.weight_paint_manager === null) { return }
    if (!this.weight_paint_manager.can_undo_since(this.weight_paint_clear_marker)) { return }
    this.weight_paint_manager.undo()
    this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    this.update_weight_paint_ui()
  }

  public redo_weight_paint_stroke (): void {
    if (this.weight_paint_manager === null) { return }
    if (!this.weight_paint_manager.can_redo_since(this.weight_paint_clear_marker)) { return }
    this.weight_paint_manager.redo()
    this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    this.update_weight_paint_ui()
  }

  public is_bone_picking_enabled (): boolean {
    return this.bone_picking_enabled
  }

  public set_bone_picking_enabled (enabled: boolean): void {
    if (this.bone_picking_enabled === enabled) {
      this.update_weight_paint_ui()
      return
    }

    this.bone_picking_enabled = enabled
    if (!enabled) {
      this.hide_picker_hover()
    }
    this.dispatchEvent(new CustomEvent('bonePickModeChanged', { detail: { enabled } }))
    this.update_weight_paint_ui()
  }

  /**
   * While the picker is armed, show which bone is under the pointer before the
   * user clicks. The engine feeds this with the current ray intersection.
   */
  public update_picker_hover (intersection: Intersection | null): void {
    if (!this.is_active || this.active_mode !== 'paint' || !this.bone_picking_enabled) { return }
    if (intersection === null) {
      this.hide_picker_hover()
      return
    }

    const bone_name = this.bone_name_at_intersection(intersection)
    if (bone_name === null) {
      this.hide_picker_hover()
      return
    }

    this.clear_bone_overlay_timeout()
    this.ui.show_selected_bone_overlay(bone_name)
  }

  public hide_picker_hover (): void {
    this.clear_bone_overlay_timeout()
    this.ui.hide_selected_bone_overlay()
  }

  /** Select the bone with the strongest influence at the clicked surface point. */
  public pick_bone (intersection: Intersection): void {
    const best_bone_name = this.bone_name_at_intersection(intersection)
    if (best_bone_name === null) { return }

    this.weight_paint_bone_name = best_bone_name
    this.update_bone_name_display()
    this.update_weight_paint_overlay_colors(best_bone_name)
    this.set_bone_picking_enabled(false)
    this.show_picked_bone_overlay(best_bone_name)
    this.update_weight_paint_ui()
  }

  /** Strongest selectable bone influence at the surface point under the pointer. */
  private bone_name_at_intersection (intersection: Intersection): string | null {
    const object = intersection.object
    const face = intersection.face
    if (!(object instanceof SkinnedMesh) || face === null || face === undefined) { return null }

    const positions = object.geometry.attributes.position
    const skin_indices = object.geometry.attributes.skinIndex
    const skin_weights = object.geometry.attributes.skinWeight
    if (positions === undefined || skin_indices === undefined || skin_weights === undefined) { return null }

    object.updateWorldMatrix(true, false)
    const local_point = object.worldToLocal(intersection.point.clone())

    // use the nearest corner of the hit triangle so small features like
    // fingers can still be picked
    let closest_vertex = face.a
    let closest_distance = Infinity
    for (const vertex_index of [face.a, face.b, face.c]) {
      const dx = positions.getX(vertex_index) - local_point.x
      const dy = positions.getY(vertex_index) - local_point.y
      const dz = positions.getZ(vertex_index) - local_point.z
      const distance = dx * dx + dy * dy + dz * dz
      if (distance < closest_distance) {
        closest_distance = distance
        closest_vertex = vertex_index
      }
    }

    const selectable = new Set(this.bone_names)
    let best_bone_name: string | null = null
    let best_weight = 0
    for (let slot = 0; slot < 4; slot++) {
      const weight = skin_weights.array[closest_vertex * 4 + slot] as number
      if (weight <= best_weight) { continue }

      const bone = object.skeleton.bones[skin_indices.array[closest_vertex * 4 + slot] as number]
      if (bone === undefined || !selectable.has(bone.name)) { continue }

      best_bone_name = bone.name
      best_weight = weight
    }

    return best_bone_name
  }

  /** Replaces the textures with a black material so only weight colors show. */
  private darken_skinned_meshes (): void {
    for (const skinned_mesh of this.skinned_meshes) {
      if (!this.original_materials.has(skinned_mesh)) {
        this.original_materials.set(skinned_mesh, skinned_mesh.material)
      }
      skinned_mesh.material = this.black_material
    }
  }

  private restore_skinned_mesh_materials (): void {
    for (const [skinned_mesh, material] of this.original_materials) {
      skinned_mesh.material = material
    }
    this.original_materials.clear()
  }

  private capture_rest_pose (): void {
    const skeleton = this.skinned_meshes[0]?.skeleton
    this.rest_bone_transforms = skeleton === undefined
      ? []
      : skeleton.bones.map((bone) => ({
        bone,
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone()
      }))
  }

  private restore_rest_pose (): void {
    this.animation_mixer.stopAllAction()
    this.animation_mixer = new AnimationMixer(new Object3D())

    for (const transform of this.rest_bone_transforms) {
      transform.bone.position.copy(transform.position)
      transform.bone.quaternion.copy(transform.quaternion)
      transform.bone.scale.copy(transform.scale)
      transform.bone.updateWorldMatrix(true, true)
    }
  }

  /**
   * Shows the brush outline at the pointer. It is a fixed-size HTML circle
   * rather than a world-space ring, so it stays thin and keeps the same screen
   * size at every zoom level.
   */
  public update_brush_cursor (event: PointerEvent, intersection: Intersection | null): void {
    if (!this.is_draw_mode_active() || intersection === null ||
      !(intersection.object instanceof SkinnedMesh) || this.weight_paint_brush === null) {
      this.hide_brush_cursor()
      return
    }

    const cursor = this.brush_cursor_element()
    if (cursor === null) { return }

    const width = this.weight_paint_brush.width_px()
    cursor.style.width = `${width}px`
    cursor.style.height = `${width}px`
    cursor.style.left = `${event.clientX}px`
    cursor.style.top = `${event.clientY}px`
    cursor.style.display = 'block'
  }

  public hide_brush_cursor (): void {
    const cursor = this.brush_cursor_element()
    if (cursor !== null) {
      cursor.style.display = 'none'
    }
  }

  private brush_cursor_element (): HTMLElement | null {
    if (this.brush_cursor === null) {
      this.brush_cursor = document.getElementById('weight-paint-brush-cursor')
    }
    return this.brush_cursor
  }

  private skinning_animations (skeleton_type: SkeletonType): RigAnimation[] {
    const available = RigConfig.animations_for(skeleton_type)
      .filter(animation => animation.name !== 'Rest Pose')
    const preferred_names = StepWeightPainting.preferred_animation_names[skeleton_type] ?? []
    const selected: RigAnimation[] = []

    for (const name of preferred_names) {
      const animation = available.find(candidate => candidate.name === name)
      if (animation !== undefined && !selected.includes(animation)) {
        selected.push(animation)
      }
      if (selected.length === StepWeightPainting.max_animations) { return selected }
    }

    for (const animation of available) {
      if (selected.length === StepWeightPainting.max_animations) { break }
      if (!selected.includes(animation)) {
        selected.push(animation)
      }
    }
    return selected
  }

  private populate_animation_options (): void {
    const list = document.getElementById('weight-paint-step-animation-list')
    if (list === null) { return }

    list.innerHTML = ''
    this.animations.forEach((animation, index) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'weight-paint-animation-button'
      button.dataset.animationIndex = String(index)
      button.textContent = animation.name.replace(/_/g, ' ')
      button.addEventListener('click', () => {
        this.play_animation_at(index)
      })
      list.appendChild(button)
    })

    if (this.selected_animation_index >= this.animations.length) {
      this.selected_animation_index = 0
    }
    this.update_animation_buttons()

    if (this.animations.length === 0) {
      this.set_animation_status('No test animations available for this rig')
    }
  }

  private update_animation_buttons (): void {
    document.querySelectorAll<HTMLButtonElement>('.weight-paint-animation-button').forEach((button) => {
      const index = Number(button.dataset.animationIndex)
      button.classList.toggle('active', index === this.selected_animation_index)
    })
  }

  private play_animation_at (index: number): void {
    const animation = this.animations[index]
    if (animation === undefined) { return }

    this.selected_animation_index = index
    this.update_animation_buttons()

    const cached_clip = this.loaded_clips.get(animation.file)
    if (cached_clip !== undefined) {
      this.apply_animation(cached_clip)
      return
    }

    this.set_animation_status(`Loading ${animation.name}...`)
    this.animation_loader.load_animation_file(animation.file, this.skeleton_scale)
      .then((clip_pairs) => {
        const clip = clip_pairs[0]?.display_animation_clip
        if (clip === undefined) { return }
        this.loaded_clips.set(animation.file, clip)
        if (this.animations[this.selected_animation_index]?.file === animation.file) {
          this.apply_animation(clip)
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load weight painting test animation:', animation.file, error)
        this.set_animation_status(`Could not load ${animation.name}`)
      })
  }

  private apply_animation (clip: AnimationClip): void {
    this.animation_mixer.stopAllAction()
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.animation_mixer.timeScale = this.animation_speed

    const actions: AnimationAction[] = []
    this.skinned_meshes.forEach((skinned_mesh) => {
      const action = this.animation_mixer.clipAction(clip, skinned_mesh)
      action.setLoop(LoopRepeat, Infinity)
      action.reset()
      action.play()
      actions.push(action)
    })

    this.animation_mixer.update(0)
    this.animation_player?.set_animation(clip, actions)
    this.set_animation_status('')
  }

  private set_animation_status (text: string): void {
    const status = document.getElementById('weight-paint-step-animation-status')
    if (status !== null) { status.textContent = text }
  }

  private update_weight_paint_bone_options (): void {
    const skeleton = this.skinned_meshes[0]?.skeleton
    const position_bone_name = RigConfig.by_skeleton_type(this.skeleton_type)?.position_tracking_bone_name

    this.bone_names = skeleton === undefined
      ? []
      : skeleton.bones
        .filter(bone => {
          if (bone.name.toLowerCase() === 'root') { return false }
          if (bone.name === position_bone_name) { return true }
          return !Utility.is_leaf_bone(bone)
        })
        .map(bone => bone.name)

    if (skeleton !== undefined && position_bone_name !== undefined &&
      skeleton.bones.some(bone => bone.name === position_bone_name) &&
      !this.bone_names.includes(position_bone_name)) {
      this.bone_names.unshift(position_bone_name)
    }

    if (this.weight_paint_bone_name === null || !this.bone_names.includes(this.weight_paint_bone_name)) {
      this.weight_paint_bone_name = position_bone_name !== undefined && this.bone_names.includes(position_bone_name)
        ? position_bone_name
        : (this.bone_names[0] ?? null)
    }

    this.update_bone_name_display()
  }

  private update_bone_name_display (): void {
    const element = document.getElementById('weight-paint-step-bone-name')
    if (element !== null) {
      element.textContent = this.weight_paint_bone_name ?? '—'
    }
  }

  private show_picked_bone_overlay (bone_name: string): void {
    this.clear_bone_overlay_timeout()

    // the pick happens on pointerdown and the shared pointerup handler hides the
    // overlay, so show it just after the click completes
    this.bone_overlay_timeout = window.setTimeout(() => {
      if (!this.is_active) {
        this.bone_overlay_timeout = null
        return
      }

      this.ui.show_selected_bone_overlay(bone_name)
      this.bone_overlay_timeout = window.setTimeout(() => {
        this.ui.hide_selected_bone_overlay()
        this.bone_overlay_timeout = null
      }, 2500)
    }, 120)
  }

  private clear_bone_overlay_timeout (): void {
    if (this.bone_overlay_timeout !== null) {
      window.clearTimeout(this.bone_overlay_timeout)
      this.bone_overlay_timeout = null
    }
  }

  private clear_bone_overlay (): void {
    this.clear_bone_overlay_timeout()
    this.ui.hide_selected_bone_overlay()
  }

  private update_weight_paint_ui (): void {
    const pick_button = document.getElementById('weight-paint-step-pick-bone') as HTMLButtonElement | null
    if (pick_button !== null) {
      const pick_label = this.bone_picking_enabled
        ? 'Click a bone on the model'
        : 'Pick a bone by clicking the model (Shift + click for a quick switch)'
      pick_button.setAttribute('aria-pressed', String(this.bone_picking_enabled))
      pick_button.setAttribute('aria-label', pick_label)
      pick_button.title = pick_label
      pick_button.disabled = this.skinned_meshes.length === 0 || this.bone_names.length === 0
    }

    this.update_bone_name_display()

    const brush = this.weight_paint_brush
    const mirror = document.getElementById('weight-paint-step-mirror') as HTMLInputElement | null
    if (mirror !== null) {
      mirror.checked = brush?.mirror_enabled ?? true
    }

    const add = document.getElementById('weight-paint-step-add') as HTMLInputElement | null
    const subtract = document.getElementById('weight-paint-step-subtract') as HTMLInputElement | null
    const smooth = document.getElementById('weight-paint-step-smooth') as HTMLInputElement | null
    if (add !== null) { add.checked = brush?.mode === 'add' }
    if (subtract !== null) { subtract.checked = brush?.mode === 'subtract' }
    if (smooth !== null) { smooth.checked = brush?.mode === 'smooth' }

    const radius_input = document.getElementById('weight-paint-step-radius') as HTMLInputElement | null
    if (radius_input !== null && brush !== null) {
      radius_input.value = String(brush.radius_px)
    }
    const radius_value = document.getElementById('weight-paint-step-radius-value')
    if (radius_value !== null && brush !== null) {
      radius_value.textContent = `${Math.round(brush.radius_px)} px`
    }

    const strength_input = document.getElementById('weight-paint-step-strength') as HTMLInputElement | null
    if (strength_input !== null && brush !== null) {
      strength_input.value = String(brush.strength)
    }
    const strength_value = document.getElementById('weight-paint-step-strength-value')
    if (strength_value !== null && brush !== null) {
      strength_value.textContent = `${Math.round(brush.strength * 100)}%`
    }

    const can_undo = this.weight_paint_manager !== null &&
      this.weight_paint_manager.can_undo_since(this.weight_paint_clear_marker)
    const can_redo = this.weight_paint_manager !== null &&
      this.weight_paint_manager.can_redo_since(this.weight_paint_clear_marker)
    const undo = document.getElementById('weight-paint-step-undo') as HTMLButtonElement | null
    if (undo !== null) { undo.disabled = !can_undo }
    const redo = document.getElementById('weight-paint-step-redo') as HTMLButtonElement | null
    if (redo !== null) { redo.disabled = !can_redo }
    const reset = document.getElementById('weight-paint-step-reset') as HTMLButtonElement | null
    if (reset !== null) {
      reset.disabled = this.weight_paint_manager === null || !this.weight_paint_manager.has_overrides()
    }

    this.update_mode_radios()
    this.update_animation_buttons()
  }

  private update_mode_radios (): void {
    const paint_radio = document.getElementById('weight-paint-mode-paint') as HTMLInputElement | null
    const test_radio = document.getElementById('weight-paint-mode-test') as HTMLInputElement | null
    if (paint_radio !== null) { paint_radio.checked = this.active_mode === 'paint' }
    if (test_radio !== null) { test_radio.checked = this.active_mode === 'test' }
  }

  private show_paint_ui (visible: boolean): void {
    const element = document.getElementById('weight-paint-paint-tools')
    if (element !== null) { element.style.display = visible ? 'flex' : 'none' }
  }

  private show_test_ui (visible: boolean): void {
    const element = document.getElementById('weight-paint-test-tools')
    if (element !== null) { element.style.display = visible ? 'flex' : 'none' }
  }

  private set_animation_player_visible (visible: boolean): void {
    if (this.ui.dom_animation_player !== null) {
      this.ui.dom_animation_player.style.display = visible ? 'flex' : 'none'
    }
  }

  /**
   * Overlay a heatmap of the selected bone's weight on the posed meshes.
   * The overlay shares the source geometry's position/skin attributes, so live
   * weight edits show up without rebuilding any geometry.
   */
  private create_weight_paint_overlays (): void {
    this.dispose_weight_paint_overlays()

    for (const source of this.skinned_meshes) {
      const positions = source.geometry.attributes.position
      const skin_indices = source.geometry.attributes.skinIndex
      const skin_weights = source.geometry.attributes.skinWeight
      if (positions === undefined || skin_indices === undefined || skin_weights === undefined) { continue }

      const geometry = new BufferGeometry()
      geometry.setAttribute('position', positions)
      geometry.setAttribute('skinIndex', skin_indices)
      geometry.setAttribute('skinWeight', skin_weights)
      if (source.geometry.index !== null) {
        geometry.setIndex(source.geometry.index)
      }
      geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(positions.count * 4), 4))

      const material = new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false
      })
      material.toneMapped = false
      material.polygonOffset = true
      material.polygonOffsetFactor = -1
      material.polygonOffsetUnits = -1

      const overlay = new SkinnedMesh(geometry, material)
      overlay.name = 'Weight Paint Overlay'
      overlay.frustumCulled = false
      overlay.renderOrder = 10
      overlay.position.copy(source.position)
      overlay.quaternion.copy(source.quaternion)
      overlay.scale.copy(source.scale)
      overlay.bindMode = source.bindMode
      overlay.bind(source.skeleton, source.bindMatrix)
      ;(source.parent ?? source).add(overlay)

      this.weight_paint_overlays.set(source, overlay)
    }

    this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    this.sync_weight_paint_overlay_visibility()
  }

  private dispose_weight_paint_overlays (): void {
    for (const overlay of this.weight_paint_overlays.values()) {
      overlay.removeFromParent()
      const geometry = overlay.geometry
      // These attributes are shared with the real skinned mesh, so detach them
      // before disposing the overlay's geometry.
      geometry.deleteAttribute('position')
      geometry.deleteAttribute('skinIndex')
      geometry.deleteAttribute('skinWeight')
      geometry.setIndex(null)
      geometry.dispose()
      const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material]
      for (const material of materials) { material.dispose() }
    }
    this.weight_paint_overlays.clear()
  }

  private sync_weight_paint_overlay_visibility (): void {
    // paint mode always shows the weights; test mode has no overlays at all
    for (const overlay of this.weight_paint_overlays.values()) {
      overlay.visible = true
    }
  }

  private update_weight_paint_overlay_colors (bone_name: string | null): void {
    for (const [source, overlay] of this.weight_paint_overlays) {
      const color = overlay.geometry.attributes.color
      const skin_indices = source.geometry.attributes.skinIndex
      const skin_weights = source.geometry.attributes.skinWeight
      const positions = source.geometry.attributes.position
      if (color === undefined || skin_indices === undefined || skin_weights === undefined || positions === undefined) {
        continue
      }

      const side = bone_name === null ? null : WeightPaintManager.bone_side(bone_name)
      const mirror_bone_name = bone_name === null
        ? null
        : WeightPaintManager.find_mirror_bone_name(bone_name, source.skeleton.bones)
      const selected_index = bone_name === null
        ? -1
        : source.skeleton.bones.findIndex(bone => bone.name === bone_name)
      const mirrored_index = mirror_bone_name === null
        ? selected_index
        : source.skeleton.bones.findIndex(bone => bone.name === mirror_bone_name)
      const center_x = this.geometry_center_x(source.geometry)
      const mirror_enabled = this.weight_paint_brush?.mirror_enabled ?? true

      const vertex_count = positions.count
      for (let i = 0; i < vertex_count; i++) {
        let bone_index = selected_index
        if (mirror_enabled && side !== null) {
          const x = positions.getX(i) - center_x
          if ((side === 'left' && x < 0) || (side === 'right' && x > 0)) {
            bone_index = mirrored_index
          }
        }
        write_weight_color(color, i, this.vertex_weight(skin_indices, skin_weights, i, bone_index))
      }
      color.needsUpdate = true
    }
  }

  private geometry_center_x (geometry: BufferGeometry): number {
    const cached = this.geometry_center_cache.get(geometry)
    if (cached !== undefined) { return cached }

    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    const center_x = box === null ? 0 : (box.min.x + box.max.x) / 2
    this.geometry_center_cache.set(geometry, center_x)
    return center_x
  }

  private vertex_weight (skin_indices: { array: ArrayLike<number> },
    skin_weights: { array: ArrayLike<number> }, vertex_index: number, bone_index: number): number {
    if (bone_index < 0) { return 0 }
    let weight = 0
    for (let slot = 0; slot < 4; slot++) {
      if (skin_indices.array[vertex_index * 4 + slot] === bone_index) {
        weight += skin_weights.array[vertex_index * 4 + slot] as number
      }
    }
    return weight
  }

  private add_event_listeners (): void {
    document.getElementById('weight-paint-mode-paint')?.addEventListener('change', () => {
      this.set_active_mode('paint')
    })
    document.getElementById('weight-paint-mode-test')?.addEventListener('change', () => {
      this.set_active_mode('test')
    })
    document.getElementById('weight-paint-step-pick-bone')?.addEventListener('click', () => {
      this.set_bone_picking_enabled(!this.bone_picking_enabled)
    })
    document.getElementById('weight-paint-step-mirror')?.addEventListener('change', (event) => {
      if (this.weight_paint_brush === null) { return }
      this.weight_paint_brush.mirror_enabled = (event.target as HTMLInputElement).checked
      this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    })
    document.getElementById('weight-paint-step-radius')?.addEventListener('input', (event) => {
      if (this.weight_paint_brush === null) { return }
      this.weight_paint_brush.radius_px = Number((event.target as HTMLInputElement).value)
      this.update_weight_paint_ui()
    })
    document.getElementById('weight-paint-step-strength')?.addEventListener('input', (event) => {
      if (this.weight_paint_brush === null) { return }
      this.weight_paint_brush.strength = Number((event.target as HTMLInputElement).value)
      this.update_weight_paint_ui()
    })
    document.querySelectorAll<HTMLInputElement>('input[name="weight-paint-step-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked && this.weight_paint_brush !== null) {
          this.weight_paint_brush.mode = input.value as WeightPaintMode
        }
      })
    })
    document.getElementById('weight-paint-step-undo')?.addEventListener('click', () => this.undo_weight_paint_stroke())
    document.getElementById('weight-paint-step-redo')?.addEventListener('click', () => this.redo_weight_paint_stroke())
    document.getElementById('weight-paint-step-reset')?.addEventListener('click', () => this.reset_weights_to_auto())
    document.getElementById('weight-paint-step-speed')?.addEventListener('change', (event) => {
      this.animation_speed = Number((event.target as HTMLSelectElement).value)
      this.animation_mixer.timeScale = this.animation_speed
    })

    this.add_keyboard_listeners()
  }

  private add_keyboard_listeners (): void {
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!this.is_active || this.is_typing_target(event.target)) { return }

      if (event.key === 'Alt') {
        this.set_alt_rotate_active(true)
        return
      }

      if (event.key.toLowerCase() === 'x' && this.active_mode === 'paint') {
        event.preventDefault()
        this.toggle_brush_mode()
      }
    })

    document.addEventListener('keyup', (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        this.set_alt_rotate_active(false)
      }
    })

    window.addEventListener('blur', () => {
      if (!this.is_active) { return }
      this.set_alt_rotate_active(false)
      this.clear_bone_overlay()
    })
  }

  private toggle_brush_mode (): void {
    if (this.weight_paint_brush === null) { return }

    const next_mode: Record<WeightPaintMode, WeightPaintMode> = {
      add: 'subtract',
      subtract: 'smooth',
      smooth: 'add'
    }
    this.weight_paint_brush.mode = next_mode[this.weight_paint_brush.mode]
    this.update_weight_paint_ui()
  }

  private is_typing_target (target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
  }
}

/**
 * Heatmap color for the selected bone's weight: blue at 0, yellow at 0.5,
 * red at 1. Alpha ramps up so low weights stay subtle over the texture.
 */
function write_weight_color (
  attribute: { setXYZW: (index: number, x: number, y: number, z: number, w: number) => unknown },
  vertex_index: number,
  weight: number
): void {
  const t = Math.min(1, Math.max(0, weight))

  let red: number
  let green: number
  let blue: number
  if (t < 0.5) {
    const u = t / 0.5
    red = 0.1 + 0.9 * u
    green = 0.35 + 0.55 * u
    blue = 1.0 - 0.9 * u
  } else {
    const u = (t - 0.5) / 0.5
    red = 1.0
    green = 0.9 - 0.8 * u
    blue = 0.1 * (1 - u)
  }

  const alpha = 0.9 * t
  attribute.setXYZW(vertex_index, red, green, blue, alpha)
}
