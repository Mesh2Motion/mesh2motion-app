import { Quaternion, Vector3, type Bone, type Object3D, type Skeleton, type QuaternionKeyframeTrack, type VectorKeyframeTrack } from 'three'
import { type Rig } from './human-retargeting/Rig.ts'
import { type Joint } from './human-retargeting/Joint.ts'
import { RetargetUtils } from './RetargetUtils.ts'
import { type BoneRestTransform } from './interfaces/BoneRestTransform'
import { type RestPoseSnapshot } from './interfaces/RestPoseSnapshot'

interface QuatDelta {
  angle_degrees: number
  axis: Vector3
}

interface DeltaRow {
  bone: string
  angle_degrees: number
  axis: string
  driven: boolean
}

/**
 * Temporary instrumentation for the swing/twist retargeting path.
 *
 * WHY THIS EXISTS
 * ---------------
 * Retargeting at rest is provably a no-op. RigItem.fromJoint stores each bone's
 * swing/twist axes as `inv(joint_rest_world_rot) * canonical_axis`, so when the source
 * sits at the rest pose that those axes were sampled from:
 *
 *   source_swing    = q_src_rest * inv(q_src_rest) * S = S
 *   swing_direction = q_tar_rest * inv(q_tar_rest) * S = S
 *   Quat.fromSwing(S, S)                              = identity
 *
 * The target therefore keeps its rest local rotation exactly, no matter how differently
 * the two rigs are oriented -- differing rest conventions cancel out for free. So any
 * visible offset of the target at rest is a bug, and it has to be a break in one of two
 * consistency requirements:
 *
 *   (a) SOURCE: the Pose-computed rest world rotation must equal what three.js
 *       getWorldQuaternion() reports for the same skeleton state, because applyChain()
 *       reads the animated source through three.js but derived its axes from Pose.
 *   (b) TARGET: the locals written back into the CLONED skeleton must be relative to the
 *       same parent chain the REAL skeleton has, because bake_animation_to_tracks samples
 *       the clone and those tracks are replayed on the real skeleton.
 *
 * Each check below isolates one way those can break. Everything reports quaternion
 * deltas as axis + angle, because the axis is what identifies the leaking transform.
 */
export class RetargetDiagnostics {
  /** Master switch. Set to false to silence all retargeting instrumentation. */
  public static readonly ENABLED: boolean = true

  /** Deltas below this are floating point noise, not findings. */
  private static readonly THRESHOLD_DEGREES: number = 0.5

  /** Rows printed per table before truncating. */
  private static readonly MAX_ROWS: number = 20

  // #region SNAPSHOT

  /**
   * Build the rest-pose reference every check is measured against.
   *
   * Pass `rest_transforms` whenever the live skeleton might be mid-animation (it usually
   * is -- stopAllAction does not restore bone locals). World rotations are then composed
   * from those rest locals up the real parent chain, with non-bone ancestors contributing
   * their actual world rotation, so the reference is a true rest pose either way.
   */
  public static capture_rest_snapshot (
    skeleton: Skeleton,
    rest_transforms: BoneRestTransform[] = []
  ): RestPoseSnapshot {
    const use_rest: boolean = rest_transforms.length === skeleton.bones.length
    const index_of = new Map<Bone, number>()
    skeleton.bones.forEach((bone, index) => index_of.set(bone, index))

    const local_of = (bone: Bone): Quaternion => {
      const index = index_of.get(bone)
      return (use_rest && index !== undefined) ? rest_transforms[index].quaternion : bone.quaternion
    }

    const snapshot: RestPoseSnapshot = {
      bone_names: skeleton.bones.map((bone) => bone.name),
      local_rotations: skeleton.bones.map((bone) => local_of(bone).clone()),
      world_rotations: []
    }

    skeleton.bones.forEach((bone) => {
      const world = new Quaternion()
      let current: Object3D | null = bone

      while (current !== null && current.type === 'Bone') {
        world.premultiply(local_of(current as Bone))
        current = current.parent
      }

      // whatever sits above the bones (the armature) contributes its live world rotation
      if (current !== null) {
        current.updateWorldMatrix(true, false)
        world.premultiply(current.getWorldQuaternion(new Quaternion()))
      }

      snapshot.world_rotations.push(world)
    })

    return snapshot
  }

