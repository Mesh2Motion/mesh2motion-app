import { Bone, Group, Matrix4, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { CustomSkeletonHelper } from './CustomSkeletonHelper'

describe('CustomSkeletonHelper initial render', () => {
  it('keeps instanced bone geometry hidden until the first live update', () => {
    const rig = new Group()
    const root = new Bone()
    const child = new Bone()
    child.position.y = 1
    root.add(child)
    rig.add(root)

    const helper = new CustomSkeletonHelper(rig, { showJoints: false })
    try {
      expect(helper.count).toBe(1)
      const matrix = new Matrix4()
      helper.getMatrixAt(0, matrix)
      const scale = new Vector3().setFromMatrixScale(matrix)
      expect(scale.toArray()).toEqual([0, 0, 0])
    } finally {
      helper.dispose()
    }
  })
})
