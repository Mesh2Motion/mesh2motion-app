import { type Scene, Group, Skeleton, type SkinnedMesh, type Bone, type Object3D } from 'three'
import { ModalDialog } from '../lib/ModalDialog.ts'

export interface TrackNameParts {
  bone_name: string
  property: string
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
   * Resets all SkinnedMeshes in the group to their rest pose
   */
  static reset_skinned_mesh_to_rest_pose (skinned_meshes_group: Scene): void {
    skinned_meshes_group.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh
        const skeleton: Skeleton = skinned_mesh.skeleton
        skeleton.pose()
        skinned_mesh.updateMatrixWorld(true)
      }
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
   */
  static clone_skeleton (source_skeleton: Skeleton): Skeleton {
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
    cloned_skeleton.pose()

    return cloned_skeleton
  }
}
