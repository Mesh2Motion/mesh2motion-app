import { SkinnedMesh } from 'three'
import { Utility } from '../../Utilities'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import tippy from 'tippy.js'
import { RigConfig, type ModelVariation, type RigConfigEntry } from '../../RigConfig'
import { type SkeletonType } from '../../enums/SkeletonType'
import { VariationLicenseCatalog } from '../../VariationLicenseInfo'

/**
 * Manages the model variation list in the Explore page's left sidebar.
 * When a rig type is selected that has model_variations in the asset manifest,
 * a card is shown for each one; clicking a card loads that model immediately.
 * Rigs without variations show an "no alternate models" message instead.
 *
 * The sidebar HTML lives in index.html; this class populates it.
 * Loads the selected variation GLB and dispatches 'variation-changed'
 * with the extracted SkinnedMesh[] so consumers can swap the model directly.
 */
export class ModelVariationSwitcher extends EventTarget {
  private readonly dom_section: HTMLElement | null = document.querySelector('#variation-section')
  private readonly dom_grid: HTMLElement | null = document.querySelector('#variation-grid')

  // A few models are around 5MB, so show progress while one loads.
  private readonly dom_loading_container: HTMLElement | null = document.querySelector('#variation-loading-container')
  private readonly dom_loading_bar: HTMLElement | null = document.querySelector('#variation-loading-bar')
  private readonly dom_loading_text: HTMLElement | null = document.querySelector('#variation-loading-text')

  private readonly loader: GLTFLoader = new GLTFLoader()
  private current_rig: RigConfigEntry | undefined
  private _is_variation_active: boolean = false
  private selected_variation: ModelVariation | null = null // model we currently have loaded
  private load_request_id = 0 // lets a rig switch or newer click discard a stale load

  public get is_variation_active (): boolean {
    return this._is_variation_active
  }

  public set is_variation_active (value: boolean) {
    this._is_variation_active = value
  }

  /** Call this whenever the active rig type changes. */
  public update_for_rig (skeleton_type: SkeletonType): void {
    this.current_rig = RigConfig.by_skeleton_type(skeleton_type)
    this.load_request_id++
    this.hide_loading_progress()

    // the rig's default model (first variation) is what gets loaded on rig change
    const variations = this.current_rig?.model_variations
    this.selected_variation = (variations !== undefined && variations.length > 0) ? variations[0] : null
    this.populate_grid()
  }

  private populate_grid (): void {
    const grid = this.dom_grid
    if (grid === null) return

    grid.innerHTML = ''

    if (this.dom_section !== null) this.dom_section.style.display = '' // hidden in the HTML until the first rig loads

    const variations = this.current_rig?.model_variations
    if (variations === undefined || variations.length === 0) {
      const empty_message = document.createElement('div')
      empty_message.className = 'variation-empty-message'
      empty_message.textContent = 'No alternate models for this rig.'
      grid.appendChild(empty_message)
      return
    }

    // Sort a copy so the rig's default (first) variation is unchanged
    const sorted_variations = [...variations].sort((a, b) => a.display_name.localeCompare(b.display_name))

    for (const variation of sorted_variations) {
      const card = document.createElement('div')
      card.className = 'variation-card'
      card.dataset.variation = variation.name

      const img = document.createElement('img')
      img.src = '../' + variation.preview_image
      img.alt = variation.display_name
      img.className = 'variation-preview-image'
      card.appendChild(img)

      card.title = variation.display_name // name isn't shown on the card

      const details = document.createElement('div')
      details.className = 'variation-details'
      card.appendChild(details)

      if (variation.attribution !== 'None') {
        const attribution_el = document.createElement('div')
        attribution_el.className = 'variation-attribution'
        attribution_el.textContent = variation.attribution
        details.appendChild(attribution_el)
      }

      const license_info = VariationLicenseCatalog.get_license_info(variation.license)
      const license_chip = document.createElement('span')
      license_chip.className = 'variation-license-chip'
      license_chip.textContent = variation.license
      details.appendChild(license_chip)

      tippy(license_chip, {
        content: `${variation.license}: ${license_info.description}`,
        theme: 'mesh2motion',
        placement: 'right'
      })

      card.classList.toggle('selected', variation.name === this.selected_variation?.name)
      card.addEventListener('click', () => { this.select_variation(variation) })

      grid.appendChild(card)
    }
  }

  private select_variation (variation: ModelVariation): void {
    if (variation.name === this.selected_variation?.name) return

    this.selected_variation = variation
    this.dom_grid?.querySelectorAll('.variation-card').forEach(card => {
      card.classList.toggle('selected', (card as HTMLElement).dataset.variation === variation.name)
    })

    this.load_variation_model(variation.model_file, variation.expandArms, variation.pelvis_position_scale)
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
    // the GLTF loader fires progress often and the DOM won't repaint between calls,
    // so push each update through requestAnimationFrame
    requestAnimationFrame(() => {
      if (this.dom_loading_bar !== null) this.dom_loading_bar.style.transform = `scaleX(${percent / 100})`
      if (this.dom_loading_text !== null) this.dom_loading_text.textContent = `Loading model… ${Math.round(percent)}%`
    })
  }

  private load_variation_model (model_file: string, expand_arms: number = 0, pelvis_position_scale: number = 1.0): void {
    const request_id = ++this.load_request_id
    this.show_loading_progress()

    this.loader.load(
      '../' + model_file,
      (gltf) => {
        if (request_id !== this.load_request_id) return

        this.hide_loading_progress()

        const skinned_meshes: SkinnedMesh[] = []
        gltf.scene.traverse((child) => {
          if (child instanceof SkinnedMesh) {
            child.castShadow = true
            child.receiveShadow = true
            skinned_meshes.push(child)
          }
        })

        Utility.parent_root_bones_to_skinned_meshes(skinned_meshes)

        this.dispatchEvent(new CustomEvent('variation-changed', {
          detail: { model_file, skinned_meshes, expandArms: expand_arms, pelvis_position_scale }
        }))
      },
      (progress: ProgressEvent<EventTarget>) => {
        if (progress.lengthComputable && request_id === this.load_request_id) {
          this.update_loading_progress((progress.loaded / progress.total) * 100)
        }
      },
      (error: unknown) => {
        // this should never happen since we are only using application files
        console.error('Failed to load model variation:', model_file, error)
        if (request_id === this.load_request_id) this.hide_loading_progress()
      }
    )
  }
}
