import { type Group, type Object3DEventMap, type Skeleton, type SkinnedMesh } from 'three'
import { ModalDialog } from '../lib/ModalDialog.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RetargetUtils {
  /**
   * Resets all SkinnedMeshes in the group to their rest pose
   */
  static reset_skinned_mesh_to_rest_pose (skinned_meshes_group: Group<Object3DEventMap>): void {
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
  static validate_skinned_mesh_has_bones (retargetable_model: Group<Object3DEventMap>): boolean {
    // Collect all SkinnedMeshes
    const skinned_meshes: SkinnedMesh[] = []
    retargetable_model.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh
        skinned_meshes.push(skinned_mesh)
      }
    })

    // Check if we have any SkinnedMeshes
    if (skinned_meshes.length === 0) {
      new ModalDialog('No SkinnedMeshes found in file', 'Error opening file').show()
      return false
    }

    console.log('skinned meshes found. ready to start retargeting process:', skinned_meshes)
    return true
  }

  /**
   * Get the animation file path based on skeleton type
   */
  static get_animation_file_path (skeleton_type: SkeletonType): string | null {
    switch (skeleton_type) {
      case SkeletonType.Human:
        return '/animations/human-base-animations.glb'
      case SkeletonType.Quadraped:
        return '/animations/quad-creature-animations.glb'
      case SkeletonType.Bird:
        return '/animations/bird-animations.glb'
      case SkeletonType.Dragon:
        return '/animations/dragon-animations.glb'
      default:
        return null
    }
  }

  /**
   * Create a track name in the format expected by Three.js
   * For named bones, use: BoneName.property
   */
  static create_track_name (bone_name: string, property: string): string {
    return `${bone_name}.${property}`
  }
}
