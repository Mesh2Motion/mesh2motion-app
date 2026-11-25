/**
 * M2M-030A — rig-relative six-camera geometry (pure, no renderer dependency).
 *
 * The visible orbit camera is never touched. These cameras exist only as values
 * used by the offscreen capture transaction. Framing and orientation are derived
 * from the actual live skeleton so imported FBX/GLB models are not assumed to
 * face a fixed world direction.
 */

import {
  Box3,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  type Bone,
  type Camera,
  type Skeleton
} from 'three'
import type { CameraMetadata, ObservationProjection, ObservationView, ProjectedJoint } from './types'

export interface RigFrame {
  up: Vector3
  right: Vector3
  forward: Vector3
}

const WORLD_UP = new Vector3(0, 1, 0)
const WORLD_RIGHT = new Vector3(1, 0, 0)
const WORLD_FORWARD = new Vector3(0, 0, 1)

function world_position (bone: Bone): Vector3 {
  return bone.getWorldPosition(new Vector3())
}

function find_bone (skeleton: Skeleton, pattern: RegExp): Bone | undefined {
  return skeleton.bones.find((bone) => pattern.test(bone.name))
}

function perpendicular_to (candidate: Vector3, reference: Vector3): Vector3 {
  const projected = candidate.clone().addScaledVector(reference, -candidate.dot(reference))
  if (projected.lengthSq() > 1e-10) return projected.normalize()
  const fallback = WORLD_RIGHT.clone().addScaledVector(reference, -WORLD_RIGHT.dot(reference))
  if (fallback.lengthSq() > 1e-10) return fallback.normalize()
  return new Vector3().crossVectors(reference, WORLD_FORWARD).normalize()
}

/**
 * Derive an orthonormal frame from the rig itself.
 *
 * Up comes from the pelvis→head chain; right comes from the left/right arm pair.
 * World axes are used only as a last-resort fallback when a rig has no usable
 * symmetric bones (a non-Humanoid rig), never as an unconditional assumption.
 */
export function rig_frame (skeleton: Skeleton): RigFrame {
  const root = find_bone(skeleton, /pelvis|hips|root/i) ?? skeleton.bones[0]
  const head = find_bone(skeleton, /head/i) ?? skeleton.bones[skeleton.bones.length - 1]
  const up = new Vector3()
  if (root !== undefined && head !== undefined && root !== head) {
    up.subVectors(world_position(head), world_position(root))
  }
  if (up.lengthSq() < 1e-10) up.copy(WORLD_UP)
  up.normalize()

  const left = find_bone(skeleton, /(upperarm|shoulder|arm|wing)[_\s-]?(l|left)\b/i)
  const right = find_bone(skeleton, /(upperarm|shoulder|arm|wing)[_\s-]?(r|right)\b/i)
  let right_axis = new Vector3()
  if (left !== undefined && right !== undefined && left !== right) {
    right_axis.subVectors(world_position(right), world_position(left))
  }
  if (right_axis.lengthSq() < 1e-10) right_axis = perpendicular_to(WORLD_RIGHT, up)
  right_axis = perpendicular_to(right_axis, up)

  const forward = new Vector3().crossVectors(right_axis, up).normalize()
  // Re-orthogonalise the right axis against the final up/forward pair.
  right_axis = new Vector3().crossVectors(up, forward).normalize()
  return { up, right: right_axis, forward }
}

/** Box3 over evaluated bone world positions. Returns null for an empty rig. */
export function posed_bone_bounds (skeleton: Skeleton, indices?: readonly number[]): Box3 | null {
  const bounds = new Box3()
  const bones = indices === undefined
    ? skeleton.bones
    : indices.map((index) => skeleton.bones[index]).filter((bone): bone is Bone => bone !== undefined)
  for (const bone of bones) bounds.expandByPoint(world_position(bone))
  return bounds.isEmpty() ? null : bounds
}

/** All descendants of a bone, including the bone itself. */
export function bone_group_indices (skeleton: Skeleton, root_index: number): number[] {
  if (root_index < 0 || root_index >= skeleton.bones.length) return []
  const result: number[] = []
  const visit = (index: number): void => {
    result.push(index)
    for (let child = 0; child < skeleton.bones.length; child++) {
      if (skeleton.bones[child].parent === skeleton.bones[index]) visit(child)
    }
  }
  visit(root_index)
  return result
}

export interface Framing {
  center: Vector3
  bounds: Box3
  frame: RigFrame
  /** Half extent measured along the camera's right/up axes. */
  half_width: number
  half_height: number
  depth_extent: number
  diagonal: number
}

/**
 * Compute a deterministic framing from the evaluated pose. `indices` narrows the
 * framing to a focus group (hand, foot, finger chain); undefined frames the model.
 */
