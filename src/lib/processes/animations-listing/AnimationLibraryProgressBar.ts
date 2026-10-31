import { UI } from '../../UI.ts'
import { type AnimationLibraryLoadProgress } from './AnimationLibrary.ts'

export class AnimationLibraryProgressBar {
  /**
   * Shows how many animation files are downloaded in the animation loading progress bar.
   * The bar hides itself once everything is loaded.
   */
  public static update (progress: AnimationLibraryLoadProgress): void {
    const ui = UI.getInstance()
    const percentage = progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 100

    if (ui.dom_loading_progress_bar !== null) {
      ui.dom_loading_progress_bar.style.width = `${percentage}%`
      ui.dom_loading_progress_bar.textContent = `${progress.loaded} / ${progress.total} animations`
    }

    if (ui.dom_current_file_progress_bar !== null) {
      ui.dom_current_file_progress_bar.style.width = '0%'
    }

    if (ui.dom_animation_progress_loader_container !== null) {
      ui.dom_animation_progress_loader_container.style.display = percentage >= 100 ? 'none' : 'flex'
    }
  }
}
