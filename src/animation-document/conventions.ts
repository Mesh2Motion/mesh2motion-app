/**
 * M2M-025B — coordinate, transform and interpolation conventions.
 *
 * - Time is always seconds, relative to the start of the clip.
 * - Positions and scales are local XYZ triples relative to the parent bone.
 * - Quaternions are local XYZW (Three.js order), stored normalized to unit length.
 * - Interpolation: quaternion channels use spherical interpolation (slerp);
 *   position/scale use linear interpolation; 'step' holds the previous keyframe.
 *
 * These helpers are pure and are the single place where normalization happens,
 * so the conversion adapter and the fixtures cannot drift apart.
 */

/** Normalize a quaternion in XYZW order.Throws on zero length. */
export function normalize_quaternion (values: readonly number[]): [number, number, number, number] {
  if (values.length !== 4) {
    throw new Error(`quaternion must have 4 values, got ${values.length}`)
  }
  const [x, y, z, w] = values
  const length = Math.sqrt(x * x + y * y + z * z + w * w)
  if (!Number.isFinite(length) || length === 0) {
    throw new Error('cannot normalize a zero-length or non-finite quaternion')
  }
  return [x / length, y / length, z / length, w / length]
}

/** Identity quaternion in XYZW order. */
export function identity_quaternion (): [number, number, number, number] {
  return [0, 0, 0, 1]
}

/**
 * Spherical interpolation between two unit quaternions (XYZW).
 * Takes the shorter arc; handles nearly-parallel quaternions with a linear
 * fallback followed by renormalization.
 */
export function slerp_quaternion (
  a: readonly number[],
  b: readonly number[],
  t: number
): [number, number, number, number] {
  const [ax, ay, az, aw] = normalize_quaternion(a)
  let [bx, by, bz, bw] = normalize_quaternion(b)

  let dot = ax * bx + ay * by + az * bz + aw * bw
  if (dot < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw
    dot = -dot
  }

  if (dot > 0.9995) {
    // Linear fallback: lerp + renormalize is numerically stable near parallel.
    return normalize_quaternion([
      ax + t * (bx - ax),
      ay + t * (by - ay),
      az + t * (bz - az),
      aw + t * (bw - aw)
    ])
  }

  const theta_0 = Math.acos(Math.min(1, Math.max(-1, dot)))
  const theta = theta_0 * t
  const sin_theta_0 = Math.sin(theta_0)
  // sin((1-t)*theta)/sin(theta) * a + sin(t*theta)/sin(theta) * b
  // gives a at t=0 and b at t=1. Using cos(theta) for the first weight is
  // incorrect and produces a visibly different (wrong) rotation.
  const scale_a = Math.sin(theta_0 - theta) / sin_theta_0
  const scale_b = Math.sin(theta) / sin_theta_0
  return normalize_quaternion([
    scale_a * ax + scale_b * bx,
    scale_a * ay + scale_b * by,
    scale_a * az + scale_b * bz,
    scale_a * aw + scale_b * bw
  ])
}

/** Linear interpolation between equal-length numeric vectors. */
export function lerp_vector (a: readonly number[], b: readonly number[], t: number): number[] {
  if (a.length !== b.length) {
    throw new Error('lerp_vector: vector length mismatch')
  }
  return a.map((value, index) => value + t * (b[index] - value))
}
