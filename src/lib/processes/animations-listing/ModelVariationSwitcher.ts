import { Skeleton, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import tippy from 'tippy.js'
import { RigConfig, type ModelVariation, type RigConfigEntry } from '../../RigConfig'
import { type SkeletonType } from '../../enums/SkeletonType'
import { VariationLicenseCatalog } from '../../VariationLicenseInfo'

/**
 * Manages the model variation selection on the "Explore" page.
 * When a rig type is selected that has model_variations in its RigConfig,
 * a button is shown that opens a confirmation dialog with image previews
 * and attribution for each variation. Otherwise the button is hidden.
 *
 * The dialog HTML lives in index.html; this class populates and shows/hides it.
 * Loads the selected variation GLB and dispatches 'variation-changed'
 * with the extracted SkinnedMesh[] so consumers can swap the model directly.
 */
export class ModelVariationSwitcher extends EventTarget {

  // Dialog related DOM elements for switching the model with a popup dialog
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


  // Loading progress bar elements within the dialog once confirmation happens. A few models are around 5MB which could take
  // a moment to load.
  private readonly dom_loading_container: HTMLElement | null = document.querySelector('#variation-loading-container')
  private readonly dom_loading_bar: HTMLElement | null = document.querySelector('#variation-loading-bar')
  private readonly dom_loading_text: HTMLElement | null = document.querySelector('#variation-loading-text')

  // UI elements on the explore page that show the currently selected variation's info. Used to populate current value.
  private readonly dom_switcher: HTMLElement | null = document.querySelector('#model-variation-switcher')
  private readonly dom_change_model_button: HTMLButtonElement | null = document.querySelector('#model-variation-button')
  private readonly dom_info_image: HTMLImageElement | null = document.querySelector('#model-variation-info-image')
  private readonly dom_info_name: HTMLElement | null = document.querySelector('#model-variation-info-name')
  private readonly dom_info_license: HTMLElement | null = document.querySelector('#model-variation-info-license')
  private readonly dom_info_attribution: HTMLElement | null = document.querySelector('#model-variation-info-attribution')

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
    this.update_active_model_info()
  }

  /** 
   * Updates the info section on the explore page to reflect the currently active variation.
   * If no variation is active, hides the info section.
  */
  private update_active_model_info (): void {

    // nothing selected for rig, or user cancelled out of dialog -> hide info section
    if (this.confirmed_variation === null) {
      if (this.dom_info_image !== null) this.dom_info_image.style.display = 'none'
      if (this.dom_info_name !== null) this.dom_info_name.textContent = ''
      if (this.dom_info_license !== null) {
        this.dom_info_license.textContent = ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this.dom_info_license as any)._tippy?.destroy()
      }
      return
    }

    // update image properties
    if (this.dom_info_image !== null) {
      this.dom_info_image.src = '../' + this.confirmed_variation.preview_image
      this.dom_info_image.alt = this.confirmed_variation.display_name
      this.dom_info_image.style.display = ''
    }

    // Update rig name
    if (this.dom_info_name !== null) {
      this.dom_info_name.textContent = this.confirmed_variation.display_name
    }

    // update license info
    if (this.dom_info_license !== null) {
      this.dom_info_license.textContent = this.confirmed_variation.license
      const license_description = VariationLicenseCatalog.get_license_info(this.confirmed_variation.license).description
      tippy(this.dom_info_license, { content: license_description, theme: 'mesh2motion' })
    }

    // update attribution
    if (this.dom_info_attribution !== null) {
      if (this.confirmed_variation.attribution !== 'None') {
        this.dom_info_attribution.textContent = this.confirmed_variation.attribution
        this.dom_info_attribution.style.display = ''
      } else {
        this.dom_info_attribution.textContent = ''
        this.dom_info_attribution.style.display = 'none'
      }
    }
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

      const license_info = VariationLicenseCatalog.get_license_info(variation.license)
      const license_chip = document.createElement('span')
      license_chip.className = 'variation-license-chip'
      license_chip.textContent = variation.license
      card.appendChild(license_chip)

      tippy(license_chip, {
        content: `${variation.license}: ${license_info.description}`,
        theme: 'mesh2motion',
        placement: 'top'
      })

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

  private show_loading_progress (): void {
    if (this.dom_loading_container !== null) this.dom_loading_container.style.display = ''
    if (this.dom_loading_bar !== null) this.dom_loading_bar.style.transform = 'scaleX(0)'
    if (this.dom_loading_text !== null) this.dom_loading_text.textContent = 'Loading model…'
  }

  private hide_loading_progress (): void {
    if (this.dom_loading_container !== null) this.dom_loading_container.style.display = 'none'
    if (this.dom_loading_bar !== null) this.dom_loading_bar.style.transform = 'scaleX(0)'
  }

  private update_loading_progress (percent: number): void {
    // the progress callback from the GLTF loader can fire frequently and the DOM never 'repaints' with the new values
    // this forces the DOM to update the new progress bar values immediately.
    requestAnimationFrame(() => {
      if (this.dom_loading_bar !== null) this.dom_loading_bar.style.transform = `scaleX(${percent / 100})`
      if (this.dom_loading_text !== null) this.dom_loading_text.textContent = `Loading model… ${Math.round(percent)}%`
    })
  }

  private load_variation_model (model_file: string): void {
    this.show_loading_progress()

    this.loader.load(
      '../' + model_file,
      (gltf) => {
        this.hide_loading_progress()
        this.hide_dialog()

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
      (progress: ProgressEvent<EventTarget>) => {
        if (progress.lengthComputable) {
          const percent = (progress.loaded / progress.total) * 100
          this.update_loading_progress(percent)
        }
      },
      (error: unknown) => {
        // this should never happen since we are only using application files
        console.error('Failed to load model variation:', model_file, error)
        this.hide_loading_progress()
        if (this.dom_dialog_confirm_button !== null) this.dom_dialog_confirm_button.disabled = false
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

    this.dom_switcher?.addEventListener('click', () => {
      this.show_dialog()
    })

    this.dom_dialog_cancel_button?.addEventListener('click', () => {
      this.hide_dialog()
    })

    // accept changes
    this.dom_dialog_confirm_button?.addEventListener('click', () => {
      if (this.pending_variation === null) return // this shouldn't happen, but leave for a safe guard

      this.confirmed_variation = this.pending_variation
      if (this.dom_dialog_confirm_button !== null) this.dom_dialog_confirm_button.disabled = true
      this.update_active_model_info()
      this.load_variation_model(this.confirmed_variation.model_file)
    })

    // clicking on the overlay screen bg should also close/cancel the dialog
    this.dom_dialog_overlay?.addEventListener('click', (e) => {
      if (e.target === this.dom_dialog_overlay) this.hide_dialog()
    })
  }
}
