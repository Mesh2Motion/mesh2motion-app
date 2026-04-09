import { Vector3, type SkinnedMesh } from 'three'
import { ProcessStep } from '../lib/enums/ProcessStep'
import { SkeletonType } from '../lib/enums/SkeletonType'
import { Mesh2MotionEngine } from '../Mesh2MotionEngine'
import { ModelVariationSwitcher } from '../lib/processes/animations-listing/ModelVariationSwitcher'
import { RigConfig } from '../lib/RigConfig'

export class MarketingBootstrap {
  private mesh2motion_engine: Mesh2MotionEngine
  private skeleton_type: SkeletonType = SkeletonType.None
  private model_variation_switcher: ModelVariationSwitcher = new ModelVariationSwitcher()

  constructor () {
    this.mesh2motion_engine = new Mesh2MotionEngine()
    this.mesh2motion_engine.animations_listing_step.set_model_variation_switcher(this.model_variation_switcher)
    this.add_event_listeners()

    // default: X:0 (centered), Y:1.7 (eye-level), Z:5 (front view)
    // view can be changed to a bit higher looking down at an angle
    const tilted_camera_angle_position = new Vector3().set(6, 5, 11)
    this.mesh2motion_engine.set_camera_position(tilted_camera_angle_position)
  }

  private change_active_skeleton (active_dom_button: HTMLElement): void {
    // remove the active classes from all buttons in .model-selection-section
    const model_buttons = document.querySelectorAll('.model-selection-section button')
    model_buttons.forEach((button) => {
      button.classList.remove('active-button')
    })

    active_dom_button.classList.add('active-button')
  }

  public setup_model_buttons (): void {
    const model_section = document.querySelector('.model-selection-section')
    if (model_section === null) return

    model_section.innerHTML = ''

    let default_button: HTMLButtonElement | null = null

    for (const rig of RigConfig.all) {
      const model_button = document.createElement('button')
      model_button.id = `load-${rig.skeleton_type}-model-button`
      model_button.textContent = rig.rig_display_name

      model_button.addEventListener('click', () => {
        // if we previously swapped a variation model into scene, clear it first
        this.mesh2motion_engine.animations_listing_step.clear_variation_model_from_scene()
        this.mesh2motion_engine.load_model_step.clear_loaded_model_data()
        this.mesh2motion_engine.load_model_step.load_model_file('../' + rig.model_file, 'glb')
        this.skeleton_type = rig.skeleton_type
        this.change_active_skeleton(model_button)
        this.model_variation_switcher.update_for_rig(rig.skeleton_type)
      })

      model_section.appendChild(model_button)

      if (rig.skeleton_type === SkeletonType.Human) {
        default_button = model_button
      }
    }

    const first_model_button = model_section.querySelector('button') as HTMLButtonElement | null
    ;(default_button ?? first_model_button)?.click() // load default model on page start
  }

  public add_event_listeners (): void {
    // when the user picks a different model variation, swap the skinned mesh in the scene
    this.model_variation_switcher.addEventListener('variation-changed', ((event: CustomEvent) => {
      const skinned_meshes = event.detail.skinned_meshes as SkinnedMesh[]
      this.mesh2motion_engine.animations_listing_step.swap_skinned_meshes(
        this.mesh2motion_engine.scene, skinned_meshes
      )

      this.rebuild_skeleton_helper(skinned_meshes)
 
    }) as EventListener)

    // event after the DOM is fully loaded for HTML elements
    document.addEventListener('DOMContentLoaded', () => {
      this.setup_model_buttons() // automatically trigger the human once we begin for the default
    }) // end the DOMContentLoaded function

    // we are re-creating the engine, so need to manually add the event listeners again
    this.mesh2motion_engine.load_model_step.addEventListener('modelLoaded', () => {
      // resolve the rig file path from the central config
      const rig_file = RigConfig.rig_file_for(this.skeleton_type)
      this.mesh2motion_engine.process_step_changed(ProcessStep.LoadSkeleton)
      if (rig_file !== undefined) {
        this.mesh2motion_engine.load_skeleton_step.load_skeleton_file('../' + rig_file)
      }
      this.mesh2motion_engine.load_skeleton_step.set_skeleton_type(this.skeleton_type)
    })

    // need to automatically finish the edit skeleton step and move onto the next step
    this.mesh2motion_engine.load_skeleton_step.addEventListener('skeletonLoaded', () => {
      this.mesh2motion_engine.animations_listing_step.set_animations_file_path('../animations/')
      this.mesh2motion_engine.process_step_changed(ProcessStep.BindPose)
    })
  }

  private rebuild_skeleton_helper (skinned_meshes: SkinnedMesh[]): void {
     // rebuild helper to target the new skeleton for this variation
      if (skinned_meshes.length > 0) {
        this.mesh2motion_engine.regenerate_skeleton_helper(skinned_meshes[0].skeleton)
        this.mesh2motion_engine.sync_skeleton_helper_joint_visibility()

        // keep current helper visibility aligned with the toggle state
        if (this.mesh2motion_engine.skeleton_helper !== undefined) {
          const show_skeleton = this.mesh2motion_engine.ui.dom_show_skeleton_checkbox?.checked ?? false
          this.mesh2motion_engine.skeleton_helper.visible = show_skeleton
        }
      }
  }

}



// instantiate the class to setup event listeners
const app = new MarketingBootstrap()
