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
      const target_rest = L.clone().multiply(R)
      const corrections = new Map<string, BindCorrection>([
        ['Hips', { L, R, target_rest }]
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

  describe('integration: M2M → RPM arm retarget', () => {
    // Real rest-pose quaternions extracted from M2M sample rig and RPM avatar GLBs.
    // The M2M rig has a root bone with 90° X rotation (Z-up convention) that the
    // RPM rig doesn't have — this is exactly the mismatch that caused the twisted-arms bug.
    function build_m2m_arm_skeleton (): Skeleton {
      const root = new Bone(); root.name = 'root'
      root.quaternion.set(-0.707107, 0, 0, 0.707107)
      const pelvis = new Bone(); pelvis.name = 'pelvis'
      pelvis.quaternion.set(0.790468, 0, 0, 0.612503)
      pelvis.position.set(0, 0, 0)
      const spine01 = new Bone(); spine01.name = 'spine_01'
      spine01.quaternion.set(-0.064703, 0, 0, 0.997905)
      const spine02 = new Bone(); spine02.name = 'spine_02'
      spine02.quaternion.set(-0.077280, 0, 0, 0.997009)
      const spine03 = new Bone(); spine03.name = 'spine_03'
      spine03.quaternion.set(-0.093324, 0, 0, 0.995636)
      const clavicleL = new Bone(); clavicleL.name = 'clavicle_l'
      clavicleL.quaternion.set(-0.530812, -0.288154, -0.314649, 0.732259)
      const upperarmL = new Bone(); upperarmL.name = 'upperarm_l'
      upperarmL.quaternion.set(0.192103, 0.660515, -0.267884, 0.674577)
      const lowerarmL = new Bone(); lowerarmL.name = 'lowerarm_l'
      lowerarmL.quaternion.set(0.021641, 0.000287, -0.006738, 0.999743)
      const handL = new Bone(); handL.name = 'hand_l'
      handL.quaternion.set(-0.008400, -0.000060, 0.009398, 0.999921)

      root.add(pelvis); pelvis.add(spine01); spine01.add(spine02)
      spine02.add(spine03); spine03.add(clavicleL); clavicleL.add(upperarmL)
      upperarmL.add(lowerarmL); lowerarmL.add(handL)
      root.updateMatrixWorld(true)
      return new Skeleton([root, pelvis, spine01, spine02, spine03, clavicleL, upperarmL, lowerarmL, handL])
    }

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

    it('produces non-identity corrections for the M2M→RPM arm chain', () => {
      const source = build_m2m_arm_skeleton()
      const target = build_rpm_arm_skeleton()

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(source, target, ARM_MAPPING)

      // The rest poses are very different — corrections must exist for arm bones
      expect(corrections.size).toBeGreaterThan(0)
      expect(corrections.has('LeftArm') || corrections.has('LeftForeArm')).toBe(true)
    })

    it('retargeted arm rest-pose frame reproduces the target rest quaternion', () => {
      const source = build_m2m_arm_skeleton()
      const target = build_rpm_arm_skeleton()

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(source, target, ARM_MAPPING)

      const source_upperarm_rest = new Quaternion(0.192103, 0.660515, -0.267884, 0.674577)
      const target_leftarm_rest = new Quaternion(0.384802, 0.069137, 0.038288, 0.919610)

      const qvals = new Float32Array([
        source_upperarm_rest.x, source_upperarm_rest.y,
        source_upperarm_rest.z, source_upperarm_rest.w
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
      const source = build_m2m_arm_skeleton()
      const target = build_rpm_arm_skeleton()

      const corrections = BindCorrectionRetargeter.compute_bind_corrections(source, target, ARM_MAPPING)

      // Simulate a forward arm bend: apply a -30° rotation around the local X axis
      // on top of the source rest pose (X flexion = elbow bends forward in M2M space)
      const source_rest = new Quaternion(0.192103, 0.660515, -0.267884, 0.674577)
      const forward_bend = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 6)
      const animated = source_rest.clone().multiply(forward_bend)

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

      // The corrected rotation should differ from target rest (arm moved)
      const target_rest = new Quaternion(0.384802, 0.069137, 0.038288, 0.919610)
      const delta_from_rest_deg = corrected.angleTo(target_rest) * 180 / Math.PI
      expect(delta_from_rest_deg).toBeGreaterThan(10)

      // Key assertion: compute the world rotation of the corrected arm by composing
      // with the target's parent chain, then check the arm direction.
      // Target parent world = Hips × Spine × Spine1 × Spine2 × LeftShoulder
      const parent_world = new Quaternion(-0.029978, -0.000026, 0.000001, 0.999551) // Hips
        .multiply(new Quaternion(-0.013786, 0.000026, 0, 0.999905)) // Spine
        .multiply(new Quaternion(-0.036357, 0, 0, 0.999339)) // Spine1
        .multiply(new Quaternion(0.063592, 0, 0, 0.997976)) // Spine2
        .multiply(new Quaternion(0.481688, 0.492769, -0.588907, 0.422308)) // LeftShoulder

      const arm_world = parent_world.clone().multiply(corrected)

      // In RPM/Mixamo, the arm bone's local +Y axis (bone direction) should point
      // roughly left (positive X in world). After a forward bend, the arm should
      // tilt forward (negative Z) — NOT backward (positive Z).
      const arm_dir = new Vector3(0, 1, 0).applyQuaternion(arm_world)

      // The arm should have a forward (negative Z) component — this is what was
      // broken before (arms went backward = positive Z)
      expect(arm_dir.z).toBeLessThan(0)
    })
  })
})
