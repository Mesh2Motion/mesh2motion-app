import { UI } from '../../UI.ts'
import { AnimationLoader } from '../animations-listing/AnimationLoader.ts'
import { type AnimationPlayer } from '../animations-listing/AnimationPlayer.ts'
import { WeightPaintManager, type BrushVertex, type WeightPaintMode } from '../edit-skeleton/WeightPaintManager.ts'
import { RigConfig, type RigAnimation } from '../../RigConfig.ts'
import { Utility } from '../../Utilities.ts'
import {
  AnimationMixer, BufferGeometry, DoubleSide, Float32BufferAttribute, LoopRepeat, Matrix3, Mesh, MeshBasicMaterial,
  Object3D, RingGeometry, SkinnedMesh, Vector3,
  type AnimationAction, type AnimationClip, type Intersection, type PerspectiveCamera
} from 'three'
import { type SkeletonType } from '../../enums/SkeletonType.ts'

/**
 * Optional step shown between posing the skeleton and the animation listing.
 *
 * It brings the user straight to the part of skinning that benefits from a
 * posed mesh: a couple of simple animations for testing deformation, plus the
 * weight painting brush and a live heatmap.
 */
export class StepWeightPainting extends EventTarget {
  private static readonly max_animations: number = 2
  private static readonly preferred_animation_names: Partial<Record<SkeletonType, string[]>> = {
    // names match the manifest, falling back to the first animations of the rig
    // when one of these is missing
    human: ['Idle_A', 'Walk'],
    fox: ['Idle', 'Walk'],
    bird: ['Flap', 'Walk'],
    dragon: ['Fly Flap', 'Walk'],
    kaiju: ['Idle', 'Walk']
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
  private skeleton_scale = 1.0
  private weight_paint_manager: WeightPaintManager | null = null

  private weight_painting_enabled = false
  private shift_painting_enabled = false
  private brush_cursor_ring: Mesh | null = null
  private weight_paint_bone_name: string | null = null
  private bone_names: string[] = []
  private bone_picking_enabled = false
  private weight_paint_radius = 0.03
  private weight_paint_strength = 0.5
  private weight_paint_mode: WeightPaintMode = 'add'
  private active_paint_mode: WeightPaintMode = 'add'
  private weight_paint_mirror_enabled = true
  private weight_paint_show_weights = true
  private weight_paint_clear_marker = 0
  private readonly weight_paint_stroke_vertices = new Set<string>()
  private readonly weight_paint_overlays = new Map<SkinnedMesh, SkinnedMesh>()
  private readonly geometry_center_cache = new WeakMap<BufferGeometry, number>()
  private readonly original_materials = new Map<SkinnedMesh, SkinnedMesh['material']>()
  private readonly black_material = new MeshBasicMaterial({ color: 0x000000 })

  private _added_event_listeners = false

  public begin (
    skinned_meshes: SkinnedMesh[],
    skeleton_type: SkeletonType,
    skeleton_scale: number,
    weight_paint_manager: WeightPaintManager,
    animation_player: AnimationPlayer
  ): void {
    this.skinned_meshes = skinned_meshes
    this.skeleton_scale = skeleton_scale
    this.weight_paint_manager = weight_paint_manager
    this.animation_player = animation_player
    this.weight_paint_clear_marker = weight_paint_manager.undo_stack_marker()
    this.animation_player.clear_animation()

    this.animation_loader.set_skeleton_type(skeleton_type)
    // the create page serves animation assets from the site root
    this.animation_loader.set_static_root_path('')

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
    this.set_shift_painting_enabled(false)
    this.set_weight_painting_enabled(false)
    this.animations = this.skinning_animations(skeleton_type)
    this.populate_animation_options()
    this.update_weight_paint_bone_options()

    // show the black surface and weight colors right away; the paint toggle
    // only controls whether the brush is active
    this.weight_paint_show_weights = true
    this.darken_skinned_meshes()
    this.create_weight_paint_overlays()
    this.update_weight_paint_ui()

    this.play_animation_at(0)

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
    this.set_bone_picking_enabled(false)
    this.set_shift_painting_enabled(false)
    this.set_weight_painting_enabled(false)
    this.dispose_brush_cursor()
    this.restore_skinned_mesh_materials()
    this.dispose_weight_paint_overlays()
    this.weight_paint_stroke_vertices.clear()
    this.animation_mixer.stopAllAction()
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.animation_player?.clear_animation()
    this.skinned_meshes = []
    this.set_animation_status('')
  }

  public is_weight_painting_enabled (): boolean {
    return this.weight_painting_enabled
  }

  /** True while either the persistent paint mode or the Shift modifier is active. */
  public is_draw_mode_active (): boolean {
    return this.weight_painting_enabled || this.shift_painting_enabled
  }

  /** Temporary paint mode while Shift is held; releasing it returns to orbit. */
  public set_shift_painting_enabled (enabled: boolean): void {
    if (this.shift_painting_enabled === enabled) { return }

    this.shift_painting_enabled = enabled
    if (!this.is_draw_mode_active()) {
      this.hide_brush_cursor()
    }
    this.dispatchEvent(new CustomEvent('weightPaintModeChanged', {
      detail: { enabled: this.is_draw_mode_active() }
    }))
  }

  public set_weight_painting_enabled (enabled: boolean): void {
    if (enabled && (this.weight_paint_manager === null ||
      this.skinned_meshes.length === 0 ||
      this.weight_paint_bone_name === null)) {
      return
    }

    if (this.weight_painting_enabled === enabled) {
      this.update_weight_paint_ui()
      return
    }

    this.weight_painting_enabled = enabled
    if (enabled) {
      // Painting is much easier on a still pose. The user can press Play again
      // at any time; the brush uses the pose at the moment of each dab.
      this.animation_player?.pause()
    }
    if (!this.is_draw_mode_active()) {
      this.hide_brush_cursor()
    }
    this.dispatchEvent(new CustomEvent('weightPaintModeChanged', {
      detail: { enabled: this.is_draw_mode_active() }
    }))
    this.update_weight_paint_ui()
  }

  public begin_weight_paint_stroke (button: number = 0, shift_pressed: boolean = false): void {
    // Shift + left paints weight, Shift + right removes weight. The add /
    // subtract control remains the fallback for a non-Shift stroke.
    this.active_paint_mode = button === 2
      ? 'subtract'
      : (shift_pressed ? 'add' : this.weight_paint_mode)
    this.weight_paint_stroke_vertices.clear()
    this.weight_paint_manager?.begin_stroke()
    this.update_weight_paint_ui()
  }

  public end_weight_paint_stroke (): void {
    this.weight_paint_stroke_vertices.clear()
    this.update_weight_paint_ui()
  }

  /** Paints the selected bone onto the posed skinned mesh under the brush. */
  public paint_weights (intersection: Intersection, camera: PerspectiveCamera): void {
    const manager = this.weight_paint_manager
    const object = intersection.object
    if (manager === null || !(object instanceof SkinnedMesh)) { return }

    const bone_name = this.weight_paint_bone_name
    if (bone_name === null) { return }

    const geometry_index = typeof object.userData.geometry_index === 'number'
      ? object.userData.geometry_index as number
      : -object.id

    object.updateWorldMatrix(true, false)
    const positions = object.geometry.attributes.position
    const center = intersection.point.clone()
    const ray_direction = center.clone().sub(camera.position).normalize()
    const point = new Vector3()
    const vertices: BrushVertex[] = []

    for (let i = 0; i < positions.count; i++) {
      const key = `${geometry_index}:${i}`
      if (this.weight_paint_stroke_vertices.has(key)) { continue }

      object.getVertexPosition(i, point)
      point.applyMatrix4(object.matrixWorld)
      const distance = point.distanceTo(center)
      if (distance > this.weight_paint_radius) { continue }

      // Ignore vertices behind the surface the brush is touching, so the
      // brush cannot paint through the mesh to the far side.
      const depth = point.sub(center).dot(ray_direction)
      if (depth > this.weight_paint_radius * 0.5) { continue }

      const t = 1 - distance / this.weight_paint_radius
      vertices.push({ vertex_index: i, falloff: t * t * (3 - 2 * t) })
      this.weight_paint_stroke_vertices.add(key)
    }

    if (vertices.length === 0) { return }

    manager.paint_vertices(
      object,
      geometry_index,
      vertices,
      bone_name,
      object.skeleton.bones,
      this.weight_paint_strength,
      this.active_paint_mode,
      this.weight_paint_mirror_enabled
    )
    if (this.weight_paint_mirror_enabled) {
      // The mirrored side was painted too, so refresh the whole heatmap.
      this.update_weight_paint_overlay_colors(bone_name)
    } else {
      this.update_weight_paint_overlay_vertices(object, vertices.map(vertex => vertex.vertex_index), bone_name)
    }
    this.update_brush_cursor(intersection)
    this.update_weight_paint_ui()
  }

  public undo_weight_paint_stroke (): void {
    if (this.weight_paint_manager === null) { return }
    if (!this.weight_paint_manager.can_undo_since(this.weight_paint_clear_marker)) { return }
    this.weight_paint_manager.undo()
    this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    this.update_weight_paint_ui()
  }

  /** Removes the strokes made on this weight painting step visit. */
  public clear_weight_paint (): void {
    if (this.weight_paint_manager === null) { return }
    this.weight_paint_manager.clear_strokes_since(this.weight_paint_clear_marker)
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
    this.dispatchEvent(new CustomEvent('bonePickModeChanged', { detail: { enabled } }))
    this.update_weight_paint_ui()
  }

  /** Select the bone with the strongest influence at the clicked surface point. */
  public pick_bone (intersection: Intersection): void {
    const object = intersection.object
    const face = intersection.face
    if (!(object instanceof SkinnedMesh) || face === null || face === undefined) { return }

    const positions = object.geometry.attributes.position
    const skin_indices = object.geometry.attributes.skinIndex
    const skin_weights = object.geometry.attributes.skinWeight
    if (positions === undefined || skin_indices === undefined || skin_weights === undefined) { return }

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

    if (best_bone_name === null) { return }

    this.weight_paint_bone_name = best_bone_name
    const filter_input = document.getElementById('weight-paint-step-bone-filter') as HTMLInputElement | null
    if (filter_input !== null) { filter_input.value = '' }
    this.rebuild_bone_options('')

    this.update_weight_paint_overlay_colors(best_bone_name)
    this.set_bone_picking_enabled(false)
    this.update_weight_paint_ui()
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

  /** Moves the brush-size ring to the surface point under the pointer. */
  public update_brush_cursor (intersection: Intersection | null): void {
    if (!this.is_draw_mode_active() || intersection === null) {
      this.hide_brush_cursor()
      return
    }

    const object = intersection.object
    const face = intersection.face
    if (!(object instanceof SkinnedMesh) || face === null || face === undefined) {
      this.hide_brush_cursor()
      return
    }

    const ring = this.ensure_brush_cursor_ring()
    if (ring === null) { return }

    object.updateWorldMatrix(true, false)
    const normal_matrix = new Matrix3().getNormalMatrix(object.matrixWorld)
    const world_normal = face.normal.clone().applyMatrix3(normal_matrix).normalize()
    const world_position = intersection.point.clone()
      .addScaledVector(world_normal, this.weight_paint_radius * 0.02)

    const parent = ring.parent
    ring.position.copy(parent === null ? world_position : parent.worldToLocal(world_position))
    ring.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), world_normal)
    ring.scale.setScalar(this.weight_paint_radius)
    ring.visible = true
  }

