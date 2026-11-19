import { Bone, Matrix4, Skeleton, type Object3D, type Scene, type SkinnedMesh } from 'three'
import { type RootBoneChain } from './interfaces/RootBoneChain'

/**
 * Resolves FBX imports that contain multiple disconnected bone hierarchies
 * (multiple root bones). Mesh2Motion only supports a single skeleton
 * hierarchy, so the user picks the main root bone and everything belonging to
 * the other hierarchies is removed: the skinned meshes bound to them, the
 * bone subtrees, and the skeleton bindings are rebuilt so the removed bones no
 * longer exist in the scene.
 */
export class MultiRootSkeletonResolver {
  /**
   * Detects whether the model contains more than one disconnected bone
   * hierarchy. Returns all root bone chains found.
   */
  public static find_root_bone_chains (model: Scene): RootBoneChain[] {
    const root_bones: Bone[] = this.find_root_bones(model)

    return root_bones.map((root_bone) => {
      const skinned_meshes: SkinnedMesh[] = []
      model.traverse((child: Object3D) => {
        if (child.type === 'SkinnedMesh') {
          const skinned_mesh = child as SkinnedMesh
          if (this.skinned_mesh_is_bound_to(skinned_mesh, root_bone)) {
            skinned_meshes.push(skinned_mesh)
          }
        }
      })

      return {
        root_bone,
        bone_count: this.count_bones_in_chain(root_bone),
        skinned_meshes,
        vertex_count: this.count_vertices(skinned_meshes)
      }
    })
  }

  /**
   * True when the model has more than one disconnected bone hierarchy.
   */
  public static has_multiple_root_bones (model: Scene): boolean {
    return this.find_root_bones(model).length > 1
  }

  /**
   * Removes every bone hierarchy except the one rooted at the bone with the
   * given uuid. Meshes bound only to removed hierarchies are removed and
   * disposed. Meshes whose skeletons reference the kept hierarchy are re-bound
   * to rebuilt skeletons that no longer contain removed bones.
   *
   * This must run before the model is added to the render scene and before
   * skeleton helpers or animation retargeting reference the bones.
   */
  public static keep_single_root_bone (model: Scene, kept_root_uuid: string): void {
    const chains: RootBoneChain[] = this.find_root_bone_chains(model)
    const kept_chain = chains.find((chain) => chain.root_bone.uuid === kept_root_uuid)

    if (kept_chain === undefined) {
      console.warn('MultiRootSkeletonResolver: could not find root bone to keep', kept_root_uuid)
      return
    }

    const removed_chains = chains.filter((chain) => chain !== kept_chain)
    const removed_bone_uuids: Set<string> = new Set<string>()

    removed_chains.forEach((chain) => {
      chain.root_bone.traverse((child: Object3D) => {
        if (child.type === 'Bone') {
          removed_bone_uuids.add(child.uuid)
        }
      })
    })

    // First pass: classify each skinned mesh and re-bind the ones we keep
    const meshes_to_remove: SkinnedMesh[] = []

    model.traverse((child: Object3D) => {
      if (child.type !== 'SkinnedMesh') {
        return
      }

      const skinned_mesh = child as SkinnedMesh
      const references_kept = this.skinned_mesh_is_bound_to(skinned_mesh, kept_chain.root_bone)

      if (!references_kept) {
        // bound only to removed hierarchies: drop the mesh entirely
        meshes_to_remove.push(skinned_mesh)
        return
      }

      // kept mesh: rebuild the skeleton binding with only kept bones.
      // snapshot the original bone uuids before rebinding, since the
      // geometry's skinIndex attribute still points into the old skeleton
      const old_bone_uuids: string[] = skinned_mesh.skeleton.bones.map((bone) => bone.uuid)
      const kept_bones: Bone[] = []
      const kept_bone_inverses: Matrix4[] = []
      const kept_bone_index_by_uuid: Map<string, number> = new Map<string, number>()

      skinned_mesh.skeleton.bones.forEach((bone, index) => {
        if (!removed_bone_uuids.has(bone.uuid)) {
          kept_bone_index_by_uuid.set(bone.uuid, kept_bones.length)
          kept_bones.push(bone)
          kept_bone_inverses.push(skinned_mesh.skeleton.boneInverses[index])
        }
      })

      // swap the skeleton binding over to the rebuilt skeleton. we pass the
      // explicit bone inverses so bind() does not recalculate them from the
      // current pose, which would break the original skinning
      skinned_mesh.bind(new Skeleton(kept_bones, kept_bone_inverses), skinned_mesh.bindMatrix)

      // remap the vertex skin indices from old bone positions to new ones
      this.remap_skin_indices(skinned_mesh, old_bone_uuids, kept_bone_index_by_uuid)
    })

    // Second pass: remove discarded meshes and bone subtrees from the scene
    meshes_to_remove.forEach((skinned_mesh) => {
      skinned_mesh.removeFromParent()
      skinned_mesh.geometry.dispose()

      const materials = Array.isArray(skinned_mesh.material) ? skinned_mesh.material : [skinned_mesh.material]
      materials.forEach((material) => { material.dispose() })
    })

    removed_chains.forEach((chain) => {
      chain.root_bone.removeFromParent()
    })

    model.updateMatrixWorld(true)
  }

