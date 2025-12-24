import { type Bone, Box3, type Group, type Object3DEventMap, type Scene, type SkinnedMesh, Vector3 } from 'three'
import { type Mesh2MotionEngine } from '../Mesh2MotionEngine.ts'
import { ModalDialog } from '../../lib/ModalDialog.ts'
import { RetargetUtils } from '../RetargetUtils.ts'

/**
 * Handles loading the target model (user-uploaded model) for retargeting
 */
export class StepLoadTargetModel extends EventTarget {
  private readonly mesh2motion_engine: Mesh2MotionEngine
  private file_input: HTMLInputElement | null = null
  private load_model_button: HTMLLabelElement | null = null

  private retargetable_meshes: Scene | null = null

  constructor (mesh2motion_engine: Mesh2MotionEngine) {
    super()
    this.mesh2motion_engine = mesh2motion_engine
  }

  public begin (): void {
    this.add_event_listeners()
  }

  public get_retargetable_meshes (): Scene | null {
    return this.retargetable_meshes
  }

  private add_event_listeners (): void {
    // Get DOM elements
    this.file_input = document.getElementById('upload-file') as HTMLInputElement
    this.load_model_button = document.getElementById('load-model-button') as HTMLLabelElement

    if (this.file_input === null) {
      console.error('Could not find file input element')
      return
    }

    // Add event listener for file selection
    this.file_input.addEventListener('change', (event) => {
      console.log('File input changed', event)
      this.handle_file_select(event)
    })
  }

  private handle_file_select (event: Event): void {
    const target = event.target as HTMLInputElement
    if (target.files !== null && target.files.length > 0) {
      const file = target.files[0]
      console.log('File selected:', file.name, 'Size:', file.size, 'Type:', file.type)

      // Get file extension
      const file_name = file.name.toLowerCase()
      let file_extension = ''
      if (file_name.endsWith('.glb')) {
        file_extension = 'glb'
      } else if (file_name.endsWith('.fbx')) {
        file_extension = 'fbx'
      } else if (file_name.endsWith('.zip')) {
        file_extension = 'zip'
      } else {
        new ModalDialog('Unsupported file type. Please select a GLB, FBX, or ZIP file.', 'Error').show()
        return
      }

      // Configure the model loader to preserve all objects (bones, etc.)
      this.mesh2motion_engine.load_model_step.set_preserve_skinned_mesh(true)

      // Create a URL for the file and load it
      const file_url = URL.createObjectURL(file)

      try {
        this.mesh2motion_engine.load_model_step.load_model_file(file_url, file_extension)

        this.mesh2motion_engine.load_model_step.addEventListener('modelLoadedForRetargeting', () => {
          console.log('Model loaded for retargeting successfully.')
          URL.revokeObjectURL(file_url) // Revoke the object URL after loading is complete

          // read in mesh2motion engine's retargetable model data (this is the target)
          const retargetable_meshes: Scene = this.mesh2motion_engine.load_model_step.get_final_retargetable_model_data()
          const is_valid_skinned_mesh = RetargetUtils.validate_skinned_mesh_has_bones(retargetable_meshes)
          if (is_valid_skinned_mesh) {
            console.log('adding retargetable meshes to scene for retargeting')

            // we have valid skinned mesh(s). The could be very large though,
            // we let's check to see how large everything is
            const bounding_box = new Box3().setFromObject(retargetable_meshes)
            const size = new Vector3()
            bounding_box.getSize(size)
            console.log('Retargetable meshes bounding box size:', size)
            console.log('Skinned mesh data to inspect:', retargetable_meshes)

            RetargetUtils.reset_skinned_mesh_to_rest_pose(retargetable_meshes)
            this.mesh2motion_engine.get_scene().add(retargetable_meshes)

            // if we are too large, scale down the model to fit better
            const largest_dimension: number = this.calculate_max_mesh_dimension(retargetable_meshes)
            if (largest_dimension > 7) {
              const scale_factor = 0.99
              this.scale_skinned_meshes_to_fit_viewport(retargetable_meshes, scale_factor)
              this.move_skinned_meshes_to_ground(retargetable_meshes)
            }

            // Adjust camera based on model size
            // this.adjust_camera_for_model(retargetable_meshes)

            // Add skeleton helper
            this.add_skeleton_helper(retargetable_meshes)

            // Save the final retargetable meshes and dispatch event
            this.retargetable_meshes = retargetable_meshes
            this.dispatchEvent(new CustomEvent('target-model-loaded'))
          }
        }, { once: true })
      } catch (error) {
        console.error('Error loading model:', error)
        new ModalDialog('Error loading model file.', 'Error').show()
        URL.revokeObjectURL(file_url) // Clean up the URL
      }
    }
  }

