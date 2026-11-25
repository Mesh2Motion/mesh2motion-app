import { type Bone } from 'three'
import { ModalDialog } from '../ui/dialogs/ModalDialog.ts'

export class TargetBoneTreeDialog {
  private target_bones: Map<string, Bone> = new Map<string, Bone>()
  private target_skinned_mesh_count: number = 0
  private view_bone_tree_button: HTMLSpanElement | null = null
  private has_added_event_listeners: boolean = false

  public begin (): void {
    this.view_bone_tree_button = document.getElementById('view-bone-tree-button') as HTMLSpanElement

    if (!this.has_added_event_listeners) {
      this.view_bone_tree_button?.addEventListener('click', () => {
        this.show()
      })

      this.has_added_event_listeners = true
    }
  }

  public set_target_bones (target_bones: Map<string, Bone>): void {
    this.target_bones = target_bones
  }

  public set_target_skinned_mesh_count (target_skinned_mesh_count: number): void {
    this.target_skinned_mesh_count = Math.max(0, target_skinned_mesh_count)
  }

  public show (): void {
    const target_bones = this.target_bones
    const root_target_bones = TargetBoneTreeDialog.get_root_bones(target_bones)

    if (target_bones.size === 0) {
      new ModalDialog('Target Skeleton Hierarchy', '<p>No target skeleton loaded.</p>', { customClass: 'bone-tree-modal' }).show()
      return
    }

    const tree_html = root_target_bones
      .map((root_bone) => TargetBoneTreeDialog.create_bone_tree_html(root_bone, target_bones))
      .join('')

    // some imports may result where there is no hiearachy...which will create issues. show this in the view
    // Check for flat hierarchy: if all bones are root bones (no parent-child relationships)
    const is_flat_hierarchy = target_bones.size > 1 && root_target_bones.length === target_bones.size
    const flat_hierarchy_warning_html = is_flat_hierarchy
      ? `<div class="bone-tree-dialog-warning">
          ⚠️ Flat hierarchy detected: This could be because there are multiple skinned meshes (which aren't supported). all bones appear as root bones with no parent-child relationships.
          This may indicate the skeleton was exported without hierarchy data (e.g. some FBX exports).
          Retargeting will not work.
        </div>`
      : ''

    const content_html = `
      <div class="bone-tree-dialog-summary">
        <span>Total bones: ${target_bones.size}</span>
        <span>Root chains: ${root_target_bones.length}</span>
        <span>Skinned meshes: ${this.target_skinned_mesh_count}</span>
      </div>
      ${flat_hierarchy_warning_html}
      <ul class="bone-tree-dialog-list">
        ${tree_html}
      </ul>
    `

    new ModalDialog('Target Skeleton Hierarchy', content_html, { customClass: 'bone-tree-modal' }).show()
  }

  private static get_root_bones (target_bones: Map<string, Bone>): Bone[] {
    const roots: Bone[] = []

    target_bones.forEach((bone) => {
      const parent = bone.parent
      const has_bone_parent_in_target = parent !== null && parent.type === 'Bone' && target_bones.has(parent.uuid)

      if (!has_bone_parent_in_target) {
        roots.push(bone)
      }
    })

    return roots.sort((a, b) => a.name.localeCompare(b.name))
  }

  private static create_bone_tree_html (bone: Bone, target_bones: Map<string, Bone>): string {
    const child_bones = bone.children
      .filter((child): child is Bone => child.type === 'Bone' && target_bones.has(child.uuid))
      .sort((a, b) => a.name.localeCompare(b.name))

    const children_html = child_bones.length > 0
      ? `<ul>${child_bones.map((child_bone) => this.create_bone_tree_html(child_bone, target_bones)).join('')}</ul>`
      : ''

    return `<li>🦴<span class="bone-tree-node-name">${this.escape_html(bone.name)}</span>${children_html}</li>`
  }

  private static escape_html (value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
