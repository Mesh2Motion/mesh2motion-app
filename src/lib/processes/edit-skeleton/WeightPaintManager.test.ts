import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Uint16BufferAttribute } from 'three'
import { WeightPaintManager } from './WeightPaintManager'

function rig (): Bone[] {
  const root = new Bone()
  root.name = 'root'
  const head = new Bone()
  head.name = 'head'
  const jaw = new Bone()
  jaw.name = 'face_jaw'
  root.add(head)
  head.add(jaw)
  return [root, head, jaw]
}

function painted_mesh (jaw_weight = 0.5, head_weight = 0.5): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 1, 0], 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([2, 1, 0, 0, 2, 1, 0, 0], 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([jaw_weight, head_weight, 0, 0, jaw_weight, head_weight, 0, 0], 4))
  geometry.setAttribute('color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1], 3))
  return new Mesh(geometry, new MeshBasicMaterial())
}

function override (manager: WeightPaintManager, vertex: number): Map<string, number> {
  const influences = manager.overrides_for_skin().get(0)?.get(vertex) ?? []
  return new Map(influences.map(influence => [influence.bone_name, influence.weight]))
}

function mirror_rig (): Bone[] {
  const root = new Bone()
  root.name = 'root'
  const head = new Bone()
  head.name = 'head'
  const upperarm_l = new Bone()
  upperarm_l.name = 'upperarm_l'
  const upperarm_r = new Bone()
  upperarm_r.name = 'upperarm_r'
  const spine = new Bone()
  spine.name = 'spine_02'
  return [root, head, upperarm_l, upperarm_r, spine]
}

function mirror_mesh (): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0.5, 0, 0, -0.5, 0, 0, 0, 0, 0], 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
  geometry.setAttribute('color', new Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3))
  return new Mesh(geometry, new MeshBasicMaterial())
}

