import * as THREE from 'three'
import { type Scene, type Vector3, Group } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { type TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

import { CustomViewHelper } from './CustomViewHelper.ts'
import { Generators } from './Generators.ts'
import type { ThemeManager } from './ThemeManager.ts'
import { type MeshDragBonePlacement } from './processes/edit-skeleton/MeshDragBonePlacement.ts'

export class SceneEnvironmentManager {
  private readonly fog_near: number = 20
  private readonly fog_far: number = 80

  private controls: OrbitControls | undefined = undefined
  private view_helper: CustomViewHelper | undefined = undefined
  private environment_container: Group = new Group()

  constructor (
    private readonly scene: Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly transform_controls: TransformControls,
    private readonly theme_manager: ThemeManager,
    private readonly mesh_drag_bone_placement: MeshDragBonePlacement
  ) {}

  public setup_environment (): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true

    // Set Filmic tone mapping for less saturated, more cinematic look
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping // a bit softer of a look
    this.renderer.toneMappingExposure = 2.0 // tweak this value for brightness

    // renderer should automatically clear its output before rendering a frame
    // this was added/needed when the view helper was implemented.
    this.renderer.autoClear = false

    // Set default camera position for front view
    // this will help because we first want the user to rotate the model to face the front
    this.camera.position.set(0, 1.7, 15)

    Generators.create_window_resize_listener(this.renderer, this.camera)
    document.body.appendChild(this.renderer.domElement)

    // center orbit controls around mid-section area with target change
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.9, 0)

    // Set zoom limits to prevent excessive zooming in or out
    this.controls.minDistance = 0.5 // Minimum zoom (closest to model)
    this.controls.maxDistance = 30 // Maximum zoom (farthest from model)

    this.controls.update()
    this.mesh_drag_bone_placement.set_orbit_controls(this.controls)

    const view_control_hitbox = document.getElementById('view-control-hitbox')
    if (view_control_hitbox === null) {
      throw new Error('Cannot create view helper: #view-control-hitbox was not found')
    }

    this.view_helper = new CustomViewHelper(this.camera, view_control_hitbox)
    this.view_helper.set_labels('X', 'Y', 'Z')

    this.scene.add(this.transform_controls.getHelper())

    // make transform control axis a bit smaller so they don't interfere with other points
    this.transform_controls.size = 1.0

    // basic things in another group, to better isolate what we are working on
    this.regenerate_floor_grid()
  }

  public get_view_helper (): CustomViewHelper | undefined {
    return this.view_helper
  }

  public enable_orbit_controls (enabled: boolean): void {
    if (this.controls === undefined) {
      return
    }

    this.controls.enabled = enabled
  }

  public set_camera_position (position: Vector3): void {
    this.camera.position.copy(position)
    this.controls?.update()
  }

  public set_zoom_limits (min_distance: number, max_distance: number): void {
    if (this.controls !== undefined) {
      this.controls.minDistance = min_distance
      this.controls.maxDistance = max_distance
      this.controls.update()
    }
  }

  public set_fog_enabled (enabled: boolean): void {
    if (enabled) {
      this.apply_scene_fog()
    } else {
      this.scene.fog = null
    }
  }

  public regenerate_floor_grid (): void {
    // remove previous setup objects from scene if they exist
    const setup_container = this.scene.getObjectByName('Setup objects')
    if (setup_container !== null && setup_container !== undefined) {
      this.scene.remove(setup_container)
    }

    const { grid_color, floor_color, light_strength } = this.get_environment_colors()

    this.apply_scene_fog()

    this.environment_container = new Group()
    this.environment_container.name = 'Setup objects'
    this.environment_container.add(...Generators.create_default_lights(light_strength))

    const floor_helpers = Generators.create_grid_helper(grid_color, floor_color) as THREE.Object3D[]
    floor_helpers.forEach((floor_helper) => {
      this.environment_container.add(floor_helper)
    })

    this.scene.add(this.environment_container)
  }

  private get_environment_colors (): { grid_color: number, floor_color: number, light_strength: number } {
    if (this.theme_manager.get_current_theme() === 'light') {
      return {
        grid_color: 0xcccccc,
        floor_color: 0xecf0f1,
        light_strength: 14
      }
    }

    return {
      grid_color: 0x4f6f6f,
      floor_color: 0x2d4353,
      light_strength: 10
    }
  }

  private apply_scene_fog (): void {
    const { floor_color } = this.get_environment_colors()
    this.scene.fog = new THREE.Fog(floor_color, this.fog_near, this.fog_far)
  }
}