  public hide_brush_cursor (): void {
    if (this.brush_cursor_ring !== null) {
      this.brush_cursor_ring.visible = false
    }
  }

  private ensure_brush_cursor_ring (): Mesh | null {
    if (this.brush_cursor_ring !== null) { return this.brush_cursor_ring }

    const parent = this.skinned_meshes[0]?.parent
    if (parent === null || parent === undefined) { return null }

    const material = new MeshBasicMaterial({
      color: 0xffffff,
      side: DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    })
    material.toneMapped = false
    material.fog = false

    const ring = new Mesh(new RingGeometry(0.8, 1, 64), material)
    ring.name = 'Weight Paint Brush Cursor'
    ring.renderOrder = 20
    ring.visible = false
    parent.add(ring)
    this.brush_cursor_ring = ring
    return ring
  }

  private dispose_brush_cursor (): void {
    if (this.brush_cursor_ring === null) { return }

    this.brush_cursor_ring.removeFromParent()
    this.brush_cursor_ring.geometry.dispose()
    const materials = Array.isArray(this.brush_cursor_ring.material)
      ? this.brush_cursor_ring.material
      : [this.brush_cursor_ring.material]
    for (const material of materials) { material.dispose() }
    this.brush_cursor_ring = null
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
    const select = document.getElementById('weight-paint-step-animation') as HTMLSelectElement | null
    if (select === null) { return }

    select.innerHTML = ''
    this.animations.forEach((animation, index) => {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = animation.name
      select.appendChild(option)
    })

    this.selected_animation_index = 0
    select.selectedIndex = this.animations.length > 0 ? 0 : -1
    if (this.animations.length === 0) {
      this.set_animation_status('No test animations available for this rig')
    }
  }

