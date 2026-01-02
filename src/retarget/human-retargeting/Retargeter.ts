import * as THREE from 'three'
import { type Rig } from './Rig'
import { type Pose } from './Pose'
import { type ChainTwistAdditive } from './ChainTwistAdditive'
import Vec3 from './Vec3'
import Quat from './Quat'
import Transform from './Transform'
import { type RigItem } from './RigItem'
import { type Joint } from './Joint'

// example and library functions taken from sketchpunklabs
// https://github.com/sketchpunklabs/threejs_proto/blob/main/code/webgl/anim/002_retarget_4m2m.html

export class Retargeter {
  public srcRig: Rig
  public tarRig: Rig
  private readonly clip: THREE.AnimationClip
  private readonly mixer: THREE.AnimationMixer = new THREE.AnimationMixer(new THREE.Object3D())
  private readonly action: THREE.AnimationAction
  public pose: Pose
  public readonly additives: ChainTwistAdditive[] = []

  constructor (source_rig: Rig, target_rig: Rig, clip: THREE.AnimationClip) {
    this.srcRig = source_rig
    this.tarRig = target_rig
    this.clip = clip

    this.pose = this.tarRig.tpose.clone()

    this.action = this.mixer.clipAction(this.clip, this.srcRig.skel.bones[0])
    this.action.play()
  }

  // #region METHODS
  public update (delta_time: number): void {
    // Run Animation
    this.mixer.update(delta_time)

    // Compute vectors from animation source
    // then align target joints to it
    this.applyScaledTranslation('pelvis') // apply position scaling for hips
    this.applyChain('pelvis')
    this.applyEndInterp('spine')
    this.applyChain('head')

    this.applyChain('armL')
    this.applyChain('armR')
    this.applyChain('legL')
    this.applyChain('legR')

    // Run Additives if any exist
    for (const i of this.additives) {
      i.apply(this)
    }

    // Apply working pose to 3JS skeleton for rendering
    this.pose.toSkeleton(this.tarRig.skel)
  }

  // Apply SwingTwist to each joint of a chain, 1 to 1 mappings
  // k = chain key like 'pelvis', 'armL', etc
  applyChain (k: string): void {
    const src: RigItem[] = this.srcRig.chains[k]
    const tar: RigItem[] = this.tarRig.chains[k]
    if (src === null || tar === null) {
      console.warn('Retargeter: Missing source or target chain for key ', k)
      return
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // const cnt = src.length

    // const p = new Vec3()
    const source_position: Vec3 = new Vec3()
    const source_rotation: Quat = new Quat()
    const target_rotation: Quat = new Quat()
    const final_rotation: Quat = new Quat()

    const source_swing: Vec3 = new Vec3() // Source Swing
    const source_twist: Vec3 = new Vec3() // Source Twist
    const swing_direction: Vec3 = new Vec3()
    const twist_direction: Vec3 = new Vec3()

    const parent_transform: Transform = new Transform()
    const current_transform: Transform = new Transform()

    let bone: THREE.Bone
    let joint: Joint

    const vec: Vec3 = new Vec3() // we will copy position data into this
    const quat: Quat = new Quat() // we will copy rotation data into this
    for (let i = 0; i < src.length; i++) {
      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // Get source swing / twist vectors
      // Pose exists in 3JS skeleton, so need to get its
      // Data through 3JS methods
      bone = this.srcRig.skel.bones[src[i].idx]
      bone.getWorldPosition(new THREE.Vector3(vec.x, vec.y, vec.z))
      bone.getWorldQuaternion(new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w))
      source_position.copyTo(vec)
      source_rotation.copyTo(quat)

      source_swing.fromQuat(source_rotation, src[i].swing)
      source_twist.fromQuat(source_rotation, src[i].twist)

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // Get Target Neutral Transform for the joint
      // ( neutralTwistDir x targetTwistDir ) * ( neutralSwingDir x targetSwingDir ) * neutralRot
      joint = this.tarRig.tpose.joints[tar[i].idx]

      // neutral = currentPose.joint.world * tpose.joint.local
      this.pose.getWorld(joint.pindex, parent_transform) // Current transform of parent joint.
      current_transform.fromMul(parent_transform, joint.local) // Applied to TPose transform

      // ----------------------------
      // SWING
      swing_direction.fromQuat(current_transform.rot, tar[i].swing) // Get swing direction
      final_rotation.fromSwing(swing_direction, source_swing) // Rotation to match swing directions
        .mul(current_transform.rot) // Apply to neutral rotation

      // swing_direction.fromQuat(final_rotation, tar[i].swing) // For Debugging
      // ----------------------------
      // TWIST
      twist_direction.fromQuat(final_rotation, tar[i].twist) // Get twist from swing rotation
      target_rotation.fromSwing(twist_direction, source_twist) // Rotation to match twist vectors
      final_rotation.pmul(target_rotation) // Apply to swing rotation

      // twist_direction.fromQuat(final_rotation, tar[i].twist) // For Debugging
      // ----------------------------
      final_rotation.pmulInvert(parent_transform.rot) // To LocalSpace
      this.pose.setRot(tar[i].idx, final_rotation) // Save to working pose

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // Visualize computed target vectors from source animation
      // Debug.pnt.add(source_position, 0xffff00, 1)
      // Debug.ln.add(source_position, p.fromScaleThenAdd(0.1, source_swing, source_position), 0xffff00)
      // Debug.ln.add(source_position, p.fromScaleThenAdd(0.1, source_twist, source_position), 0xff00ff)

      // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
      // Visualize target vectors over mesh
      // Debug.pnt.add(current_transform.pos, 0x00ff00, 1)
      // Debug.ln.add(current_transform.pos, p.fromScaleThenAdd(0.15, swing_direction, current_transform.pos), 0xffff00)
      // Debug.ln.add(current_transform.pos, p.fromScaleThenAdd(0.1, swing_direction, current_transform.pos), 0xffffff)
      // Debug.ln.add(current_transform.pos, p.fromScaleThenAdd(0.15, twist_direction, current_transform.pos), 0xff00ff)
      // Debug.ln.add(current_transform.pos, p.fromScaleThenAdd(0.1, twist_direction, current_transform.pos), 0xff0000)
    }
  }

