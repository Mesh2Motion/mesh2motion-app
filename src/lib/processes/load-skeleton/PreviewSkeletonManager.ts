import { Group, Object3D, type Object3DEventMap, SkeletonHelper, type Scene } from 'three'
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import type GLTFResult from './interfaces/GLTFResult'
import { type HandSkeletonType, SkeletonType } from '../../enums/SkeletonType'
import { HandHelper } from './HandHelper'

const skeleton_group_name: string = 'preview_skeleton_group'

// need a function that will add a preview skeleton to the scene
// this will remove any existing preview skeleton first
// and then add the new one based on the selected type
export async function add_preview_skeleton (
  root: Scene,
  skeleton_file_path: SkeletonType,
  hand_skeleton_type: HandSkeletonType,
  skeleton_scale: number = 1.0
): Promise<Object3D<Object3DEventMap>> {
  let preview_skeleton_group = root.getObjectByName(skeleton_group_name) as Group | undefined

  // Check if preview skeleton group exists and matches requested skeleton
  if (preview_skeleton_group !== undefined) {
    // Read previous skeleton info from userData
    const previous_file_path = preview_skeleton_group.userData.skeleton_file_path
    const previous_hand_type = preview_skeleton_group.userData.hand_skeleton_type
    if (previous_file_path === skeleton_file_path && previous_hand_type === hand_skeleton_type) {
      // Only update scale
      preview_skeleton_group.scale.set(skeleton_scale, skeleton_scale, skeleton_scale)
      // Return the first child (should be loaded_scene)
      return preview_skeleton_group.children[0]
    } else {
      // Remove old skeleton group
      remove_preview_skeleton(root)
    }
  }

  // Create new preview skeleton group
  preview_skeleton_group = new Group()
  preview_skeleton_group.name = skeleton_group_name
  // Store current skeleton info for future comparison
  preview_skeleton_group.userData.skeleton_file_path = skeleton_file_path
  preview_skeleton_group.userData.hand_skeleton_type = hand_skeleton_type
  root.add(preview_skeleton_group)

  // Load and customize skeleton
  const loaded_scene: Object3D<Object3DEventMap> = await load_skeleton(skeleton_file_path)
  if (skeleton_file_path === SkeletonType.Human) {
    const helper = new HandHelper()
    helper.modify_hand_skeleton(loaded_scene, hand_skeleton_type)
  }
  const skeleton_helper = new SkeletonHelper(loaded_scene.children[0])
  skeleton_helper.name = 'preview_skeleton'
  preview_skeleton_group.add(skeleton_helper)
  preview_skeleton_group.scale.set(skeleton_scale, skeleton_scale, skeleton_scale)
  root.add(preview_skeleton_group)
  return loaded_scene
}

async function load_skeleton (file_path: string): Promise<Object3D<Object3DEventMap>> {
  const loader = new GLTFLoader()
  const gltf: GLTF | GLTFResult = await loader.loadAsync(file_path)
  // If your GLTFResult extends GLTF and has `.scene`, this is fine:
  return gltf.scene as Object3D<Object3DEventMap>
}

// need a function that will remove the preview skeleton from the scene
export function remove_preview_skeleton (root: Scene): void {
  const skeleton_group = root.getObjectByName(skeleton_group_name)
  if ((skeleton_group?.parent) != null) {
    skeleton_group.parent.remove(skeleton_group)
  }
}

// Function to add a preview skeleton from an already-loaded BVH armature
export async function add_preview_skeleton_from_bvh (
  root: Scene,
  armature: Object3D,
  skeleton_scale: number = 1.0
): Promise<void> {
  // Remove existing preview
  remove_preview_skeleton(root)

  // Bake the scale into the armature bone positions
  if (skeleton_scale !== 1) {
    armature.scale.set(1, 1, 1)
    armature.traverse((obj) => {
      if (obj instanceof Object3D && obj !== armature) {
        obj.position.multiplyScalar(skeleton_scale)
      }
    })
    armature.updateMatrixWorld(true)
  }

  // Create new preview skeleton group
  const preview_skeleton_group = new Group()
  preview_skeleton_group.name = skeleton_group_name
  preview_skeleton_group.userData.is_bvh_import = true
  // Don't apply scale at group level since we've baked it into positions
  preview_skeleton_group.scale.set(1, 1, 1)
  root.add(preview_skeleton_group)

  // Create skeleton helper from the armature
  const skeleton_helper = new SkeletonHelper(armature)
  skeleton_helper.name = 'preview_skeleton'
  preview_skeleton_group.add(skeleton_helper)

  // Add the armature itself to the group so it can be animated
  preview_skeleton_group.add(armature)
}