  private play_animation_at (index: number): void {
    const animation = this.animations[index]
    if (animation === undefined) { return }

    this.selected_animation_index = index
    const select = document.getElementById('weight-paint-step-animation') as HTMLSelectElement | null
    if (select !== null) { select.value = String(index) }

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
    if (this.weight_painting_enabled) {
      this.animation_player?.pause()
    }
    this.set_animation_status('')
  }

  private set_animation_status (text: string): void {
    const status = document.getElementById('weight-paint-step-animation-status')
    if (status !== null) { status.textContent = text }
  }

  private update_weight_paint_bone_options (): void {
    const skeleton = this.skinned_meshes[0]?.skeleton
    this.bone_names = skeleton === undefined
      ? []
      : skeleton.bones
        .filter(bone => bone.name !== 'root' && !Utility.is_leaf_bone(bone))
        .map(bone => bone.name)

    const filter_input = document.getElementById('weight-paint-step-bone-filter') as HTMLInputElement | null
    if (filter_input !== null) { filter_input.value = '' }
    this.rebuild_bone_options('')
  }

  private rebuild_bone_options (filter: string): void {
    const select = document.getElementById('weight-paint-step-bone') as HTMLSelectElement | null
    if (select === null) { return }

    const previous = this.weight_paint_bone_name ?? select.value
    const normalized_filter = filter.trim().toLowerCase()
    const matching_names = normalized_filter === ''
      ? this.bone_names
      : this.bone_names.filter(name => name.toLowerCase().includes(normalized_filter))

    select.innerHTML = ''
    for (const name of matching_names) {
      const option = document.createElement('option')
      option.value = name
      option.textContent = name
      select.appendChild(option)
    }

    const previous_index = matching_names.indexOf(previous)
    select.selectedIndex = previous_index >= 0 ? previous_index : (matching_names.length > 0 ? 0 : -1)
    this.weight_paint_bone_name = select.value === '' ? null : select.value
  }

