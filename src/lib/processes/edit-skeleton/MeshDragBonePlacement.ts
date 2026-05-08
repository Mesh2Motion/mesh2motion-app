import * as THREE from 'three'
import { type OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { type TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { ProcessStep } from '../../enums/ProcessStep.ts'
import { Utility } from '../../Utilities.ts'
import { type StepEditSkeleton } from './StepEditSkeleton.ts'
import { type StepLoadModel } from '../load-model/StepLoadModel.ts'
import { type StepWeightSkin } from '../weight-skin/StepWeightSkin.ts'
import { Bone, type PerspectiveCamera, Vector3, type Object3D, type Skeleton, type Intersection, type BufferAttribute, type Mesh, type SkinnedMesh } from 'three'

export function calculate_vertex_snap_influence (snap_strength: number): number {
  const clamped_strength = Math.max(0, Math.min(20, snap_strength))
  return clamped_strength / 20
}

export function blend_target_with_snap_vertex (
  target_world_position: Vector3,
  snap_vertex_world_position: Vector3 | null,
  snap_strength: number
): Vector3 {
  const snap_influence = calculate_vertex_snap_influence(snap_strength)
  if (snap_influence <= 0 || snap_vertex_world_position === null) {
    return target_world_position.clone()
  }

  return target_world_position.clone().lerp(snap_vertex_world_position, snap_influence)
}

export function is_centerline_mesh_snap_bone_name (bone_name: string): boolean {
  const normalized_bone_name = bone_name.toLowerCase()
  const has_side_marker =
    normalized_bone_name.startsWith('left') ||
    normalized_bone_name.startsWith('right') ||
    /^l[_-]/.test(normalized_bone_name) ||
    /^r[_-]/.test(normalized_bone_name) ||
    /(^|[^a-z])(left|right)([^a-z]|$)/.test(normalized_bone_name)

  if (has_side_marker) {
    return false
  }

  return /(pelvis|hips|spine|chest|torso|abdomen|waist|neck|head)/.test(normalized_bone_name)
}

export function apply_mesh_centerline_target (
  target_world_position: Vector3,
  center_x: number,
  center_z: number
): Vector3 {
  return new Vector3(center_x, target_world_position.y, center_z)
}

export class MeshDragBonePlacement {
  private orbit_controls: OrbitControls | undefined = undefined
  private is_dragging_mode_active: boolean = false

  constructor (
    private readonly camera: PerspectiveCamera,
    private readonly edit_skeleton_step: StepEditSkeleton,
    private readonly load_model_step: StepLoadModel,
    private readonly weight_skin_step: StepWeightSkin,
    private readonly hover_distance: number
  ) {}

  public set_orbit_controls (controls: OrbitControls): void {
    this.orbit_controls = controls
  }

  public is_dragging (): boolean {
    return this.is_dragging_mode_active
  }

  public sync_interaction_mode (process_step: ProcessStep, transform_controls: TransformControls): void {
    const using_mesh_drag_mode =
      process_step === ProcessStep.EditSkeleton &&
      this.edit_skeleton_step.is_mesh_drag_placement_enabled()

    transform_controls.enabled = !using_mesh_drag_mode && process_step === ProcessStep.EditSkeleton

    if (using_mesh_drag_mode) {
      transform_controls.detach()
      if (this.orbit_controls !== undefined) {
        this.orbit_controls.enabled = true
      }
    }

    if (this.is_dragging_mode_active && !using_mesh_drag_mode) {
      this.is_dragging_mode_active = false
      if (this.orbit_controls !== undefined) {
        this.orbit_controls.enabled = true
      }
    }
  }

  public handle_mouse_down (mouse_event: MouseEvent): void {
    const is_primary_button_click = mouse_event.button === 0
    if (!is_primary_button_click) {
      return
    }

    const skeleton_to_test: Skeleton | undefined = this.edit_skeleton_step.skeleton()
    if (skeleton_to_test === undefined) {
      return
    }

    const [closest_bone, , closest_distance] =
      Utility.raycast_closest_bone_test(this.camera, mouse_event, skeleton_to_test)

    if (closest_bone?.name === 'root') {
      return
    }

    if (!this.edit_skeleton_step.is_bone_selectable(closest_bone)) {
      return
    }

    if (closest_distance === null || closest_distance > this.hover_distance) {
      return
    }

    if (closest_bone === null) {
      return
    }

    this.edit_skeleton_step.set_currently_selected_bone(closest_bone)
    this.edit_skeleton_step.store_bone_state_for_undo()

    if (this.edit_skeleton_step.independent_bone_movement.is_enabled()) {
      const mirror_bone = this.edit_skeleton_step.is_mirror_mode_enabled()
        ? this.edit_skeleton_step.find_mirror_bone(closest_bone)
        : undefined
      this.edit_skeleton_step.independent_bone_movement.record_drag_start(closest_bone, mirror_bone)
    }

    this.is_dragging_mode_active = true
    if (this.orbit_controls !== undefined) {
      this.orbit_controls.enabled = false
    }

    this.move_selected_bone_to_mesh_midpoint(mouse_event)
  }

  public handle_mouse_move (mouse_event: MouseEvent): void {
    if (!this.is_dragging_mode_active) {
      return
    }

    this.move_selected_bone_to_mesh_midpoint(mouse_event)
  }

  public handle_mouse_up (): boolean {
    if (!this.is_dragging_mode_active) {
      return false
    }

    const selected_bone = this.edit_skeleton_step.get_currently_selected_bone()
    if (selected_bone !== null && this.edit_skeleton_step.independent_bone_movement.is_enabled()) {
      const mirror_bone = this.edit_skeleton_step.is_mirror_mode_enabled()
        ? this.edit_skeleton_step.find_mirror_bone(selected_bone)
        : undefined
      this.edit_skeleton_step.independent_bone_movement.finalize_drop(selected_bone, mirror_bone)
    }

    this.is_dragging_mode_active = false
    if (this.orbit_controls !== undefined) {
      this.orbit_controls.enabled = true
    }

    return true
  }

  public snap_primary_centerline_bones_to_mesh_center (): void {
    const skeleton_to_snap = this.edit_skeleton_step.skeleton()
    if (skeleton_to_snap === undefined) {
      return
    }

    const mesh_targets = this.get_centerline_mesh_targets()
    if (mesh_targets.length === 0) {
      return
    }

    skeleton_to_snap.bones.forEach((bone) => {
      if (!is_centerline_mesh_snap_bone_name(bone.name) || !(bone.parent instanceof Bone)) {
        return
      }

      const centered_world_position = this.get_mesh_centerline_target_at_world_position(
        Utility.world_position_from_object(bone),
        mesh_targets
      )

      if (centered_world_position === null) {
        return
      }

      const centered_local_position = centered_world_position.clone()
      bone.parent.worldToLocal(centered_local_position)
      bone.position.copy(centered_local_position)
      bone.updateWorldMatrix(true, true)
    })
  }

  public spread_spine_chain_for_fox (): void {
    const skeleton_to_adjust = this.edit_skeleton_step.skeleton()
    if (skeleton_to_adjust === undefined) {
      return
    }

    const pelvis_bone = this.find_bone_by_name_match(skeleton_to_adjust, /(pelvis|hips)/)
    const head_bone = this.find_bone_by_name_match(skeleton_to_adjust, /head/)
    const spine_bones = this.find_spine_chain_bones(skeleton_to_adjust)

    const mesh_bounds = this.get_mesh_bounds()
    if (mesh_bounds === null) {
      return
    }

    if (pelvis_bone === null || head_bone === null || spine_bones.length === 0) {
      return
    }

    const pelvis_world = Utility.world_position_from_object(pelvis_bone)
    const head_world = Utility.world_position_from_object(head_bone)

    const bounds_size = mesh_bounds.getSize(new Vector3())
    const bounds_center = mesh_bounds.getCenter(new Vector3())
    const use_x_axis = bounds_size.x >= bounds_size.z
    let axis_dir = use_x_axis ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1)

    const head_hint = new Vector3(head_world.x, 0, head_world.z)
    const pelvis_hint = new Vector3(pelvis_world.x, 0, pelvis_world.z)
    const hint_axis = head_hint.clone().sub(pelvis_hint)

    if (hint_axis.lengthSq() > 0.0001) {
      axis_dir = hint_axis.normalize()
    } else {
      const center_hint = new Vector3(bounds_center.x, 0, bounds_center.z)
      if (head_hint.sub(center_hint).dot(axis_dir) < 0) {
        axis_dir.multiplyScalar(-1)
      }
    }

    const axis_length = Math.max(use_x_axis ? bounds_size.x : bounds_size.z, 0.1)
    const half_length = axis_length * 0.45
    const tail_position = bounds_center.clone().add(axis_dir.clone().multiplyScalar(-half_length))
    const head_position = bounds_center.clone().add(axis_dir.clone().multiplyScalar(half_length))

    tail_position.y = pelvis_world.y
    head_position.y = head_world.y

    const spine_axis = head_position.clone().sub(tail_position)
    if (spine_axis.lengthSq() < 0.0001) {
      return
    }

    const spine_direction = spine_axis.clone().normalize()
    spine_bones.sort((bone_a, bone_b) => {
      const bone_a_pos = Utility.world_position_from_object(bone_a)
      const bone_b_pos = Utility.world_position_from_object(bone_b)
      const bone_a_depth = bone_a_pos.clone().sub(tail_position).dot(spine_direction)
      const bone_b_depth = bone_b_pos.clone().sub(tail_position).dot(spine_direction)

      if (bone_a_depth === bone_b_depth) {
        return bone_a.name.localeCompare(bone_b.name)
      }

      return bone_a_depth - bone_b_depth
    })

    spine_bones.forEach((bone, index) => {
      if (!(bone.parent instanceof Bone)) {
        return
      }

      const lerp_factor = (index + 1) / (spine_bones.length + 1)
      const target_world_position = tail_position.clone().lerp(head_position, lerp_factor)
      target_world_position.y = pelvis_world.y + (head_world.y - pelvis_world.y) * lerp_factor
      const target_local_position = target_world_position.clone()
      bone.parent.worldToLocal(target_local_position)
      bone.position.copy(target_local_position)
      bone.updateWorldMatrix(true, true)
    })
  }

  private move_selected_bone_to_mesh_midpoint (mouse_event: MouseEvent): void {
    const selected_bone = this.edit_skeleton_step.get_currently_selected_bone()

    if (selected_bone?.parent === null || selected_bone === null) {
      return
    }

    const intersection_target = this.get_edit_mesh_intersection_target(mouse_event)
    let target_world_position: Vector3 | null = null

    if (intersection_target !== null) {
      if (is_centerline_mesh_snap_bone_name(selected_bone.name)) {
        target_world_position = this.get_mesh_centerline_target_at_world_position(intersection_target.midpoint)
      }

      if (target_world_position === null) {
        target_world_position = blend_target_with_snap_vertex(
          intersection_target.midpoint,
          intersection_target.closest_vertex_world_position,
          this.edit_skeleton_step.get_mesh_drag_snap_strength()
        )
      }
    } else {
      target_world_position = this.get_point_on_viewport_plane_from_mouse(selected_bone, mouse_event)
    }

    if (target_world_position === null) {
      return
    }

    const midpoint_local = target_world_position.clone()
    selected_bone.parent.worldToLocal(midpoint_local)
    selected_bone.position.copy(midpoint_local)
    selected_bone.updateWorldMatrix(true, true)

    const mirror_bone = this.edit_skeleton_step.is_mirror_mode_enabled()
      ? this.edit_skeleton_step.find_mirror_bone(selected_bone)
      : undefined

    if (this.edit_skeleton_step.is_mirror_mode_enabled()) {
      this.edit_skeleton_step.apply_mirror_mode(selected_bone, 'translate')
    }

    if (this.edit_skeleton_step.independent_bone_movement.is_enabled()) {
      this.edit_skeleton_step.independent_bone_movement.apply(selected_bone, mirror_bone)
    }
  }

  private get_centerline_mesh_targets (): Object3D[] {
    const mesh_targets: Object3D[] = []
    mesh_targets.push(this.load_model_step.model_meshes())

    const weight_painted_mesh = this.weight_skin_step.weight_painted_mesh_group()
    if (weight_painted_mesh !== null) {
      mesh_targets.push(weight_painted_mesh)
    }

    return mesh_targets.filter((target) => target.children.length > 0)
  }

  private get_mesh_bounds (): THREE.Box3 | null {
    const mesh_targets = this.get_centerline_mesh_targets()
    if (mesh_targets.length === 0) {
      return null
    }

    const scene_bounds = new THREE.Box3()
    mesh_targets.forEach((target) => {
      scene_bounds.expandByObject(target)
    })

    if (scene_bounds.isEmpty()) {
      return null
    }

    return scene_bounds
  }

  private get_mesh_centerline_target_at_world_position (
    target_world_position: Vector3,
    mesh_targets: Object3D[] = this.get_centerline_mesh_targets()
  ): Vector3 | null {
    if (mesh_targets.length === 0) {
      return null
    }

    const scene_bounds = this.get_mesh_bounds()
    if (scene_bounds === null) {
      return null
    }

    const scene_center = scene_bounds.getCenter(new Vector3())
    const scene_size = scene_bounds.getSize(new Vector3())
    const ray_margin = Math.max(0.25, scene_size.length() * 0.25)
    const target_y = target_world_position.y

    let snapped_x = scene_center.x
    let snapped_z = scene_center.z

    const initial_z_midpoint = this.get_opposing_surface_midpoint(
      mesh_targets,
      new Vector3(scene_center.x, target_y, scene_bounds.max.z + ray_margin),
      new Vector3(0, 0, -1),
      new Vector3(scene_center.x, target_y, scene_bounds.min.z - ray_margin),
      new Vector3(0, 0, 1)
    )

    if (initial_z_midpoint !== null) {
      snapped_z = initial_z_midpoint.z
    }

    const x_midpoint = this.get_opposing_surface_midpoint(
      mesh_targets,
      new Vector3(scene_bounds.min.x - ray_margin, target_y, snapped_z),
      new Vector3(1, 0, 0),
      new Vector3(scene_bounds.max.x + ray_margin, target_y, snapped_z),
      new Vector3(-1, 0, 0)
    )

    if (x_midpoint !== null) {
      snapped_x = x_midpoint.x
    }

    const refined_z_midpoint = this.get_opposing_surface_midpoint(
      mesh_targets,
      new Vector3(snapped_x, target_y, scene_bounds.max.z + ray_margin),
      new Vector3(0, 0, -1),
      new Vector3(snapped_x, target_y, scene_bounds.min.z - ray_margin),
      new Vector3(0, 0, 1)
    )

    if (refined_z_midpoint !== null) {
      snapped_z = refined_z_midpoint.z
    }

    return apply_mesh_centerline_target(target_world_position, snapped_x, snapped_z)
  }

  private find_spine_chain_bones (skeleton: Skeleton): Bone[] {
    return skeleton.bones.filter((bone) => /spine/.test(bone.name.toLowerCase()))
  }

  private find_bone_by_name_match (skeleton: Skeleton, matcher: RegExp): Bone | null {
    const bone_match = skeleton.bones.find((bone) => matcher.test(bone.name.toLowerCase()))
    return bone_match ?? null
  }

  private get_opposing_surface_midpoint (
    mesh_targets: Object3D[],
    forward_origin: Vector3,
    forward_direction: Vector3,
    reverse_origin: Vector3,
    reverse_direction: Vector3
  ): Vector3 | null {
    const forward_hit = this.get_axis_surface_hit(mesh_targets, forward_origin, forward_direction)
    const reverse_hit = this.get_axis_surface_hit(mesh_targets, reverse_origin, reverse_direction)

    if (forward_hit !== null && reverse_hit !== null) {
      return forward_hit.add(reverse_hit).multiplyScalar(0.5)
    }

    return forward_hit ?? reverse_hit
  }

  private get_axis_surface_hit (
    mesh_targets: Object3D[],
    origin: Vector3,
    direction: Vector3
  ): Vector3 | null {
    const axis_raycaster = new THREE.Raycaster(origin, direction.clone().normalize())
    const intersections = axis_raycaster.intersectObjects(mesh_targets, true)
    return intersections.length > 0 ? intersections[0].point.clone() : null
  }

  private get_edit_mesh_intersection_target (mouse_event: MouseEvent): MeshIntersectionTarget | null {
    const mesh_targets: Object3D[] = []

    const imported_model = this.load_model_step.model_meshes()
    if (imported_model.visible) {
      mesh_targets.push(imported_model)
    }

    const weight_painted_mesh = this.weight_skin_step.weight_painted_mesh_group()
    if (weight_painted_mesh !== null && weight_painted_mesh.visible) {
      mesh_targets.push(weight_painted_mesh)
    }

    if (mesh_targets.length === 0) {
      return null
    }

    const forward_raycaster = new THREE.Raycaster()
    forward_raycaster.setFromCamera(Utility.normalized_mouse_position(mouse_event), this.camera)
    const forward_intersections = forward_raycaster.intersectObjects(mesh_targets, true)

    if (forward_intersections.length === 0) {
      return null
    }

    const first_hit = forward_intersections[0]
    const first_intersection = first_hit.point.clone()
    const closest_vertex_world_position = this.get_closest_vertex_world_position_from_hit(first_hit)

    const scene_bounds = new THREE.Box3()
    mesh_targets.forEach((target) => {
      scene_bounds.expandByObject(target)
    })

    const scene_size = scene_bounds.getSize(new THREE.Vector3())
    const far_offset_distance = Math.max(1, scene_size.length() * 2)
    const reverse_ray_origin = first_intersection
      .clone()
      .add(forward_raycaster.ray.direction.clone().multiplyScalar(far_offset_distance))

    const reverse_raycaster = new THREE.Raycaster(
      reverse_ray_origin,
      forward_raycaster.ray.direction.clone().negate()
    )

    const reverse_intersections = reverse_raycaster.intersectObjects(mesh_targets, true)
    if (reverse_intersections.length === 0) {
      return {
        midpoint: first_intersection,
        closest_vertex_world_position
      }
    }

    const last_intersection = reverse_intersections[0].point.clone()
    return {
      midpoint: first_intersection.clone().add(last_intersection).multiplyScalar(0.5),
      closest_vertex_world_position
    }
  }

  private get_closest_vertex_world_position_from_hit (intersection: Intersection<Object3D>): Vector3 | null {
    const face = intersection.face
    const object = intersection.object
    const geometry = 'geometry' in object ? object.geometry : undefined

    if (face === null || geometry === undefined) {
      return null
    }

    const position_attribute = geometry.getAttribute('position') as BufferAttribute | undefined
    if (position_attribute === undefined) {
      return null
    }

    const vertex_indices = [face.a, face.b, face.c]
    let closest_vertex_world_position: Vector3 | null = null
    let closest_vertex_distance = Number.POSITIVE_INFINITY

    for (const vertex_index of vertex_indices) {
      const vertex_world_position = this.get_vertex_world_position(object as Mesh | SkinnedMesh, position_attribute, vertex_index)
      const vertex_distance = vertex_world_position.distanceTo(intersection.point)

      if (vertex_distance < closest_vertex_distance) {
        closest_vertex_distance = vertex_distance
        closest_vertex_world_position = vertex_world_position
      }
    }

    return closest_vertex_world_position
  }

  private get_vertex_world_position (object: Mesh | SkinnedMesh, positions: BufferAttribute, vertex_index: number): Vector3 {
    const vertex_world_position = new Vector3().fromBufferAttribute(positions, vertex_index)

    if ('isSkinnedMesh' in object && object.isSkinnedMesh && typeof object.applyBoneTransform === 'function') {
      object.applyBoneTransform(vertex_index, vertex_world_position)
    }

    return object.localToWorld(vertex_world_position)
  }

  private get_point_on_viewport_plane_from_mouse (selected_bone: THREE.Bone, mouse_event: MouseEvent): Vector3 | null {
    const bone_world_position = Utility.world_position_from_object(selected_bone)

    const mouse_raycaster = new THREE.Raycaster()
    mouse_raycaster.setFromCamera(Utility.normalized_mouse_position(mouse_event), this.camera)

    const viewport_normal = this.camera.getWorldDirection(new THREE.Vector3()).normalize()
    const viewport_plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      viewport_normal,
      bone_world_position
    )

    const intersection_point = mouse_raycaster.ray.intersectPlane(viewport_plane, new THREE.Vector3())
    return intersection_point === null ? null : intersection_point.clone()
  }
}

interface MeshIntersectionTarget {
  midpoint: Vector3
  closest_vertex_world_position: Vector3 | null
}
