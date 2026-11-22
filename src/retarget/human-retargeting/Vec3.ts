import type Quat from './Quat'

export default class Vec3 extends Array {
  // constructor can be in the following formats:
  // -> new Vec3()
  // -> new Vec3(x,y,z)
  // -> new Vec3(vec3)
  constructor (a?: number | Vec3 | null, b?: number, c?: number) {
    super(3)

    // if all the args are numbers, set them as the x,y,z values
    if (typeof a === 'number' && typeof b === 'number' && typeof c === 'number') {
      this[0] = a
      this[1] = b
      this[2] = c
    } else if (a !== undefined && a !== null && typeof a === 'object') {
      // we passed in an object, so copy/clone it
      this.copy(a)
    } else {
      // empty constructor. return a 0,0,0 vector
      this.zero()
    }
  }

  // #region SETTERS
  zero (): this {
    this[0] = 0
    this[1] = 0
    this[2] = 0
    return this
  }

  copy (v: Vec3): this {
    this[0] = v[0]
    this[1] = v[1]
    this[2] = v[2]
    return this
  }

  copyTo (v: Vec3): this {
    v[0] = this[0]
    v[1] = this[1]
    v[2] = this[2]
    return this
  }

  xyz (x: number, y: number, z: number): this {
    this[0] = x
    this[1] = y
    this[2] = z
    return this
  }

  copyObj (o: { x: number, y: number, z: number, [key: string]: unknown }): this {
    this[0] = o.x
    this[1] = o.y
    this[2] = o.z
    return this
  }

  set x (x: number) {
    this[0] = x
  }

  set y (y: number) {
    this[1] = y
  }

  set z (z: number) {
    this[2] = z
  }

  // #endregion

  // #region GETTERS
  get len (): number {
    return Math.sqrt(this[0] ** 2 + this[1] ** 2 + this[2] ** 2) 
  }

  get lenSqr (): number {
    return this[0] ** 2 + this[1] ** 2 + this[2] ** 2
  }

  // type safe getters
  get x (): number { return this[0] }
  get y (): number { return this[1] }
  get z (): number { return this[2] }

  clone (): Vec3 {
    return new Vec3(this)
  }
  // #endregion

  // #region FROM OPS
  /**
   * Adds two vectors and sets this vector to the result
   * @param a First Vec3 to add
   * @param b Second Vec3 to add
   * @returns vec3 object for chaining. It also mutates the original vector that calls this method
   */
  fromAdd (a: Vec3, b: Vec3): this {
    this[0] = a[0] + b[0]
    this[1] = a[1] + b[1]
    this[2] = a[2] + b[2]
    return this
  }

  fromSub (a: Vec3, b: Vec3): this {
    this[0] = a[0] - b[0]
    this[1] = a[1] - b[1]
    this[2] = a[2] - b[2]
    return this
  }

  /**
   * Scale a vector by a scalar
   * @param v Vector to scale
   * @param scalar amount to scale 1.0 is 100%
   * @returns new scaled vector
   */
  fromScale (v: Vec3, scalar: number): this {
    this[0] = v[0] * scalar
    this[1] = v[1] * scalar
    this[2] = v[2] * scalar
    return this
  }

  fromScaleThenAdd (scale: number, a: Vec3, b: Vec3): this {
    this[0] = a[0] * scale + b[0]
    this[1] = a[1] * scale + b[1]
    this[2] = a[2] * scale + b[2]
    return this
  }

  fromNorm (v: Vec3): this {
    let mag = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    if (mag === 0) return this

    mag = 1 / mag
    this[0] = v[0] * mag
    this[1] = v[1] * mag
    this[2] = v[2] * mag
    return this
  }

  fromCross (a: Vec3, b: Vec3): this {
    const ax = a[0]; const ay = a[1]; const az = a[2]
    const bx = b[0]; const by = b[1]; const bz = b[2]

    this[0] = ay * bz - az * by
    this[1] = az * bx - ax * bz
    this[2] = ax * by - ay * bx
    return this
  }