describe('WeightPaintManager', () => {
  it('adds weight to the selected bone and normalises the rest', () => {
    const bones = rig()
    const mesh = painted_mesh(0.25, 0.75)
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'face_jaw', bones, 0.5, 'add')

    const influences = override(manager, 0)
    expect(influences.get('face_jaw')).toBeCloseTo(0.625)
    expect(influences.get('head')).toBeCloseTo(0.375)
    expect([...influences.values()].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1)
    expect(manager.is_vertex_painted(0, 0)).toBe(true)
    expect(manager.is_vertex_painted(0, 1)).toBe(false)
  })

  it('removes weight and hands it to the parent when nothing else is left', () => {
    const bones = rig()
    const mesh = painted_mesh(1, 0)
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'face_jaw', bones, 1, 'subtract')

    const influences = override(manager, 0)
    expect(influences.get('face_jaw')).toBeUndefined()
    expect(influences.get('head')).toBeCloseTo(1)
  })

  it('undoes a whole stroke', () => {
    const bones = rig()
    const mesh = painted_mesh()
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'face_jaw', bones, 1, 'add')
    expect(manager.is_vertex_painted(0, 0)).toBe(true)
    expect(manager.can_undo()).toBe(true)

    manager.undo()
    expect(manager.is_vertex_painted(0, 0)).toBe(false)
    expect(manager.can_undo()).toBe(false)
  })

  it('writes the painted weights into the skin attributes', () => {
    const bones = rig()
    const mesh = painted_mesh(0.5, 0.5)
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'face_jaw', bones, 0.5, 'add')

    const skin_indices = mesh.geometry.attributes.skinIndex.array
    const skin_weights = mesh.geometry.attributes.skinWeight.array
    expect([skin_indices[0], skin_indices[1]]).toEqual([2, 1])
    expect(skin_weights[0]).toBeCloseTo(0.75)
    expect(skin_weights[1]).toBeCloseTo(0.25)
    expect([skin_indices[4], skin_indices[5]]).toEqual([2, 1])
  })

  it('restores skin attributes when a stroke is undone', () => {
    const bones = rig()
    const mesh = painted_mesh(0.5, 0.5)
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'face_jaw', bones, 1, 'add')
    expect(mesh.geometry.attributes.skinWeight.array[0]).toBeCloseTo(1)

    manager.undo()
    expect(mesh.geometry.attributes.skinWeight.array[0]).toBeCloseTo(0.5)
    expect(mesh.geometry.attributes.skinWeight.array[1]).toBeCloseTo(0.5)
  })

  it('clears only strokes made after a marker', () => {
    const bones = rig()
    const mesh = painted_mesh()
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'face_jaw', bones, 1, 'add')
    const marker = manager.undo_stack_marker()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 1, falloff: 1 }], 'face_jaw', bones, 1, 'add')
    expect(manager.is_vertex_painted(0, 1)).toBe(true)
    expect(manager.can_undo_since(marker)).toBe(true)

    manager.clear_strokes_since(marker)
    expect(manager.is_vertex_painted(0, 0)).toBe(true)
    expect(manager.is_vertex_painted(0, 1)).toBe(false)
    expect(manager.can_undo_since(marker)).toBe(false)
    expect(mesh.geometry.attributes.skinWeight.array[4]).toBeCloseTo(0.5)
  })

  it('writes overrides into the skin arrays and skips missing bones', () => {
    const bones = rig()
    const mesh = painted_mesh()
    const manager = new WeightPaintManager()
    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'face_jaw', bones, 1, 'add')

    // second vertex: one influence no longer exists
    manager.overrides_for_skin().get(0)!.set(1, [
      { bone_name: 'removed_bone', weight: 0.5 },
      { bone_name: 'head', weight: 0.5 }
    ])

    const skin_indices = [2, 1, 0, 0, 0, 0, 0, 0]
    const skin_weights = [0.5, 0.5, 0, 0, 1, 0, 0, 0]
    WeightPaintManager.apply_overrides(manager.overrides_for_skin(), 0, bones, skin_indices, skin_weights)

    expect(skin_indices.slice(0, 4)).toEqual([2, 0, 0, 0])
    expect(skin_weights.slice(0, 4)).toEqual([1, 0, 0, 0])
    expect(skin_indices.slice(4, 8)).toEqual([1, 0, 0, 0])
    expect(skin_weights.slice(4, 8)).toEqual([1, 0, 0, 0])
  })

  it('tracks and clears painted vertices', () => {
    const bones = rig()
    const mesh = painted_mesh()
    const manager = new WeightPaintManager()
    expect(manager.has_overrides()).toBe(false)

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }, { vertex_index: 1, falloff: 0.5 }], 'face_jaw', bones, 1, 'add')
    expect(manager.has_overrides()).toBe(true)
    expect(manager.painted_vertex_count()).toBe(2)

    manager.clear()
    expect(manager.has_overrides()).toBe(false)
    expect(manager.painted_vertex_count()).toBe(0)
  })

  it('mirrors side bones onto the matching counterpart bone', () => {
    const bones = mirror_rig()
    const mesh = mirror_mesh()
    const manager = new WeightPaintManager()

    expect(WeightPaintManager.find_mirror_bone_name('upperarm_l', bones)).toBe('upperarm_r')
    expect(WeightPaintManager.bone_side('face_eye_L')).toBe('left')

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'upperarm_l', bones, 1, 'add', true)

    expect(override(manager, 0).get('upperarm_l')).toBeCloseTo(1)
    expect(override(manager, 1).get('upperarm_r')).toBeCloseTo(1)
    expect(mesh.geometry.attributes.skinIndex.array[4]).toBe(3) // mirrored vertex now uses upperarm_r
    expect(mesh.geometry.attributes.skinWeight.array[4]).toBeCloseTo(1)
  })

  it('does not mirror when the option is off', () => {
    const bones = mirror_rig()
    const mesh = mirror_mesh()
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'upperarm_l', bones, 1, 'add', false)

    expect(override(manager, 0).get('upperarm_l')).toBeCloseTo(1)
    expect(manager.is_vertex_painted(0, 1)).toBe(false)
    expect(mesh.geometry.attributes.skinIndex.array[4]).toBe(1) // still head
  })

  it('mirrors center bones onto themselves on both sides', () => {
    const bones = mirror_rig()
    const mesh = mirror_mesh()
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    manager.paint_vertices(mesh, 0, [{ vertex_index: 0, falloff: 1 }], 'spine_02', bones, 1, 'add', true)

    expect(override(manager, 0).get('spine_02')).toBeCloseTo(1)
    expect(override(manager, 1).get('spine_02')).toBeCloseTo(1)
  })

  it('only paints the side that matches a sided bone', () => {
    const bones = mirror_rig()
    const mesh = mirror_mesh()
    const manager = new WeightPaintManager()

    manager.begin_stroke()
    const painted = manager.paint_vertices(mesh, 0, [{ vertex_index: 1, falloff: 1 }], 'upperarm_l', bones, 1, 'add', true)

    expect(painted).toBe(0)
    expect(manager.has_overrides()).toBe(false)
  })
})
