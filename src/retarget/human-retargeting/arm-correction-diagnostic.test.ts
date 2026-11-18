import { describe, it } from 'vitest'
import { Bone, Quaternion, Skeleton, Vector3 } from 'three'
import { BindCorrectionRetargeter } from './BindCorrectionRetargeter.ts'

// Canonical Mixamo rest poses from retarget.mjs (SOURCE_REST / SOURCE_WORLD_REST)
const CANONICAL_REST: Record<string, [number, number, number, number]> = {
  Hips:          [0.0010741148761599644, 0, 0, 0.9999994231384476],
  Spine:         [-0.018332562694809717, 0, 0, 0.9998319444511763],
  Spine1:        [-0.03815628571181615, 0, 0, 0.9992717837809081],
  Spine2:        [-0.056998031890724846, 0, 0, 0.9983742907149431],
  LeftShoulder:  [0.5181706903502131, 0.5134387363832796, -0.48299308003518876, 0.4843526489955184],
  LeftArm:       [-0.003089573263103852, 0.08018148459223169, -0.025041829737156785, 0.9964608827384491],
  LeftForeArm:   [0, 0, 0.012369379808617674, 0.9999234962951223],
  LeftHand:      [-0.0012910117424963744, 0.002537815819541244, 0.010116448936771993, 0.9999447735952517],
}

const CANONICAL_WORLD_REST: Record<string, [number, number, number, number]> = {
  Hips:          [0.0010741148761599644, 0, 0, 0.9999994231384476],
  Spine:         [-0.017258617754264162, 0, 0, 0.9998510589648868],
  Spine1:        [-0.055396652424023016, 0, 0, 0.9984644264570511],
  Spine2:        [-0.11221710079276989, 0, 0, 0.9936837134066652],
  LeftShoulder:  [0.4605450937998788, 0.4559956590278878, -0.537559006794696, 0.5394409087622226],
  LeftArm:       [0.4889318420664182, 0.5108287295941205, -0.5108290884863605, 0.48893078190839623],
  LeftForeArm:   [0.49521300584988104, 0.5047420653526237, -0.5047420379230214, 0.4952120815979495],
  LeftHand:      [0.5009334720626235, 0.5016127781291206, -0.4977959877649929, 0.49964931327533474],
}

// M2M source skeleton rest poses (from existing test)
const M2M_REST: Record<string, [number, number, number, number]> = {
  root:        [-0.707107, 0, 0, 0.707107],
  pelvis:      [0.790468, 0, 0, 0.612503],
  spine_01:    [-0.064703, 0, 0, 0.997905],
  spine_02:    [-0.077280, 0, 0, 0.997009],
  spine_03:    [-0.093324, 0, 0, 0.995636],
  clavicle_l:  [-0.530812, -0.288154, -0.314649, 0.732259],
  upperarm_l:  [0.192103, 0.660515, -0.267884, 0.674577],
  lowerarm_l:  [0.021641, 0.000287, -0.006738, 0.999743],
  hand_l:      [-0.008400, -0.000060, 0.009398, 0.999921],
}

// RPM target skeleton rest poses (from existing test)
const RPM_REST: Record<string, [number, number, number, number]> = {
  Hips:          [-0.029978, -0.000026, 0.000001, 0.999551],
  Spine:         [-0.013786, 0.000026, 0, 0.999905],
  Spine1:        [-0.036357, 0, 0, 0.999339],
  Spine2:        [0.063592, 0, 0, 0.997976],
  LeftShoulder:  [0.481688, 0.492769, -0.588907, 0.422308],
  LeftArm:       [0.384802, 0.069137, 0.038288, 0.919610],
  LeftForeArm:   [0.015386, -0.009235, 0.237663, 0.971182],
  LeftHand:      [0.015976, -0.120418, -0.040059, 0.991786],
}

const M2M_TO_RPM_MAPPING = new Map<string, string>([
  ['Hips', 'pelvis'],
  ['Spine', 'spine_01'],
  ['Spine1', 'spine_02'],
  ['Spine2', 'spine_03'],
  ['LeftShoulder', 'clavicle_l'],
  ['LeftArm', 'upperarm_l'],
  ['LeftForeArm', 'lowerarm_l'],
  ['LeftHand', 'hand_l'],
])

