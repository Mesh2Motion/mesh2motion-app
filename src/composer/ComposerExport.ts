import { type AnimationClip, type SkinnedMesh } from 'three'
import { type DownloadSettings } from '../lib/processes/export-to-file/DownloadSettings.ts'
import { type StepExportToFile } from '../lib/processes/export-to-file/StepExportToFile.ts'
import { DownloadSuccessDialog } from '../lib/components/download-success/DownloadSuccessDialog.ts'
import { ModalDialog } from '../lib/ModalDialog.ts'

export interface ComposerExportData {
  clip: AnimationClip
  skinned_meshes: SkinnedMesh[]
}

/**
 * The download button on the Composer page. The file is named after the animations in the slots.
 * Downloads go through the same export step and download options as the Explore page.
 */
export class ComposerExport {
  private readonly dom_export_button: HTMLButtonElement | null = document.querySelector('#export-composer-button')

  private export_name: string = 'Animation_Remix'
  private is_exporting: boolean = false
  private has_export_data: boolean = false

  constructor (
    private readonly file_export_step: StepExportToFile,
    private readonly download_settings: DownloadSettings,
    private readonly get_export_data: () => ComposerExportData | null
  ) {
    // the button always downloads one animation
    const count_element = this.dom_export_button?.querySelector('#animation-selection-count')
    if (count_element !== null && count_element !== undefined) {
      count_element.textContent = '1'
    }

    this.add_event_listeners()
    this.update_button_state()
  }

  /**
   * Name for the downloaded file and the animation inside it, e.g. 'Wave_Walk_Remix'.
   */
  public set_export_name (name: string): void {
    const cleaned_name: string = ComposerExport.clean_name(name)
    if (cleaned_name !== '') {
      this.export_name = cleaned_name
    }
  }

  /**
   * Turns the download button off while the composed animation is out of date (a slot is still downloading).
   */
  public set_export_ready (is_ready: boolean): void {
    this.has_export_data = is_ready
    this.update_button_state()
  }

  // names end up as file names and animation names in game engines, so keep them simple
  static clean_name (name: string): string {
    return name.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '')
  }

  private add_event_listeners (): void {
    this.dom_export_button?.addEventListener('click', () => {
      this.export().catch((error: unknown) => {
        console.error('Composer export failed:', error)
        const error_message = error instanceof Error ? error.message : 'Failed to export file.'
        new ModalDialog('Export failed', error_message).show()
      })
    })
  }

  private async export (): Promise<void> {
    const export_data: ComposerExportData | null = this.get_export_data()
    if (export_data === null || this.is_exporting) {
      return
    }

    const name: string = this.export_name
    const clip: AnimationClip = export_data.clip.clone()
    clip.name = name

    this.is_exporting = true
    this.update_button_state()
    try {
      this.file_export_step.set_animation_clips_to_export([{ clip, mirror_export_mode: 'none' }])
      await this.file_export_step.export(export_data.skinned_meshes, name, this.download_settings)
    } finally {
      this.is_exporting = false
      this.update_button_state()
    }

    new DownloadSuccessDialog().show()
  }

  private update_button_state (): void {
    if (this.dom_export_button !== null) {
      this.dom_export_button.disabled = !this.has_export_data || this.is_exporting
    }
  }
}
