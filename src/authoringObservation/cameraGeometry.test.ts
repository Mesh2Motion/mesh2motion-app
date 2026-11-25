import { describe, expect, it } from 'vitest'
import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three'
import {
  bone_group_indices,
  camera_metadata,
  compute_framing,
  create_observation_camera,
  posed_bone_bounds,
  project_joint,
  rig_frame,
  view_basis
} from './cameraGeometry'
import { OBSERVATION_VIEWS, type ObservationView } from './types'
import { make_test_rig } from './testFixtures'

describe('six observation cameras', () => {
  it('constructs all six supported views as orthographic cameras by default', () => {
    const { skeleton } = make_test_rig()
    const framing = compute_framing(skeleton, 512, 512)
    expect(framing).not.toBeNull()
    for (const view of OBSERVATION_VIEWS) {
      const camera = create_observation_camera({ view, framing: framing!, width: 512, height: 512, projection: 'orthographic' })
      expect(camera).toBeInstanceOf(OrthographicCamera)
      expect(camera.position.length()).toBeGreaterThan(0)
    }
  })

  it('uses explicit non-degenerate up vectors for top and bottom', () => {
    const { skeleton } = make_test_rig()
    const frame = rig_frame(skeleton)
    const top = view_basis('top', frame)
    const bottom = view_basis('bottom', frame)
    expect(Math.abs(top.offset.dot(top.up))).toBeLessThan(1e-6)
    expect(Math.abs(bottom.offset.dot(bottom.up))).toBeLessThan(1e-6)
    expect(top.up.dot(bottom.up)).toBeCloseTo(-1, 6)
    expect(top.up.dot(frame.forward)).toBeCloseTo(-1, 6)
    expect(bottom.up.dot(frame.forward)).toBeCloseTo(1, 6)
  })

  it('places front/back, left/right on opposite sides of the rig frame', () => {
    const { skeleton } = make_test_rig()
    const frame = rig_frame(skeleton)
    const front = view_basis('front', frame).offset
    const back = view_basis('back', frame).offset
    const left = view_basis('left', frame).offset
    const right = view_basis('right', frame).offset
    expect(front.dot(back)).toBeCloseTo(-1, 6)
    expect(left.dot(right)).toBeCloseTo(-1, 6)
    expect(Math.abs(front.dot(right))).toBeLessThan(1e-6)
  })

  it('derives orientation from the rig instead of assuming a world direction', () => {
    const { skeleton, scene } = make_test_rig()
    scene.rotation.y = Math.PI / 2
    scene.updateMatrixWorld(true)
    skeleton.bones.forEach((bone) => bone.updateWorldMatrix(true, false))
    const frame = rig_frame(skeleton)
    // With the rig rotated, its forward axis is no longer world +Z.
    expect(Math.abs(frame.forward.dot(new Vector3(0, 0, 1)))).toBeLessThan(0.2)
    expect(frame.forward.length()).toBeCloseTo(1, 6)
    expect(frame.up.dot(frame.forward)).toBeCloseTo(0, 6)
  })

  it('frames the whole posed skeleton and narrows to a focus group', () => {
    const { skeleton, by_name } = make_test_rig()
    const whole = posed_bone_bounds(skeleton)
    expect(whole).not.toBeNull()
    expect(whole!.isEmpty()).toBe(false)
    const hand_index = skeleton.bones.indexOf(by_name.get('hand_r')!)
    const group = bone_group_indices(skeleton, hand_index)
    expect(group).toEqual([hand_index, group[1]])
    const focus = compute_framing(skeleton, 512, 512, group)
    expect(focus).not.toBeNull()
    expect(focus!.diagonal).toBeLessThan(whole!.getSize(new Vector3()).length())
  })

  it('writes column-major matrices and aspect-correct orthographic bounds', () => {
    const { skeleton } = make_test_rig()
    const framing = compute_framing(skeleton, 800, 400)!
    const camera = create_observation_camera({ view: 'front', framing, width: 800, height: 400, projection: 'orthographic' }) as OrthographicCamera
    const metadata = camera_metadata(camera, 'orthographic')
    expect(metadata.view_matrix).toHaveLength(16)
    expect(metadata.projection_matrix).toHaveLength(16)
    expect((camera.right - camera.left) / (camera.top - camera.bottom)).toBeCloseTo(2, 6)
    expect(metadata.left).toBe(camera.left)
    expect(metadata.up[1]).toBeGreaterThan(0.9)
  })

  it('supports perspective projection with an explicit fov', () => {
    const { skeleton } = make_test_rig()
    const framing = compute_framing(skeleton, 512, 512)!
    const camera = create_observation_camera({ view: 'right', framing, width: 512, height: 512, projection: 'perspective' }) as PerspectiveCamera
    const metadata = camera_metadata(camera, 'perspective')
    expect(camera).toBeInstanceOf(PerspectiveCamera)
    expect(metadata.fov_degrees).toBe(40)
    expect(metadata.aspect).toBe(1)
  })

  it('projects world joints into normalised image coordinates', () => {
    const { skeleton, by_name } = make_test_rig()
    const framing = compute_framing(skeleton, 256, 256)!
    const camera = create_observation_camera({ view: 'front', framing, width: 256, height: 256, projection: 'orthographic' })
    const head = by_name.get('head')!.getWorldPosition(new Vector3())
    const projection = project_joint(head, camera, 'none')
    expect(projection.in_frame).toBe(true)
    expect(projection.visible).toBe(true)
    expect(projection.u).toBeGreaterThanOrEqual(0)
    expect(projection.u).toBeLessThanOrEqual(1)
    expect(projection.v).toBeGreaterThanOrEqual(0)
    expect(projection.v).toBeLessThanOrEqual(1)
    const far_away = project_joint(new Vector3(100, 100, 100), camera, 'none')
    expect(far_away.in_frame).toBe(false)
    expect(far_away.visible).toBe(false)
  })

  it('marks occluded joints as not visible and never fabricates geometry', () => {
    const { skeleton, by_name } = make_test_rig()
    const framing = compute_framing(skeleton, 256, 256)!
    const camera = create_observation_camera({ view: 'front', framing, width: 256, height: 256, projection: 'orthographic' })
    const head = by_name.get('head')!.getWorldPosition(new Vector3())
    const occluded = project_joint(head, camera, 'self', 'occluded')
    expect(occluded.visible).toBe(false)
    expect(occluded.occlusion).toBe('self')
    const unknown = project_joint(head, camera, 'unknown', 'no_geometry')
    expect(unknown.visible).toBe(false)
    expect(unknown.occlusion).toBe('unknown')
  })

  it('accepts every view name from the frozen contract', () => {
    expect(OBSERVATION_VIEWS).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom'])
    const as_view = (value: ObservationView): ObservationView => value
    expect(as_view('bottom')).toBe('bottom')
  })
})