function q (xyzw: [number, number, number, number]): Quaternion {
  return new Quaternion(xyzw[0], xyzw[1], xyzw[2], xyzw[3])
}

function fmt_q (quat: Quaternion): string {
  return `(${quat.x.toFixed(6)}, ${quat.y.toFixed(6)}, ${quat.z.toFixed(6)}, ${quat.w.toFixed(6)})`
}

function angle_deg (quat: Quaternion): string {
  const half_angle = Math.acos(Math.min(1, Math.abs(quat.w)))
  return (half_angle * 2 * 180 / Math.PI).toFixed(1) + '°'
}

function angular_diff_deg (a: Quaternion, b: Quaternion): string {
  return (a.angleTo(b) * 180 / Math.PI).toFixed(1) + '°'
}

// Compute world quaternion by multiplying chain in order
function chain_world (chain: Quaternion[]): Quaternion {
  const result = chain[0].clone()
  for (let i = 1; i < chain.length; i++) {
    result.multiply(chain[i])
  }
  return result
}

describe('ARM CORRECTION DIAGNOSTIC', () => {
  // Build M2M skeleton (with root bone) for BindCorrectionRetargeter
  function build_m2m_skeleton (): Skeleton {
    const m2m_chain = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l']
    const bones: Bone[] = []
    for (const name of m2m_chain) {
      const bone = new Bone()
      bone.name = name
      bone.quaternion.copy(q(M2M_REST[name]))
      bones.push(bone)
    }
    for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i])
    bones[0].updateMatrixWorld(true)
    return new Skeleton(bones)
  }

  // Build RPM skeleton for BindCorrectionRetargeter
  function build_rpm_skeleton (): Skeleton {
    const rpm_chain = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']
    const bones: Bone[] = []
    for (const name of rpm_chain) {
      const bone = new Bone()
      bone.name = name
      bone.quaternion.copy(q(RPM_REST[name]))
      bones.push(bone)
    }
    for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i])
    bones[0].updateMatrixWorld(true)
    return new Skeleton(bones)
  }

  // Manually compute world quaternions for a chain
  function compute_world_quats (rest: Record<string, [number, number, number, number]>, chain: string[]): Map<string, Quaternion> {
    const result = new Map<string, Quaternion>()
    let world = new Quaternion()
    for (const name of chain) {
      world = world.clone().multiply(q(rest[name]))
      result.set(name, world.clone())
    }
    return result
  }

  // Compute bind corrections manually using retarget.mjs's approach (from hardcoded data)
  function compute_canonical_corrections (
    rpm_rest: Record<string, [number, number, number, number]>,
    rpm_world: Map<string, Quaternion>
  ): Map<string, { L: Quaternion | null, R: Quaternion | null }> {
    const BIND_EPSILON = 1e-6
    const out = new Map<string, { L: Quaternion | null, R: Quaternion | null }>()

    for (const [canonical_name, Rs_arr] of Object.entries(CANONICAL_REST)) {
      const Rt_arr = rpm_rest[canonical_name]
      if (Rt_arr === undefined) continue

      const Rs = q(Rs_arr)
      const Rt = q(Rt_arr)
      const WS = q(CANONICAL_WORLD_REST[canonical_name])
      const WT = rpm_world.get(canonical_name)
      if (WT === undefined) continue

      // L = Rt × WT⁻¹ × WS × Rs⁻¹  (same formula as retarget.mjs line 1046)
      const L = Rt.clone()
        .multiply(WT.clone().invert())
        .multiply(WS.clone())
        .multiply(Rs.clone().invert())

      // R = WS⁻¹ × WT
      const R_q = WS.clone().invert().multiply(WT.clone())

      const identity_L = (1 - Math.abs(L.w)) < BIND_EPSILON
      const identity_R = (1 - Math.abs(R_q.w)) < BIND_EPSILON

      if (identity_L && identity_R) continue

      out.set(canonical_name, {
        L: identity_L ? null : L,
        R: identity_R ? null : R_q,
      })
    }
    return out
  }

  it('dumps M2M world quaternions vs canonical world quaternions', () => {
    const m2m_chain = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l']
    const rpm_chain = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']
    const canonical_chain = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']

    const m2m_world = compute_world_quats(M2M_REST, m2m_chain)
    const rpm_world = compute_world_quats(RPM_REST, rpm_chain)

    console.log('\n=== WORLD QUATERNIONS ===')
    console.log(
      'Bone'.padEnd(18),
      'M2M world'.padEnd(52),
      'Canonical world'.padEnd(52),
      'RPM world'.padEnd(52),
      'M2M↔Canon'
    )

    const m2m_to_canonical: Record<string, string> = {
      pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2',
      clavicle_l: 'LeftShoulder', upperarm_l: 'LeftArm', lowerarm_l: 'LeftForeArm', hand_l: 'LeftHand',
    }

    for (const [m2m_name, canonical_name] of Object.entries(m2m_to_canonical)) {
      const Wm = m2m_world.get(m2m_name)!
      const Wc = q(CANONICAL_WORLD_REST[canonical_name])
      const Wr = rpm_world.get(canonical_name)!

      console.log(
        canonical_name.padEnd(18),
        fmt_q(Wm).padEnd(52),
        fmt_q(Wc).padEnd(52),
        fmt_q(Wr).padEnd(52),
        angular_diff_deg(Wm, Wc)
      )
    }
  })

  it('dumps L and R corrections: M2M→RPM vs Canonical→RPM', () => {
    const source = build_m2m_skeleton()
    const target = build_rpm_skeleton()

    const m2m_corrections = BindCorrectionRetargeter.compute_bind_corrections(source, target, M2M_TO_RPM_MAPPING)

    const rpm_chain = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']
    const rpm_world = compute_world_quats(RPM_REST, rpm_chain)
    const canonical_corrections = compute_canonical_corrections(RPM_REST, rpm_world)

    const arm_bones = ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']

    console.log('\n=== L CORRECTIONS (pre-multiply) ===')
    console.log(
      'Bone'.padEnd(16),
      'M2M→RPM L'.padEnd(52),
      'angle'.padEnd(8),
      'Canon→RPM L'.padEnd(52),
      'angle'.padEnd(8),
      'L divergence'
    )

    for (const bone of arm_bones) {
      const m2m_c = m2m_corrections.get(bone)
      const can_c = canonical_corrections.get(bone)

      const m2m_L = m2m_c?.L ?? new Quaternion(0, 0, 0, 1)
      const can_L = can_c?.L ?? new Quaternion(0, 0, 0, 1)

      console.log(
        bone.padEnd(16),
        fmt_q(m2m_L).padEnd(52),
        angle_deg(m2m_L).padEnd(8),
        fmt_q(can_L).padEnd(52),
        angle_deg(can_L).padEnd(8),
        angular_diff_deg(m2m_L, can_L)
      )
    }

    console.log('\n=== R CORRECTIONS (post-multiply) ===')
    console.log(
      'Bone'.padEnd(16),
      'M2M→RPM R'.padEnd(52),
      'angle'.padEnd(8),
      'Canon→RPM R'.padEnd(52),
      'angle'.padEnd(8),
      'R divergence'
    )

    for (const bone of arm_bones) {
      const m2m_c = m2m_corrections.get(bone)
      const can_c = canonical_corrections.get(bone)

      const m2m_R = m2m_c?.R ?? new Quaternion(0, 0, 0, 1)
      const can_R = can_c?.R ?? new Quaternion(0, 0, 0, 1)

      console.log(
        bone.padEnd(16),
        fmt_q(m2m_R).padEnd(52),
        angle_deg(m2m_R).padEnd(8),
        fmt_q(can_R).padEnd(52),
        angle_deg(can_R).padEnd(8),
        angular_diff_deg(m2m_R, can_R)
      )
    }
  })

  it('compares retarget output for sample animated keyframes', () => {
    const source = build_m2m_skeleton()
    const target = build_rpm_skeleton()
    const m2m_corrections = BindCorrectionRetargeter.compute_bind_corrections(source, target, M2M_TO_RPM_MAPPING)

    // Sample animation keyframes: M2M rest + deltas
    const source_rest_q = q(M2M_REST.upperarm_l)

    // Test cases: rest, forward bend, outward bend, clap-like
    const test_cases: Array<{ name: string, keyframe: Quaternion }> = [
      { name: 'rest', keyframe: source_rest_q.clone() },
      { name: 'forward -30°X', keyframe: source_rest_q.clone().multiply(
          new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 6)) },
      { name: 'inward +30°Z', keyframe: source_rest_q.clone().multiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 6)) },
      { name: 'raise +45°Z', keyframe: source_rest_q.clone().multiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4)) },
    ]

    const target_rest_q = q(RPM_REST.LeftArm)
    const corr = m2m_corrections.get('LeftArm')

    // Also compute the "L-only" (world-matching) correction
    const m2m_chain = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'upperarm_l']
    const rpm_chain_names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm']
    const m2m_world = compute_world_quats(M2M_REST, m2m_chain)
    const rpm_world = compute_world_quats(RPM_REST, rpm_chain_names)

    const Ws = m2m_world.get('upperarm_l')!
    const Wt = rpm_world.get('LeftArm')!
    const Rs = q(M2M_REST.upperarm_l)
    const Rt = q(RPM_REST.LeftArm)

    // L-only = Rt × Wt⁻¹ × Ws × Rs⁻¹ (same as our L)
    const L_only = Rt.clone().multiply(Wt.clone().invert()).multiply(Ws).multiply(Rs.clone().invert())

    console.log('\n=== ANIMATED KEYFRAME COMPARISON (LeftArm) ===')
    console.log('R angle:', angle_deg(corr?.R ?? new Quaternion()))
    console.log('L angle:', angle_deg(corr?.L ?? new Quaternion()))
    console.log()

    console.log(
      'Case'.padEnd(18),
      'L×Q×R output'.padEnd(52),
      'L-only output'.padEnd(52),
      'target rest'.padEnd(52),
      'L×Q×R ↔ rest',
      '  L-only ↔ rest',
      '  L×Q×R ↔ L-only'
    )

    for (const tc of test_cases) {
      const keyframe = tc.keyframe.clone()

      // L × Q × R (our method)
      const lqr = keyframe.clone()
      if (corr?.L) lqr.premultiply(corr.L)
      if (corr?.R) lqr.multiply(corr.R)

      // L-only (world-matching)
      const l_only_result = keyframe.clone().premultiply(L_only)

      console.log(
        tc.name.padEnd(18),
        fmt_q(lqr).padEnd(52),
        fmt_q(l_only_result).padEnd(52),
        fmt_q(target_rest_q).padEnd(52),
        angular_diff_deg(lqr, target_rest_q).padStart(12),
        angular_diff_deg(l_only_result, target_rest_q).padStart(14),
        angular_diff_deg(lqr, l_only_result).padStart(16)
      )
    }

    // Also show world rotations for each case
    console.log('\n=== WORLD ROTATION CHECK (LeftArm) ===')
    // M2M parent world = root × pelvis × spine01 × spine02 × spine03 × clavicle_l
    const m2m_parent_chain = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l']
    const m2m_parent_world = compute_world_quats(M2M_REST, m2m_parent_chain).get('clavicle_l')!
    // RPM parent world = Hips × Spine × Spine1 × Spine2 × LeftShoulder
    const rpm_parent_chain = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder']
    const rpm_parent_world = compute_world_quats(RPM_REST, rpm_parent_chain).get('LeftShoulder')!

    console.log(
      'Case'.padEnd(18),
      'source world'.padEnd(52),
      'target world (L×Q×R)'.padEnd(52),
      'target world (L-only)'.padEnd(52),
      'src↔tgt(L×Q×R)',
      '  src↔tgt(L-only)'
    )

    for (const tc of test_cases) {
      const keyframe = tc.keyframe.clone()

      // Source world rotation
      const src_world = m2m_parent_world.clone().multiply(keyframe)

      // L × Q × R target output
      const lqr = keyframe.clone()
      if (corr?.L) lqr.premultiply(corr.L)
      if (corr?.R) lqr.multiply(corr.R)
      const tgt_world_lqr = rpm_parent_world.clone().multiply(lqr)

      // L-only target output
      const l_only_result = keyframe.clone().premultiply(L_only)
      const tgt_world_l_only = rpm_parent_world.clone().multiply(l_only_result)

      console.log(
        tc.name.padEnd(18),
        fmt_q(src_world).padEnd(52),
        fmt_q(tgt_world_lqr).padEnd(52),
        fmt_q(tgt_world_l_only).padEnd(52),
        angular_diff_deg(src_world, tgt_world_lqr).padStart(14),
        angular_diff_deg(src_world, tgt_world_l_only).padStart(16)
      )
    }
  })
})
