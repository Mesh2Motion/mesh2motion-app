import { describe, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'

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

function q (xyzw: [number, number, number, number]): Quaternion {
  return new Quaternion(xyzw[0], xyzw[1], xyzw[2], xyzw[3])
}
function chain_world (names: string[], rest: Record<string, [number, number, number, number]>): Map<string, Quaternion> {
  const result = new Map<string, Quaternion>()
  let world = new Quaternion()
  for (const name of names) {
    world = world.clone().multiply(q(rest[name]))
    result.set(name, world.clone())
  }
  return result
}
function angle_deg (quat: Quaternion): string {
  return (Math.acos(Math.min(1, Math.abs(quat.w))) * 2 * 180 / Math.PI).toFixed(1) + '°'
}
function fmt_q (quat: Quaternion): string {
  return `(${quat.x.toFixed(4)}, ${quat.y.toFixed(4)}, ${quat.z.toFixed(4)}, ${quat.w.toFixed(4)})`
}

describe('SWING-ONLY R DIAGNOSTIC', () => {
  it('compares full R, swing-only R, and L-only for arm bones', () => {
    const m2m_chain = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l']
    const rpm_chain = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']
    const m2m_world = chain_world(m2m_chain, M2M_REST)
    const rpm_world = chain_world(rpm_chain, RPM_REST)

    const bone_dir_local = new Vector3(0, 1, 0)

    // Arm bones to test
    const pairs = [
      { m2m: 'upperarm_l', rpm: 'LeftArm' },
      { m2m: 'lowerarm_l', rpm: 'LeftForeArm' },
      { m2m: 'hand_l', rpm: 'LeftHand' },
    ]

    const m2m_parent_world = chain_world(['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l'], M2M_REST).get('clavicle_l')!
    const rpm_parent_chain_bones = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder']
    const rpm_parent_world = chain_world(rpm_parent_chain_bones, RPM_REST).get('LeftShoulder')!

    // Focus on LeftArm
    const Ws = m2m_world.get('upperarm_l')!
    const Wt = rpm_world.get('LeftArm')!
    const Rs = q(M2M_REST.upperarm_l)
    const Rt = q(RPM_REST.LeftArm)

    // Bone directions in world space
    const src_dir = bone_dir_local.clone().applyQuaternion(Ws).normalize()
    const tgt_dir = bone_dir_local.clone().applyQuaternion(Wt).normalize()

    // Three R variants
    const R_full = Ws.clone().invert().multiply(Wt.clone())
    const R_swing = new Quaternion().setFromUnitVectors(src_dir, tgt_dir)
    const R_twist = R_swing.clone().invert().multiply(R_full)

    console.log('\n=== R DECOMPOSITION (LeftArm) ===')
    console.log(`Source bone dir: (${src_dir.x.toFixed(3)}, ${src_dir.y.toFixed(3)}, ${src_dir.z.toFixed(3)})`)
    console.log(`Target bone dir: (${tgt_dir.x.toFixed(3)}, ${tgt_dir.y.toFixed(3)}, ${tgt_dir.z.toFixed(3)})`)
    console.log(`R_full:  ${fmt_q(R_full)}  ${angle_deg(R_full)}`)
    console.log(`R_swing: ${fmt_q(R_swing)}  ${angle_deg(R_swing)}`)
    console.log(`R_twist: ${fmt_q(R_twist)}  ${angle_deg(R_twist)}`)

    // Three L corrections
    const L_full = Rt.clone().multiply(Wt.clone().invert()).multiply(Ws.clone()).multiply(Rs.clone().invert())
    const L_swing = Rt.clone().multiply(R_swing.clone().invert()).multiply(Rs.clone().invert())
    const L_only = L_full.clone() // L-only uses the same L, just doesn't apply R

    // Verify rest: L × Rs × R should = Rt
    const rest_full = L_full.clone().multiply(Rs.clone()).multiply(R_full)
    const rest_swing = L_swing.clone().multiply(Rs.clone()).multiply(R_swing)
    const rest_lonly = L_only.clone().multiply(Rs.clone())
    console.log(`\nRest → Rt diff:  full=${(rest_full.angleTo(Rt)*180/Math.PI).toFixed(1)}°  swing=${(rest_swing.angleTo(Rt)*180/Math.PI).toFixed(1)}°  L-only=${(rest_lonly.angleTo(Rt)*180/Math.PI).toFixed(1)}°`)

    // Test keyframes
    const test_cases = [
      { name: 'rest', kf: q(M2M_REST.upperarm_l) },
      { name: 'fwd -30°X', kf: q(M2M_REST.upperarm_l).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 6)) },
      { name: 'in +30°Z', kf: q(M2M_REST.upperarm_l).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 6)) },
      { name: 'raise +45°Z', kf: q(M2M_REST.upperarm_l).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4)) },
      { name: 'fwd -60°X', kf: q(M2M_REST.upperarm_l).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 3)) },
      { name: 'clap 90°Z', kf: q(M2M_REST.upperarm_l).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)) },
    ]

    console.log('\n=== BONE DIRECTION TRACKING (LeftArm +Y in world) ===')
    console.log(
      'Case'.padEnd(14),
      'source dir'.padEnd(22),
      'full_R dir'.padEnd(22),
      'swing_R dir'.padEnd(22),
      'L-only dir'.padEnd(22),
      'src↔full',
      ' src↔swing',
      ' src↔Lonly'
    )

    for (const tc of test_cases) {
      const kf = tc.kf.clone()

      // Source world direction
      const src_wr = m2m_parent_world.clone().multiply(kf)
      const sd = bone_dir_local.clone().applyQuaternion(src_wr).normalize()

      // Full R
      const of = kf.clone(); of.premultiply(L_full); of.multiply(R_full)
      const fd = bone_dir_local.clone().applyQuaternion(rpm_parent_world.clone().multiply(of)).normalize()

      // Swing R
      const os = kf.clone(); os.premultiply(L_swing); os.multiply(R_swing)
      const swd = bone_dir_local.clone().applyQuaternion(rpm_parent_world.clone().multiply(os)).normalize()

      // L-only
      const ol = kf.clone(); ol.premultiply(L_only)
      const ld = bone_dir_local.clone().applyQuaternion(rpm_parent_world.clone().multiply(ol)).normalize()

      const df = (v: Vector3) => `(${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)})`
      const da = (a: Vector3, b: Vector3) => (Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180 / Math.PI).toFixed(1) + '°'

      console.log(
        tc.name.padEnd(14),
        df(sd).padEnd(22),
        df(fd).padEnd(22),
        df(swd).padEnd(22),
        df(ld).padEnd(22),
        da(sd, fd).padStart(7),
        da(sd, swd).padStart(9),
        da(sd, ld).padStart(9)
      )
    }
  })
})