  /**
   * Modifies existing vector from a quaternion rotation
   * @param quat  Quaternion
   * @param vec Vector3
   * @returns Vec3 object for chaining. It also mutates the original vector that calls this method
   */
  fromQuat (quat: Quat, vec = new Vec3(0, 0, 1)): this {
    // extract quaternion values
    const qx = quat[0]
    const qy = quat[1]
    const qz = quat[2]
    const qw = quat[3]

    // extract vector3 values
    const vx = vec[0]
    const vy = vec[1]
    const vz = vec[2]

    // calculate the cross product and quaternion-vector multiplication needed for the rotation.
    const x1 = (qy * vz) - (qz * vy)
    const y1 = (qz * vx) - (qx * vz)
    const z1 = (qx * vy) - (qy * vx)

    // second cross product
    const x2 = (qw * x1) + (qy * z1) - (qz * y1)
    const y2 = (qw * y1) + (qz * x1) - (qx * z1)
    const z2 = (qw * z1) + (qx * y1) - (qy * x1)

    // apply mutates vec3 that calls this method
    this[0] = vx + (2 * x2)
    this[1] = vy + (2 * y2)
    this[2] = vz + (2 * z2)
    return this
  }

  fromLerp (a: Vec3, b: Vec3, t: number): this {
    const ti = 1 - t
    this[0] = a[0] * ti + b[0] * t
    this[1] = a[1] * ti + b[1] * t
    this[2] = a[2] * ti + b[2] * t
    return this
  }

  fromPlaneSnap (pnt: Vec3 | null, planeNorm: Vec3, planePos: Vec3 = new Vec3(0, 0, 0)): this {
    // if there is no point, clone this vector
    if (pnt == null) pnt = this.clone()

    // Dot Product between pnt vector & normal
    const dot =
            (pnt[0] - planePos[0]) * planeNorm[0] +
            (pnt[1] - planePos[1]) * planeNorm[1] +
            (pnt[2] - planePos[2]) * planeNorm[2]

    // Snap point to plane
    this[0] = pnt[0] - dot * planeNorm[0]
    this[1] = pnt[1] - dot * planeNorm[1]
    this[2] = pnt[2] - dot * planeNorm[2]

    return this
  }

  // #endregion

  // #region OPERATORS
  add (a: Vec3): this {
    this[0] += a[0]
    this[1] += a[1]
    this[2] += a[2]
    return this
  }

  sub (v: Vec3): this {
    this[0] -= v[0]
    this[1] -= v[1]
    this[2] -= v[2]
    return this
  }

  mul (v: Vec3): this {
    this[0] *= v[0]
    this[1] *= v[1]
    this[2] *= v[2]
    return this
  }

  scale (scalar: number): this {
    this[0] *= scalar
    this[1] *= scalar
    this[2] *= scalar
    return this
  }

  invScale (scalar: number): this {
    this[0] /= scalar
    this[1] /= scalar
    this[2] /= scalar
    return this
  }

  scaleThenAdd (scalar: number, v: Vec3): this {
    this[0] += v[0] * scalar
    this[1] += v[1] * scalar
    this[2] += v[2] * scalar
    return this
  }

  cross (b: Vec3): this {
    const ax = this[0]; const ay = this[1]; const az = this[2]
    const bx = b[0]; const by = b[1]; const bz = b[2]

    this[0] = ay * bz - az * by
    this[1] = az * bx - ax * bz
    this[2] = ax * by - ay * bx
    return this
  }

  norm (): this {
    let mag = Math.sqrt(this[0] ** 2 + this[1] ** 2 + this[2] ** 2)
    if (mag !== 0) {
      mag = 1 / mag
      this[0] *= mag
      this[1] *= mag
      this[2] *= mag
    }
    return this
  }

  negate (): this {
    this[0] = -this[0]
    this[1] = -this[1]
    this[2] = -this[2]
    return this
  }

