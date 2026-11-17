import { describe, expect, it } from 'vitest'
import {
  BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, PerspectiveCamera,
  PlaneGeometry, Vector3, type Intersection
} from 'three'
import { WeightPaintBrush } from './WeightPaintBrush'
import { WeightPaintManager, type BrushVertex } from './WeightPaintManager'

class RecordingManager {
  public readonly calls: BrushVertex[][] = []

  public begin_stroke (): void {}
  public finish_stroke (): void {}
  public normalize_all_weights (): void {}

  public paint_vertices (
    _mesh: Mesh,
    _geometry_index: number,
    vertices: BrushVertex[]
  ): number {
    this.calls.push(vertices.map(vertex => ({ ...vertex })))
    return vertices.length
  }
}

interface BrushScene {
  brush: WeightPaintBrush
  manager: RecordingManager
  mesh: Mesh
  camera: PerspectiveCamera
  positions: Mesh['geometry']['attributes']['position']
}

function brush_scene (): BrushScene {
  const manager = new RecordingManager()
  const brush = new WeightPaintBrush(manager as unknown as WeightPaintManager)
  // a fixed world-space radius keeps the test independent of the viewport size
  brush.world_radius = () => 1

  const geometry = new PlaneGeometry(10, 10, 20, 20)
  const mesh = new Mesh(geometry, new MeshBasicMaterial())
  mesh.userData.geometry_index = 0
  mesh.updateMatrixWorld(true)

  const camera = new PerspectiveCamera(50, 1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)

  return { brush, manager, mesh, camera, positions: geometry.attributes.position }
}

function dab (scene: BrushScene, x: number): boolean {
  const intersection = { object: scene.mesh, point: new Vector3(x, 0, 0) } as unknown as Intersection
  return scene.brush.paint(intersection, scene.camera, 'head', [])
}

function vertex_index_at (scene: BrushScene, x: number, y: number): number {
  for (let i = 0; i < scene.positions.count; i++) {
    if (Math.abs(scene.positions.getX(i) - x) < 1e-6 &&
      Math.abs(scene.positions.getY(i) - y) < 1e-6) {
      return i
    }
  }
  throw new Error(`no vertex at ${x}, ${y}`)
}

function falloff_of (vertices: BrushVertex[], vertex_index: number): number | undefined {
  return vertices.find(vertex => vertex.vertex_index === vertex_index)?.falloff
}

describe('WeightPaintBrush', () => {
  it('sweeps between dabs so a fast drag paints a continuous stroke', () => {
    const scene = brush_scene()
    const middle = vertex_index_at(scene, 1, 0)

    scene.brush.begin_stroke()
    expect(dab(scene, 0)).toBe(true)
    expect(falloff_of(scene.manager.calls[0], middle)).toBeUndefined()

    // without sweeping, the vertex between the two dabs would be left unpainted
    expect(dab(scene, 2)).toBe(true)
    expect(scene.manager.calls).toHaveLength(2)
    expect(falloff_of(scene.manager.calls[1], middle)).toBeGreaterThan(0.9)
  })

  it('only applies the falloff increase during a stroke', () => {
    const scene = brush_scene()
    const center = vertex_index_at(scene, 1, 0)

    scene.brush.begin_stroke()
    dab(scene, 0)
    dab(scene, 1)
    expect(falloff_of(scene.manager.calls[1], center)).toBeGreaterThan(0.9)

    // the vertex already reached full falloff during this stroke, so a dab on
    // top of it must not stack another helping of weight
    expect(dab(scene, 1)).toBe(false)
    expect(scene.manager.calls).toHaveLength(2)
  })

  it('does not sweep across the gap after leaving the mesh', () => {
    const scene = brush_scene()

    scene.brush.begin_stroke()
    dab(scene, -4)
    scene.brush.reset_dab_path()
    dab(scene, 4)

    expect(scene.manager.calls).toHaveLength(2)
    const painted_x = scene.manager.calls[1].map(vertex => scene.positions.getX(vertex.vertex_index))
    expect(painted_x.length).toBeGreaterThan(0)
    expect(painted_x.every(x => Math.abs(x - 4) <= 1.000001)).toBe(true)
    expect(painted_x.some(x => Math.abs(x) < 3)).toBe(false)
  })

  it('distributes a dab across the touched triangle and its neighbours', () => {
    const manager = new RecordingManager()
    const brush = new WeightPaintBrush(manager as unknown as WeightPaintManager)
    // a tiny radius proves the paint comes from the surface hit, not a vertex
    // that happens to fall inside the brush
    brush.world_radius = () => 0.0001

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      1, 1, 0
    ], 3))
    geometry.setIndex([0, 1, 2, 2, 1, 3])
    const mesh = new Mesh(geometry, new MeshBasicMaterial())
    mesh.userData.geometry_index = 0
    mesh.updateMatrixWorld(true)

    const camera = new PerspectiveCamera(50, 1, 0.1, 100)
    camera.position.set(0, 0, 5)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld(true)

    const intersection = {
      object: mesh,
      point: new Vector3(1 / 3, 1 / 3, 0),
      face: { a: 0, b: 1, c: 2, normal: new Vector3(0, 0, 1), materialIndex: 0 }
    } as unknown as Intersection

    brush.begin_stroke()
    expect(brush.paint(intersection, camera, 'head', [])).toBe(true)

    const painted = new Map(manager.calls[0].map(vertex => [vertex.vertex_index, vertex.falloff]))
    expect(painted.get(0)).toBeCloseTo(1 / 3, 2)
    expect(painted.get(1)).toBeCloseTo(1 / 3, 2)
    expect(painted.get(2)).toBeCloseTo(1 / 3, 2)
    // vertex 3 shares an edge with the touched triangle, so it gets half
    expect(painted.get(3)).toBeCloseTo(1 / 6, 2)
  })
})
