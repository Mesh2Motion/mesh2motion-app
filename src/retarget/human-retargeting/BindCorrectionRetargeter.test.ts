import { describe, it, expect } from 'vitest'
import { AnimationClip, Bone, Quaternion, QuaternionKeyframeTrack, Skeleton, Vector3, VectorKeyframeTrack } from 'three'
import { BindCorrectionRetargeter, type BindCorrection } from './BindCorrectionRetargeter.ts'

describe('BindCorrectionRetargeter', () => {
  describe('compute_bind_corrections', () => {
    it('produces corrections when target rest differs from canonical source', () => {
      const hips = new Bone(); hips.name = 'Hips'
      hips.quaternion.set(-0.03, 0, 0, 0.9996)
      hips.updateMatrixWorld(true)
      const target = new Skeleton([hips])
      const mapping = new Map([['Hips', 'pelvis']])

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(target, mapping)

      expect(corrections.size).toBeGreaterThan(0)
    })

    it('skips bones not present in canonical rest data', () => {
      const custom = new Bone(); custom.name = 'CustomBone'
      custom.quaternion.set(0, 0, 0.7, 0.7)
      custom.updateMatrixWorld(true)
      const target = new Skeleton([custom])
      const mapping = new Map([['CustomBone', 'custom_source']])

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(target, mapping)

      expect(corrections.size).toBe(0)
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

    it('passes through uncorrected bones unchanged', () => {
      const anim_q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.5)
      const qvals = new Float32Array([anim_q.x, anim_q.y, anim_q.z, anim_q.w])
      const source_clip = new AnimationClip('test', 0, [
        new QuaternionKeyframeTrack('pelvis.quaternion', new Float32Array([0]), qvals)
      ])

      const corrections = new Map<string, BindCorrection>()
      const mapping = new Map([['Hips', 'pelvis']])

      const result = BindCorrectionRetargeter.retarget(source_clip, corrections, mapping, {
        hip_scale: 1,
        root_correction_quat: null,
        position_bone_name: null
      })

      expect(result.tracks.length).toBe(1)
      expect(result.tracks[0].name).toBe('Hips.quaternion')
      const actual = new Quaternion(
        result.tracks[0].values[0],
        result.tracks[0].values[1],
        result.tracks[0].values[2],
        result.tracks[0].values[3]
      )
      expect(actual.angleTo(anim_q)).toBeLessThan(1e-5)
    })
  })

  describe('integration: canonical → RPM arm retarget', () => {
    // Real rest-pose quaternions extracted from RPM avatar GLB.
    // Source rest comes from the embedded canonical Mixamo constants.
    function build_rpm_arm_skeleton (): Skeleton {
      const hips = new Bone(); hips.name = 'Hips'
      hips.quaternion.set(-0.029978, -0.000026, 0.000001, 0.999551)
      const spine = new Bone(); spine.name = 'Spine'
      spine.quaternion.set(-0.013786, 0.000026, 0, 0.999905)
      const spine1 = new Bone(); spine1.name = 'Spine1'
      spine1.quaternion.set(-0.036357, 0, 0, 0.999339)
      const spine2 = new Bone(); spine2.name = 'Spine2'
      spine2.quaternion.set(0.063592, 0, 0, 0.997976)
      const leftShoulder = new Bone(); leftShoulder.name = 'LeftShoulder'
      leftShoulder.quaternion.set(0.481688, 0.492769, -0.588907, 0.422308)
      const leftArm = new Bone(); leftArm.name = 'LeftArm'
      leftArm.quaternion.set(0.384802, 0.069137, 0.038288, 0.919610)
      const leftForeArm = new Bone(); leftForeArm.name = 'LeftForeArm'
      leftForeArm.quaternion.set(0.015386, -0.009235, 0.237663, 0.971182)
      const leftHand = new Bone(); leftHand.name = 'LeftHand'
      leftHand.quaternion.set(0.015976, -0.120418, -0.040059, 0.991786)

      hips.add(spine); spine.add(spine1); spine1.add(spine2)
      spine2.add(leftShoulder); leftShoulder.add(leftArm)
      leftArm.add(leftForeArm); leftForeArm.add(leftHand)
      hips.updateMatrixWorld(true)
      return new Skeleton([hips, spine, spine1, spine2, leftShoulder, leftArm, leftForeArm, leftHand])
    }

    const ARM_MAPPING: Map<string, string> = new Map([
      ['Hips', 'pelvis'],
      ['Spine', 'spine_01'],
      ['Spine1', 'spine_02'],
      ['Spine2', 'spine_03'],
      ['LeftShoulder', 'clavicle_l'],
      ['LeftArm', 'upperarm_l'],
      ['LeftForeArm', 'lowerarm_l'],
      ['LeftHand', 'hand_l']
    ])

    it('produces non-identity corrections for the canonical→RPM arm chain', () => {
      const target = build_rpm_arm_skeleton()

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(target, ARM_MAPPING)

      expect(corrections.size).toBeGreaterThan(0)
      expect(corrections.has('LeftArm') || corrections.has('LeftForeArm')).toBe(true)
    })

    it('retargeted canonical rest frame reproduces target rest quaternion', () => {
      const target = build_rpm_arm_skeleton()

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(target, ARM_MAPPING)

      // Canonical source rest for LeftArm (Mixamo authoring rig's LeftArm rest)
      const canonical_leftarm_rest = new Quaternion(
        -0.003089573263103852, 0.08018148459223169,
        -0.025041829737156785, 0.9964608827384491
      )
      const target_leftarm_rest = new Quaternion(0.384802, 0.069137, 0.038288, 0.919610)

      const qvals = new Float32Array([
        canonical_leftarm_rest.x, canonical_leftarm_rest.y,
        canonical_leftarm_rest.z, canonical_leftarm_rest.w
      ])
      const clip = new AnimationClip('rest', 0, [
        new QuaternionKeyframeTrack('upperarm_l.quaternion', new Float32Array([0]), qvals)
      ])

      const result = BindCorrectionRetargeter.retarget(clip, corrections, ARM_MAPPING, {
        hip_scale: 1, root_correction_quat: null, position_bone_name: null
      })

      expect(result.tracks.length).toBe(1)
      const corrected = new Quaternion(
        result.tracks[0].values[0], result.tracks[0].values[1],
        result.tracks[0].values[2], result.tracks[0].values[3]
      )

      const angle_deg = corrected.angleTo(target_leftarm_rest) * 180 / Math.PI
      expect(angle_deg).toBeLessThan(5)
    })

    it('arm flexion points forward, not behind the back', () => {
      const target = build_rpm_arm_skeleton()

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(target, ARM_MAPPING)

      // Canonical source rest for LeftArm + a forward bend
      const canonical_rest = new Quaternion(
        -0.003089573263103852, 0.08018148459223169,
        -0.025041829737156785, 0.9964608827384491
      )
      const forward_bend = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 6)
      const animated = canonical_rest.clone().multiply(forward_bend)

      const qvals = new Float32Array([animated.x, animated.y, animated.z, animated.w])
      const clip = new AnimationClip('bend', 0, [
        new QuaternionKeyframeTrack('upperarm_l.quaternion', new Float32Array([0]), qvals)
      ])

      const result = BindCorrectionRetargeter.retarget(clip, corrections, ARM_MAPPING, {
        hip_scale: 1, root_correction_quat: null, position_bone_name: null
      })

      const corrected = new Quaternion(
        result.tracks[0].values[0], result.tracks[0].values[1],
        result.tracks[0].values[2], result.tracks[0].values[3]
      )

      const target_rest = new Quaternion(0.384802, 0.069137, 0.038288, 0.919610)
      const delta_from_rest_deg = corrected.angleTo(target_rest) * 180 / Math.PI
      expect(delta_from_rest_deg).toBeGreaterThan(10)

      // World rotation of the corrected arm via target parent chain
      const parent_world = new Quaternion(-0.029978, -0.000026, 0.000001, 0.999551)
        .multiply(new Quaternion(-0.013786, 0.000026, 0, 0.999905))
        .multiply(new Quaternion(-0.036357, 0, 0, 0.999339))
        .multiply(new Quaternion(0.063592, 0, 0, 0.997976))
        .multiply(new Quaternion(0.481688, 0.492769, -0.588907, 0.422308))

      const arm_world = parent_world.clone().multiply(corrected)
      const arm_dir = new Vector3(0, 1, 0).applyQuaternion(arm_world)

      // Arm should point forward (negative Z), not behind the back (positive Z)
      expect(arm_dir.z).toBeLessThan(0)
    })
  })
})
