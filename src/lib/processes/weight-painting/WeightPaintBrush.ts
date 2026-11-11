import { MathUtils, Matrix3, Mesh, SkinnedMesh, Vector3, type Bone, type Intersection, type PerspectiveCamera } from 'three'
import { WeightPaintManager, type BrushVertex, type WeightPaintMode } from './WeightPaintManager.ts'

/**
 * Shared brush mechanics for the paint tools in the Position Joints step and
 * the optional weight painting step.
 *
 * The brush size is measured in CSS pixels, so both the painted area and the
 * on-screen outline stay the same size no matter how far the camera is zoomed.
 */
export class WeightPaintBrush {
  public radius_px = 24
  public strength = 0.5
  public mode: WeightPaintMode = 'add'
  public mirror_enabled = true

  private active_mode: WeightPaintMode = 'add'
  private readonly touched_vertices = new Set<string>()

  constructor (private readonly manager: WeightPaintManager) {}

  public width_px (): number {
    return this.radius_px * 2
  }

  public begin_stroke (): void {
    this.active_mode = this.mode
    this.touched_vertices.clear()
    this.manager.begin_stroke()
  }

  /** @param meshes Finish by normalizing these meshes' influences as well. */
  public finish_stroke (meshes: Mesh[] = []): void {
    if (meshes.length > 0) {
      this.manager.normalize_all_weights(meshes)
    }
    this.manager.finish_stroke()
    this.touched_vertices.clear()
  }

  /**
   * Paints the selected bone (or smooths) on the mesh under the raycast hit.
   * @returns true when at least one vertex changed
   */
  public paint (
    intersection: Intersection,
    camera: PerspectiveCamera,
    bone_name: string,
    fallback_bones?: Bone[]
  ): boolean {
    const object = intersection.object
    if (!(object instanceof Mesh)) { return false }

    const is_skinned = object instanceof SkinnedMesh
    const bones = is_skinned ? object.skeleton.bones : fallback_bones
    if (bones === undefined) { return false }

    let geometry_index: number
    if (typeof object.userData.geometry_index === 'number') {
      geometry_index = object.userData.geometry_index as number
    } else if (is_skinned) {
      geometry_index = -object.id
    } else {
      // preview meshes must map back to the geometry index used for overrides
      return false
    }

    const positions = object.geometry.attributes.position
    if (positions === undefined) { return false }

    object.updateWorldMatrix(true, false)
    const center = intersection.point.clone()
    const radius = this.world_radius(camera, center)
    if (radius <= 0) { return false }

    const normals = object.geometry.attributes.normal
    const normal_matrix = is_skinned ? null : new Matrix3().getNormalMatrix(object.matrixWorld)
    const ray_direction = center.clone().sub(camera.position).normalize()
    const point = new Vector3()
    const normal = new Vector3()
    const vertices: BrushVertex[] = []

    for (let i = 0; i < positions.count; i++) {
      const key = `${geometry_index}:${i}`
      if (this.touched_vertices.has(key)) { continue }

      object.getVertexPosition(i, point)
      point.applyMatrix4(object.matrixWorld)
      const distance = point.distanceTo(center)
      if (distance > radius) { continue }

      if (is_skinned) {
        // Ignore vertices behind the surface the brush is touching, so the
        // brush cannot paint through the mesh to the far side.
        const depth = point.sub(center).dot(ray_direction)
        if (depth > radius * 0.5) { continue }
      } else if (normals !== undefined && normal_matrix !== null) {
        // The preview meshes are not deformed, so the surface normal is enough
        // to keep the brush from painting the back of the model.
        normal.fromBufferAttribute(normals, i).applyMatrix3(normal_matrix).normalize()
        if (normal.dot(ray_direction) > -0.05) { continue }
      }

      const t = 1 - distance / radius
      vertices.push({ vertex_index: i, falloff: t * t * (3 - 2 * t) })
      this.touched_vertices.add(key)
    }

    if (vertices.length === 0) { return false }

    const painted_count = this.manager.paint_vertices(
      object,
      geometry_index,
      vertices,
      bone_name,
      bones,
      this.strength,
      this.active_mode,
      this.mirror_enabled
    )
    return painted_count > 0
  }

  /** World-space brush radius at a surface point, derived from the pixel size. */
  public world_radius (camera: PerspectiveCamera, point: Vector3): number {
    const forward = camera.getWorldDirection(new Vector3())
    const depth = point.clone().sub(camera.position).dot(forward)
    if (depth <= 0) { return 0 }

    const viewport_height = Math.max(1, window.innerHeight)
    const world_per_pixel = 2 * depth * Math.tan(MathUtils.degToRad(camera.fov) / 2) / viewport_height
    return this.radius_px * world_per_pixel
  }
}