  private update_weight_paint_ui (): void {
    const toggle = document.getElementById('weight-paint-step-toggle') as HTMLButtonElement | null
    if (toggle !== null) {
      toggle.textContent = this.weight_painting_enabled ? 'Stop painting' : 'Start painting'
      toggle.setAttribute('aria-pressed', String(this.weight_painting_enabled))
      toggle.disabled = this.weight_paint_manager === null ||
        this.skinned_meshes.length === 0 ||
        this.weight_paint_bone_name === null
    }

    const pick_button = document.getElementById('weight-paint-step-pick-bone') as HTMLButtonElement | null
    if (pick_button !== null) {
      const pick_label = this.bone_picking_enabled
        ? 'Click a bone on the model'
        : 'Pick a bone by clicking the model'
      pick_button.setAttribute('aria-pressed', String(this.bone_picking_enabled))
      pick_button.setAttribute('aria-label', pick_label)
      pick_button.title = pick_label
      pick_button.disabled = this.skinned_meshes.length === 0 || this.bone_names.length === 0
    }

    const show_weights = document.getElementById('weight-paint-step-show') as HTMLInputElement | null
    if (show_weights !== null) {
      show_weights.checked = this.weight_paint_show_weights
      show_weights.disabled = this.weight_paint_overlays.size === 0
    }

    const mirror = document.getElementById('weight-paint-step-mirror') as HTMLInputElement | null
    if (mirror !== null) {
      mirror.checked = this.weight_paint_mirror_enabled
    }

    const can_undo = this.weight_paint_manager !== null &&
      this.weight_paint_manager.can_undo_since(this.weight_paint_clear_marker)
    const undo = document.getElementById('weight-paint-step-undo') as HTMLButtonElement | null
    if (undo !== null) { undo.disabled = !can_undo }
    const clear = document.getElementById('weight-paint-step-clear') as HTMLButtonElement | null
    if (clear !== null) { clear.disabled = !can_undo }
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
    for (const overlay of this.weight_paint_overlays.values()) {
      overlay.visible = this.weight_paint_show_weights
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

      const vertex_count = positions.count
      for (let i = 0; i < vertex_count; i++) {
        let bone_index = selected_index
        if (this.weight_paint_mirror_enabled && side !== null) {
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

  private update_weight_paint_overlay_vertices (source: SkinnedMesh, vertex_indices: number[], bone_name: string): void {
    const overlay = this.weight_paint_overlays.get(source)
    if (overlay === undefined) { return }

    const color = overlay.geometry.attributes.color
    const skin_indices = source.geometry.attributes.skinIndex
    const skin_weights = source.geometry.attributes.skinWeight
    if (color === undefined || skin_indices === undefined || skin_weights === undefined) { return }

    const bone_index = source.skeleton.bones.findIndex(bone => bone.name === bone_name)
    for (const vertex_index of vertex_indices) {
      write_weight_color(color, vertex_index, this.vertex_weight(skin_indices, skin_weights, vertex_index, bone_index))
    }
    color.needsUpdate = true
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
    document.getElementById('weight-paint-step-animation')?.addEventListener('change', (event) => {
      this.play_animation_at(Number((event.target as HTMLSelectElement).value))
    })
    document.getElementById('weight-paint-step-speed')?.addEventListener('change', (event) => {
      this.animation_speed = Number((event.target as HTMLSelectElement).value)
      this.animation_mixer.timeScale = this.animation_speed
    })
    document.getElementById('weight-paint-step-toggle')?.addEventListener('click', () => {
      this.set_weight_painting_enabled(!this.weight_painting_enabled)
    })
    document.getElementById('weight-paint-step-pick-bone')?.addEventListener('click', () => {
      this.set_bone_picking_enabled(!this.bone_picking_enabled)
    })
    document.getElementById('weight-paint-step-bone')?.addEventListener('change', (event) => {
      const select = event.target as HTMLSelectElement
      this.weight_paint_bone_name = select.value === '' ? null : select.value
      this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
      this.update_weight_paint_ui()
    })
    document.getElementById('weight-paint-step-bone-filter')?.addEventListener('input', (event) => {
      this.rebuild_bone_options((event.target as HTMLInputElement).value)
      this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
      this.update_weight_paint_ui()
    })
    document.getElementById('weight-paint-step-show')?.addEventListener('change', (event) => {
      this.weight_paint_show_weights = (event.target as HTMLInputElement).checked
      this.sync_weight_paint_overlay_visibility()
    })
    document.getElementById('weight-paint-step-mirror')?.addEventListener('change', (event) => {
      this.weight_paint_mirror_enabled = (event.target as HTMLInputElement).checked
      this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    })
    document.getElementById('weight-paint-step-radius')?.addEventListener('input', (event) => {
      this.weight_paint_radius = Number((event.target as HTMLInputElement).value)
      if (this.brush_cursor_ring !== null) {
        this.brush_cursor_ring.scale.setScalar(this.weight_paint_radius)
      }
    })
    document.getElementById('weight-paint-step-strength')?.addEventListener('input', (event) => {
      this.weight_paint_strength = Number((event.target as HTMLInputElement).value)
    })
    document.querySelectorAll<HTMLInputElement>('input[name="weight-paint-step-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) {
          this.weight_paint_mode = input.value === 'subtract' ? 'subtract' : 'add'
        }
      })
    })
    document.getElementById('weight-paint-step-undo')?.addEventListener('click', () => this.undo_weight_paint_stroke())
    document.getElementById('weight-paint-step-clear')?.addEventListener('click', () => this.clear_weight_paint())
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
