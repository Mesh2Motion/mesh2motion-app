import { Quaternion, Vector3, type Bone, type Skeleton } from 'three'

/*
 * IndependentBoneMovement
 * Encapsulates the "Move Bone Independently" feature for the Edit Skeleton step.
 *
 * When enabled, moving a bone will not drag its children along with it.  Instead,
 * each direct bone-child's world position is snapshotted at the start of a drag,
 * and then re-expressed in the (moving) parent's local frame every frame so that
 * the children appear stationary in world space.
 *
 * If mirror mode is also active the same behaviour is applied to the mirror bone's
 * children so that both sides of the skeleton stay in sync.
 */
export class IndependentBoneMovement {
  private _enabled: boolean = false
  private readonly _children_initial_world_positions: Map<string, Vector3> = new Map<string, Vector3>()
  private readonly _children_initial_world_rotations: Map<string, Quaternion> = new Map<string, Quaternion>()
  private readonly _rest_bone_world_positions: Map<string, Vector3> = new Map<string, Vector3>()
  private readonly _rest_bone_world_rotations: Map<string, Quaternion> = new Map<string, Quaternion>()

  public is_enabled (): boolean {
    return this._enabled
  }

  public set_enabled (value: boolean): void {
    this._enabled = value
  }

  /**
   * Capture the initial (rest) world-space transforms for all bones.
   * This should be called once when a fresh editable skeleton is created.
   */
  public set_rest_pose (skeleton: Skeleton): void {
    this._rest_bone_world_positions.clear()
    this._rest_bone_world_rotations.clear()

    skeleton.bones.forEach((bone) => {
      const world_pos = new Vector3()
      const world_rot = new Quaternion()
      bone.getWorldPosition(world_pos)
      bone.getWorldQuaternion(world_rot)
      this._rest_bone_world_positions.set(bone.uuid, world_pos.clone())
      this._rest_bone_world_rotations.set(bone.uuid, world_rot.clone())
    })
  }

  /**
   * Snapshot the world-space position and rotation of each direct bone child
   * at drag start.  Clears any previously stored transforms first.
   * When mirror mode is also active, pass the mirror bone as the second argument
   * so its children are tracked in the same pass.
   */
  public record_drag_start (bone: Bone, mirror_bone?: Bone): void {
    this._children_initial_world_positions.clear()
    this._children_initial_world_rotations.clear()
    this._snapshot_direct_children(bone)
    if (mirror_bone !== undefined) {
      this._snapshot_direct_children(mirror_bone)
    }
  }

  /**
   * Re-pin the direct children of a bone to their snapshotted world transforms.
   * Call this every frame while the bone is being dragged.
   * When mirror mode is also active, pass the mirror bone as the second argument
   * so its children are pinned in the same call.
   */
  public apply (bone: Bone, mirror_bone?: Bone): void {
    this._apply_to_bone(bone)
    if (mirror_bone !== undefined) {
      this._apply_to_bone(mirror_bone)
    }
  }

  /**
   * At drag end, update rotation data for the moved bone AND its parent bone.
   *
   * When you translate a bone (e.g. elbow), two rotations change:
   *   1. The PARENT bone (e.g. upper arm) — because the direction from parent
   *      to the moved child has changed.
   *   2. The moved bone itself — because the direction from it to its own
   *      children has changed (children were pinned in place).
   *
   * After each rotation update the affected bone's children are re-pinned so
   * their world-space transforms are preserved.
   */
  public finalize_drop (bone: Bone, mirror_bone?: Bone): void {
    this._finalize_bone_with_parent(bone)

    if (mirror_bone !== undefined) {
      this._finalize_bone_with_parent(mirror_bone)
    }
  }

  private _finalize_bone_with_parent (bone: Bone): void {
    // Snapshot world transforms of the moved bone and its children
    // These are the "ground truth" we want to preserve through rotation updates
    const snapshot = new Map<string, { pos: Vector3, rot: Quaternion }>()
    this._snapshot_bone_and_children(bone, snapshot)

    // - Step 1: Update the PARENT bone's rotation --------------
    // The parent-to-child direction changed because the child was translated.
    const parent_bone = (bone.parent !== null && this._is_bone(bone.parent))
      ? bone.parent
      : null

    if (parent_bone !== null && this._should_update_parent_rotation_from_child_translation(parent_bone)) {
      // Also snapshot siblings so they can be re-pinned after parent rotates
      parent_bone.children.forEach((sibling) => {
        if (sibling === bone || !this._is_bone(sibling)) { return }
        this._snapshot_bone_and_children(sibling, snapshot)
      })

      this._finalize_bone_rotation_from_rest_pose(parent_bone)

      // Re-pin ALL parent children (moved bone + siblings) to their snapshots
      this._repin_children_from_snapshot(parent_bone, snapshot)
    }

    // - Step 2: Update the MOVED bone's rotation ---------------
    // The bone-to-child direction changed because children were pinned in place.
    this._finalize_bone_rotation_from_rest_pose(bone)

    // Re-pin the moved bone's children to their snapshots
    this._repin_children_from_snapshot(bone, snapshot)
  }

