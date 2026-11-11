import { type Bone, type Intersection, type PerspectiveCamera } from 'three'
import { Utility } from '../../Utilities.ts'
import { WeightPaintBrush } from './WeightPaintBrush.ts'
import { WeightPaintManager, type ManualWeightOverrides, type WeightPaintMode } from './WeightPaintManager.ts'

/**
 * Weight painting controls shown while positioning the joints.
 *
 * It owns the paint state and the panel in the tool sidebar, so StepEditSkeleton
 * only has to forward engine events and expose the painted overrides.
 */
export class WeightPaintEditTools extends EventTarget {
  public readonly manager = new WeightPaintManager()
  public readonly brush = new WeightPaintBrush(this.manager)

  private bones: Bone[] = []
  private bone_name: string | null = null
  private available = false
  private enabled = false
  private added_event_listeners = false

  public begin (bones: Bone[]): void {
    this.bones = bones
    if (!this.added_event_listeners) {
      this.add_event_listeners()
      this.added_event_listeners = true
    }
    this.update_bone_options()
    this.update_ui()
  }

  public overrides_for_skin (): ManualWeightOverrides {
    return this.manager.overrides_for_skin()
  }

  public set_available (available: boolean): void {
    this.available = available
    if (!available) {
      this.set_enabled(false)
    }
    this.update_ui()
  }

  public is_enabled (): boolean {
    return this.enabled
  }

  public set_enabled (enabled: boolean): void {
    if (enabled && (!this.available || this.bone_name === null)) {
      return
    }
    if (this.enabled === enabled) {
      this.update_ui()
      return
    }

    this.enabled = enabled
    this.dispatchEvent(new CustomEvent('weightPaintModeChanged', { detail: { enabled } }))
    this.update_ui()
  }

  public begin_stroke (): void {
    this.brush.begin_stroke()
    this.update_ui()
  }

  public end_stroke (): void {
    this.brush.finish_stroke()
    this.update_ui()
  }

  /** Breaks the drag sweep when the pointer leaves the mesh. */
  public reset_dab_path (): void {
    this.brush.reset_dab_path()
  }

  public paint (intersection: Intersection, camera: PerspectiveCamera): void {
    if (!this.enabled || this.bone_name === null) { return }

    this.brush.paint(intersection, camera, this.bone_name, this.bones)
    this.update_ui()
  }

  public undo_stroke (): void {
    if (!this.manager.undo()) { return }
    this.dispatchEvent(new CustomEvent('weightPaintChanged'))
    this.update_ui()
  }

  public clear (): void {
    this.manager.clear()
    this.dispatchEvent(new CustomEvent('weightPaintChanged'))
    this.update_ui()
  }

  /** Used when a different model is loaded, since vertex indices no longer match. */
  public reset (): void {
    this.manager.clear()
    this.update_ui()
  }

  private update_bone_options (): void {
    const select = document.getElementById('weight-paint-bone') as HTMLSelectElement | null
    if (select === null) { return }

    const previous = this.bone_name ?? select.value
    select.innerHTML = ''
    for (const bone of this.bones) {
      if (bone.name === 'root' || Utility.is_leaf_bone(bone)) { continue }
      const option = document.createElement('option')
      option.value = bone.name
      option.textContent = bone.name
      select.appendChild(option)
    }

    const previous_still_exists = Array.from(select.options).some(option => option.value === previous)
    select.selectedIndex = previous_still_exists
      ? Array.from(select.options).findIndex(option => option.value === previous)
      : (select.options.length > 0 ? 0 : -1)
    this.bone_name = select.value === '' ? null : select.value
  }

  private update_ui (): void {
    const container = document.getElementById('weight-painting-tools')
    if (container !== null) {
      container.hidden = !this.available
    }

    const toggle = document.getElementById('weight-paint-toggle') as HTMLButtonElement | null
    if (toggle !== null) {
      toggle.textContent = this.enabled ? 'Stop painting' : 'Start painting'
      toggle.setAttribute('aria-pressed', String(this.enabled))
      toggle.disabled = !this.available || this.bone_name === null
    }

    const undo = document.getElementById('weight-paint-undo') as HTMLButtonElement | null
    if (undo !== null) {
      undo.disabled = !this.manager.can_undo()
    }

    const clear = document.getElementById('weight-paint-clear') as HTMLButtonElement | null
    if (clear !== null) {
      clear.disabled = !this.manager.has_overrides()
    }

    const mirror = document.getElementById('weight-paint-mirror') as HTMLInputElement | null
    if (mirror !== null) {
      mirror.checked = this.brush.mirror_enabled
    }

    const add = document.getElementById('weight-paint-add') as HTMLInputElement | null
    const subtract = document.getElementById('weight-paint-subtract') as HTMLInputElement | null
    const smooth = document.getElementById('weight-paint-smooth') as HTMLInputElement | null
    if (add !== null) { add.checked = this.brush.mode === 'add' }
    if (subtract !== null) { subtract.checked = this.brush.mode === 'subtract' }
    if (smooth !== null) { smooth.checked = this.brush.mode === 'smooth' }
  }

  private add_event_listeners (): void {
    document.getElementById('weight-paint-toggle')?.addEventListener('click', () => {
      this.set_enabled(!this.enabled)
    })
    document.getElementById('weight-paint-bone')?.addEventListener('change', (event) => {
      const select = event.target as HTMLSelectElement
      this.bone_name = select.value === '' ? null : select.value
      this.update_ui()
    })
    document.getElementById('weight-paint-radius')?.addEventListener('input', (event) => {
      this.brush.radius_px = Number((event.target as HTMLInputElement).value)
    })
    document.getElementById('weight-paint-strength')?.addEventListener('input', (event) => {
      this.brush.strength = Number((event.target as HTMLInputElement).value)
    })
    document.getElementById('weight-paint-mirror')?.addEventListener('change', (event) => {
      this.brush.mirror_enabled = (event.target as HTMLInputElement).checked
      this.update_ui()
    })
    document.querySelectorAll<HTMLInputElement>('input[name="weight-paint-mode"]').forEach((input) => {
      input.addEventListener('change', () => {
        if (!input.checked) { return }
        this.brush.mode = input.value as WeightPaintMode
      })
    })
    document.getElementById('weight-paint-undo')?.addEventListener('click', () => this.undo_stroke())
    document.getElementById('weight-paint-clear')?.addEventListener('click', () => this.clear())
  }
}