  transformQuat (q: Quat): this {
    const qx = q[0]; const qy = q[1]; const qz = q[2]; const qw = q[3]
    const vx = this[0]; const vy = this[1]; const vz = this[2]
    const x1 = qy * vz - qz * vy
    const y1 = qz * vx - qx * vz
    const z1 = qx * vy - qy * vx
    const x2 = qw * x1 + qy * z1 - qz * y1
    const y2 = qw * y1 + qz * x1 - qx * z1
    const z2 = qw * z1 + qx * y1 - qy * x1
    this[0] = vx + 2 * x2
    this[1] = vy + 2 * y2
    this[2] = vz + 2 * z2
    return this
  }

  axisAngle (axis: Vec3, rad: number): this {
    // Rodrigues Rotation formula:
    // v_rot = v * cos(theta) + cross( axis, v ) * sin(theta) + axis * dot( axis, v) * (1-cos(theta))
    const cp = new Vec3().fromCross(axis, this)
    const dot = Vec3.dot(axis, this)
    const s = Math.sin(rad)
    const c = Math.cos(rad)
    const ci = 1 - c

    this[0] = this[0] * c + cp[0] * s + axis[0] * dot * ci
    this[1] = this[1] * c + cp[1] * s + axis[1] * dot * ci
    this[2] = this[2] * c + cp[2] * s + axis[2] * dot * ci
    return this
  }
  // #endregion

  // #region STATIC OPS
  static len (a: Vec3): number { return Math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2) }

  static lenSqr (a: Vec3): number { return a[0] ** 2 + a[1] ** 2 + a[2] ** 2 }

  static dist (a: Vec3, b: Vec3): number { return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) }

  static distSqr (a: Vec3, b: Vec3): number { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 }

  static dot (a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }

  static cross (a: Vec3, b: Vec3, out = new Vec3()): Vec3 {
    const ax = a[0]
    const ay = a[1]
    const az = a[2]
    const bx = b[0]
    const by = b[1]
    const bz = b[2]

    out[0] = ay * bz - az * by
    out[1] = az * bx - ax * bz
    out[2] = ax * by - ay * bx
    return out
  }

  static angle (a: Vec3, b: Vec3): number {
    // acos(dot(a,b)/(len(a)*len(b)))
    // const theta = this.dot( a, b ) / ( Math.sqrt( Vec3.lenSqr(a) * Vec3.lenSqr(b) ) );
    // return Math.acos( Math.max( -1, Math.min( 1, theta ) ) ); // clamp ( t, -1, 1 )

    // atan2(len(cross(a,b)),dot(a,b))
    const d = this.dot(a, b)
    const c = this.cross(a, b)
    return Math.atan2(Vec3.len(c), d)

    // This also works, but requires more LEN / SQRT Calls
    // 2 * atan2( ( u * v.len - v * u.len ).len, ( u * v.len + v * u.len ).len );

    // https://math.stackexchange.com/questions/1143354/numerically-stable-method-for-angle-between-3d-vectors/1782769
    // θ=2 atan2(|| ||v||u−||u||v ||, || ||v||u+||u||v ||)

    // let cosine = this.dot( a, b );
    // if(cosine > 1.0) return 0;
    // else if(cosine < -1.0) return Math.PI;
    // else return Math.acos( cosine / ( Math.sqrt( a.lenSqr * b.lenSqr() ) ) );
  }

  static look (fwd: Vec3, up: Vec3 = new Vec3(0, 1, 0)): [Vec3, Vec3, Vec3] {
    const zAxis	= new Vec3(fwd).norm()
    const xAxis = new Vec3().fromCross(up, zAxis).norm() // Right

    // Z & UP are parallel
    if (xAxis.lenSqr === 0) {
      if (Math.abs(up[2]) === 1) {
        // shift x when Fwd or Bak
        zAxis[0] += 0.0001
      } else {
        // shift z
        zAxis[2] += 0.0001
      }

      zAxis.norm() // ReNormalize
      xAxis.fromCross(up, zAxis).norm() // Redo Right
    }

    const yAxis = new Vec3().fromCross(zAxis, xAxis).norm() // Up
    return [xAxis, yAxis, zAxis]
  }

  // #endregion
}