  private _snapshot_bone_and_children (bone: Bone, out: Map<string, { pos: Vector3, rot: Quaternion }>): void {
    const pos = new Vector3()
    const rot = new Quaternion()
    bone.getWorldPosition(pos)
    bone.getWorldQuaternion(rot)
    out.set(bone.uuid, { pos: pos.clone(), rot: rot.clone() })

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }
      const child_pos = new Vector3()
      const child_rot = new Quaternion()
      child.getWorldPosition(child_pos)
      child.getWorldQuaternion(child_rot)
      out.set(child.uuid, { pos: child_pos.clone(), rot: child_rot.clone() })
    })
  }

  private _repin_children_from_snapshot (bone: Bone, snapshot: Map<string, { pos: Vector3, rot: Quaternion }>): void {
    const bone_world_rot = new Quaternion()
    bone.getWorldQuaternion(bone_world_rot)
    const inv_bone_world_rot = bone_world_rot.clone().invert()

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }
      const snap = snapshot.get(child.uuid)
      if (snap === undefined) { return }

      const local_pos = snap.pos.clone()
      bone.worldToLocal(local_pos)
      child.position.copy(local_pos)

      const local_rot = inv_bone_world_rot.clone().multiply(snap.rot)
      child.quaternion.copy(local_rot)

      child.updateWorldMatrix(true, true)
    })
  }

  private _snapshot_direct_children (bone: Bone): void {
    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }

      const world_pos = new Vector3()
      const world_rot = new Quaternion()
      child.getWorldPosition(world_pos)
      child.getWorldQuaternion(world_rot)
      this._children_initial_world_positions.set(child.uuid, world_pos.clone())
      this._children_initial_world_rotations.set(child.uuid, world_rot.clone())
    })
  }

  private _apply_to_bone (bone: Bone): void {
    const parent_world_rotation = new Quaternion()
    bone.getWorldQuaternion(parent_world_rotation)
    const inverse_parent_world_rotation = parent_world_rotation.clone().invert()

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }
      const initial_world_pos = this._children_initial_world_positions.get(child.uuid)
      const initial_world_rot = this._children_initial_world_rotations.get(child.uuid)
      if (initial_world_pos === undefined) { return }
      const local_pos = initial_world_pos.clone()
      bone.worldToLocal(local_pos)
      child.position.copy(local_pos)

      if (initial_world_rot !== undefined) {
        const local_rot = inverse_parent_world_rotation.clone().multiply(initial_world_rot)
        child.quaternion.copy(local_rot)
      }

      // updateWorldMatrix(updateParents, updateChildren) - propagate changes up and down the hierarchy
      child.updateWorldMatrix(true, true)
    })
  }

  private _finalize_bone_rotation_from_rest_pose (bone: Bone): void {
    const rest_world_rotation = this._rest_bone_world_rotations.get(bone.uuid)
    const rest_direction = this._average_child_direction_from_rest_pose(bone)
    const current_direction = this._average_child_direction_from_current_pose(bone)

    if (rest_world_rotation === undefined || rest_direction === null || current_direction === null) {
      return
    }

    const world_rotation_delta = new Quaternion().setFromUnitVectors(rest_direction, current_direction)
    const target_world_rotation = world_rotation_delta.multiply(rest_world_rotation.clone())

    const parent_world_rotation = new Quaternion()
    if (bone.parent !== null && 'getWorldQuaternion' in bone.parent) {
      bone.parent.getWorldQuaternion(parent_world_rotation)
    } else {
      parent_world_rotation.identity()
    }

    const target_local_rotation = parent_world_rotation.clone().invert().multiply(target_world_rotation)
    bone.quaternion.copy(target_local_rotation)
    bone.updateWorldMatrix(true, true)
  }

  private _average_child_direction_from_rest_pose (bone: Bone): Vector3 | null {
    const bone_rest_world_position = this._rest_bone_world_positions.get(bone.uuid)
    if (bone_rest_world_position === undefined) {
      return null
    }

    const averaged_direction = new Vector3(0, 0, 0)
    let direction_count = 0

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }
      const child_rest_world_position = this._rest_bone_world_positions.get(child.uuid)
      if (child_rest_world_position === undefined) { return }

      const child_direction = child_rest_world_position.clone().sub(bone_rest_world_position)
      if (child_direction.lengthSq() < 1e-8) { return }

      child_direction.normalize()
      averaged_direction.add(child_direction)
      direction_count += 1
    })

    if (direction_count === 0 || averaged_direction.lengthSq() < 1e-8) {
      return null
    }

    return averaged_direction.normalize()
  }

  private _average_child_direction_from_current_pose (bone: Bone): Vector3 | null {
    const bone_world_position = new Vector3()
    bone.getWorldPosition(bone_world_position)

    const averaged_direction = new Vector3(0, 0, 0)
    let direction_count = 0

    bone.children.forEach((child) => {
      if (!this._is_bone(child)) { return }

      const child_world_position = new Vector3()
      child.getWorldPosition(child_world_position)

      const child_direction = child_world_position.sub(bone_world_position)
      if (child_direction.lengthSq() < 1e-8) { return }

      child_direction.normalize()
      averaged_direction.add(child_direction)
      direction_count += 1
    })

    if (direction_count === 0 || averaged_direction.lengthSq() < 1e-8) {
      return null
    }

    return averaged_direction.normalize()
  }

  private _is_bone (value: unknown): value is Bone {
    if (typeof value !== 'object' || value === null) {
      return false
    }

    if (!('isBone' in value)) {
      return false
    }

    return (value as { isBone?: boolean }).isBone === true
  }

  private _should_update_parent_rotation_from_child_translation (bone: Bone): boolean {
    // Branching parents like chest/pelvis/clavicle hubs should preserve their
    // template orientation when a single child is translated; otherwise the
    // averaged child-direction solve can twist the torso/shoulder backward.
    const bone_children = bone.children.filter((child): child is Bone => this._is_bone(child))
    return bone_children.length <= 1
  }
}