export function compute_framing (
  skeleton: Skeleton,
  width: number,
  height: number,
  indices?: readonly number[]
): Framing | null {
  const bounds = posed_bone_bounds(skeleton, indices)
  if (bounds === null) return null
  const frame = rig_frame(skeleton)
  const center = bounds.getCenter(new Vector3())
  const size = bounds.getSize(new Vector3())
  const diagonal = Math.max(size.length(), 1e-3)

  const corners: Vector3[] = []
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new Vector3(x, y, z))
    }
  }
  let half_width = 0
  let half_height = 0
  let depth_extent = 0
  for (const corner of corners) {
    const delta = corner.sub(center)
    half_width = Math.max(half_width, Math.abs(delta.dot(frame.right)))
    half_height = Math.max(half_height, Math.abs(delta.dot(frame.up)))
    depth_extent = Math.max(depth_extent, Math.abs(delta.dot(frame.forward)))
  }
  const margin = Math.max(diagonal * 0.12, 0.05)
  half_width += margin
  half_height += margin
  return { center, bounds, frame, half_width, half_height, depth_extent, diagonal }
}

/** View direction and explicit up vector for each of the six cameras. */
export function view_basis (view: ObservationView, frame: RigFrame): { offset: Vector3, up: Vector3 } {
  switch (view) {
    case 'front': return { offset: frame.forward.clone(), up: frame.up.clone() }
    case 'back': return { offset: frame.forward.clone().negate(), up: frame.up.clone() }
    case 'left': return { offset: frame.right.clone().negate(), up: frame.up.clone() }
    case 'right': return { offset: frame.right.clone(), up: frame.up.clone() }
    // Top/bottom need explicit non-degenerate up vectors; using frame.up would
    // make lookAt degenerate because it is parallel to the view direction.
    case 'top': return { offset: frame.up.clone(), up: frame.forward.clone().negate() }
    case 'bottom': return { offset: frame.up.clone().negate(), up: frame.forward.clone() }
  }
}

export interface ObservationCameraOptions {
  view: ObservationView
  framing: Framing
  width: number
  height: number
  projection: ObservationProjection
}

/** Build one camera. The camera is never added to a scene by this module. */
export function create_observation_camera (options: ObservationCameraOptions): Camera {
  const { view, framing, width, height, projection } = options
  const aspect = width / height
  const basis = view_basis(view, framing.frame)
  const distance = framing.diagonal * 2 + framing.depth_extent + 0.1
  const position = framing.center.clone().addScaledVector(basis.offset, distance)

  let camera: Camera
  if (projection === 'orthographic') {
    const half_height = Math.max(framing.half_height, framing.half_width / aspect, 1e-3)
    const half_width = half_height * aspect
    camera = new OrthographicCamera(
      -half_width, half_width, half_height, -half_height, 0.01, distance + framing.diagonal * 2
    )
  } else {
    const fov = 40
    const fit_height = framing.half_height / Math.tan((fov * Math.PI) / 360)
    const fit_width = framing.half_width / (Math.tan((fov * Math.PI) / 360) * aspect)
    const perspective_distance = Math.max(fit_height, fit_width) + framing.depth_extent + 0.1
    const adjusted = framing.center.clone().addScaledVector(basis.offset, perspective_distance)
    camera = new PerspectiveCamera(fov, aspect, 0.01, perspective_distance + framing.diagonal * 2)
    position.copy(adjusted)
  }
  camera.position.copy(position)
  camera.up.copy(basis.up)
  camera.lookAt(framing.center)
  if (camera instanceof OrthographicCamera || camera instanceof PerspectiveCamera) camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  return camera
}

function elements (matrix: { elements: ArrayLike<number> }): number[] {
  return Array.from(matrix.elements)
}

/** Deterministic metadata for MCP projection and geometric observations. */
export function camera_metadata (camera: Camera, projection: ObservationProjection): CameraMetadata {
  camera.updateMatrixWorld(true)
  const target = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position)
  const metadata: CameraMetadata = {
    projection,
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
    up: [camera.up.x, camera.up.y, camera.up.z],
    near: (camera as OrthographicCamera).near,
    far: (camera as OrthographicCamera).far,
    view_matrix: elements(camera.matrixWorldInverse),
    projection_matrix: elements(camera.projectionMatrix)
  }
  if (camera instanceof OrthographicCamera) {
    metadata.left = camera.left
    metadata.right = camera.right
    metadata.top = camera.top
    metadata.bottom = camera.bottom
  } else if (camera instanceof PerspectiveCamera) {
    metadata.fov_degrees = camera.fov
    metadata.aspect = camera.aspect
  }
  return metadata
}

/**
 * Project a world-space joint into normalised image coordinates using the
 * camera matrices returned to MCP. No geometry is invented or inferred.
 */
export function project_joint (
  world: Vector3,
  camera: Camera,
  occlusion: ProjectedJoint['occlusion'],
  reason?: ProjectedJoint['reason']
): ProjectedJoint {
  camera.updateMatrixWorld(true)
  const view_position = world.clone().applyMatrix4(camera.matrixWorldInverse)
  const depth = -view_position.z
  const ndc = world.clone().project(camera)
  const u = (ndc.x + 1) / 2
  const v = (1 - ndc.y) / 2
  const near = (camera as OrthographicCamera).near
  const far = (camera as OrthographicCamera).far
  const in_frame = u >= 0 && u <= 1 && v >= 0 && v <= 1 && depth >= near && depth <= far && Number.isFinite(depth)
  return {
    u,
    v,
    depth,
    in_frame,
    visible: in_frame && occlusion === 'none',
    occlusion,
    reason: in_frame ? reason : 'off_frame'
  }
}
