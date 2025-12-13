import { Mesh2MotionEngine } from '../Mesh2MotionEngine.ts'
import { type Group, type Object3DEventMap, type SkinnedMesh, Vector3 } from 'three'
import { ModalDialog } from '../lib/ModalDialog.ts'
import { StepLoadTargetSkeleton } from './StepLoadTargetSkeleton.ts'
import { StepBoneMapping } from './StepBoneMapping.ts'
import { RetargetUtils } from './RetargetUtils.ts'

class RetargetModule {
  private readonly mesh2motion_engine: Mesh2MotionEngine
  private fileInput: HTMLInputElement | null = null
  private load_model_button: HTMLLabelElement | null = null
  private bone_map_button: HTMLButtonElement | null = null
  private readonly step_load_target_skeleton: StepLoadTargetSkeleton
  private readonly step_bone_mapping: StepBoneMapping

  constructor () {
    // Set up camera position similar to marketing bootstrap
    this.mesh2motion_engine = new Mesh2MotionEngine()
    const camera_position = new Vector3().set(0, 1.7, 5)
    this.mesh2motion_engine.set_camera_position(camera_position)
    
    // Initialize skeleton loading step
    this.step_load_target_skeleton = new StepLoadTargetSkeleton(this.mesh2motion_engine.get_scene())
    
    // Initialize bone mapping step
    this.step_bone_mapping = new StepBoneMapping(this.mesh2motion_engine.get_scene())
  }

  public init (): void {
    this.add_event_listeners()
    this.step_load_target_skeleton.begin()
  }

  public add_event_listeners (): void {
    // Get DOM elements
    this.fileInput = document.getElementById('upload-file') as HTMLInputElement
    this.load_model_button = document.getElementById('load-model-button') as HTMLLabelElement
    this.bone_map_button = document.getElementById('bone-map-button') as HTMLButtonElement

    // Add event listener for file selection
    this.fileInput.addEventListener('change', (event) => {
      console.log('File input changed', event)
      this.handleFileSelect(event)
    })
    
    // Listen for target skeleton loaded
    this.step_load_target_skeleton.addEventListener('skeleton-loaded', () => {
      const target_armature = this.step_load_target_skeleton.get_loaded_target_armature()
      const skeleton_type = this.step_load_target_skeleton.get_skeleton_type()
      this.step_bone_mapping.set_target_skeleton_data(target_armature, skeleton_type)
    })
    
    // Bone map button click listener
    this.bone_map_button?.addEventListener('click', () => {
      this.handle_bone_map_requested()
    })
  }

  private handleFileSelect (event: Event): void {
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

          // read in mesh2motion engine's retargetable model data
          const retargetable_meshes = this.mesh2motion_engine.load_model_step.get_final_retargetable_model_data()
          const is_valid_skinned_mesh = RetargetUtils.validate_skinned_mesh_has_bones(retargetable_meshes)
          if (is_valid_skinned_mesh) {
            console.log('adding retargetable meshes to scene for retargeting')
            RetargetUtils.reset_skinned_mesh_to_rest_pose(retargetable_meshes)
            this.mesh2motion_engine.get_scene().add(retargetable_meshes)

            // Add skeleton helper
            this.add_skeleton_helper(retargetable_meshes)
            
            // Set source skeleton data in bone mapping
            this.step_bone_mapping.set_source_skeleton_data(retargetable_meshes)
          }
        }, { once: true })
      } catch (error) {
        console.error('Error loading model:', error)
        new ModalDialog('Error loading model file.', 'Error').show()
        URL.revokeObjectURL(file_url) // Clean up the URL
      }
    }
  }

  private add_skeleton_helper (retargetable_meshes: Group<Object3DEventMap>): void {
    retargetable_meshes.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh
        this.mesh2motion_engine.regenerate_skeleton_helper(skinned_mesh.skeleton, 'Retarget Skeleton Helper')
      }
    })
  }

  private handle_bone_map_requested (): void {
    console.log('Bone map requested - proceeding to bone mapping step')
    console.log('Target skeleton type:', this.step_load_target_skeleton.get_skeleton_type())
    console.log('Target armature:', this.step_load_target_skeleton.get_loaded_target_armature())
    
    // Begin the bone mapping step
    this.step_bone_mapping.begin()
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  retarget_app.init()
})

const retarget_app = new RetargetModule()

