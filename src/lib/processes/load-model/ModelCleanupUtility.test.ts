import { describe, it, expect } from 'vitest'
import { Box3, BufferGeometry, BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Scene, Vector3 } from 'three'
import { ModelCleanupUtility } from './ModelCleanupUtility'

function make_mesh (name: string, geometry: BufferGeometry = new BoxGeometry(1, 1, 1)): Mesh {
  const mesh = new Mesh(geometry, new MeshStandardMaterial())
  mesh.name = name
  return mesh
}

/** World space bounds of a single mesh's own geometry. */
function mesh_bounds (mesh: Mesh): Box3 {
  mesh.updateMatrixWorld(true)
  mesh.geometry.computeBoundingBox()
  return new Box3().copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
}

describe('ModelCleanupUtility.calculate_mesh_metrics', () => {
  it('counts only complete triangles and keeps triangle_count integral', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(new Array(7 * 3).fill(0), 3))

    expect(ModelCleanupUtility.calculate_mesh_metrics([geometry])).toEqual({
      vertex_count: 7,
      triangle_count: 2,
      objects_count: 1
    })
  })

  it('uses index count for indexed triangle geometry', () => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(new Array(7 * 3).fill(0), 3))
    geometry.setIndex([0, 1, 2, 2, 3, 4, 4, 5, 6, 6])

    expect(ModelCleanupUtility.calculate_mesh_metrics([geometry])).toEqual({
      vertex_count: 7,
      triangle_count: 3,
      objects_count: 1
    })
  })
})

describe('ModelCleanupUtility.bake_transforms_into_geometry', () => {
  it('keeps a mesh where it was, but with an identity transform', () => {
    const scene = new Scene()
    const mesh = make_mesh('head')
    mesh.position.set(0, 5, 0)
    mesh.scale.set(2, 2, 2)
    scene.add(mesh)

    const bounds_before: Box3 = mesh_bounds(mesh)
    ModelCleanupUtility.bake_transforms_into_geometry(scene)
    const bounds_after: Box3 = mesh_bounds(mesh)

    expect(mesh.position.toArray()).toEqual([0, 0, 0])
    expect(mesh.scale.toArray()).toEqual([1, 1, 1])
    expect(bounds_after.min.toArray()).toEqual(bounds_before.min.toArray())
    expect(bounds_after.max.toArray()).toEqual(bounds_before.max.toArray())
  })

  it('bakes a rotation so the mesh keeps facing the same way', () => {
    const scene = new Scene()
    // a plane is 2 wide on X and 4 tall on Y before rotating
    const mesh = make_mesh('banner', new PlaneGeometry(2, 4))
    mesh.rotation.set(Math.PI / 2, 0, 0)
    scene.add(mesh)

    ModelCleanupUtility.bake_transforms_into_geometry(scene)
    const size: Vector3 = mesh_bounds(mesh).getSize(new Vector3())

    expect(mesh.rotation.x).toBeCloseTo(0)
    // rotating 90 degrees about X moves the 4 unit span onto Z
    expect(size.x).toBeCloseTo(2)
    expect(size.y).toBeCloseTo(0)
    expect(size.z).toBeCloseTo(4)
  })

  it('bakes transforms inherited from parent objects', () => {
    const scene = new Scene()
    const group = new Group()
    group.scale.set(10, 10, 10)
    group.position.set(3, 0, 0)
    const mesh = make_mesh('body')
    group.add(mesh)
    scene.add(group)

    ModelCleanupUtility.bake_transforms_into_geometry(scene)
    const bounds: Box3 = mesh_bounds(mesh)

    // scaled to 10 units then offset by the parent, and the parent is cleared too
    expect(group.scale.toArray()).toEqual([1, 1, 1])
    expect(group.position.toArray()).toEqual([0, 0, 0])
    expect(bounds.getSize(new Vector3()).x).toBeCloseTo(10)
    expect(bounds.getCenter(new Vector3()).x).toBeCloseTo(3)
  })

  it('keeps the relative layout of separate parts', () => {
    const scene = new Scene()
    const left = make_mesh('left')
    left.position.set(-4, 0, 0)
    const right = make_mesh('right')
    right.position.set(4, 0, 0)
    scene.add(left, right)

    ModelCleanupUtility.bake_transforms_into_geometry(scene)

    expect(mesh_bounds(left).getCenter(new Vector3()).x).toBeCloseTo(-4)
    expect(mesh_bounds(right).getCenter(new Vector3()).x).toBeCloseTo(4)
  })

  it('does not disturb geometry shared with another mesh', () => {
    const scene = new Scene()
    const shared_geometry = new BoxGeometry(1, 1, 1)
    const first = make_mesh('first', shared_geometry)
    first.position.set(0, 10, 0)
    const second = make_mesh('second', shared_geometry)
    scene.add(first, second)

    ModelCleanupUtility.bake_transforms_into_geometry(scene)

    expect(first.geometry).not.toBe(second.geometry)
    expect(mesh_bounds(first).getCenter(new Vector3()).y).toBeCloseTo(10)
    expect(mesh_bounds(second).getCenter(new Vector3()).y).toBeCloseTo(0)
  })

  it('reverses face winding for a mirrored transform', () => {
    const scene = new Scene()
    const mesh = make_mesh('sword')
    mesh.scale.set(-1, 1, 1)
    scene.add(mesh)

    const original_index = Array.from(mesh.geometry.getIndex()!.array)
    ModelCleanupUtility.bake_transforms_into_geometry(scene)
    const baked_index = Array.from(mesh.geometry.getIndex()!.array)

    // first and last vertex of each triangle swap, so the face points back outward
    expect(baked_index[0]).toBe(original_index[2])
    expect(baked_index[2]).toBe(original_index[0])
    expect(baked_index[1]).toBe(original_index[1])
  })
})

describe('ModelCleanupUtility.strip_out_all_unecessary_model_data', () => {
  it('does not duplicate a mesh that is nested under another mesh', () => {
    const scene = new Scene()
    const parent_mesh = make_mesh('torso')
    parent_mesh.add(make_mesh('arm'))
    scene.add(parent_mesh)

    const stripped = ModelCleanupUtility.strip_out_all_unecessary_model_data(scene, 'Imported Model', false)

    const names: string[] = []
    stripped.traverse((child) => {
      if (child.type === 'Mesh') {
        names.push(child.name)
      }
    })

    expect(names.sort()).toEqual(['arm', 'torso'])
  })
})
