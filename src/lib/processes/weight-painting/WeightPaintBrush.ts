import { MathUtils, Matrix3, Mesh, SkinnedMesh, Triangle, Vector3, type Bone, type BufferGeometry, type Intersection, type PerspectiveCamera } from 'three'
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
  // highest falloff reached per vertex during this stroke; only the increase
  // is applied so a drag builds up weight without stacking at the same spot
  private readonly stroke_falloffs = new Map<string, number>()
  // where the previous dab landed, so fast pointer moves leave no gaps
  private has_last_dab = false
  private readonly last_dab_center = new Vector3()
  private readonly sweep = new Vector3()
  private readonly sweep_offset = new Vector3()
  private readonly sweep_closest = new Vector3()
  // triangle adjacency per geometry, used to spread a dab across the surface
  private readonly adjacency_cache = new WeakMap<BufferGeometry, number[][]>()

  constructor (private readonly manager: WeightPaintManager) {}

  public width_px (): number {
    return this.radius_px * 2
  }

  public begin_stroke (): void {
    this.active_mode = this.mode
    this.stroke_falloffs.clear()
    this.has_last_dab = false
    this.manager.begin_stroke()
  }

  /** @param meshes Finish by normalizing these meshes' influences as well. */
  public finish_stroke (meshes: Mesh[] = []): void {
    if (meshes.length > 0) {
      this.manager.normalize_all_weights(meshes)
    }
    this.manager.finish_stroke()
    this.stroke_falloffs.clear()
    this.has_last_dab = false
  }

  /** Stops the next dab from sweeping across a gap where the pointer left the mesh. */
  public reset_dab_path (): void {
    this.has_last_dab = false
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
    // A dab should paint the surface it lands on even when no vertex happens to
    // sit under the cursor, so seed the touched triangle and its neighbours.
    const surface_falloffs = this.surface_falloffs(object, intersection)

    // Sweep from the previous dab's hit point so fast pointer moves paint a
    // continuous stroke instead of leaving gaps between discrete samples.
    const previous_center = this.has_last_dab ? this.last_dab_center : null
    if (previous_center !== null) {
      this.sweep.subVectors(center, previous_center)
    }
    const sweep_length_sq = previous_center === null ? 0 : this.sweep.lengthSq()
    const has_sweep = sweep_length_sq > 1e-12

    for (let i = 0; i < positions.count; i++) {
      const key = `${geometry_index}:${i}`
      object.getVertexPosition(i, point)
      point.applyMatrix4(object.matrixWorld)

      if (has_sweep && previous_center !== null) {
        this.sweep_offset.copy(point).sub(previous_center)
        const t = Math.min(1, Math.max(0, this.sweep_offset.dot(this.sweep) / sweep_length_sq))
        this.sweep_closest.copy(previous_center).addScaledVector(this.sweep, t)
      } else {
        this.sweep_closest.copy(center)
      }

      const distance = point.distanceTo(this.sweep_closest)
      const surface_falloff = surface_falloffs.get(i) ?? 0
      if (distance > radius && surface_falloff <= 0) { continue }

      if (surface_falloff <= 0) {
        if (is_skinned) {
          // Ignore vertices behind the surface the brush is touching, so the
          // brush cannot paint through the mesh to the far side.
          const depth = point.sub(this.sweep_closest).dot(ray_direction)
          if (depth > radius * 0.5) { continue }
        } else if (normals !== undefined && normal_matrix !== null) {
          // The preview meshes are not deformed, so the surface normal is enough
          // to keep the brush from painting the back of the model.
          normal.fromBufferAttribute(normals, i).applyMatrix3(normal_matrix).normalize()
          if (normal.dot(ray_direction) > -0.05) { continue }
        }
      }

      const t = Math.max(0, 1 - distance / radius)
      const falloff = Math.max(t * t * (3 - 2 * t), surface_falloff)
      // The first dab that reaches a vertex is usually at the brush edge. Only
      // applying the increase lets the stroke keep strengthening that vertex
      // as the brush center passes over it.
      const previous_falloff = this.stroke_falloffs.get(key) ?? 0
      if (falloff <= previous_falloff + 1e-4) { continue }
      this.stroke_falloffs.set(key, falloff)
      vertices.push({ vertex_index: i, falloff: falloff - previous_falloff })
    }

    if (vertices.length === 0) { return false }
    this.has_last_dab = true
    this.last_dab_center.copy(center)

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

  /**
   * Falloff for the triangle under the brush and its immediate neighbours.
   *
   * The barycentric coordinates of the hit point spread the dab across the
   * triangle's three vertices, so painting anywhere on the surface changes the
   * surrounding vertices instead of requiring the cursor to sit on one. Each
   * direct neighbour of those vertices then receives half that influence, which
   * blends the painted patch into the rest of the surface.
   */
  private surface_falloffs (object: Mesh, intersection: Intersection): Map<number, number> {
    const falloffs = new Map<number, number>()
    const face = intersection.face
    const positions = object.geometry.attributes.position
    if (face === undefined || face === null || positions === undefined) { return falloffs }

    const triangle = [face.a, face.b, face.c]
    if (triangle.some(index => index < 0 || index >= positions.count)) { return falloffs }

    const world = triangle.map(index => {
      const vertex = new Vector3()
      object.getVertexPosition(index, vertex)
      return vertex.applyMatrix4(object.matrixWorld)
    })
    const barycentric = Triangle.getBarycoord(intersection.point, world[0], world[1], world[2], new Vector3())
    if (barycentric === null) { return falloffs }

    const influences = [barycentric.x, barycentric.y, barycentric.z]
    for (let i = 0; i < triangle.length; i++) {
      const influence = MathUtils.clamp(influences[i] ?? 0, 0, 1)
      if (influence <= 0) { continue }
      falloffs.set(triangle[i], influence)
    }

    const adjacency = this.adjacency_for(object.geometry)
    for (const index of triangle) {
      const influence = (falloffs.get(index) ?? 0) * 0.5
      if (influence <= 0) { continue }
      for (const neighbour of adjacency[index] ?? []) {
        falloffs.set(neighbour, Math.max(falloffs.get(neighbour) ?? 0, influence))
      }
    }
    return falloffs
  }

  /** Vertex adjacency built from the geometry's triangles, cached per geometry. */
  private adjacency_for (geometry: BufferGeometry): number[][] {
    const cached = this.adjacency_cache.get(geometry)
    if (cached !== undefined) { return cached }

    const positions = geometry.attributes.position
    const vertex_count = positions?.count ?? 0
    const neighbours: Array<Set<number>> = Array.from({ length: vertex_count }, () => new Set<number>())
    const index = geometry.getIndex()
    const triangle_count = Math.floor((index !== null ? index.count : vertex_count) / 3)

    for (let triangle = 0; triangle < triangle_count; triangle++) {
      const a = index !== null ? index.getX(triangle * 3) : triangle * 3
      const b = index !== null ? index.getX(triangle * 3 + 1) : triangle * 3 + 1
      const c = index !== null ? index.getX(triangle * 3 + 2) : triangle * 3 + 2
      neighbours[a]?.add(b)
      neighbours[a]?.add(c)
      neighbours[b]?.add(a)
      neighbours[b]?.add(c)
      neighbours[c]?.add(a)
      neighbours[c]?.add(b)
    }

    const adjacency = neighbours.map(set => [...set])
    this.adjacency_cache.set(geometry, adjacency)
    return adjacency
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