  // #endregion

  // #region CHECKS

  /**
   * Structural assumptions that Pose.fromSkeleton makes about the bone array.
   * Pose derives poseOffset from bones[0].parent and links parents by name against a
   * map that only holds already-iterated bones, so bone ordering and naming matter.
   */
  public static report_skeleton_structure (label: string, skeleton: Skeleton): void {
    if (!this.ENABLED) return

    const bones: Bone[] = skeleton.bones
    const index_of = new Map<Bone, number>()
    bones.forEach((bone, index) => index_of.set(bone, index))

    // bones whose parent is not a Bone are the tops of the hierarchy. Pose can only
    // represent ONE of these, since rootOffset/poseOffset is a single shared transform
    const hierarchy_roots = bones.filter((bone) => bone.parent?.type !== 'Bone')

    // Pose.updateWorld() walks the joint array in order and assumes a parent has already
    // been resolved by the time its child is reached
    const out_of_order = bones.filter((bone) => {
      const parent_index = bone.parent !== null ? index_of.get(bone.parent as Bone) : undefined
      return parent_index !== undefined && parent_index > (index_of.get(bone) ?? 0)
    })

    // Pose links parents by NAME, so duplicates silently mis-link
    const seen = new Set<string>()
    const duplicate_names = new Set<string>()
    bones.forEach((bone) => {
      if (seen.has(bone.name)) duplicate_names.add(bone.name)
      seen.add(bone.name)
    })

    console.group(`[retarget-diag] ${label} skeleton structure (${bones.length} bones)`)
    console.log('bones[0]:', bones[0]?.name, '| parent type:', bones[0]?.parent?.type,
      '| is a hierarchy root:', bones[0]?.parent?.type !== 'Bone')
    console.log('hierarchy roots:', hierarchy_roots.map((bone) => bone.name))

    // the armature transform(s) sitting above the bones. This is the transform that gets
    // double applied when native Skeleton.pose() writes a bind WORLD matrix into a local
    const armatures = new Set(hierarchy_roots.map((bone) => bone.parent).filter((parent) => parent !== null))
    armatures.forEach((armature) => {
      armature.updateWorldMatrix(true, false)
      const rotation = armature.getWorldQuaternion(new Quaternion())
      const scale = armature.getWorldScale(new Vector3())
      const as_axis_angle = this.delta_to_axis_angle(new Quaternion(), rotation)
      console.log(`armature "${armature.name}" (${armature.type}) world rotation:`,
        `${as_axis_angle.angle_degrees.toFixed(2)} deg about ${this.format_axis(as_axis_angle.axis)}`,
        '| world scale:', `[${scale.toArray().map((v) => v.toFixed(4)).join(', ')}]`)
    })

    if (hierarchy_roots.length > 1) {
      console.warn(`FINDING: ${hierarchy_roots.length} hierarchy roots. Pose has a single ` +
        'poseOffset and cannot represent more than one.')
    }
    if (out_of_order.length > 0) {
      console.warn('FINDING: bones listed before their own parent (Pose.fromSkeleton will ' +
        'leave pindex = -1 and treat these as hierarchy roots):', out_of_order.map((b) => b.name))
    }
    if (duplicate_names.size > 0) {
      console.warn('FINDING: duplicate bone names (Pose links parents by name):', [...duplicate_names])
    }
    console.groupEnd()
  }

