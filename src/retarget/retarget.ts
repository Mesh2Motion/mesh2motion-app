import { Mesh2MotionEngine } from '../Mesh2MotionEngine.ts'
import { type Group, type Object3DEventMap, type SkinnedMesh, Vector3 } from 'three'
import { ModalDialog } from '../lib/ModalDialog.ts'
import { StepLoadSourceSkeleton } from './StepLoadSourceSkeleton.ts'
import { StepBoneMapping } from './StepBoneMapping.ts'
import { RetargetUtils } from './RetargetUtils.ts'
import { RetargetAnimationPreview } from './RetargetAnimationPreview.ts'

class RetargetModule {
  private readonly mesh2motion_engine: Mesh2MotionEngine
  private fileInput: HTMLInputElement | null = null
  private load_model_button: HTMLLabelElement | null = null
  private readonly step_load_source_skeleton: StepLoadSourceSkeleton
  private readonly step_bone_mapping: StepBoneMapping
  private readonly retarget_animation_preview: RetargetAnimationPreview

  constructor () {
    // Set up camera position similar to marketing bootstrap
    this.mesh2motion_engine = new Mesh2MotionEngine()
    const camera_position = new Vector3().set(0, 1.7, 5)
    this.mesh2motion_engine.set_camera_position(camera_position)
    
    // Initialize Mesh2Motion skeleton loading step (source)
    this.step_load_source_skeleton = new StepLoadSourceSkeleton(this.mesh2motion_engine.get_scene())
    
    // Initialize bone mapping step
    this.step_bone_mapping = new StepBoneMapping(this.mesh2motion_engine.get_scene())
    
    // Initialize animation preview
    this.retarget_animation_preview = new RetargetAnimationPreview(
      this.mesh2motion_engine.get_scene(),
      this.step_bone_mapping
    )
    
    // Set up animation loop for preview updates
    this.setup_animation_loop()
  }

  public init (): void {
    this.add_event_listeners()
    this.step_load_source_skeleton.begin()
    this.step_bone_mapping.begin()
    this.retarget_animation_preview.begin()
  }

  public add_event_listeners (): void {
    // Get DOM elements
    this.fileInput = document.getElementById('upload-file') as HTMLInputElement
    this.load_model_button = document.getElementById('load-model-button') as HTMLLabelElement

    // Add event listener for file selection
    this.fileInput.addEventListener('change', (event) => {
      console.log('File input changed', event)
      this.handleFileSelect(event)
    })
    
    // Listen for source skeleton (Mesh2Motion) loaded
    this.step_load_source_skeleton.addEventListener('skeleton-loaded', () => {
      const source_armature = this.step_load_source_skeleton.get_loaded_source_armature()
      const skeleton_type = this.step_load_source_skeleton.get_skeleton_type()
      this.step_bone_mapping.set_source_skeleton_data(source_armature, skeleton_type)
      this.try_start_preview()
    })
  }

  private try_start_preview (): void {
    // Start preview when both skeletons are loaded
    if (this.step_bone_mapping.has_both_skeletons()) {
      console.log('Both skeletons loaded, starting animation preview...')
      this.retarget_animation_preview.start_preview().catch((error) => {
        console.error('Failed to start preview:', error)
      })
    }
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

          // read in mesh2motion engine's retargetable model data (this is the target)
          const retargetable_meshes = this.mesh2motion_engine.load_model_step.get_final_retargetable_model_data()
          const is_valid_skinned_mesh = RetargetUtils.validate_skinned_mesh_has_bones(retargetable_meshes)
          if (is_valid_skinned_mesh) {
            console.log('adding retargetable meshes to scene for retargeting')
            RetargetUtils.reset_skinned_mesh_to_rest_pose(retargetable_meshes)
            this.mesh2motion_engine.get_scene().add(retargetable_meshes)

            // Add skeleton helper
            this.add_skeleton_helper(retargetable_meshes)
            
            // Set target skeleton data in bone mapping (uploaded mesh)
            this.step_bone_mapping.set_target_skeleton_data(retargetable_meshes)
            this.try_start_preview()
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
  private setup_animation_loop (): void {
    let last_time = performance.now()
    
    const animate = (): void => {
      requestAnimationFrame(animate)
      
      const current_time = performance.now()
      const delta_time = (current_time - last_time) / 1000 // Convert to seconds
      last_time = current_time
      
      // Update animation preview
      this.retarget_animation_preview.update(delta_time)
    }
    
    animate()
  }}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  retarget_app.init()
})

const retarget_app = new RetargetModule()


