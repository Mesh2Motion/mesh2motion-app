import * as THREE from 'three'
import { type OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { type TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { ProcessStep } from '../../enums/ProcessStep.ts'
import { Utility } from '../../Utilities.ts'
import { type StepEditSkeleton } from './StepEditSkeleton.ts'
import { type StepLoadModel } from '../load-model/StepLoadModel.ts'
import { type StepWeightSkin } from '../weight-skin/StepWeightSkin.ts'
import { type PerspectiveCamera, type Vector3, type Object3D, type Skeleton } from 'three'

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

    this.is_dragging_mode_active = false
    if (this.orbit_controls !== undefined) {
      this.orbit_controls.enabled = true
    }

    return true
  }

  private move_selected_bone_to_mesh_midpoint (mouse_event: MouseEvent): void {
    const selected_bone = this.edit_skeleton_step.get_currently_selected_bone()

    if (selected_bone?.parent === null || selected_bone === null) {
      return
    }

    const intersection_segment = this.get_edit_mesh_intersection_segment(mouse_event)
    let target_world_position: Vector3 | null = null

    if (intersection_segment !== null) {
      const [first_intersection, last_intersection] = intersection_segment
      target_world_position = first_intersection.clone().add(last_intersection).multiplyScalar(0.5)
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

  private get_edit_mesh_intersection_segment (mouse_event: MouseEvent): [Vector3, Vector3] | null {
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

    const first_intersection = forward_intersections[0].point.clone()

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
      return [first_intersection, first_intersection]
    }

    const last_intersection = reverse_intersections[0].point.clone()
    return [first_intersection, last_intersection]
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
