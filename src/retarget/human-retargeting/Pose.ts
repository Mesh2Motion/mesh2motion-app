import { Joint } from './Joint'
import type Quat from './Quat'
import Transform from './Transform'
import * as THREE from 'three'
import type Vec3 from './Vec3'

// Threejs does not have a method to clone a skeleton that works correctly.
// Pose allows to make copies of a skeleton state. This is great to cache
// the bindpose plus have a working space for computing a new pose before
// commiting the results to the skeleton
export class Pose {
  // #region MAIN
  public srcPose: Pose | null = null
  public nameIdx = new Map<string, number>()
  public joints: Joint[] = []
  public rootOffset = new Transform() // Absolute root transform
  public poseOffset = new Transform() // Offset applied to pose

  constructor (skel?: THREE.Skeleton) {
    if (skel !== undefined) {
      this.fromSkeleton(skel)
    }
  }
  // #endregion

  // #region GETTERS / SETTERS

  /**
   * Gets the joint by index or name
   * @param o either index of joint, or string name of joint
   * @returns joint object
   */
  getJoint (o: number | string): Joint | null {
    switch (typeof o) {
      case 'number':
        return this.joints[o]
      case 'string': {
        const idx = this.nameIdx.get(o)
        return (idx !== undefined) ? this.joints[idx] : null
      }
    }

    return null
  }

  public clone (): Pose {
    const p = new Pose()
    p.rootOffset.copy(this.rootOffset)
    p.poseOffset.copy(this.poseOffset)

    for (const j of this.joints) p.joints.push(j.clone())

    p.srcPose = this.srcPose ?? this
    p.nameIdx = this.nameIdx // Ref copy, should never change
    return p
  }

  fromSkeleton (skel: THREE.Skeleton): void {
    this.nameIdx.clear()

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    let j: Joint
    for (const [i, b] of skel.bones.entries()) {
      // console.log( i, b );
      // Create Joint
      j = new Joint().fromBone(b)
      j.index = i

      // Map Name to Index
      this.nameIdx.set(j.name, j.index)

      // Link up parent-child relationshop
      if ((b.parent?.isBone)) {
        const name_index: number | undefined = this.nameIdx.get(b.parent.name)

        if (name_index !== undefined) {
          j.pindex = name_index
        }

        this.joints[j.pindex].children.push(j.index)
      }

      this.joints[i] = j
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Get pose offset transform

    const b: THREE.Bone = skel.bones[0]
    if (b !== null) {
      const v = new THREE.Vector3()


      b.parent.getWorldPosition(v)
      this.poseOffset.pos[0] = v.x
      this.poseOffset.pos[1] = v.y
      this.poseOffset.pos[2] = v.z

      b.parent.getWorldScale(v)
      this.poseOffset.scl[0] = v.x
      this.poseOffset.scl[1] = v.y
      this.poseOffset.scl[2] = v.z

      const q = new THREE.Quaternion()
      b.parent.getWorldQuaternion(q)
      this.poseOffset.rot[0] = q.x
      this.poseOffset.rot[1] = q.y
      this.poseOffset.rot[2] = q.z
      this.poseOffset.rot[3] = q.w
    }

    this.updateWorld()
  }

  reset (): this {
    if (!this.srcPose) { console.log('Pose.reset - No source available for resetting'); return }

    for (let i = 0; i < this.joints.length; i++) {
      this.joints[i].local.copy(this.srcPose.joints[i].local)
    }

    return this
  }

  toSkeleton (skel: THREE.Skeleton): void {
    let j: Joint
    for (const [i, b] of skel.bones.entries()) {
      j = this.joints[i]
      b.position.fromArray(j.local.pos)
      b.quaternion.fromArray(j.local.rot)
      b.scale.fromArray(j.local.scl)
    }
  }

  setRot (i: number, rot: Quat): this {
    const r = this.joints[i].local.rot
    r[0] = rot[0]
    r[1] = rot[1]
    r[2] = rot[2]
    r[3] = rot[3]
    return this
  }

  setPos (i: number, pos: Vec3): this {
    const p = this.joints[i].local.pos
    p[0] = pos[0]
    p[1] = pos[1]
    p[2] = pos[2]
    return this
  }

  setScl (i: number, scl: Vec3): this {
    const p = this.joints[i].local.scl
    p[0] = scl[0]
    p[1] = scl[1]
    p[2] = scl[2]
    return this
  }

  setScalar (i: number, s: number): this {
    const p = this.joints[i].local.scl
    p[0] = s
    p[1] = s
    p[2] = s
    return this
  }

  // #endregion

  // #region COMPUTE
  updateWorld (): this {
    for (const j of this.joints) {
      if (j.pindex !== -1) {
        // Parent Exists
        j.world.fromMul(this.joints[j.pindex].world, j.local)
      } else {
        // No Parent, apply any possible offset
        j.world
          .fromMul(this.rootOffset, this.poseOffset)
          .mul(j.local)
      }
    }

    return this
  }

  /**
   * Get the world transform of a joint by its index
   * @param id joint index
   * @param out optional transform to store result
   * @returns world transform of joint
   */
  getWorld (joint_idx: number, out_transform = new Transform()): Transform {
    let joint: Joint | null = this.getJoint(joint_idx)

    if (joint === null) {
      if (joint_idx === -1) {
        out_transform.fromMul(this.rootOffset, this.poseOffset)
      } else {
        console.error('Pose.getWorld - joint not found', joint_idx)
      }

      return out_transform
    }

    // Work up the heirarchy till the root bone
    if (joint.local === undefined) {
      console.error('Pose.getWorld - joint.local is undefined', joint)
    }

    out_transform.copy(joint.local)
    while (joint.pindex !== -1) {
      joint = this.joints[joint.pindex]
      out_transform.pmul(joint.local)
    }

    // Add offset
    out_transform.pmul(this.poseOffset)
      .pmul(this.rootOffset)

    return out_transform
  }

  // #endregion

  // #region DEBUGGING
  // debug (): this {
  //   const LN: number = 0x707070
  //   const PT: number = 0x505050

  //   let c
  //   for (const j of this.joints) {
  //     Debug.pnt.add(j.world.pos, PT, 0.7)
  //     for (const i of j.children) {
  //       c = this.joints[i]
  //       Debug.ln.add(j.world.pos, c.world.pos, LN)
  //     }
  //   }
  //   return this
  // }

  // #endregion
}
