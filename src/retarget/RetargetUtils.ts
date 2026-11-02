import { type Scene, Group, Matrix4, Skeleton, Vector3, Quaternion, type SkinnedMesh, type Bone, type Object3D } from 'three'
import { ModalDialog } from '../lib/ModalDialog.ts'

export interface TrackNameParts {
  bone_name: string
  property: string
}

/** A single bone's local transform, captured while the skeleton is known to be at rest. */
export interface BoneRestTransform {
  position: Vector3
  quaternion: Quaternion
  scale: Vector3
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RetargetUtils {
  /**
   * Convert a Group (with Armature and Bone hierarchy) to a detached THREE.Skeleton
   * @param group The root Group containing the Armature and Bone hierarchy
   * @returns Skeleton or null if not found
   */
  static create_skeleton_from_group_object (group: Group): Skeleton | null {
    const armature = group.children.find(child => child.type === 'Object3D' &&
      child.name.toLowerCase().includes('armature'))

    if (armature === undefined) return null

    const root_bone = armature.children.find(child => child.type === 'Bone') as Bone | undefined
    if (root_bone === undefined) return null

    const detached_armature = armature.clone(true)
    const bones = this.collect_bones(detached_armature)
    if (bones.length === 0) return null

    const skeleton = new Skeleton(bones)
    skeleton.calculateInverses()
    skeleton.pose()
    return skeleton
  }

  /**
   * Recursively collect all bones from an Object3D subtree.
   */
  static collect_bones (object: Object3D, bones: Bone[] = []): Bone[] {
    if (object.type === 'Bone') bones.push(object as Bone)
    object.children.forEach(child => this.collect_bones(child, bones))
    return bones
  }

  /**
   * Resets all SkinnedMeshes in the group to their rest pose.
   *
   * This is a parent-aware version of Skeleton.pose(). The native pose() writes
   * the bind-time WORLD matrix into root bone locals without accounting for the
   * armature node's own transform, so the armature scale/rotation gets applied a
   * second time on the next updateMatrixWorld (e.g. an armature with scale 0.01
   * makes the model render at 1/100th the size the bounding box reports).
   */
  static reset_skinned_mesh_to_rest_pose (skinned_meshes_group: Object3D): void {
    // ensure non-bone parent (armature) world matrices are current
    skinned_meshes_group.updateMatrixWorld(true)

    const parent_inverse = new Matrix4()

    skinned_meshes_group.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh
        const skeleton: Skeleton = skinned_mesh.skeleton

        // first pass: recover the bind-time world matrices
        skeleton.bones.forEach((bone, index) => {
          bone.matrixWorld.copy(skeleton.boneInverses[index]).invert()
        })

        // second pass: convert bind world matrices into bone-local matrices,
        // dividing out whatever transform the parent (bone or armature) has
        skeleton.bones.forEach((bone) => {
          if (bone.parent !== null) {
            parent_inverse.copy(bone.parent.matrixWorld).invert()
            bone.matrix.copy(parent_inverse).multiply(bone.matrixWorld)
          } else {
            bone.matrix.copy(bone.matrixWorld)
          }

          bone.matrix.decompose(bone.position, bone.quaternion, bone.scale)
        })

        skinned_mesh.updateMatrixWorld(true)
      }
    })
  }

  /**
   * Three.js pose() fix for calculating bone local transform from bind-time world matrix.
   * Snapshot every bone's local transform. Call this while the skeleton is known to be at
   * rest (right after load), because once an animation has played there is no longer a
   * reliable way to recover the rest pose: the bind matrices in `boneInverses` are in
   * bind-time space, so dividing them by the *current* parent world reintroduces any
   * transform the app applied afterwards (for example the import scale set in
   * StepLoadTargetModel).
   */
  static capture_bone_rest_transforms (skeleton: Skeleton): BoneRestTransform[] {
    return skeleton.bones.map((bone) => ({
      position: bone.position.clone(),
      quaternion: bone.quaternion.clone(),
      scale: bone.scale.clone()
    }))
  }

  /**
   * Recover the rest pose of a skinned mesh's skeleton from its bind matrices, without
   * touching the live bones. For skeletons that may already be mid-animation, where
   * capture_bone_rest_transforms is too late.
   *
   * At rest, skinning is the identity, which pins each bone's world matrix to
   * meshWorld * bindMatrix^-1 * boneInverse^-1 (attached bind mode). Root bones are then
   * divided by whatever their non-bone parent currently is, so a mesh that was moved or
   * scaled after binding still comes out right.
   */
  static capture_bind_pose_rest_transforms (skinned_mesh: SkinnedMesh): BoneRestTransform[] {
    const skeleton: Skeleton = skinned_mesh.skeleton
    skinned_mesh.updateWorldMatrix(true, false)

    // bindMatrixInverse can't be used here: in attached mode three.js overwrites it with the
    // mesh's current inverse world every frame, so invert bindMatrix itself
    const bind_space_to_world = new Matrix4()
    if (skinned_mesh.bindMode === 'attached') {
      bind_space_to_world.copy(skinned_mesh.matrixWorld).multiply(skinned_mesh.bindMatrix.clone().invert())
    }

    const rest_world_matrices: Matrix4[] = skeleton.boneInverses.map((bone_inverse) =>
      bind_space_to_world.clone().multiply(bone_inverse.clone().invert()))

    const parent_inverse = new Matrix4()
    const local = new Matrix4()

    return skeleton.bones.map((bone, index) => {
      const parent_index: number = bone.parent !== null ? skeleton.bones.indexOf(bone.parent as Bone) : -1
      if (parent_index !== -1) {
        parent_inverse.copy(rest_world_matrices[parent_index]).invert()
      } else if (bone.parent !== null) {
        bone.parent.updateWorldMatrix(true, false)
        parent_inverse.copy(bone.parent.matrixWorld).invert()
      } else {
        parent_inverse.identity()
      }

      local.copy(parent_inverse).multiply(rest_world_matrices[index])

      const rest_transform: BoneRestTransform = {
        position: new Vector3(),
        quaternion: new Quaternion(),
        scale: new Vector3()
      }
      local.decompose(rest_transform.position, rest_transform.quaternion, rest_transform.scale)
      return rest_transform
    })
  }

  /**
   * Validates that the retargetable model contains SkinnedMeshes with bones
   * @returns true if valid SkinnedMeshes are found, false otherwise
   */
  static validate_skinned_mesh_has_bones (retargetable_model: Scene, show_error: boolean = true): boolean {
    // Collect all SkinnedMeshes
    let has_skinned_mesh_with_bones = false
    retargetable_model.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        has_skinned_mesh_with_bones = true
      }
    })

    // Check if we have any SkinnedMeshes
    if (!has_skinned_mesh_with_bones) {
      if (show_error) {
        new ModalDialog('No SkinnedMeshes found in file', 'Error opening file').show()
      }
      return false
    }

    console.log('skinned meshes found. ready to start retargeting process:', has_skinned_mesh_with_bones)
    return true
  }

  /**
   * Determines if our target rig is a perfect match to the source rig (M2M) by comparing bone names
   * When this happens, we don't need any bone mapping since we have a 1:1 match
   * @param source_armature Always a Mesh2Motion rig
   * @param target_armature user-uploaded rig
   * @returns boolean indicating if the bone names are identical
   */
  static are_source_and_target_bones_identical (source_armature: Group, target_armature: Scene): boolean {
    // if there is no target armature at all, return false
    if (!this.validate_skinned_mesh_has_bones(target_armature, false)) {
      return false
    }

    // collect all bones from source
    const source_bone_names: Set<string> = new Set<string>()
    source_armature.traverse((child) => {
      if (child.type === 'Bone') {
        source_bone_names.add(child.name)
      }
    })

    let all_bones_match = true
    target_armature.traverse((child) => {
      if (child.type === 'Bone') {
        if (!source_bone_names.has(child.name)) {
          all_bones_match = false
        }
      }
    })

    return all_bones_match
  }

  /**
   * Parse a track name to extract bone name and property (e.g., "quaternion", "position", "scale")
   * Handles various formats like "boneName.property" or ".bones[boneName].property"
   */
  static parse_track_name_for_metadata (track_name: string): TrackNameParts | null {
    // Try format: "boneName.property"
    const simple_match = track_name.match(/^([^.]+)\.(.+)$/)
    if (simple_match !== null) {
      return {
        bone_name: simple_match[1],
        property: simple_match[2]
      }
    }

    // Try format: ".bones[boneName].property"
    const bones_match = track_name.match(/\.bones\[([^\]]+)\]\.(.+)$/)
    if (bones_match !== null) {
      return {
        bone_name: bones_match[1],
        property: bones_match[2]
      }
    }

    return null
  }

  /**
   * Create a reverse mapping: source bone name -> array of target bone names
   * Useful when original map is target -> source but processing needs source -> targets.
   */
  static reverse_bone_mapping (bone_mappings: Map<string, string>): Map<string, string[]> {
    const reverse_mappings = new Map<string, string[]>()
    bone_mappings.forEach((source_bone_name, target_bone_name) => {
      if (!reverse_mappings.has(source_bone_name)) {
        reverse_mappings.set(source_bone_name, [])
      }

      const target_list = reverse_mappings.get(source_bone_name)
      if (target_list !== undefined) {
        target_list.push(target_bone_name)
      }
    })

    return reverse_mappings
  }

  /**
   * Create a reverse mapping for one-to-one use cases: source bone name -> target bone name.
   * If multiple targets map to the same source, the first mapping wins.
   */
  static reverse_bone_mapping_one_to_one (bone_mappings: Map<string, string>): Map<string, string> {
    const reverse_mapping = new Map<string, string>()

    bone_mappings.forEach((source_bone_name, target_bone_name) => {
      if (!reverse_mapping.has(source_bone_name)) {
        reverse_mapping.set(source_bone_name, target_bone_name)
      }
    })

    return reverse_mapping
  }

  /**
   * Clone a skeleton into a detached working copy for retargeting.
   *
   * Why this exists instead of the native three.js `Skeleton.clone()`:
   * - `Skeleton.clone()` does not guarantee a fully detached bone hierarchy suitable for isolated edits.
   * - Our retargeting path needs stable non-bone root parent world transforms for pose offsets.
   * - This function deep-clones bone hierarchies and recreates detached non-bone root parents using
   *   decomposed world transforms, preventing mutation of live scene bones.
   *
   * @param rest_transforms rest pose to restore the clone to, from
   *   `capture_bone_rest_transforms`. Required for correctness: the live skeleton is
   *   usually mid-animation when this is called (stopAllAction does not restore bone
   *   locals), and native `Skeleton.pose()` cannot be used to reset it -- see below.
   */  
  static clone_skeleton (source_skeleton: Skeleton, rest_transforms: BoneRestTransform[] = []): Skeleton {
    const original_to_clone = new Map<Bone, Bone>()

    const root_bones = source_skeleton.bones.filter((bone) =>
      bone.parent === null || bone.parent.type !== 'Bone'
    )

    const detached_parent_cache = new Map<Object3D, Object3D>()

    const ensure_detached_parent = (source_parent: Object3D): Object3D => {
      const cached_parent = detached_parent_cache.get(source_parent)
      if (cached_parent !== undefined) {
        return cached_parent
      }

      const detached_parent = new Group()
      source_parent.updateWorldMatrix(true, false)
      source_parent.matrixWorld.decompose(detached_parent.position, detached_parent.quaternion, detached_parent.scale)
      detached_parent.updateMatrixWorld(true)

      detached_parent_cache.set(source_parent, detached_parent)
      return detached_parent
    }

    root_bones.forEach((root_bone) => {
      const cloned_root = root_bone.clone(true)

      if (root_bone.parent !== null && root_bone.parent.type !== 'Bone') {
        const detached_parent = ensure_detached_parent(root_bone.parent)
        detached_parent.add(cloned_root)
      }

      const stack: Array<{ original: Bone, cloned: Bone }> = [{ original: root_bone, cloned: cloned_root }]

      while (stack.length > 0) {
        const pair = stack.pop()
        if (pair === undefined) continue

        original_to_clone.set(pair.original, pair.cloned)

        const original_children = pair.original.children.filter(child => child.type === 'Bone') as Bone[]
        const cloned_children = pair.cloned.children.filter(child => child.type === 'Bone') as Bone[]

        for (let i = 0; i < original_children.length; i++) {
          stack.push({
            original: original_children[i],
            cloned: cloned_children[i]
          })
        }
      }
    })

    const cloned_bones = source_skeleton.bones
      .map((bone) => original_to_clone.get(bone))
      .filter((bone): bone is Bone => bone !== undefined)

    const cloned_bone_inverses = source_skeleton.boneInverses.map((inverse) => inverse.clone())
    const cloned_skeleton = new Skeleton(cloned_bones, cloned_bone_inverses)

    // Three.js pose() fix for calculating bone local transform from bind-time world matrix.
    // Restore the rest pose from the snapshot rather than calling native Skeleton.pose().
    //
    // pose() recovers each bind-time WORLD matrix from boneInverses, then for any bone
    // whose parent is not a Bone it copies that world matrix straight into the bone's
    // LOCAL matrix without dividing out the parent. Our clone deliberately gives the root
    // bone a detached parent carrying the armature's full world transform (above), so that
    // transform ends up applied twice. The root bone's local picks up an extra copy of the
    // armature rotation, and since every other bone hangs off it the entire rig comes out
    // rigidly rotated -- a Z-up authored rig (armature at -90 X) lands 90 degrees off.
    // This is the same defect described on reset_skinned_mesh_to_rest_pose above.
    if (rest_transforms.length === cloned_bones.length) {
      cloned_bones.forEach((bone, index) => {
        bone.position.copy(rest_transforms[index].position)
        bone.quaternion.copy(rest_transforms[index].quaternion)
        bone.scale.copy(rest_transforms[index].scale)
      })
    } else if (rest_transforms.length > 0) {
      console.warn('RetargetUtils.clone_skeleton: rest transform count does not match bone ' +
        `count (${rest_transforms.length} vs ${cloned_bones.length}). Leaving the clone in ` +
        'its current pose.')
    }

    // make the clone's world matrices valid so consumers reading them get real values
    cloned_bones.forEach((bone) => {
      if (bone.parent?.type !== 'Bone') bone.updateMatrixWorld(true)
    })

    return cloned_skeleton
  }
}
