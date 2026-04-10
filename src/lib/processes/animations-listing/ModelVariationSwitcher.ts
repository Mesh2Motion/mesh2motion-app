import { Skeleton, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RigConfig, type ModelVariation, type RigConfigEntry } from '../../RigConfig'
import { type SkeletonType } from '../../enums/SkeletonType'

/**
 * Manages the model variation selection on the Explore page.
 * When a rig type is selected that has model_variations in its RigConfig,
 * a button is shown that opens a confirmation dialog with image previews
 * and attribution for each variation. Otherwise the button is hidden.
 *
 * The dialog HTML lives in index.html; this class populates and shows/hides it.
 * Loads the selected variation GLB and dispatches 'variation-changed'
 * with the extracted SkinnedMesh[] so consumers can swap the model directly.
 */
export class ModelVariationSwitcher extends EventTarget {
  private readonly dom_switcher: HTMLElement | null = document.querySelector('#model-variation-switcher')
  private readonly dom_change_model_button: HTMLButtonElement | null = document.querySelector('#model-variation-button')
  private readonly dom_dialog_overlay: HTMLElement | null = document.querySelector('#variation-dialog-overlay')
  private readonly dom_grid: HTMLElement | null = document.querySelector('#variation-grid')
  private readonly dom_dialog_confirm_button: HTMLButtonElement | null = document.querySelector('#variation-confirm-button')
  private readonly dom_dialog_cancel_button: HTMLButtonElement | null = document.querySelector('#variation-cancel-button')
  private readonly loader: GLTFLoader = new GLTFLoader()
  private current_rig: RigConfigEntry | undefined
  private added_event_listeners = false
  private _is_variation_active: boolean = false
  private confirmed_variation: ModelVariation | null = null // model we currently have loaded
  private pending_variation: ModelVariation | null = null // active selection (will be reset if user cancels out of dialog)

  public get is_variation_active (): boolean {
    return this._is_variation_active
  }

  public set is_variation_active (value: boolean) {
    this._is_variation_active = value
  }

  /**
   * Call this whenever the active rig type changes.
   * Shows the variation button if the rig has variations, otherwise hides it.
   */
  public update_for_rig (skeleton_type: SkeletonType): void {
    this.current_rig = RigConfig.by_skeleton_type(skeleton_type)
    this.update_button_visibility()
    this.add_event_listeners()

    // select the first variation by default if variation selection doesn't exist
    const variations = this.current_rig?.model_variations
    this.confirmed_variation = (variations !== undefined && variations.length > 0) ? variations[0] : null
    this.pending_variation = this.confirmed_variation
  }

  private update_button_visibility (): void {
    const switcher = this.dom_switcher
    if (switcher === null) return

    const variations = this.current_rig?.model_variations
    if (variations === undefined || variations.length === 0) {
      switcher.style.display = 'none'
      return
    }

    switcher.style.display = '' // use default display style by removing inline style
  }

  private populate_grid (): void {
    const grid = this.dom_grid
    if (grid === null) return

    const variations = this.current_rig?.model_variations
    if (variations === undefined || variations.length === 0) return

    grid.innerHTML = '' // reset whatever was there before

    // create tiles for each variation item
    for (const variation of variations) {
      const card = document.createElement('div')
      card.className = 'variation-card'

      const img = document.createElement('img')
      img.src =  '../' + variation.preview_image
      img.alt = variation.display_name
      img.className = 'variation-preview-image'
      card.appendChild(img)

      const name_el = document.createElement('div')
      name_el.className = 'variation-name'
      name_el.textContent = variation.display_name
      card.appendChild(name_el)

      if (variation.attribution !== 'None') {
        const attribution_el = document.createElement('div')
        attribution_el.className = 'variation-attribution'
        attribution_el.textContent = variation.attribution
        card.appendChild(attribution_el)
      }

      // add class for default selection
      if (this.pending_variation !== null && variation.model_file === this.pending_variation.model_file) {
        card.classList.add('selected')
      }

      card.addEventListener('click', () => {
        grid.querySelectorAll('.variation-card').forEach(c => c.classList.remove('selected'))
        card.classList.add('selected')
        this.pending_variation = variation
        if (this.dom_dialog_confirm_button !== null) this.dom_dialog_confirm_button.disabled = false
      })

      grid.appendChild(card)
    }
  }

  private show_dialog (): void {
    if (this.dom_dialog_overlay === null) return

    this.pending_variation = this.confirmed_variation

    if (this.dom_dialog_confirm_button !== null) {
      this.dom_dialog_confirm_button.disabled = this.pending_variation === null
    }

    this.populate_grid()
    this.dom_dialog_overlay.style.display = '' // reset to default styling
  }

  private hide_dialog (): void {
    if (this.dom_dialog_overlay === null) return
    this.dom_dialog_overlay.style.display = 'none'
  }

  private load_variation_model (model_file: string): void {
    this.loader.load(
      '../' + model_file,
      (gltf) => {
        const skinned_meshes: SkinnedMesh[] = []
        gltf.scene.traverse((child) => {
          if (child instanceof SkinnedMesh) {
            child.castShadow = true
            child.receiveShadow = true
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

    this.dom_change_model_button?.addEventListener('click', () => {
      this.show_dialog()
    })

    this.dom_dialog_cancel_button?.addEventListener('click', () => {
      this.hide_dialog()
    })

    // accept changes
    this.dom_dialog_confirm_button?.addEventListener('click', () => {
      if (this.pending_variation === null) return // this shouldn't happen, but leave for a safe guard

      this.confirmed_variation = this.pending_variation
      this.hide_dialog()
      this.load_variation_model(this.confirmed_variation.model_file)
    })

    // clicking on the overlay screen bg should also close/cancel the dialog
    this.dom_dialog_overlay?.addEventListener('click', (e) => {
      if (e.target === this.dom_dialog_overlay) this.hide_dialog()
    })
  }
}
