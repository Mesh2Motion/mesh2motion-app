import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'

import {
  apply_mesh_centerline_target,
  blend_target_with_snap_vertex,
  calculate_vertex_snap_influence,
  is_centerline_mesh_snap_bone_name
} from './MeshDragBonePlacement.ts'

describe('MeshDragBonePlacement', () => {
  it('maps snap strength from 0 to 20 into a 0 to 1 blend factor', () => {
    expect(calculate_vertex_snap_influence(0)).toBe(0)
    expect(calculate_vertex_snap_influence(10)).toBe(0.5)
    expect(calculate_vertex_snap_influence(20)).toBe(1)
  })

  it('blends the target position toward the snap vertex based on strength', () => {
    const midpoint = new Vector3(0, 0, 0)
    const snap_vertex = new Vector3(10, 0, 0)

    expect(blend_target_with_snap_vertex(midpoint, snap_vertex, 0).toArray()).toEqual([0, 0, 0])
    expect(blend_target_with_snap_vertex(midpoint, snap_vertex, 10).toArray()).toEqual([5, 0, 0])
    expect(blend_target_with_snap_vertex(midpoint, snap_vertex, 20).toArray()).toEqual([10, 0, 0])
  })

  it('identifies center-line torso and head bones for mesh centering', () => {
    expect(is_centerline_mesh_snap_bone_name('Pelvis')).toBe(true)
    expect(is_centerline_mesh_snap_bone_name('Spine2')).toBe(true)
    expect(is_centerline_mesh_snap_bone_name('Neck')).toBe(true)
    expect(is_centerline_mesh_snap_bone_name('Head')).toBe(true)
    expect(is_centerline_mesh_snap_bone_name('LeftHead')).toBe(false)
    expect(is_centerline_mesh_snap_bone_name('RightShoulder')).toBe(false)
  })

  it('keeps the clicked height while snapping torso bones onto the mesh centerline', () => {
    const target = new Vector3(1.25, 1.8, -0.35)

    expect(apply_mesh_centerline_target(target, 0.1, 0.05).toArray()).toEqual([0.1, 1.8, 0.05])
  })
})