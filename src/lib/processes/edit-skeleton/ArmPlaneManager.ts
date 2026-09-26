import { Group, Mesh, PlaneGeometry, MeshBasicMaterial, type Scene, DoubleSide } from 'three'
import { ArmWeightCorrector } from '../../solvers/ArmWeightCorrector.js'

/**
 * ArmPlaneManager - manages the pair of mirrored vertical planes that show where
 * the arm weight correction cuts off during the edit skeleton step.
 *
 * Unlike PreviewPlaneManager (one horizontal plane, singleton) this owns two
 * planes at +X and -X, so it is a plain class instantiated by the step that
 * needs it.
 */
export class ArmPlaneManager {
  private readonly arm_plane_group_name: string = 'arm_plane_group'

  // State tracking
  private scene_ref: Scene | null = null
  private plane_group: Group | null = null
  private left_plane_mesh: Mesh | null = null
  private right_plane_mesh: Mesh | null = null
  private current_plane_x: number = 0.0
  private current_center_y: number = 0.0
  private current_center_z: number = 0.0
  private readonly plane_size: number = ArmWeightCorrector.correction_half_height * 2
  private is_visible: boolean = false

  /**
   * Initialize the manager with a scene reference
   * @param scene The main scene
   */
  public initialize (scene: Scene): void {
    this.scene_ref = scene
  }

  /**
   * Set the visibility of the arm planes. Creates them on demand and removes
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
   * Move the planes to a new distance from the center line. The planes are
   * centered on the shoulder joint's height/depth so they sit over the torso.
   *
   * State is stored even when the planes are hidden, so callers can update the
   * position before or after toggling visibility.
   */
  public update_position (plane_x: number, center_y: number, center_z: number): void {
    this.current_plane_x = plane_x
    this.current_center_y = center_y
    this.current_center_z = center_z

    if (this.left_plane_mesh !== null && this.right_plane_mesh !== null) {
      this.left_plane_mesh.position.set(-plane_x, center_y, center_z)
      this.right_plane_mesh.position.set(plane_x, center_y, center_z)
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
      [this.left_plane_mesh, this.right_plane_mesh].forEach((plane_mesh) => {
        if (plane_mesh === null) return
        plane_mesh.geometry.dispose()
        if (plane_mesh.material instanceof MeshBasicMaterial) {
          plane_mesh.material.dispose()
        }
      })

      this.scene_ref.remove(this.plane_group)
    }

    this.plane_group = null
    this.left_plane_mesh = null
    this.right_plane_mesh = null
    this.is_visible = false
  }

  /**
   * Clean up all resources and reset state
   */
  public cleanup (): void {
    this.remove_planes()
    this.scene_ref = null
    this.current_plane_x = 0.0
    this.current_center_y = 0.0
    this.current_center_z = 0.0
    this.is_visible = false
  }

  /**
   * Build the two vertical planes at the currently stored position
   */
  private add_planes (): void {
    if (this.scene_ref === null) {
      throw new Error('ArmPlaneManager not initialized with scene reference')
    }

    this.remove_planes()

    this.plane_group = new Group()
    this.plane_group.name = this.arm_plane_group_name

    this.left_plane_mesh = this.create_plane_mesh('arm_plane_left')
    this.right_plane_mesh = this.create_plane_mesh('arm_plane_right')

    this.plane_group.add(this.left_plane_mesh)
    this.plane_group.add(this.right_plane_mesh)
    this.scene_ref.add(this.plane_group)

    this.is_visible = true

    // apply the stored position to the freshly created meshes
    this.update_position(this.current_plane_x, this.current_center_y, this.current_center_z)
  }

  private create_plane_mesh (name: string): Mesh {
    const geometry = new PlaneGeometry(this.plane_size, this.plane_size)
    const material = new MeshBasicMaterial({
      color: 0x3399ff, // blue, to distinguish from the green head weight correction plane
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
      wireframe: false
    })

    const plane_mesh = new Mesh(geometry, material)
    plane_mesh.name = name

    // rotate so the plane's normal points along X (a vertical wall facing sideways)
    plane_mesh.rotation.y = Math.PI / 2

    return plane_mesh
  }
}