  private move_skinned_meshes_to_ground (retargetable_meshes: Scene): void {
    // Move so the lowest point is at y=0
    retargetable_meshes.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh
        console.log('current position for mesh: ', skinned_mesh.position)
        // skinned_mesh.position.set(0, 0, 0)
        // skinned_mesh.updateMatrixWorld(true)
      }
    })
  }

  private scale_skinned_meshes_to_fit_viewport (retargetable_meshes: Scene, scale_factor: number): void {
    // armatures seem to be the way to scale skinned meshes properly
    // scale down the root bone of each skinned mesh
    // it will automatically scale down the meshes along with it
    retargetable_meshes.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh

        // Scale the skeleton root bone instead
        if (skinned_mesh.skeleton.bones.length > 0) {
          const root = skinned_mesh.skeleton.bones[0]
          // Find the actual root (traverse up to the top-most bone)
          let actual_root = root
          while ((actual_root.parent != null) && actual_root.parent.type === 'Bone') {
            actual_root = actual_root.parent as Bone
          }
          actual_root.scale.multiplyScalar(scale_factor)
          actual_root.updateMatrixWorld(true)
          skinned_mesh.skeleton.update()
        }
      }
    })
  }

  private add_skeleton_helper (retargetable_meshes: Scene): void {
    retargetable_meshes.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh
        this.mesh2motion_engine.regenerate_skeleton_helper(skinned_mesh.skeleton, 'Retarget Skeleton Helper')
      }
    })
  }

  // gets max dimension of the model for scaling
  // returns a unitless number representing the largest dimension
  private calculate_max_mesh_dimension (retargetable_meshes: Scene): number {
    const bounding_box = new Box3().setFromObject(retargetable_meshes)
    const size = new Vector3()
    bounding_box.getSize(size)
    return Math.max(size.x, size.y, size.z)
  }

  private adjust_camera_for_model (model_group: Scene): void {
    // Calculate bounding box of the model
    const bounding_box = new Box3().setFromObject(model_group)

    // Calculate model dimensions
    const size = new Vector3()
    bounding_box.getSize(size)

    // Calculate center of the model
    const center = new Vector3()
    bounding_box.getCenter(center)

    // Get the maximum dimension (height, width, or depth)
    const max_dimension = Math.max(size.x, size.y, size.z)

    // Disable fog for retargeting to prevent models from appearing foggy when zoomed far out
    if (max_dimension > 50) {
      console.log('Model is very large. Removing fog to increase visibility: ', max_dimension)
      this.mesh2motion_engine.set_fog_enabled(false)
    }

    // Calculate appropriate camera distance
    // Use a multiplier to ensure the entire model is visible
    // The 2.5 multiplier provides good framing with some padding
    const camera_distance = max_dimension * 2.5

    // Position camera to look at the center of the model
    // Keep camera slightly elevated (looking down at the model)
    const camera_position = new Vector3(
      center.x,
      center.y + max_dimension * 0.3, // Slight elevation based on model size
      center.z + camera_distance
    )

    this.mesh2motion_engine.set_camera_position(camera_position)

    console.log('Adjusted camera for model:', {
      bounding_box_size: size,
      center,
      max_dimension,
      camera_distance,
      camera_position
    })
  }
}
