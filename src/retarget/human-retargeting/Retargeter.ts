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
  private animation_frame_id: number | null = null
  private last_time: number = 0

  // corrective rotation applied to top-level target bones (bones with no bone parent).
  // useful when the imported rig has no root bone and the pelvis rest orientation
  // leaves the character tilted (for example face planting after retargeting)
  private root_correction_quat: THREE.Quaternion = new THREE.Quaternion() // identity = no correction
  private has_root_correction: boolean = false
  private readonly top_level_bones: THREE.Bone[] = []

  constructor (source_rig: Rig, target_rig: Rig, clip: THREE.AnimationClip) {
    this.srcRig = source_rig
    this.tarRig = target_rig
    this.clip = clip

    this.pose = this.tarRig.tpose.clone()

    // cache the bones that sit at the top of the hierarchy (no Bone parent).
    // these are the bones a global rig correction must be applied to
    this.top_level_bones = this.tarRig.skel.bones.filter((bone) => bone.parent?.type !== 'Bone')

    this.action = this.mixer.clipAction(this.clip, this.srcRig.skel.bones[0])
    this.action.play()
  }

  // #region METHODS
  public update (delta_time: number): void {
    // Run Animation
    this.mixer.update(delta_time)

    // get a list of all the chains that exist. This list is generated
    // from the config file when the Rig is built.
    for (const chain_name of Object.keys(this.srcRig.chains)) {
      // special chain that also has root motion
      if (chain_name === 'pelvis') {
        // Compute vectors from animation source
        this.applyScaledTranslation(chain_name) // apply position scaling for hips
      }

      // spine gets more fancy algorithm with using interpolation between first and
      // last bones in chain
      if (chain_name === 'spine' && this.is_full_chain('spine')) {
        this.applyEndInterp('spine')
      } else {
        this.applyChain(chain_name)
      }
    }

    // Run Additives if any exist
    for (const i of this.additives) {
      i.apply(this)
    }

    // Apply working pose to 3JS skeleton for rendering
    this.pose.toSkeleton(this.tarRig.skel)

    // apply any global rig correction last so it rotates the whole skeleton
    this.apply_root_correction()
  }

  /**
   * Sets a corrective rotation (in degrees) around the X axis that is applied to
   * the top-level target bone(s) on every update. Use 0 to clear the correction.
   * @param degrees rotation around the X axis in degrees (for example -90 or 90)
   */
  public set_root_correction_x (degrees: number): void {
    this.root_correction_quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), degrees * Math.PI / 180)
    this.has_root_correction = degrees !== 0
  }

  /**
   * Rotates every top-level target bone by the root correction quaternion.
   * Since these bones have no bone parent, this rigidly rotates the entire rig.
   * Both the rotation and position are transformed so baked root motion follows
   * the corrected orientation.
   */
  private apply_root_correction (): void {
    if (!this.has_root_correction) {
      return
    }

    this.top_level_bones.forEach((bone) => {
      // fresh objects are intentionally not used here: premultiply/applyQuaternion
      // mutate the bone transform in place, so no shared temp vector aliasing issues
      bone.quaternion.premultiply(this.root_correction_quat)
      bone.position.applyQuaternion(this.root_correction_quat)
    })
  }

  /**
   * Start an animation loop that continuously updates the retargeting
   * Uses requestAnimationFrame for smooth animation updates
   */
  public start_testing_animation (): void {
    // Initialize last_time on first call
    this.last_time = performance.now()

    const animate = (current_time: number): void => {
      // Calculate delta time in seconds
      const delta_time = (current_time - this.last_time) / 1000
      this.last_time = current_time

      // Update retargeting with calculated delta
      this.update(delta_time)

      // Continue the animation loop
      this.animation_frame_id = requestAnimationFrame(animate)
    }

    // Start the animation loop
    this.animation_frame_id = requestAnimationFrame(animate)
  }

  /**
   * Stop the animation loop started by start_testing_animation()
   */
  public stop_testing_animation (): void {
    if (this.animation_frame_id !== null) {
      cancelAnimationFrame(this.animation_frame_id)
      this.animation_frame_id = null
    }
  }

  /**
   * Bake the retargeted animation into Three.js keyframe tracks
   * Samples the animation at the specified frame rate and captures bone transforms
   * @param fps - Frames per second to sample at (default: 30)
   * @returns Array of keyframe tracks for the retargeted animation
   */
  public bake_animation_to_tracks (fps: number = 30): Array<THREE.QuaternionKeyframeTrack | THREE.VectorKeyframeTrack> {
    const tracks: Array<THREE.QuaternionKeyframeTrack | THREE.VectorKeyframeTrack> = []
    const duration = this.clip.duration
    const frame_time = 1 / fps
    const frame_count = Math.ceil(duration * fps) + 1

    // Storage for keyframe data per bone
    const bone_data = new Map<string, { times: number[], positions: number[], quaternions: number[] }>()

    // Only one bone carries root motion. Figure out which one before we sample
    const root_motion_bone_name: string | null = this.root_motion_bone_name()

    // Initialize storage for each bone in the target skeleton
    this.tarRig.skel.bones.forEach((bone) => {
      bone_data.set(bone.name, {
        times: [],
        positions: [],
        quaternions: []
      })
    })

    // Sample the animation at each frame
    for (let frame = 0; frame < frame_count; frame++) {
      const time = Math.min(frame * frame_time, duration)

      // Update the retargeting with the current time
      this.update(frame_time)

      // Capture transforms from all bones in the target skeleton
      this.tarRig.skel.bones.forEach((bone) => {
        const data = bone_data.get(bone.name)
        if (data === undefined) return

        // Store time
        data.times.push(time)

        // Store position (x, y, z)
        data.positions.push(bone.position.x, bone.position.y, bone.position.z)

        // Store quaternion (x, y, z, w)
        data.quaternions.push(
          bone.quaternion.x,
          bone.quaternion.y,
          bone.quaternion.z,
          bone.quaternion.w
        )
      })
    }

    // Create keyframe tracks from the captured data
    bone_data.forEach((data, bone_name) => {
      // Create quaternion track
      const quat_track = new THREE.QuaternionKeyframeTrack(
        `${bone_name}.quaternion`,
        data.times,
        data.quaternions
      )
      tracks.push(quat_track)

      // add root motion track for the one bone that actually gets translated
      if (bone_name === root_motion_bone_name) {
        const pos_track = new THREE.VectorKeyframeTrack(
          `${bone_name}.position`,
          data.times,
          data.positions
        )
        tracks.push(pos_track)
      }
    })

    console.log(`Baked ${frame_count} frames for ${this.tarRig.skel.bones.length} bones (${tracks.length} tracks)`)

    return tracks
  }

  /**
   * Find the target bone that carries root motion.
   * The pelvis chain is the only chain that gets translated (see applyScaledTranslation),
   * so whatever bone the user mapped there is the one with position data worth baking.
   * Falls back to name matching for rigs that never got a pelvis mapping.
   * @returns bone name, or null if we cannot figure one out
   */
  private root_motion_bone_name (): string | null {

    // Check if the pelvis chain exists and has bones mapped
    const pelvis_chain: RigItem[] = this.tarRig.chains.pelvis
    if (pelvis_chain !== undefined && pelvis_chain.length > 0) {
      const bone: THREE.Bone | undefined = this.tarRig.skel.bones[pelvis_chain[0].idx]
      if (bone !== undefined) {
        return bone.name
      }
    }

    // no pelvis chain mapped...guess from common naming conventions instead
    const root_motion_names: string[] = ['pelvis', 'hips', 'hip']
    const fallback_bone: THREE.Bone | undefined = this.tarRig.skel.bones.find((bone) => {
      const name = bone.name.toLowerCase().trim()
      return root_motion_names.some(candidate => name.includes(candidate))
    })

    if (fallback_bone === undefined) {
      console.warn('Retargeter: Could not find a root motion bone. Baked animation will have no position track')
      return null
    }

    return fallback_bone.name
  }

  /**
   * Retargets a whole chain of bones (like an arm or leg) by matching the swing and twist
   * orientation of each source bone to its corresponding target bone, one-to-one, along the chain.
   * Apply SwingTwist to each joint of a chain, 1 to 1 mappings
   * @param k chain key like 'pelvis', 'armL', etc
   * @returns nothing
   */
  public applyChain (k: string): void {
    const src: RigItem[] = this.srcRig.chains[k]
    const tar: RigItem[] = this.tarRig.chains[k]
    if (!src || !tar || src.length === 0 || tar.length === 0) {
      console.warn('Retargeter: Missing source or target chain for key ', k)
      return
    }

    // Setup ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    const vec: THREE.Vector3 = new THREE.Vector3() // we will copy position data into this
    const quat: THREE.Quaternion = new THREE.Quaternion() // we will copy rotation data into this

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

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

    // Chains can differ in length for some rigs, so iterate only shared indices.
    for (let i = 0; i < Math.min(src.length, tar.length); i++) {
      // Get source swing / twist vectors
      // Pose exists in 3JS skeleton, so need to get its
      // Data through 3JS methods
      bone = this.srcRig.skel.bones[src[i].idx]
      bone.getWorldPosition(vec)
      bone.getWorldQuaternion(quat)
      source_position.xyz(vec.x, vec.y, vec.z)
      source_rotation.xyzw(quat.x, quat.y, quat.z, quat.w)

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

  /**
   * Retargets a chain by interpolating the swing and twist vectors only at the ends of the chain,
   * then smoothly blending (lerping) these vectors for the intermediate joints.
   * @param k chain key like 'spine', etc
   * @returns void
   */
  // Interpolate start & end SwingTwist vectors over a chain
  // k = chain key like 'spine', etc
  public applyEndInterp (k: string): void {
    if (this.srcRig === null || this.tarRig === null || this.pose === null) {
      console.warn('Retargeter: Missing srcRig, tarRig, or pose.')
      return
    }

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    const src: RigItem[] = this.srcRig.chains[k]
    const tar: RigItem[] = this.tarRig.chains[k]
    if (src === null || tar === null) return

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Source rig start & end tranforms and associated swing/twist vectors
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
    let t: number // 0-1 lerp (interpolation) factor for chain

    for (let i = 0; i <= rig_items_count; i++) {
      // evenly spaced bones along the chain
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
  // this will correspond to the hip/root movement that drives root motion
  // this will only be applied to one chain, usually the 'pelvis' chain
  public applyScaledTranslation (k: string): void {
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

  /**
   * Make a rotation's invert directions match the target directions
   * Create neutral transfroms for each joint as a starting point
   * which is the current pose's parent joint worldspace transform applied
   * to the local space tpose transform of the joint.
   * This gives the transform of the joint as if itself has not change but its heirarchy has.
   * This ensures the joint's orientation matches both swing and twist vectors from the source animation,
   * producing natural retargeted motion for the target skeleton.
   *
   * @param rig_item        RigItem for the target joint (contains swing/twist axes)
   * @param tar_swing_dir   Target swing direction vector (from source animation)
   * @param tar_twist_dir   Target twist direction vector (from source animation)
   * @param tpose           Target skeleton's t-pose
   * @param current_pose    Current working pose for the target skeleton
   * @returns               Quaternion representing the final local-space rotation for the joint
   */
  public applySwingTwist (rig_item: RigItem, tar_swing_dir: Vec3, tar_twist_dir: Vec3, tpose: Pose, current_pose: Pose): Quat {
    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Compute Neutral Transform of the joint
    // curentPose.parentJoint.world.rot * tPose.joint.local.rot
    const j: Joint = tpose.joints[rig_item.idx]
    const ptran: Transform = current_pose.getWorld(j.pindex) // Get WS of current pose of parent joint
    const ctran: Transform = new Transform().fromMul(ptran, j.local) // Apply to Tpose's locaa for neutral rotation
    const dir: Vec3 = new Vec3()
    const source_rot: Quat = new Quat()
    const target_rot: Quat = new Quat()

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // SWING
    dir.fromQuat(ctran.rot, rig_item.swing) // Get Worldspace direction
    source_rot.fromSwing(dir, tar_swing_dir) // Compute rot current dir to target dir
      .mul(ctran.rot) // PMul result to neutral rotation

    // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    // Twist
    dir.fromQuat(source_rot, rig_item.twist) // Get WS twist direction after swring rotation
    target_rot.fromSwing(dir, tar_twist_dir) // Compute rot to make twist vectors match
      .mul(source_rot) // twist * ( swing * neutral )
      .pmulInvert(ptran.rot) // To Localspace

    return target_rot
  }
  // #endregion

  /**
   *  Determines if a given chain has values in every slot. This will mess up the 
   * interpolation calculations if trying applyEndInterp(). Use more simple applyChain() instead.
   * @param chain_name string key for chain
   * @returns boolean
   */
  private is_full_chain (chain_name: string): boolean {
    const chain = this.tarRig.chains[chain_name]
    if (chain.length === 0) {
      return false
    }

    return chain.every((item) => item.idx !== -1)
  }
}