  /**
   * Does the Rig's captured T-pose actually match the live skeleton it was built from?
   *
   * A non-zero LOCAL delta confined to hierarchy-root bones, all equal to the armature's
   * world rotation, is the signature of native Skeleton.pose() writing a bind WORLD
   * matrix into a bone local without dividing out the armature transform.
   */
  public static report_pose_fidelity (label: string, snapshot: RestPoseSnapshot, rig: Rig): void {
    if (!this.ENABLED) return

    const driven: Set<number> = this.driven_bone_indices(rig)
    const local_rows: DeltaRow[] = []
    const world_rows: DeltaRow[] = []

    rig.tpose.joints.forEach((joint: Joint, index: number) => {
      const reference_local = snapshot.local_rotations[index]
      const reference_world = snapshot.world_rotations[index]
      if (reference_local === undefined || reference_world === undefined) return

      const local_delta = this.delta_to_axis_angle(reference_local, this.to_quaternion(joint.local.rot))
      const world_delta = this.delta_to_axis_angle(reference_world, this.to_quaternion(joint.world.rot))

      if (local_delta.angle_degrees > this.THRESHOLD_DEGREES) {
        local_rows.push(this.to_row(joint.name, local_delta, driven.has(index)))
      }
      if (world_delta.angle_degrees > this.THRESHOLD_DEGREES) {
        world_rows.push(this.to_row(joint.name, world_delta, driven.has(index)))
      }
    })

    console.group(`[retarget-diag] ${label} T-pose fidelity vs live skeleton`)
    this.print_rows('LOCAL rotation deltas (expected: none)', local_rows)
    this.print_rows('WORLD rotation deltas (expected: none)', world_rows)

    const pose_offset = this.delta_to_axis_angle(new Quaternion(), this.to_quaternion(rig.tpose.poseOffset.rot))
    console.log('Pose.poseOffset rotation:',
      `${pose_offset.angle_degrees.toFixed(2)} deg about ${this.format_axis(pose_offset.axis)}`,
      '| scale:', `[${Array.from(rig.tpose.poseOffset.scl).map((v) => v.toFixed(4)).join(', ')}]`)

    const orphans = rig.tpose.joints.filter((joint) => joint.pindex === -1)
    console.log('joints with pindex === -1 (treated as hierarchy roots by Pose):',
      orphans.map((joint) => joint.name))
    console.groupEnd()
  }

  /**
   * Requirement (a). applyChain() samples the animated source with three.js
   * getWorldQuaternion(), but RigItem derived the source's swing/twist axes from Pose's
   * world rotations. If those two disagree for the same skeleton state, every source
   * axis is silently rotated by the difference. Call this BEFORE the mixer runs.
   */
  public static report_source_consistency (rig: Rig, skeleton: Skeleton): void {
    if (!this.ENABLED) return

    const driven: Set<number> = this.driven_bone_indices(rig)
    const rows: DeltaRow[] = []

    rig.tpose.joints.forEach((joint: Joint, index: number) => {
      const bone: Bone | undefined = skeleton.bones[index]
      if (bone === undefined) return

      bone.updateWorldMatrix(true, false)
      const three_world = bone.getWorldQuaternion(new Quaternion())
      const delta = this.delta_to_axis_angle(three_world, this.to_quaternion(joint.world.rot))

      if (delta.angle_degrees > this.THRESHOLD_DEGREES) {
        rows.push(this.to_row(joint.name, delta, driven.has(index)))
      }
    })

    console.group('[retarget-diag] SOURCE Pose world vs three.js getWorldQuaternion')
    this.print_rows('deltas (expected: none -- any delta rotates the source swing/twist axes)', rows)
    console.groupEnd()
  }

  /**
   * End-to-end predictor of what the user actually sees. Compares frame 0 of every baked
   * quaternion track against the real skeleton's rest local rotation.
   *
   * The source clip is not exactly at rest on frame 0, so DRIVEN bones are expected to
   * show a small delta. UNDRIVEN bones must show zero: they were never retargeted, so a
   * track that moves them is carrying a corrupted rest pose out of the clone.
   */
  public static report_baked_frame_zero (
    tracks: Array<QuaternionKeyframeTrack | VectorKeyframeTrack>,
    snapshot: RestPoseSnapshot,
    rig: Rig
  ): void {
    if (!this.ENABLED) return

    const driven: Set<number> = this.driven_bone_indices(rig)
    const driven_names = new Set<string>()
    driven.forEach((index) => {
      const name = rig.tpose.joints[index]?.name
      if (name !== undefined) driven_names.add(name)
    })

    const rows: DeltaRow[] = []
    const frame_zero = new Quaternion()

    tracks.forEach((track) => {
      const parts = RetargetUtils.parse_track_name_for_metadata(track.name)
      if (parts === null || parts.property !== 'quaternion') return

      const bone_index = snapshot.bone_names.indexOf(parts.bone_name)
      const reference_local = snapshot.local_rotations[bone_index]
      if (reference_local === undefined) return

      frame_zero.fromArray(track.values as unknown as number[], 0)
      const delta = this.delta_to_axis_angle(reference_local, frame_zero)

      if (delta.angle_degrees > this.THRESHOLD_DEGREES) {
        rows.push(this.to_row(parts.bone_name, delta, driven_names.has(parts.bone_name)))
      }
    })

    const undriven_rows = rows.filter((row) => !row.driven)

    console.group('[retarget-diag] baked frame 0 vs real skeleton rest pose')
    this.print_rows('all bones that move on frame 0', rows)

    if (undriven_rows.length > 0) {
      console.warn(`FINDING: ${undriven_rows.length} UNMAPPED bone(s) are being moved off ` +
        'their rest pose. These were never retargeted, so the offset is a corrupted rest ' +
        'pose leaking out of the cloned skeleton. Largest:',
      `${undriven_rows[0].angle_degrees.toFixed(2)} deg about ${undriven_rows[0].axis} on "${undriven_rows[0].bone}"`)
    } else {
      console.log('No unmapped bone moves off rest. The rest-pose invariant holds.')
    }
    console.groupEnd()
  }

