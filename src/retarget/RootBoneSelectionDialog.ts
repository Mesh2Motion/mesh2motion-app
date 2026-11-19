import { type RootBoneChain } from './interfaces/RootBoneChain'

/**
 * Modal dialog that asks the user which root bone is the main skeleton when
 * an imported model contains multiple disconnected bone hierarchies. Resolves
 * with the uuid of the chosen root bone, or null when the user cancels.
 */
export class RootBoneSelectionDialog {
  private dialog_element: HTMLDivElement | null = null

  /**
   * Shows the dialog and waits for the user to pick a root bone.
   * @returns The uuid of the chosen root bone, or null when cancelled.
   */
  public show (root_chains: RootBoneChain[]): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this.remove()

      const options_html: string = root_chains
        .map((chain, index) => this.create_chain_option_html(chain, index))
        .join('')

      this.dialog_element = document.createElement('div')
      this.dialog_element.className = 'modal-dialog-overlay root-bone-selection-modal'
      this.dialog_element.innerHTML = `
        <div class="modal-dialog-content">
          <h2>Multiple Root Bones Detected in Skeleton</h2>
          <div class="modal-dialog-body">
            <p>
              This model contains ${root_chains.length} separate root bones (which translates to multiple skeletons).
              Mesh2Motion can only retarget a single skeleton hierarchy, so choose the main one to
              keep. All other skeletons will be discarded.
            </p>
            <div class="root-bone-selection-list">${options_html}</div>
          </div>
          <div class="root-bone-selection-actions">
            <button class="root-bone-selection-cancel">Cancel Import</button>
          </div>
        </div>
      `
      document.body.appendChild(this.dialog_element)

      this.dialog_element.querySelectorAll<HTMLButtonElement>('[data-root-uuid]').forEach((button) => {
        button.addEventListener('click', () => {
          const root_uuid = button.dataset.rootUuid ?? null
          this.remove()
          resolve(root_uuid)
        })
      })

      this.dialog_element.querySelector('.root-bone-selection-cancel')?.addEventListener('click', () => {
        this.remove()
        resolve(null)
      })

      this.dialog_element.addEventListener('click', (event) => {
        if (event.target === this.dialog_element) {
          this.remove()
          resolve(null)
        }
      })
    })
  }

  // Creates the HTML for a single root bone option in the dialog.
  private create_chain_option_html (chain: RootBoneChain, index: number): string {
    const bone_word = chain.bone_count === 1 ? 'bone' : 'bones'
 

    return `
      <button class="root-bone-selection-option" data-root-uuid="${chain.root_bone.uuid}">
        <span class="root-bone-option-name">
        Root ${index + 1}: ${this.escape_html(chain.root_bone.name)} bone  (${chain.bone_count} ${bone_word})
        </span>
      </button>
    `
  }

  // Removes the dialog from the DOM and cleans up event listeners.
  public remove (): void {
    if (this.dialog_element !== null && this.dialog_element.parentNode !== null) {
      this.dialog_element.parentNode.removeChild(this.dialog_element)
      this.dialog_element = null
    }
  }

  // Bone names can contain HTML special characters, so escape them
  private escape_html (value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
