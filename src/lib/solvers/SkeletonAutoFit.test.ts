import { describe, expect, it } from 'vitest'
import { Bone, BufferGeometry, Float32BufferAttribute, Skeleton, Vector3 } from 'three'
import { SkeletonAutoFit } from './SkeletonAutoFit'

/** Create a bone at a world-space position by setting its local offset from a parent. */
function add_bone (name: string, world: [number, number, number], parent: Bone | null): Bone {
  const bone = new Bone()
  bone.name = name
  if (parent === null) {
    bone.position.set(world[0], world[1], world[2])
  } else {
    const parent_world = parent.getWorldPosition(new Vector3())
    bone.position.set(world[0] - parent_world.x, world[1] - parent_world.y, world[2] - parent_world.z)
    parent.add(bone)
    parent.updateMatrixWorld(true)
  }
  bone.updateMatrixWorld(true)
  return bone
}

/**
 * Minimal T-pose-ish biped:
 *   root -> spine -> chest (branch) -> { neck -> head },
 *                                      { shoulderL -> upperarmL -> forearmL -> handL }
 */
function build_biped (): { skeleton: Skeleton, bones: Record<string, Bone> } {
  const root = add_bone('root', [0, 0, 0], null)
  const spine = add_bone('spine', [0, 1, 0], root)
  const chest = add_bone('chest', [0, 2, 0], spine)
  const neck = add_bone('neck', [0, 2.5, 0], chest)
  const head = add_bone('head', [0, 3, 0], neck)
  const shoulderL = add_bone('shoulderL', [0.3, 2, 0], chest)
  const upperarmL = add_bone('upperarmL', [0.6, 2, 0], shoulderL)
  const forearmL = add_bone('forearmL', [1.0, 2, 0], upperarmL)
  const handL = add_bone('handL', [1.4, 2, 0], forearmL)

  root.updateMatrixWorld(true)
  const bones = { root, spine, chest, neck, head, shoulderL, upperarmL, forearmL, handL }
  return { skeleton: new Skeleton(Object.values(bones)), bones }
}

/** Mesh that extends beyond the skeleton: right hand tip at x=2.5, head top at y=4. */
function build_mesh (): BufferGeometry {
  const points = [
    0, 4, 0, // head top
    2.5, 2, 0, // right hand tip
    2.4, 2.05, 0.05, // near the hand tip (cone padding)
    0, 0, 0, // body
    0.2, 1, 0.2,
    0, 2, 0.1,
    0.1, 2.2, 0
  ]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3))
  return geometry
}

describe('SkeletonAutoFit', () => {
  it('stretches limb tips to the mesh extremities', () => {
    const { skeleton, bones } = build_biped()
    const moved = SkeletonAutoFit.fit(skeleton, [build_mesh()])

    // both the arm and the head should have been fitted
    expect(moved).toBe(2)

    // the hand should reach toward the mesh hand tip (x ~ 2.5, up from 1.4)
    const hand_world = bones.handL.getWorldPosition(new Vector3())
    expect(hand_world.x).toBeGreaterThan(2.0)

    // the head should reach toward the mesh head top (y ~ 4, up from 3)
    const head_world = bones.head.getWorldPosition(new Vector3())
    expect(head_world.y).toBeGreaterThan(3.5)
  })

  it('keeps each limb anchor (shoulder/neck) fixed', () => {
    const { skeleton, bones } = build_biped()
    SkeletonAutoFit.fit(skeleton, [build_mesh()])

    // shoulder is the arm anchor and should not move
    const shoulder_world = bones.shoulderL.getWorldPosition(new Vector3())
    expect(shoulder_world.x).toBeCloseTo(0.3, 5)
    expect(shoulder_world.y).toBeCloseTo(2, 5)

    // neck is the head anchor and should not move
    const neck_world = bones.neck.getWorldPosition(new Vector3())
    expect(neck_world.y).toBeCloseTo(2.5, 5)
  })

  it('redistributes intermediate joints monotonically along the limb', () => {
    const { skeleton, bones } = build_biped()
    SkeletonAutoFit.fit(skeleton, [build_mesh()])

    const upper = bones.upperarmL.getWorldPosition(new Vector3()).x
    const fore = bones.forearmL.getWorldPosition(new Vector3()).x
    const hand = bones.handL.getWorldPosition(new Vector3()).x

    // elbow/wrist should remain ordered between shoulder and hand
    expect(upper).toBeGreaterThan(0.3)
    expect(fore).toBeGreaterThan(upper)
    expect(hand).toBeGreaterThan(fore)
  })

  it('returns 0 when there is no mesh geometry', () => {
    const { skeleton } = build_biped()
    expect(SkeletonAutoFit.fit(skeleton, [])).toBe(0)
  })
})