  // #endregion

  // #region HELPERS

  /** Quat/Vec3 in the retargeting math extend Array, so they index like [x, y, z, w]. */
  private static to_quaternion (rot: ArrayLike<number>): Quaternion {
    return new Quaternion(rot[0], rot[1], rot[2], rot[3])
  }

  /** Bone indices that are actually part of a mapped chain, so actually retargeted. */
  private static driven_bone_indices (rig: Rig): Set<number> {
    const indices = new Set<number>()
    Object.values(rig.chains).forEach((chain) => {
      chain.forEach((item) => {
        if (item.idx !== -1) indices.add(item.idx)
      })
    })
    return indices
  }

  /**
   * Rotation that takes `from` to `to`, expressed as an axis and a positive angle.
   * The axis is the useful half: it names the transform that leaked in.
   */
  private static delta_to_axis_angle (from: Quaternion, to: Quaternion): QuatDelta {
    const delta = from.clone().invert().multiply(to)

    // a quaternion and its negation are the same rotation. Pick the short way round
    if (delta.w < 0) {
      delta.set(-delta.x, -delta.y, -delta.z, -delta.w)
    }

    const half_angle = Math.acos(Math.min(1, Math.max(-1, delta.w)))
    const sin_half = Math.sin(half_angle)
    const axis = sin_half > 1e-6
      ? new Vector3(delta.x / sin_half, delta.y / sin_half, delta.z / sin_half)
      : new Vector3(0, 0, 0)

    return { angle_degrees: half_angle * 2 * 180 / Math.PI, axis }
  }

  /** Format an axis so a recognizable one (a bare X/Y/Z) is obvious at a glance. */
  private static format_axis (axis: Vector3): string {
    const formatted = `[${axis.toArray().map((v) => v.toFixed(3)).join(', ')}]`
    const named = [
      { name: '+X', vector: new Vector3(1, 0, 0) },
      { name: '-X', vector: new Vector3(-1, 0, 0) },
      { name: '+Y', vector: new Vector3(0, 1, 0) },
      { name: '-Y', vector: new Vector3(0, -1, 0) },
      { name: '+Z', vector: new Vector3(0, 0, 1) },
      { name: '-Z', vector: new Vector3(0, 0, -1) }
    ].find((candidate) => candidate.vector.distanceTo(axis) < 0.01)

    return named !== undefined ? `${named.name} ${formatted}` : formatted
  }

  private static to_row (bone: string, delta: QuatDelta, driven: boolean): DeltaRow {
    return {
      bone,
      angle_degrees: Number(delta.angle_degrees.toFixed(3)),
      axis: this.format_axis(delta.axis),
      driven
    }
  }

  private static print_rows (title: string, rows: DeltaRow[]): void {
    if (rows.length === 0) {
      console.log(`${title}: none above ${this.THRESHOLD_DEGREES} deg`)
      return
    }

    rows.sort((a, b) => b.angle_degrees - a.angle_degrees)
    console.log(`${title}: ${rows.length} bone(s), max ${rows[0].angle_degrees} deg ` +
      `about ${rows[0].axis} on "${rows[0].bone}"`)
    console.table(rows.slice(0, this.MAX_ROWS))
    if (rows.length > this.MAX_ROWS) {
      console.log(`... ${rows.length - this.MAX_ROWS} more row(s) not shown`)
    }
  }

  // #endregion
}