  // Interp start & end SwingTwist vectors over a chain
  // k = chain key like 'spine', etc
  applyEndInterp (k: string): void {
    if (this.srcRig === null || this.tarRig === null || this.pose === null) {
      console.warn('Retargeter: Missing srcRig, tarRig, or pose.')
      return
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    const src: RigItem[] = this.srcRig.chains[k]
    const tar: RigItem[] = this.tarRig.chains[k]
    if (src === null || tar === null) return

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    const aTran: Transform = this.getWorld(this.srcRig.skel, src[0].idx)
    const aSwing: Vec3 = new Vec3().fromQuat(aTran.rot, src[0].swing)
    const aTwist: Vec3 = new Vec3().fromQuat(aTran.rot, src[0].twist)

    const bTran: Transform = this.getWorld(this.srcRig.skel, src[src.length - 1].idx)
    const bSwing: Vec3 = new Vec3().fromQuat(bTran.rot, src[src.length - 1].swing)
    const bTwist: Vec3 = new Vec3().fromQuat(bTran.rot, src[src.length - 1].twist)

    // Visualize data over source skeleton
    // Debug.pnt.add(aTran.pos, 0xffff00, 1.2)
    // Debug.pnt.add(bTran.pos, 0xffff00, 1.2)

    // Debug.ln.add(aTran.pos, vv.fromScaleThenAdd(0.1, aSwing, aTran.pos), 0xffff00)
    // Debug.ln.add(aTran.pos, vv.fromScaleThenAdd(0.1, aTwist, aTran.pos), 0xff00ff)
    // Debug.ln.add(bTran.pos, vv.fromScaleThenAdd(0.1, bSwing, bTran.pos), 0xffff00)
    // Debug.ln.add(bTran.pos, vv.fromScaleThenAdd(0.1, bTwist, bTran.pos), 0xff00ff)

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    const target_dir: Vec3 = new Vec3()
    const target_twist: Vec3 = new Vec3()
    const rig_items_count: number = tar.length - 1
    let itm: RigItem
    let t: number // 0-1 lerp factor for chain

    for (let i = 0; i <= rig_items_count; i++) {
      t = i / rig_items_count
      itm = tar[i]

      // Lerp Target Vectors
      target_dir.fromLerp(aSwing, bSwing, t).norm()
      target_twist.fromLerp(aTwist, bTwist, t).norm()

      // Make joint vectors match target vectors
      const rot = this.applySwingTwist(itm, target_dir, target_twist, this.tarRig.tpose, this.pose)
      this.pose.setRot(itm.idx, rot)

      // -----------------------
      // const debug_transform: Transform = new Transform() // Debug
      // this.pose.getWorld(itm.idx, debug_transform)
      // const vv: Vec3 = new Vec3() // Debug
      // Debug.pnt.add(debug_transform.pos, 0x00ff00, 1, 1)
      // Debug.ln.add(debug_transform.pos, vv.fromQuat(debug_transform.rot, itm.swing).scale(0.1).add(debug_transform.pos), 0xffff00)
      // Debug.ln.add(debug_transform.pos, vv.fromQuat(debug_transform.rot, itm.twist).scale(0.1).add(debug_transform.pos), 0xff00ff)
    }
  }

  // Compute offset translation & scale it to fit better on target
  applyScaledTranslation (k: string): void {
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // get chain root items
    const src: RigItem = this.srcRig.chains[k][0]
    const tar: RigItem = this.tarRig.chains[k][0]
    if (src === null || tar === null) return

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Compute offset position change from animation
    const scale_delta: number = this.tarRig.scalar / this.srcRig.scalar // Scale from Src to Tar
    const source_t_pose_joint: Joint = this.srcRig.tpose.joints[src.idx] // TPose Src Joint
    const source_ws_transform: Transform = this.getWorld(this.srcRig.skel, src.idx) // WS Tranform of Src Bone

    // ( animated.joint.world.pos - tpose.joint.world.pos ) * ( tarHipHeight / srcHipHeight )
    const transform_offset: Vec3 = new Vec3()
      .fromSub(source_ws_transform.pos, source_t_pose_joint.world.pos)
      .scale(scale_delta)

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Neutral Transform
    const parent_transform: Transform = this.pose.getWorld(tar.pidx)
    const ctran: Transform = new Transform().fromMul(parent_transform, this.tarRig.tpose.joints[tar.idx].local)

    // Add scaled offset translation
    const pos: Vec3 = new Vec3().fromAdd(ctran.pos, transform_offset)

    // Save to local space
    this.pose.setPos(tar.idx, parent_transform.toLocalPos(pos))
  }
  // #endregion

  // #region THREEJS HELPERS
  /**
   *  Run three.js GetWorld functions & return as a Transform Object
   * @param skel THREE.Skeleton to get bone from
   * @param bone_idx Bone index
   * @param trans Transform object to store result in
   * @returns transform object for chaining. Also mutates the original transform passed in
   */
  public getWorld (skel: THREE.Skeleton, bone_idx: number, trans: Transform = new Transform()): Transform {
    const b: THREE.Bone = skel.bones[bone_idx]
    const p: THREE.Vector3 = b.getWorldPosition(new THREE.Vector3())
    const q: THREE.Quaternion = b.getWorldQuaternion(new THREE.Quaternion())

    trans.pos[0] = p.x
    trans.pos[1] = p.y
    trans.pos[2] = p.z

    trans.rot[0] = q.x
    trans.rot[1] = q.y
    trans.rot[2] = q.z
    trans.rot[3] = q.w

    // SCALE - Not Needed for this proto
    return trans
  }

  // Make a rotation's invert directions match the target directions
  // Create neutral transfroms for each joint as a starting point
  // which is the current pose's parent joint worldspace transform applied
  // to the local space tpose transform of the joint.
  // This gives the transform of the joint as if itself has not change
  // but its heirarchy has.
  public applySwingTwist (itm: RigItem, tSwing: Vec3, tTwist: Vec3, tpose: Pose, pose: Pose): Quat {
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Compute Neutral Transform of the joint
    // curentPose.parentJoint.world.rot * tPose.joint.local.rot
    const j: Joint = tpose.joints[itm.idx]
    const ptran: Transform = pose.getWorld(j.pindex) // Get WS of current pose of parent joint
    const ctran: Transform = new Transform().fromMul(ptran, j.local) // Apply to Tpose's locaa for neutral rotation
    const dir: Vec3 = new Vec3()
    const source_rot: Quat = new Quat()
    const target_rot: Quat = new Quat()

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // SWING
    dir.fromQuat(ctran.rot, itm.swing) // Get Worldspace direction
    source_rot.fromSwing(dir, tSwing) // Compute rot current dir to target dir
      .mul(ctran.rot) // PMul result to neutral rotation

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Twist
    dir.fromQuat(source_rot, itm.twist) // Get WS twist direction after swring rotation
    target_rot.fromSwing(dir, tTwist) // Compute rot to make twist vectors match
      .mul(source_rot) // twist * ( swing * neutral )
      .pmulInvert(ptran.rot) // To Localspace

    return target_rot
  }
  // #endregion
}
