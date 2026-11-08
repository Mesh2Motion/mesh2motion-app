import { UI } from '../../UI.ts'
import { AnimationPlayer } from './AnimationPlayer.ts'

import {
  type AnimationClip, AnimationMixer, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, SkinnedMesh, Vector3,
  type AnimationAction, Object3D, type Scene, type Intersection, type PerspectiveCamera
} from 'three'

import { AnimationUtility } from './AnimationUtility.ts'
import { ArmExtensionControl } from './ArmExtensionControl.ts'
import { AnimationLoader, type AnimationLoadProgress } from './AnimationLoader.ts'
import { AnimationLibrary, type AnimationLibraryLoadProgress } from './AnimationLibrary.ts'
import { AnimationLibraryProgressBar } from './AnimationLibraryProgressBar.ts'
import { CustomAnimationImporter } from './CustomAnimationImporter.ts'
import { ImportAnimationsButton } from './ImportAnimationsButton.ts'
import { type ModelVariationSwitcher } from './ModelVariationSwitcher.ts'

import { SkeletonType } from '../../enums/SkeletonType.ts'
import { RigConfig } from '../../RigConfig.ts'
import { Utility } from '../../Utilities.ts'
import { type ThemeManager } from '../../ThemeManager.ts'
import { AnimationSearch } from './AnimationSearch.ts'
import { type TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'
import { type AnimationClipExportSelection } from './interfaces/AnimationExportSelection.ts'
import { PropsManager } from './props/PropsManager.ts'
import { WeightPaintManager, type BrushVertex, type WeightPaintMode } from '../edit-skeleton/WeightPaintManager.ts'

// Note: EventTarget is a built-ininterface and do not need to import it
export class StepAnimationsListing extends EventTarget {
  private readonly theme_manager: ThemeManager
  private readonly ui: UI
  private readonly animation_player: AnimationPlayer
  private readonly animation_loader: AnimationLoader = new AnimationLoader()
  private readonly animation_library: AnimationLibrary = new AnimationLibrary(this.animation_loader)

  private animation_mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private skinned_meshes_to_animate: SkinnedMesh[] = []
  private model_variation_switcher: ModelVariationSwitcher | null = null
  private current_playing_id: string | null = null
  private skeleton_type: SkeletonType = SkeletonType.Human

  // weight painting directly on the posed skinned meshes
  private weight_paint_manager: WeightPaintManager | null = null
  private weight_painting_enabled = false
  private weight_paint_bone_name: string | null = null
  private weight_paint_radius = 0.03
  private weight_paint_strength = 0.5
  private weight_paint_mode: WeightPaintMode = 'add'
  private weight_paint_mirror_enabled = true
  private weight_paint_clear_marker = 0
  private readonly weight_paint_stroke_vertices = new Set<string>()
  private readonly weight_paint_overlays = new Map<SkinnedMesh, SkinnedMesh>()
  private readonly geometry_center_cache = new WeakMap<BufferGeometry, number>()
  private weight_paint_show_weights = true

  // prefix that points from the current page to the static root, e.g. '../' for pages in a sub-folder
  private static_root_path: string = ''

  // retrieved from load skeleton step
  // we will use this to scale all position animation keyframes (uniform scale)
  private skeleton_scale: number = 1.0

  // per model variation multiplier for the position tracking bone (pelvis/hips) keyframes
  private model_variation_pelvis_position_scale: number = 1.0

  private readonly custom_animation_importer: CustomAnimationImporter
  // wired up in begin() so pages that never show this step don't listen to the import button
  private import_animations_button: ImportAnimationsButton | null = null
  private readonly props_manager: PropsManager = new PropsManager()

  private _added_event_listeners: boolean = false

  // enable status for mirroring animations
  public mirror_animations_enabled: boolean = false

  // Animation search functionality
  public animation_search: AnimationSearch | null = null

  public set_static_root_path (path: string): void {
    this.static_root_path = path
  }

  // shared "Expand / Contract Arms" controls. owns the current arm extension amount
  private readonly arm_extension_control: ArmExtensionControl = ArmExtensionControl.getInstance()

  private has_added_event_listeners: boolean = false

  constructor (theme_manager: ThemeManager) {
    super()
    this.ui = UI.getInstance()
    this.animation_player = new AnimationPlayer()
    this.theme_manager = theme_manager

    this.custom_animation_importer = new CustomAnimationImporter(this.animation_loader)

    // applied to every clip as it loads, and again to loaded clips whenever a warp setting changes
    this.animation_library.set_display_transform((clip_pairs: TransformedAnimationClipPair[]) => {
      this.apply_display_warps(clip_pairs)
    })

    // fancy way to bind the import context by implementing the function
    // from the CustomAnimationImporter and passing in the current context values. this allows
    // the CustomAnimationImporter to be decoupled from the StepAnimationsListing
    this.custom_animation_importer.set_import_context_provider(() => {
      return {
        skinned_meshes_to_animate: this.skinned_meshes_to_animate,
        skeleton_scale: this.skeleton_scale,
        skeleton_type: this.skeleton_type
      }
    })

    this.custom_animation_importer.addEventListener('import-success', (event: Event) => {
      const new_clips = (event as CustomEvent<TransformedAnimationClipPair[]>).detail
      const new_entries = this.animation_library.add_loaded_clips(new_clips)
      this.animation_search?.add_animations(new_entries)
      this.update_filtered_animation_listing_ui()

      // show the first imported animation
      if (new_entries.length > 0) {
        this.play_animation(new_entries[0].id)
      }
    })
  }

  public begin (skeleton_type: SkeletonType, skeleton_scale: number): void {
    this.skeleton_scale = skeleton_scale

    if (this.ui.dom_current_step_element != null) {
      this.ui.dom_current_step_element.innerHTML = 'Test animations'
    }

    if (this.ui.dom_skinned_mesh_tools != null) {
      this.ui.dom_skinned_mesh_tools.style.display = 'flex'
    }

    if (this.ui.dom_skinned_mesh_animation_tools != null) {
      this.ui.dom_skinned_mesh_animation_tools.style.display = 'flex'
    }

    // bone display toggle only works in animation preview since
    // everything is setup by now
    if (this.ui.dom_show_skeleton_container != null) {
      this.ui.dom_show_skeleton_container.style.display = 'inline-flex'
    }

    this.reset_step_data()
    this.import_animations_button?.dispose()
    this.import_animations_button = new ImportAnimationsButton(
      this.custom_animation_importer,
      this.ui.dom_import_animations_button,
      this.ui.dom_import_animations_input
    )

    this.skeleton_type = skeleton_type
    this.props_manager.begin(skeleton_type, skeleton_scale)

    // if we are navigating back to this step, we don't want to add the event listeners again
    if (!this._added_event_listeners) {
      this.add_event_listeners()
      this._added_event_listeners = true
    }

    this.update_download_button_enabled()
  }

  public reset_step_data (): void {
    // reset previous state if we are re-entering this step
    // this will happen if we are reskinning the mesh after changes
    this.props_manager.detach_all()
    this.animation_library.clear()
    this.skinned_meshes_to_animate = []
    this.animation_mixer = new AnimationMixer(new Object3D())
    this.current_playing_id = null
    this.animation_search = null
    this.model_variation_pelvis_position_scale = 1.0
    this.reset_weight_paint_state()
    this.reset_ui_elements()
    this.animation_player.clear_animation()
  }

  private reset_weight_paint_state (): void {
    this.dispose_weight_paint_overlays()
    if (this.weight_painting_enabled) {
      this.weight_painting_enabled = false
      this.dispatchEvent(new CustomEvent('animationWeightPaintModeChanged', { detail: { enabled: false } }))
    }
    this.weight_paint_stroke_vertices.clear()
    this.weight_paint_bone_name = null
    this.weight_paint_clear_marker = this.weight_paint_manager?.undo_stack_marker() ?? 0
    this.update_weight_paint_ui()
  }

  // If we change skeleton types, we need to reset some of the state 
  // in the case we selected animations. This clears the UI state associated with that.
  private reset_ui_elements (): void {
    if (this.ui.dom_animation_clip_list !== null) {
      this.ui.dom_animation_clip_list.innerHTML = ''
    }

    if (this.ui.dom_animation_count !== null) {
      this.ui.dom_animation_count.innerHTML = '0'
    }

    if (this.ui.dom_animations_listing_count !== null) {
      this.ui.dom_animations_listing_count.innerHTML = '0 animations'
    }

    if (this.ui.dom_export_button !== null) {
      this.ui.dom_export_button.disabled = true
    }
  }

  public mixer (): AnimationMixer {
    return this.animation_mixer
  }

  // setup in the bootstrap.ts file and only called if we are actively
  // on this step
  public frame_change (delta_time: number): void {
    this.mixer().update(delta_time)
    this.animation_player.update(delta_time)
  }

  /**
   * Returns the skinned meshes currently used for animation playback.
   * This is used during the download/export process to retrieved final skinned mesh
   */
  public active_skinned_meshes (): SkinnedMesh[] {
    return this.skinned_meshes_to_animate
  }

  public set_weight_paint_manager (manager: WeightPaintManager | null): void {
    this.weight_paint_manager = manager
  }

  public is_weight_painting_enabled (): boolean {
    return this.weight_painting_enabled
  }

  public set_weight_painting_enabled (enabled: boolean): void {
    if (enabled && (this.weight_paint_manager === null ||
      this.skinned_meshes_to_animate.length === 0 ||
      this.weight_paint_bone_name === null)) {
      return
    }

    if (this.weight_painting_enabled === enabled) {
      this.update_weight_paint_ui()
      return
    }

    this.weight_painting_enabled = enabled
    if (enabled) {
      // Painting is much easier on a still pose. The user can press play again
      // at any time; the brush uses the pose at the moment of each dab.
      this.animation_player.pause()
      this.create_weight_paint_overlays()
    } else {
      this.dispose_weight_paint_overlays()
    }
    this.dispatchEvent(new CustomEvent('animationWeightPaintModeChanged', { detail: { enabled } }))
    this.update_weight_paint_ui()
  }

  public begin_weight_paint_stroke (): void {
    this.weight_paint_stroke_vertices.clear()
    this.weight_paint_manager?.begin_stroke()
    this.update_weight_paint_ui()
  }

  public end_weight_paint_stroke (): void {
    this.weight_paint_stroke_vertices.clear()
    this.update_weight_paint_ui()
  }

  /** Paints the selected bone onto the posed skinned mesh under the brush. */
  public paint_weights (intersection: Intersection, camera: PerspectiveCamera): void {
    const manager = this.weight_paint_manager
    const object = intersection.object
    if (manager === null || !(object instanceof SkinnedMesh)) { return }

    const bone_name = this.weight_paint_bone_name
    if (bone_name === null) { return }

    const geometry_index = typeof object.userData.geometry_index === 'number'
      ? object.userData.geometry_index as number
      : -object.id

    object.updateWorldMatrix(true, false)
    const positions = object.geometry.attributes.position
    const center = intersection.point.clone()
    const ray_direction = center.clone().sub(camera.position).normalize()
    const point = new Vector3()
    const vertices: BrushVertex[] = []

    for (let i = 0; i < positions.count; i++) {
      const key = `${geometry_index}:${i}`
      if (this.weight_paint_stroke_vertices.has(key)) { continue }

      object.getVertexPosition(i, point)
      point.applyMatrix4(object.matrixWorld)
      const distance = point.distanceTo(center)
      if (distance > this.weight_paint_radius) { continue }

      // Ignore vertices behind the surface the brush is touching, so the
      // brush cannot paint through the mesh to the far side.
      const depth = point.sub(center).dot(ray_direction)
      if (depth > this.weight_paint_radius * 0.5) { continue }

      const t = 1 - distance / this.weight_paint_radius
      vertices.push({ vertex_index: i, falloff: t * t * (3 - 2 * t) })
      this.weight_paint_stroke_vertices.add(key)
    }

    if (vertices.length === 0) { return }

    manager.paint_vertices(
      object,
      geometry_index,
      vertices,
      bone_name,
      object.skeleton.bones,
      this.weight_paint_strength,
      this.weight_paint_mode,
      this.weight_paint_mirror_enabled
    )
    if (this.weight_paint_mirror_enabled) {
      // The mirrored side was painted too, so refresh the whole heatmap.
      this.update_weight_paint_overlay_colors(bone_name)
    } else {
      this.update_weight_paint_overlay_vertices(object, vertices.map(vertex => vertex.vertex_index), bone_name)
    }
    this.update_weight_paint_ui()
  }

  public undo_weight_paint_stroke (): void {
    if (this.weight_paint_manager === null) { return }
    if (!this.weight_paint_manager.can_undo_since(this.weight_paint_clear_marker)) { return }
    this.weight_paint_manager.undo()
    this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    this.update_weight_paint_ui()
  }

  /** Removes the strokes made on this animation-stage visit. */
  public clear_weight_paint (): void {
    if (this.weight_paint_manager === null) { return }
    this.weight_paint_manager.clear_strokes_since(this.weight_paint_clear_marker)
    this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    this.update_weight_paint_ui()
  }

  /** Called when the app leaves the animation step. */
  public cleanup_on_exit_step (): void {
    this.set_weight_painting_enabled(false)
    this.dispose_weight_paint_overlays()
    this.weight_paint_stroke_vertices.clear()
  }

  private update_weight_paint_bone_options (): void {
    const select = document.getElementById('animation-weight-paint-bone') as HTMLSelectElement | null
    if (select === null) { return }

    const skeleton = this.skinned_meshes_to_animate[0]?.skeleton
    const previous = this.weight_paint_bone_name ?? select.value
    select.innerHTML = ''

    if (skeleton !== undefined) {
      for (const bone of skeleton.bones) {
        if (bone.name === 'root' || Utility.is_leaf_bone(bone)) { continue }
        const option = document.createElement('option')
        option.value = bone.name
        option.textContent = bone.name
        select.appendChild(option)
      }
    }

    const previous_still_exists = Array.from(select.options).some(option => option.value === previous)
    select.selectedIndex = previous_still_exists
      ? Array.from(select.options).findIndex(option => option.value === previous)
      : (select.options.length > 0 ? 0 : -1)
    this.weight_paint_bone_name = select.value === '' ? null : select.value
  }

  private update_weight_paint_ui (): void {
    const container = document.getElementById('animation-weight-paint-tools')
    if (container !== null) {
      container.hidden = this.skinned_meshes_to_animate.length === 0
    }

    const toggle = document.getElementById('animation-weight-paint-toggle') as HTMLButtonElement | null
    if (toggle !== null) {
      toggle.textContent = this.weight_painting_enabled ? 'Stop painting' : 'Start painting'
      toggle.setAttribute('aria-pressed', String(this.weight_painting_enabled))
      toggle.disabled = this.weight_paint_manager === null ||
        this.skinned_meshes_to_animate.length === 0 ||
        this.weight_paint_bone_name === null
    }

    const show_weights = document.getElementById('animation-weight-paint-show') as HTMLInputElement | null
    if (show_weights !== null) {
      show_weights.checked = this.weight_paint_show_weights
      show_weights.disabled = !this.weight_painting_enabled
    }

    const mirror = document.getElementById('animation-weight-paint-mirror') as HTMLInputElement | null
    if (mirror !== null) {
      mirror.checked = this.weight_paint_mirror_enabled
    }

    const can_undo = this.weight_paint_manager !== null &&
      this.weight_paint_manager.can_undo_since(this.weight_paint_clear_marker)
    const undo = document.getElementById('animation-weight-paint-undo') as HTMLButtonElement | null
    if (undo !== null) { undo.disabled = !can_undo }
    const clear = document.getElementById('animation-weight-paint-clear') as HTMLButtonElement | null
    if (clear !== null) { clear.disabled = !can_undo }
  }

  /**
   * Overlay a heatmap of the selected bone's weight on the posed meshes.
   * The overlay shares the source geometry's position/skin attributes, so live
   * weight edits show up without rebuilding any geometry.
   */
  private create_weight_paint_overlays (): void {
    this.dispose_weight_paint_overlays()

    for (const source of this.skinned_meshes_to_animate) {
      const positions = source.geometry.attributes.position
      const skin_indices = source.geometry.attributes.skinIndex
      const skin_weights = source.geometry.attributes.skinWeight
      if (positions === undefined || skin_indices === undefined || skin_weights === undefined) { continue }

      const geometry = new BufferGeometry()
      geometry.setAttribute('position', positions)
      geometry.setAttribute('skinIndex', skin_indices)
      geometry.setAttribute('skinWeight', skin_weights)
      if (source.geometry.index !== null) {
        geometry.setIndex(source.geometry.index)
      }
      geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(positions.count * 4), 4))

      const material = new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false
      })
      material.toneMapped = false
      material.polygonOffset = true
      material.polygonOffsetFactor = -1
      material.polygonOffsetUnits = -1

      const overlay = new SkinnedMesh(geometry, material)
      overlay.name = 'Weight Paint Overlay'
      overlay.frustumCulled = false
      overlay.renderOrder = 10
      overlay.position.copy(source.position)
      overlay.quaternion.copy(source.quaternion)
      overlay.scale.copy(source.scale)
      overlay.bindMode = source.bindMode
      overlay.bind(source.skeleton, source.bindMatrix)
      ;(source.parent ?? source).add(overlay)

      this.weight_paint_overlays.set(source, overlay)
    }

    this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
    this.sync_weight_paint_overlay_visibility()
  }

  private dispose_weight_paint_overlays (): void {
    for (const overlay of this.weight_paint_overlays.values()) {
      overlay.removeFromParent()
      const geometry = overlay.geometry
      // These attributes are shared with the real skinned mesh, so detach them
      // before disposing the overlay's geometry.
      geometry.deleteAttribute('position')
      geometry.deleteAttribute('skinIndex')
      geometry.deleteAttribute('skinWeight')
      geometry.setIndex(null)
      geometry.dispose()
      const materials = Array.isArray(overlay.material) ? overlay.material : [overlay.material]
      for (const material of materials) { material.dispose() }
    }
    this.weight_paint_overlays.clear()
  }

  private sync_weight_paint_overlay_visibility (): void {
    for (const overlay of this.weight_paint_overlays.values()) {
      overlay.visible = this.weight_paint_show_weights
    }
  }

  private update_weight_paint_overlay_colors (bone_name: string | null): void {
    for (const [source, overlay] of this.weight_paint_overlays) {
      const color = overlay.geometry.attributes.color
      const skin_indices = source.geometry.attributes.skinIndex
      const skin_weights = source.geometry.attributes.skinWeight
      const positions = source.geometry.attributes.position
      if (color === undefined || skin_indices === undefined || skin_weights === undefined || positions === undefined) {
        continue
      }

      const side = bone_name === null ? null : WeightPaintManager.bone_side(bone_name)
      const mirror_bone_name = bone_name === null
        ? null
        : WeightPaintManager.find_mirror_bone_name(bone_name, source.skeleton.bones)
      const selected_index = bone_name === null
        ? -1
        : source.skeleton.bones.findIndex(bone => bone.name === bone_name)
      const mirrored_index = mirror_bone_name === null
        ? selected_index
        : source.skeleton.bones.findIndex(bone => bone.name === mirror_bone_name)
      const center_x = this.geometry_center_x(source.geometry)

      const vertex_count = positions.count
      for (let i = 0; i < vertex_count; i++) {
        let bone_index = selected_index
        if (this.weight_paint_mirror_enabled && side !== null) {
          const x = positions.getX(i) - center_x
          if ((side === 'left' && x < 0) || (side === 'right' && x > 0)) {
            bone_index = mirrored_index
          }
        }
        write_weight_color(color, i, this.vertex_weight(skin_indices, skin_weights, i, bone_index))
      }
      color.needsUpdate = true
    }
  }

  private geometry_center_x (geometry: BufferGeometry): number {
    const cached = this.geometry_center_cache.get(geometry)
    if (cached !== undefined) { return cached }

    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    const center_x = box === null ? 0 : (box.min.x + box.max.x) / 2
    this.geometry_center_cache.set(geometry, center_x)
    return center_x
  }

  private update_weight_paint_overlay_vertices (source: SkinnedMesh, vertex_indices: number[], bone_name: string): void {
    const overlay = this.weight_paint_overlays.get(source)
    if (overlay === undefined) { return }

    const color = overlay.geometry.attributes.color
    const skin_indices = source.geometry.attributes.skinIndex
    const skin_weights = source.geometry.attributes.skinWeight
    if (color === undefined || skin_indices === undefined || skin_weights === undefined) { return }

    const bone_index = source.skeleton.bones.findIndex(bone => bone.name === bone_name)
    for (const vertex_index of vertex_indices) {
      write_weight_color(color, vertex_index, this.vertex_weight(skin_indices, skin_weights, vertex_index, bone_index))
    }
    color.needsUpdate = true
  }

  private vertex_weight (skin_indices: { array: ArrayLike<number> },
    skin_weights: { array: ArrayLike<number> }, vertex_index: number, bone_index: number): number {
    if (bone_index < 0) { return 0 }
    let weight = 0
    for (let slot = 0; slot < 4; slot++) {
      if (skin_indices.array[vertex_index * 4 + slot] === bone_index) {
        weight += skin_weights.array[vertex_index * 4 + slot] as number
      }
    }
    return weight
  }

  public set_model_variation_switcher (switcher: ModelVariationSwitcher): void {
    this.model_variation_switcher = switcher
  }

  /**
   * Applies the current arm-extension deformation for the active model variation
   * and immediately replays the current animation when the Explore page swaps models.
   */
  public apply_model_variation_arm_extension (value: number): void {
    this.arm_extension_control.set_value(value)

    if (this.animation_library.all().length === 0) {
      return
    }

    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_id)
  }

  /**
   * Applies the pelvis/hips position scale for the active model variation.
   * Taller variations need their hips raised so their feet stay on the ground.
   */
  public apply_model_variation_pelvis_position_scale (value: number): void {
    this.model_variation_pelvis_position_scale = value

    if (this.animation_library.all().length === 0) {
      return
    }

    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_id)
  }

  /**
   * Removes the current skinned meshes from the scene, adds the new ones,
   * and replays the current animation on them.
   */
  public swap_skinned_meshes (scene: Scene, new_skinned_meshes: SkinnedMesh[]): void {
    if (this.weight_painting_enabled) {
      this.set_weight_painting_enabled(false)
    }
    this.dispose_weight_paint_overlays()
    const is_variation_active = this.model_variation_switcher?.is_variation_active ?? false
    this.props_manager.detach_all()
    this.clear_variation_model_from_scene()

    if (!is_variation_active) {
      // remove the original skinned meshes that were added individually
      for (const mesh of this.skinned_meshes_to_animate) {
        Utility.remove_object_with_children(mesh)
      }
    }

    // add individual skinned meshes to scene (bones are children of the mesh after normalization)
    if (this.model_variation_switcher !== null) {
      this.model_variation_switcher.is_variation_active = true
    }
    for (const mesh of new_skinned_meshes) {
      scene.add(mesh)
    }

    this.skinned_meshes_to_animate = new_skinned_meshes
    this.props_manager.attach_to_skinned_meshes(new_skinned_meshes)
    this.update_weight_paint_bone_options()
    this.update_weight_paint_ui()

    // replay current animation on the new meshes
    this.play_animation(this.current_playing_id)
    this.animation_player.play()
  }

  /**
   * Clears any variation model root that was injected during model variation swapping.
   * This should be called before doing a full model load flow.
   */
  public clear_variation_model_from_scene (): void {
    const is_variation_active = this.model_variation_switcher?.is_variation_active ?? false
    if (is_variation_active) {
      this.props_manager.detach_all()
      for (const mesh of this.skinned_meshes_to_animate) {
        Utility.remove_object_with_children(mesh)
      }
      if (this.model_variation_switcher !== null) {
        this.model_variation_switcher.is_variation_active = false
      }
    }
  }

  public load_and_apply_default_animation_to_skinned_mesh (final_skinned_meshes: SkinnedMesh[]): void {
    this.skinned_meshes_to_animate = final_skinned_meshes
    this.props_manager.attach_to_skinned_meshes(final_skinned_meshes)
    this.update_weight_paint_bone_options()
    this.update_weight_paint_ui()

    // animation file paths are relative to the static root
    this.animation_loader.set_static_root_path(this.static_root_path)

    // Create an animation mixer to do the playback. Play the first by default
    this.animation_mixer = new AnimationMixer(new Object3D())

    // lists every animation for the rig right away. Each GLB downloads the first time it is played or exported
    this.animation_library.reset(this.skeleton_type, this.skeleton_scale)
    this.on_animation_library_ready()
  }

  private on_animation_library_ready (): void {
    // create user interface with all available animation clips
    this.build_animation_clip_ui(this.theme_manager)

    // add event listener to listem for checkbox changes when we change
    // the amount of animations to export
    this.animation_search?.addEventListener('export-options-changed', () => {
      // update the count for the download button
      if (this.ui.dom_animation_count != null) {
        this.ui.dom_animation_count.innerHTML = this.animation_search?.get_selected_export_animation_count().toString() ?? '0'
      }

      // the clip list's click handler runs before the checkbox change is recorded,
      // so the button has to be refreshed here once the selection is up to date
      this.update_download_button_enabled()
    })

    // add event listener to listen for filtered animations listing
    this.update_filtered_animation_listing_ui()
    this.animation_search?.addEventListener('filtered-animations-listing', () => {
      this.update_filtered_animation_listing_ui()
    })

    // play the first animation by default
    this.play_animation(this.animation_library.all()[0]?.id ?? null)
  }

  private onAnimationLoadProgress (progress: AnimationLoadProgress): void {
    if (this.ui.dom_loading_progress_bar !== null) {
      this.ui.dom_loading_progress_bar.style.width = `${progress.percentage}%`

      const mb_loaded: string = (progress.overallBytesLoaded / (1024 * 1024)).toFixed(1)
      const mb_total: string = (progress.overallBytesTotal / (1024 * 1024)).toFixed(1)
      this.ui.dom_loading_progress_bar.textContent = `${mb_loaded} / ${mb_total} MB`
    }

    if (this.ui.dom_current_file_progress_bar !== null) {
      this.ui.dom_current_file_progress_bar.style.width = `${progress.currentFileProgress}%`
    }

    // if we are done loading, we can hide the container
    if (progress.percentage >= 100) {
      if (this.ui.dom_animation_progress_loader_container !== null) {
        this.ui.dom_animation_progress_loader_container.style.display = 'none'
      }
    } else {
      // make sure it is visible while loading
      if (this.ui.dom_animation_progress_loader_container !== null) {
        this.ui.dom_animation_progress_loader_container.style.display = 'flex'
      }
    }

    // can potentially shows file name loading...not sure if we need to actually show this.
    // if (this.ui.dom_loading_status_text !== null && progress.currentFile !== '') {
    //   const file_name = progress.currentFile.split('/').pop() ?? progress.currentFile
    //   this.ui.dom_loading_status_text.textContent = `Loading ${file_name}...`
    // }
  }

  private update_filtered_animation_listing_ui (): void {
    const animation_length_string: string = this.animation_search?.filtered_animations().length.toString() ?? '0'
    if (this.ui.dom_animations_listing_count != null) {
      this.ui.dom_animations_listing_count.innerHTML = animation_length_string + ' animations'
    }
  }

  /**
   * Rebuilds all of the loaded warped animations by applying the specified warps.
   */
  private rebuild_warped_animations (): void {
    this.animation_library.rebuild_display_clips()
  }

  /**
   * Applies the current warps to display clips that start out as copies of their original clip.
   */
  private apply_display_warps (clip_pairs: TransformedAnimationClipPair[]): void {
    if (this.mirror_animations_enabled) {
      AnimationUtility.apply_animation_mirroring(clip_pairs)
    }

    /// Apply the arm extension warp:
    AnimationUtility.apply_arm_extension_warp(clip_pairs, this.arm_extension_control.value())

    /// Raise/lower the hips to match the proportions of the active model variation:
    AnimationUtility.apply_position_tracking_bone_scale(
      clip_pairs,
      RigConfig.by_skeleton_type(this.skeleton_type)?.position_tracking_bone_name,
      this.model_variation_pelvis_position_scale
    )
  }

  /**
   * Not all animation files have root bone keyframes, so we need to make
   * sure this is reset between animations to fully reset the animation state
   * @param skinned_mesh
   */
  private reset_root_motion_position (skinned_mesh: SkinnedMesh): void {
    if (skinned_mesh.skeleton.bones.length > 0) {
      const root_bone = skinned_mesh.skeleton.bones[0] // should always be root bone
      root_bone.position.set(0, 0, 0)
      root_bone.updateMatrixWorld(true)
    }
  }

  private play_animation (animation_id: string | null): void {
    if (animation_id === null) {
      return
    }

    this.current_playing_id = animation_id

    const clip_pair = this.animation_library.find(animation_id)?.clip_pair
    if (clip_pair === undefined) {
      return
    }

    // download the animation the first time it is played, then play it if it is still the one picked
    if (clip_pair === null) {
      this.animation_library.load(animation_id)
        .then(() => {
          if (this.current_playing_id === animation_id) {
            this.play_animation(animation_id)
          }
        })
        .catch((error: unknown) => {
          console.error('Failed to load animation:', animation_id, error)
        })
      return
    }

    const clip_to_play: AnimationClip = clip_pair.display_animation_clip

    // animation mixer has internal cache with animations. doing this helps clear it
    // otherwise modifications like arm extension will not update
    this.animation_mixer = new AnimationMixer(new Object3D())

    const all_animation_actions: AnimationAction[] = []

    this.skinned_meshes_to_animate.forEach((skinned_mesh: SkinnedMesh) => {
      this.reset_root_motion_position(skinned_mesh)

      const anim_action: AnimationAction = this.animation_mixer.clipAction(clip_to_play, skinned_mesh)

      anim_action.stop()
      anim_action.play()

      // Collect all animation actions for the animation player
      all_animation_actions.push(anim_action)
    })

    // Update the animation player with the current animation and all actions
    if (all_animation_actions.length > 0) {
      this.animation_player.set_animation(clip_to_play, all_animation_actions)
    }
  }

  private update_download_button_enabled (): void {
    // see if any animations are selected for export, including ones hidden by filtering.
    // if not we need to disable the "Download" button
    const is_any_animation_selected: boolean = (this.animation_search?.get_selected_animation_ids().length ?? 0) > 0
    if (this.ui.dom_export_button != null) {
      this.ui.dom_export_button.disabled = !is_any_animation_selected
    }
  }

  private add_event_listeners (): void {
    // make sure to only add the event listeners once
    // this could be potentially called multiple times when going back and forth
    // between editing skeleton and this step
    if (this.has_added_event_listeners) {
      console.info('Event listeners already added to animation step. Skipping.')
      return
    }

    // Add progress event for when a custom animation GLB file is importing
    this.animation_loader.addEventListener('progress', (event: Event) => {
      const progress = (event as CustomEvent<AnimationLoadProgress>).detail
      this.onAnimationLoadProgress(progress)
    })

    // progress for downloading many library animations at once, like before an export
    this.animation_library.addEventListener('progress', (event: Event) => {
      AnimationLibraryProgressBar.update((event as CustomEvent<AnimationLibraryLoadProgress>).detail)
    })

    // event listener for animation clip list with changing the current animation
    if (this.ui.dom_animation_clip_list != null) {
      this.ui.dom_animation_clip_list.addEventListener('click', (event) => {
        this.update_download_button_enabled()

        if (event.target != null) {
          const play_button = (event.target as HTMLElement).closest('button[data-action="play-animation"]')
          if (play_button === null) {
            return
          }

          const animation_id = play_button.getAttribute('data-animation-id')
          if (animation_id != null) {
            this.play_animation(animation_id)
          }
        }
      })
    }

    // shared A-Pose arm extension controls (reset button, numeric input, range input)
    this.arm_extension_control.initialize(() => {
      this.update_a_pose_value()
    })

    // check for changes to mirror animations checkbox
    this.ui.dom_mirror_animations_checkbox?.addEventListener('change', () => {
      const is_checked: boolean = this.ui.dom_mirror_animations_checkbox?.checked ?? false
      this.mirror_animations_enabled = is_checked
      // Rebuild animations with or without mirroring
      this.rebuild_warped_animations()
      this.play_animation(this.current_playing_id)
    })

    // event listener for animation view mode tabs (Library vs Selected)
    const animation_view_radios = document.querySelectorAll('input[name="animation-view-mode"]')
    animation_view_radios.forEach((radio) => {
      radio.addEventListener('change', (event) => {
        const target = event.target as HTMLInputElement
        const show_selected_only = target.value === 'selected'
        this.animation_search?.set_show_selected_only(show_selected_only)
      })
    })

    // event listener for select all / deselect all button
    const toggle_select_all_button = document.querySelector('#toggle-select-all-animations')
    toggle_select_all_button?.addEventListener('click', () => {
      this.animation_search?.toggle_select_all_animations()
      this.update_download_button_enabled()
    })

    // weight painting on the posed skinned meshes
    document.getElementById('animation-weight-paint-toggle')?.addEventListener('click', () => {
      this.set_weight_painting_enabled(!this.weight_painting_enabled)
    })
    document.getElementById('animation-weight-paint-bone')?.addEventListener('change', (event) => {
      const select = event.target as HTMLSelectElement
      this.weight_paint_bone_name = select.value === '' ? null : select.value
      if (this.weight_painting_enabled) {
        this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
      }
      this.update_weight_paint_ui()
    })
    document.getElementById('animation-weight-paint-show')?.addEventListener('change', (event) => {
      this.weight_paint_show_weights = (event.target as HTMLInputElement).checked
      this.sync_weight_paint_overlay_visibility()
    })
    document.getElementById('animation-weight-paint-mirror')?.addEventListener('change', (event) => {
      this.weight_paint_mirror_enabled = (event.target as HTMLInputElement).checked
      if (this.weight_painting_enabled) {
        this.update_weight_paint_overlay_colors(this.weight_paint_bone_name)
      }
    })
    document.getElementById('animation-weight-paint-radius')?.addEventListener('input', (event) => {
      this.weight_paint_radius = Number((event.target as HTMLInputElement).value)
    })
    document.getElementById('animation-weight-paint-strength')?.addEventListener('input', (event) => {
      this.weight_paint_strength = Number((event.target as HTMLInputElement).value)
    })
    document.querySelectorAll<HTMLInputElement>('input[name="animation-weight-paint-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) {
          this.weight_paint_mode = input.value === 'subtract' ? 'subtract' : 'add'
        }
      })
    })
    document.getElementById('animation-weight-paint-undo')?.addEventListener('click', () => this.undo_weight_paint_stroke())
    document.getElementById('animation-weight-paint-clear')?.addEventListener('click', () => this.clear_weight_paint())

    // helps ensure we don't add event listeners multiple times
    this.has_added_event_listeners = true
  }

  // called by ArmExtensionControl whenever the arm extension amount changes
  private update_a_pose_value (): void {
    this.rebuild_warped_animations()
    this.play_animation(this.current_playing_id)
  }

  public build_animation_clip_ui (theme_manager: ThemeManager): void {
    // Initialize AnimationSearch if not already done
    // we could switch skeleton types using navigation, so need to re-create in case this happens
    this.animation_search = new AnimationSearch('animation-filter', 'animations-items', theme_manager, this.skeleton_type)

    // Use the animation search class to handle the UI
    this.animation_search.initialize_animations(this.animation_library.all())
  }

  /**
   * Downloads any selected animations that are not loaded yet, then returns the display
   * clip for each selection so the export includes the current warps.
   */
  public async get_animation_clips_to_export (): Promise<AnimationClipExportSelection[]> {
    const export_selections = this.animation_search?.get_selected_animation_export_selections() ?? []
    await this.animation_library.load_many(export_selections.map(selection => selection.animation_id))

    return export_selections.flatMap((selection) => {
      const clip_pair = this.animation_library.find(selection.animation_id)?.clip_pair
      if (clip_pair === undefined || clip_pair === null) {
        return []
      }
      return [{ clip: clip_pair.display_animation_clip, mirror_export_mode: selection.mirror_export_mode }]
    })
  }
}

/**
 * Heatmap color for the selected bone's weight: blue at 0, yellow at 0.5,
 * red at 1. Alpha ramps up so low weights stay subtle over the texture.
 */
function write_weight_color (
  attribute: { setXYZW: (index: number, x: number, y: number, z: number, w: number) => unknown },
  vertex_index: number,
  weight: number
): void {
  const t = Math.min(1, Math.max(0, weight))

  let red: number
  let green: number
  let blue: number
  if (t < 0.5) {
    const u = t / 0.5
    red = 0.1 + 0.9 * u
    green = 0.35 + 0.55 * u
    blue = 1.0 - 0.9 * u
  } else {
    const u = (t - 0.5) / 0.5
    red = 1.0
    green = 0.9 - 0.8 * u
    blue = 0.1 * (1 - u)
  }

  const alpha = 0.9 * t
  attribute.setXYZW(vertex_index, red, green, blue, alpha)
}
