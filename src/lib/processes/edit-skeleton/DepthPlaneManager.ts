import { Group, Mesh, PlaneGeometry, MeshBasicMaterial, type Scene, DoubleSide } from 'three'

/**
 * DepthPlaneManager - manages the pair of mirrored planes that show where the
 * front/back weight correction cuts off during the edit skeleton step.
 *
 * The same shape as ArmPlaneManager, but the planes face along Z instead of X:
 * one in front of the character and one behind, so the user can see how much
 * hair or clothing depth is about to be taken off the arm bones.
 */
export class DepthPlaneManager {
  private readonly depth_plane_group_name: string = 'depth_plane_group'

  // State tracking
  private scene_ref: Scene | null = null
  private plane_group: Group | null = null
  private front_plane_mesh: Mesh | null = null
  private back_plane_mesh: Mesh | null = null
  private current_plane_z: number = 0.0
  private current_center_y: number = 0.0
  private current_anchor_z: number = 0.0
  private readonly plane_size: number = 2.0
  private is_visible: boolean = false

  /**
   * Initialize the manager with a scene reference
   * @param scene The main scene
   */
  public initialize (scene: Scene): void {
    this.scene_ref = scene
  }

  /**
   * Set the visibility of the depth planes. Creates them on demand and removes
   * them when hidden, so nothing lingers in the scene between steps.
   */
  public set_visibility (visible: boolean): void {
    if (visible && !this.is_visible) {
      this.add_planes()
    } else if (!visible && this.is_visible) {
      this.remove_planes()
    }
  }

  /**
   * Move the planes to a new distance either side of the body's depth. They are
   * centered on the shoulder joint's height so they sit over the torso.
   *
   * State is stored even when the planes are hidden, so callers can update the
   * position before or after toggling visibility.
   *
   * @param plane_z how far in front of and behind the anchor the planes sit
   * @param center_y the height to center the planes at
   * @param anchor_z the body depth the distance is measured out from
   */
  public update_position (plane_z: number, center_y: number, anchor_z: number): void {
    this.current_plane_z = plane_z
    this.current_center_y = center_y
    this.current_anchor_z = anchor_z

    if (this.front_plane_mesh !== null && this.back_plane_mesh !== null) {
      this.front_plane_mesh.position.set(0, center_y, anchor_z + plane_z)
      this.back_plane_mesh.position.set(0, center_y, anchor_z - plane_z)
    }
  }

  public is_plane_visible (): boolean {
    return this.is_visible
  }

  /**
   * Remove both planes from the scene and dispose their resources
   */
  public remove_planes (): void {
    if (this.plane_group !== null && this.scene_ref !== null) {
      [this.front_plane_mesh, this.back_plane_mesh].forEach((plane_mesh) => {
        if (plane_mesh === null) return
        plane_mesh.geometry.dispose()
        if (plane_mesh.material instanceof MeshBasicMaterial) {
          plane_mesh.material.dispose()
        }
      })

      this.scene_ref.remove(this.plane_group)
    }

    this.plane_group = null
    this.front_plane_mesh = null
    this.back_plane_mesh = null
    this.is_visible = false
  }

  /**
   * Clean up all resources and reset state
   */
  public cleanup (): void {
    this.remove_planes()
    this.scene_ref = null
    this.current_plane_z = 0.0
    this.current_center_y = 0.0
    this.current_anchor_z = 0.0
    this.is_visible = false
  }

  /**
   * Build the two planes at the currently stored position
   */
  private add_planes (): void {
    if (this.scene_ref === null) {
      throw new Error('DepthPlaneManager not initialized with scene reference')
    }

    this.remove_planes()

    this.plane_group = new Group()
    this.plane_group.name = this.depth_plane_group_name

    this.front_plane_mesh = this.create_plane_mesh('depth_plane_front')
    this.back_plane_mesh = this.create_plane_mesh('depth_plane_back')

    this.plane_group.add(this.front_plane_mesh)
    this.plane_group.add(this.back_plane_mesh)
    this.scene_ref.add(this.plane_group)

    this.is_visible = true

    // apply the stored position to the freshly created meshes
    this.update_position(this.current_plane_z, this.current_center_y, this.current_anchor_z)
  }

  private create_plane_mesh (name: string): Mesh {
    const geometry = new PlaneGeometry(this.plane_size, this.plane_size)
    const material = new MeshBasicMaterial({
      color: 0xff9933, // orange, to distinguish from the green head and blue arm planes
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
      wireframe: false
    })

    const plane_mesh = new Mesh(geometry, material)
    plane_mesh.name = name

    // PlaneGeometry already faces along Z, so no rotation is needed here

    return plane_mesh
  }
}
