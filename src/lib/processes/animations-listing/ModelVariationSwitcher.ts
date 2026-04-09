import { Skeleton, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RigConfig, type RigConfigEntry } from '../../RigConfig'
import { type SkeletonType } from '../../enums/SkeletonType'

/**
 * Manages the model variation dropdown on the Explore page.
 * When a rig type is selected that has model_variations in its RigConfig,
 * the dropdown is populated and shown. Otherwise it is hidden.
 *
 * Loads the selected variation GLB and dispatches 'variation-changed'
 * with the extracted SkinnedMesh[] so consumers can swap the model directly.
 */
export class ModelVariationSwitcher extends EventTarget {
  private readonly dom_switcher: HTMLElement | null = document.querySelector('#model-variation-switcher')
  private readonly dom_select: HTMLSelectElement | null = document.querySelector('#model-variation-selection')
  private readonly loader: GLTFLoader = new GLTFLoader()
  private current_rig: RigConfigEntry | undefined
  private added_event_listeners = false
  private _is_variation_active: boolean = false

  public get is_variation_active (): boolean {
    return this._is_variation_active
  }

  public set is_variation_active (value: boolean) {
    this._is_variation_active = value
  }

  /**
   * Call this whenever the active rig type changes.
   * Populates the variation dropdown if the rig has variations, otherwise hides it.
   */
  public update_for_rig (skeleton_type: SkeletonType): void {
    this.current_rig = RigConfig.by_skeleton_type(skeleton_type)
    this.populate_select()
    this.add_event_listeners()
  }

  private populate_select (): void {
    const switcher = this.dom_switcher
    const select = this.dom_select
    if (switcher === null || select === null) return

    const variations = this.current_rig?.model_variations
    if (variations === undefined || variations.length === 0) {
      switcher.style.display = 'none'
      return
    }

    // clear any previous options and rebuild from RigConfig
    select.innerHTML = ''
    for (const variation of variations) {
      const option = document.createElement('option')
      option.value = variation.model_file
      option.textContent = variation.display_name
      select.appendChild(option)
    }

    switcher.style.display = '' // use default display style by removing inline style
  }

  private load_variation_model (model_file: string): void {
    this.loader.load(
      '../' + model_file,
      (gltf) => {
        const skinned_meshes: SkinnedMesh[] = []
        gltf.scene.traverse((child) => {
          if (child instanceof SkinnedMesh) {
            skinned_meshes.push(child)
          }
        })

        this.normalize_skinned_meshes(skinned_meshes)

        this.dispatchEvent(new CustomEvent('variation-changed', {
          detail: { model_file, skinned_meshes }
        }))
      },
      undefined,
      (error) => {
        console.error('Failed to load model variation:', model_file, error)
      }
    )
  }

  /**
   * Re-parents each skeleton's root bone to be a child of its skinned mesh.
   * This matches the structure created by StepWeightSkin in the normal pipeline,
   * so the export path can treat both cases identically.
   */
  private normalize_skinned_meshes (skinned_meshes: SkinnedMesh[]): void {
    const processed_skeletons = new Set<Skeleton>()

    for (const mesh of skinned_meshes) {
      if (processed_skeletons.has(mesh.skeleton)) continue
      processed_skeletons.add(mesh.skeleton)

      const root_bone = mesh.skeleton.bones[0]
      if (root_bone !== undefined) {
        mesh.add(root_bone)
      }
    }
  }

  private add_event_listeners (): void {
    if (this.added_event_listeners) return
    this.added_event_listeners = true

    const select = this.dom_select
    if (select === null) return

    select.addEventListener('change', () => {
      this.load_variation_model(select.value)
    })
  }
}