  /**
   * Collects the topmost bones of every disconnected bone hierarchy in the
   * model. A bone is a root when its parent is not a Bone. Only bones actually
   * referenced by a SkinnedMesh skeleton are considered, so unrelated
   * decoration objects do not create phantom hierarchies.
   */
  private static find_root_bones (model: Scene): Bone[] {
    const root_bones: Bone[] = []

    model.traverse((child: Object3D) => {
      if (child.type !== 'SkinnedMesh') {
        return
      }

      const skinned_mesh = child as SkinnedMesh
      skinned_mesh.skeleton.bones.forEach((bone) => {
        const is_root = bone.parent === null || bone.parent.type !== 'Bone'
        if (is_root && !root_bones.includes(bone)) {
          root_bones.push(bone)
        }
      })
    })

    return root_bones
  }

  /**
   * True when any bone in the mesh's skeleton is the root bone or one of its
   * descendants.
   */
  private static skinned_mesh_is_bound_to (skinned_mesh: SkinnedMesh, root_bone: Bone): boolean {
    return skinned_mesh.skeleton.bones.some((bone) => this.bone_is_in_chain(bone, root_bone))
  }

  private static bone_is_in_chain (bone: Bone, root_bone: Bone): boolean {
    let current: Object3D | null = bone
    while (current !== null) {
      if (current === root_bone) {
        return true
      }
      current = current.parent
    }
    return false
  }

  private static count_bones_in_chain (root_bone: Bone): number {
    let count = 0
    root_bone.traverse((child: Object3D) => {
      if (child.type === 'Bone') {
        count++
      }
    })
    return count
  }

  private static count_vertices (skinned_meshes: SkinnedMesh[]): number {
    let count = 0
    skinned_meshes.forEach((skinned_mesh) => {
      const position = skinned_mesh.geometry.getAttribute('position')
      if (position !== undefined) {
        count += position.count
      }
    })
    return count
  }

  /**
   * Rewrites the geometry's skinIndex attribute so it points at the same bones
   * in the rebuilt skeleton. Weight and index entries that pointed at removed
   * bones are zeroed so they contribute nothing.
   * @param old_bone_uuids bone uuids in the skeleton's original bone order,
   * captured before rebinding. The geometry's skinIndex still refers to these.
   */
  private static remap_skin_indices (
    skinned_mesh: SkinnedMesh,
    old_bone_uuids: string[],
    kept_bone_index_by_uuid: Map<string, number>
  ): void {
    const skin_index = skinned_mesh.geometry.getAttribute('skinIndex')
    const skin_weight = skinned_mesh.geometry.getAttribute('skinWeight')

    if (skin_index === undefined || skin_weight === undefined) {
      return
    }

    for (let vertex_index = 0; vertex_index < skin_index.count; vertex_index++) {
      for (let component = 0; component < 4; component++) {
        const old_bone_index: number = skin_index.getComponent(vertex_index, component)
        const bone_uuid: string | undefined = old_bone_uuids[old_bone_index]
        const new_index: number | undefined = bone_uuid !== undefined ? kept_bone_index_by_uuid.get(bone_uuid) : undefined

        if (new_index === undefined) {
          // pointed at a removed bone: contribute nothing
          skin_index.setComponent(vertex_index, component, 0)
          skin_weight.setComponent(vertex_index, component, 0)
        } else {
          skin_index.setComponent(vertex_index, component, new_index)
        }
      }
    }

    // renormalize weights per vertex so zeroed influences do not shrink the skin
    for (let vertex_index = 0; vertex_index < skin_weight.count; vertex_index++) {
      const total: number =
        skin_weight.getComponent(vertex_index, 0) +
        skin_weight.getComponent(vertex_index, 1) +
        skin_weight.getComponent(vertex_index, 2) +
        skin_weight.getComponent(vertex_index, 3)

      if (total > 0 && total !== 1) {
        for (let component = 0; component < 4; component++) {
          skin_weight.setComponent(vertex_index, component, skin_weight.getComponent(vertex_index, component) / total)
        }
      }
    }

    skin_index.needsUpdate = true
    skin_weight.needsUpdate = true
  }
}
