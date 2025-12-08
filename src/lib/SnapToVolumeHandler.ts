import * as THREE from 'three'
import { type Bone, type Scene, type Skeleton, type PerspectiveCamera } from 'three'
import { Utility } from './Utilities.ts'
import { type StepEditSkeleton } from './processes/edit-skeleton/StepEditSkeleton.ts'
import { type StepLoadModel } from './processes/load-model/StepLoadModel.ts'
import { type CustomSkeletonHelper } from './CustomSkeletonHelper.ts'
import { ModelPreviewDisplay } from './enums/ModelPreviewDisplay.ts'
import { type OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Handles snap-to-volume functionality for positioning bones at mesh volume centers
 * This class manages the interaction of clicking/dragging to snap bones to mesh volume
 */
export class SnapToVolumeHandler {
  private is_dragging: boolean = false
  private readonly search_radius: number = 0.15 // radius for finding nearby vertices when snapping to volume center
  private readonly hover_distance: number = 0.02 // distance to hover over bones to select them

  constructor (
    private readonly camera: PerspectiveCamera,
    private readonly edit_skeleton_step: StepEditSkeleton,
    private readonly load_model_step: StepLoadModel,
    private readonly controls: OrbitControls | undefined,
    private readonly skeleton_helper: CustomSkeletonHelper | undefined,
    private readonly mesh_preview_display_type: ModelPreviewDisplay,
    private readonly regenerate_skeleton_helper: (skeleton: Skeleton, name: string) => void,
    private readonly regenerate_weight_painted_preview_mesh: () => void
  ) {}

  /**
   * Check if currently dragging in snap-to-volume mode
   */
  public is_snap_to_volume_dragging (): boolean {
    return this.is_dragging
  }

  /**
   * Handle mouse down in snap to volume mode - start dragging
   */
  public handle_mouse_down (mouse_event: MouseEvent): void {
    const skeleton_to_test: Skeleton | undefined = this.edit_skeleton_step.skeleton()
    
    if (skeleton_to_test === undefined) {
      console.warn('No skeleton to test for snap to volume')
      return
    }

    // Find the closest bone to mouse position
    const [closest_bone, closest_bone_index, closest_distance] = Utility.raycast_closest_bone_test(this.camera, mouse_event, skeleton_to_test)

    // don't allow to select root bone
    if (closest_bone?.name === 'root') {
      return
    }

    // Only select bone if we are close enough
    if (closest_distance === null || closest_distance > this.hover_distance) {
      return
    }

    if (closest_bone === null) {
      return
    }

    // Store the selected bone
    this.edit_skeleton_step.set_currently_selected_bone(closest_bone)
    
    // Store undo state before making changes (only once at start of drag)
    this.edit_skeleton_step.store_bone_state_for_undo()
    
    // Start dragging mode
    this.is_dragging = true
    
    // Disable orbit controls while dragging
    if (this.controls !== undefined) {
      this.controls.enabled = false
    }

    // Perform the initial snap
    this.snap_bone_to_volume_at_mouse_position(mouse_event, closest_bone)
  }

  /**
   * Handle mouse move while dragging in snap to volume mode
   */
  public handle_dragging (mouse_event: MouseEvent): void {
    const selected_bone = this.edit_skeleton_step.get_currently_selected_bone()
    
    if (selected_bone === null) {
      return
    }

    // Continuously update bone position as mouse moves
    this.snap_bone_to_volume_at_mouse_position(mouse_event, selected_bone)
  }

  /**
   * Handle mouse up in snap to volume mode - stop dragging
   */
  public handle_mouse_up (): void {
    this.is_dragging = false
    
    // Re-enable orbit controls
    if (this.controls !== undefined) {
      this.controls.enabled = true
    }

    // Refresh weight painting if in weight painted mode
    if (this.mesh_preview_display_type === ModelPreviewDisplay.WeightPainted) {
      this.regenerate_weight_painted_preview_mesh()
    }
  }

  /**
   * Snap the bone to the volume center at the current mouse position
   */
  private snap_bone_to_volume_at_mouse_position (mouse_event: MouseEvent, bone: Bone): void {
    // Raycast to find mesh intersection
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(Utility.normalized_mouse_position(mouse_event), this.camera)

    // Get the model meshes to raycast against
    const model_meshes = this.load_model_step.model_meshes()
    
    // Collect all mesh objects for raycasting
    const meshes_to_test: THREE.Mesh[] = []
    model_meshes.traverse((child) => {
      if (child.type === 'Mesh' || child.type === 'SkinnedMesh') {
        meshes_to_test.push(child as THREE.Mesh)
      }
    })

    if (meshes_to_test.length === 0) {
      return
    }

    // Perform raycasting
    const intersections = raycaster.intersectObjects(meshes_to_test, true)

    if (intersections.length === 0) {
      return
    }

    // Get the first intersection
    const intersection = intersections[0]
    const mesh = intersection.object as THREE.Mesh

    // Calculate the local volume center around the intersection point
    const volume_center = this.calculate_local_volume_center(mesh, intersection.point)

    // Move the bone to the volume center
    if (bone.parent !== null) {
      const parent_world_matrix = new THREE.Matrix4()
      bone.parent.updateWorldMatrix(true, false)
      parent_world_matrix.copy(bone.parent.matrixWorld).invert()
      const local_position = volume_center.clone().applyMatrix4(parent_world_matrix)
      bone.position.copy(local_position)
    } else {
      bone.position.copy(volume_center)
    }

    bone.updateWorldMatrix(true, true)

    // Apply mirror mode if enabled
    if (this.edit_skeleton_step.is_mirror_mode_enabled()) {
      this.edit_skeleton_step.apply_mirror_mode(bone, 'translate')
    }

    // Update skeleton helper
    if (this.skeleton_helper !== undefined) {
      this.regenerate_skeleton_helper(this.edit_skeleton_step.skeleton(), 'Skeleton Helper')
    }
  }

  /**
   * Calculate the volume center of the mesh around a given point
   * This uses the mesh's geometry to find vertices near the intersection point
   * and calculates their bounding box center
   */
  private calculate_local_volume_center (mesh: THREE.Mesh, intersection_point: THREE.Vector3): THREE.Vector3 {
    const geometry = mesh.geometry
    
    if (geometry === undefined || geometry === null) {
      return intersection_point.clone()
    }

    // Get position attribute
    const positions = geometry.attributes.position
    
    if (positions === undefined) {
      return intersection_point.clone()
    }

    // Transform intersection point to local space of the mesh
    const local_intersection = intersection_point.clone()
    const inverse_matrix = new THREE.Matrix4()
    mesh.updateWorldMatrix(true, false)
    inverse_matrix.copy(mesh.matrixWorld).invert()
    local_intersection.applyMatrix4(inverse_matrix)

    // Find vertices within a radius of the intersection point
    const nearby_vertices: THREE.Vector3[] = []

    for (let i = 0; i < positions.count; i++) {
      const vertex = new THREE.Vector3(
        positions.getX(i),
        positions.getY(i),
        positions.getZ(i)
      )

      const distance = vertex.distanceTo(local_intersection)
      if (distance < this.search_radius) {
        nearby_vertices.push(vertex)
      }
    }

    // If we found nearby vertices, calculate their bounding box center
    if (nearby_vertices.length > 0) {
      const bbox = new THREE.Box3()
      bbox.setFromPoints(nearby_vertices)
      const center = new THREE.Vector3()
      bbox.getCenter(center)
      
      // Transform back to world space
      center.applyMatrix4(mesh.matrixWorld)
      return center
    }

    // If no nearby vertices, just return the intersection point
    return intersection_point.clone()
  }
}
