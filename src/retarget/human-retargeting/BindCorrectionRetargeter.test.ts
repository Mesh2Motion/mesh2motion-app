import { describe, it, expect } from 'vitest'
import { AnimationClip, Bone, Quaternion, QuaternionKeyframeTrack, Skeleton, Vector3, VectorKeyframeTrack } from 'three'
import { BindCorrectionRetargeter, type BindCorrection } from './BindCorrectionRetargeter.ts'

function create_two_bone_skeleton (rootQ: Quaternion, childQ: Quaternion): Skeleton {
  const root = new Bone()
  root.name = 'Root'
  root.quaternion.copy(rootQ)
  const child = new Bone()
  child.name = 'Child'
  child.position.set(0, 1, 0)
  child.quaternion.copy(childQ)
  root.add(child)
  root.updateMatrixWorld(true)
  return new Skeleton([root, child])
}

describe('BindCorrectionRetargeter', () => {
  describe('compute_bind_corrections', () => {
    it('returns empty map when source and target rest poses are identical', () => {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)
      const cq = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6)
      const source = create_two_bone_skeleton(q.clone(), cq.clone())
      const target = create_two_bone_skeleton(q.clone(), cq.clone())
      const mapping = new Map([['Root', 'Root'], ['Child', 'Child']])

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(source, target, mapping)

      expect(corrections.size).toBe(0)
    })

    it('produces non-identity corrections when rest poses differ', () => {
      const source_root_q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)
      const source_child_q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6)
      const target_root_q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3)
      const target_child_q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 4)

      const source = create_two_bone_skeleton(source_root_q, source_child_q)
      const target = create_two_bone_skeleton(target_root_q, target_child_q)
      const mapping = new Map([['Root', 'Root'], ['Child', 'Child']])

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(source, target, mapping)

      expect(corrections.size).toBeGreaterThan(0)

      const child_corr = corrections.get('Child')
      expect(child_corr).toBeDefined()
      expect(child_corr!.L !== null || child_corr!.R !== null).toBe(true)
    })
  })

  describe('retarget', () => {
    it('renames tracks without modifying values when corrections are empty', () => {
      const times = new Float32Array([0, 1])
      const qvals = new Float32Array([0, 0, 0, 1, 0.707, 0, 0, 0.707])
      const source_clip = new AnimationClip('test', 1, [
        new QuaternionKeyframeTrack('pelvis.quaternion', times, qvals)
      ])
      const corrections = new Map<string, BindCorrection>()
      const mapping = new Map([['Hips', 'pelvis']])

      const result = BindCorrectionRetargeter.retarget(source_clip, corrections, mapping, {
        hip_scale: 1,
        root_correction_quat: null,
        position_bone_name: 'pelvis'
      })

      expect(result.tracks.length).toBe(1)
      expect(result.tracks[0].name).toBe('Hips.quaternion')

      for (let i = 0; i < qvals.length; i++) {
        expect((result.tracks[0] as QuaternionKeyframeTrack).values[i]).toBeCloseTo(qvals[i], 5)
      }
    })

    it('applies L/R corrections to quaternion keyframes', () => {
      const times = new Float32Array([0])
      const identity_q = new Float32Array([0, 0, 0, 1])
      const source_clip = new AnimationClip('test', 0, [
        new QuaternionKeyframeTrack('pelvis.quaternion', times, identity_q)
      ])

      const L = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
      const R = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)
      const corrections = new Map<string, BindCorrection>([
        ['Hips', { L, R }]
      ])
      const mapping = new Map([['Hips', 'pelvis']])

      const result = BindCorrectionRetargeter.retarget(source_clip, corrections, mapping, {
        hip_scale: 1,
        root_correction_quat: null,
        position_bone_name: 'pelvis'
      })

      const expected = L.clone().multiply(R)
      const actual = new Quaternion(
        result.tracks[0].values[0],
        result.tracks[0].values[1],
        result.tracks[0].values[2],
        result.tracks[0].values[3]
      )

      expect(actual.angleTo(expected)).toBeLessThan(1e-5)
    })

    it('scales and rotates hip position track', () => {
      const times = new Float32Array([0])
      const pos_vals = new Float32Array([1, 2, 3])
      const source_clip = new AnimationClip('test', 0, [
        new VectorKeyframeTrack('pelvis.position', times, pos_vals)
      ])

      const corrections = new Map<string, BindCorrection>()
      const mapping = new Map([['Hips', 'pelvis']])

      const result = BindCorrectionRetargeter.retarget(source_clip, corrections, mapping, {
        hip_scale: 2,
        root_correction_quat: null,
        position_bone_name: 'pelvis'
      })

      expect(result.tracks.length).toBe(1)
      expect(result.tracks[0].name).toBe('Hips.position')
      expect(result.tracks[0].values[0]).toBeCloseTo(2, 5)
      expect(result.tracks[0].values[1]).toBeCloseTo(4, 5)
      expect(result.tracks[0].values[2]).toBeCloseTo(6, 5)
    })

    it('round-trips unchanged when source and target skeletons are identical', () => {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4)
      const cq = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 6)
      const source = create_two_bone_skeleton(q.clone(), cq.clone())
      const target = create_two_bone_skeleton(q.clone(), cq.clone())
      const mapping = new Map([['Root', 'Root'], ['Child', 'Child']])

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(source, target, mapping)

      const anim_q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.5)
      const qvals = new Float32Array([anim_q.x, anim_q.y, anim_q.z, anim_q.w])
      const source_clip = new AnimationClip('test', 0, [
        new QuaternionKeyframeTrack('Child.quaternion', new Float32Array([0]), qvals)
      ])

      const result = BindCorrectionRetargeter.retarget(source_clip, corrections, mapping, {
        hip_scale: 1,
        root_correction_quat: null,
        position_bone_name: null
      })

      expect(result.tracks.length).toBe(1)
      const actual = new Quaternion(
        result.tracks[0].values[0],
        result.tracks[0].values[1],
        result.tracks[0].values[2],
        result.tracks[0].values[3]
      )
      expect(actual.angleTo(anim_q)).toBeLessThan(1e-5)
    })
  })
})
