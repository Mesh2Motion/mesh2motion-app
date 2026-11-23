/**
 * M2M-031 — New Animation workspace.
 *
 * Two explicit creation modes (From Scratch / From Existing Animation) share the
 * application's authoritative AnimationDocument via SharedDraftController and
 * keep the normal 3D viewport. No MCP observation camera is ever shown here.
 */

import { SkinnedMesh, Vector3, type AnimationClip } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Mesh2MotionEngine } from '../Mesh2MotionEngine.ts'
import { maybe_attach_desktop_control } from '../control/attachControl.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { RigConfig } from '../lib/RigConfig.ts'
import { Utility } from '../lib/Utilities.ts'
import { AnimationLoader } from '../lib/processes/animations-listing/AnimationLoader.ts'
import { AnimationLibrary } from '../lib/processes/animations-listing/AnimationLibrary.ts'
import type { AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry.ts'
import { create_empty_document } from '../animation-document/create.ts'
import { import_clip_as_document } from '../animation-document/clipImport.ts'
import { SharedDraftController } from '../animation-document/sharedDraft.ts'
import { get_active_authoring_bridge } from '../authoringBridge/attach.ts'
import { is_animation_document } from '../authoringBridge/types.ts'
import { KeyframeEditor } from './keyframeEditor.ts'

const STATIC_ROOT = '../'
const SUPPORTED_RIGS: ReadonlyArray<{ value: SkeletonType, label: string }> = [
  { value: SkeletonType.Human, label: 'Human' },
  { value: SkeletonType.Fox, label: 'Fox' },
  { value: SkeletonType.Horse, label: 'Horse' }
]

function by_id<T extends HTMLElement> (id: string): T {
  const element = window.document.getElementById(id)
  if (element === null) throw new Error(`missing required element #${id}`)
  return element as T
}

export class NewAnimationWorkspace {
  private readonly engine: Mesh2MotionEngine
  private readonly controller: SharedDraftController
  private readonly editor: KeyframeEditor
  private readonly animation_loader = new AnimationLoader()
  private readonly animation_library = new AnimationLibrary(this.animation_loader)
  private skinned_meshes: SkinnedMesh[] = []
  private rig_type: SkeletonType = SkeletonType.Human
  private mode: 'scratch' | 'existing' = 'scratch'
  private selected_source: AnimationEntry | null = null
  private previewing = false

  constructor () {
    this.engine = new Mesh2MotionEngine()
    // Rust's frozen PageValue currently has no 'new-animation' variant; use the
    // existing 'unknown' value so MCP snapshots are not rejected. Codex can add
    // a named variant later without breaking this page.
    maybe_attach_desktop_control(this.engine, { page: 'unknown' })
    this.engine.set_camera_position(new Vector3(5.367, 3.298, 13.687))
    this.engine.set_active_skinned_meshes_provider(() => this.skinned_meshes)
    this.controller = new SharedDraftController(() => get_active_authoring_bridge())
    this.editor = new KeyframeEditor(this.controller, {
      tracks: by_id('new-animation-tracks'),
      timeline: by_id('new-animation-timeline'),
      time_label: by_id('new-animation-time'),
      values: by_id('new-animation-values'),
      status: by_id('new-animation-status')
    })
    this.editor.set_time(0)
    this.controller.subscribe(() => this.sync_controls())
    this.bind_controls()
  }

  async start (): Promise<void> {
    this.set_status('Loading rig…')
    try {
      await this.load_rig(this.rig_type)
      this.refresh_library()
      this.set_status('Ready. Choose a creation mode and create a clip.')
    } catch (error) {
      this.set_status(`Could not load the rig: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private set_status (message: string): void {
    by_id('new-animation-status').textContent = message
  }

  private bind_controls (): void {
    const rig_select = by_id<HTMLSelectElement>('new-animation-rig')
    for (const rig of SUPPORTED_RIGS) {
      const option = window.document.createElement('option')
      option.value = rig.value
      option.textContent = rig.label
      rig_select.appendChild(option)
    }
    rig_select.value = this.rig_type
    rig_select.addEventListener('change', () => {
      this.rig_type = rig_select.value as SkeletonType
      void this.load_rig(this.rig_type).then(() => this.refresh_library()).catch((error: unknown) => {
        this.set_status(`Rig change failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })

    for (const input of window.document.querySelectorAll<HTMLInputElement>('input[name="new-animation-mode"]')) {
      input.addEventListener('change', () => {
        this.mode = input.value === 'existing' ? 'existing' : 'scratch'
        by_id('new-animation-source-panel').hidden = this.mode !== 'existing'
        this.set_status(this.mode === 'scratch'
          ? 'From Scratch will create an empty original clip.'
          : 'From Existing Animation copies the selected clip tracks into a new draft.')
      })
    }

    by_id('new-animation-create').addEventListener('click', () => { void this.create_draft() })
    by_id('new-animation-preview').addEventListener('click', () => { void this.toggle_preview() })
    by_id('new-animation-add-key').addEventListener('click', () => { void this.editor.add_keyframe() })
    by_id('new-animation-remove-key').addEventListener('click', () => { void this.editor.remove_keyframe() })
    by_id('new-animation-undo').addEventListener('click', () => { void this.controller.undo_edit() })
    by_id('new-animation-redo').addEventListener('click', () => { void this.controller.redo_edit() })
    by_id('new-animation-save').addEventListener('click', () => { void this.save_draft() })
    by_id('new-animation-export').addEventListener('click', () => { void this.save_draft() })
    by_id('new-animation-commit').addEventListener('click', () => { void this.commit() })
    by_id('new-animation-cancel').addEventListener('click', () => { void this.cancel() })

    const filter = by_id<HTMLInputElement>('new-animation-source-filter')
    filter.addEventListener('input', () => this.render_library(filter.value.trim().toLowerCase()))

    const import_input = by_id<HTMLInputElement>('new-animation-import-input')
    by_id('new-animation-import').addEventListener('click', () => { import_input.click() })
    import_input.addEventListener('change', () => { void this.import_document(import_input.files?.[0]) })
  }

  private async load_rig (type: SkeletonType): Promise<void> {
    const rig = RigConfig.by_skeleton_type(type)
    if (rig === undefined) throw new Error(`unsupported rig ${type}`)
    const variation = rig.model_variations.find((item) => item.name === 'base') ?? rig.model_variations[0]
    if (variation === undefined) throw new Error(`rig ${rig.rig_display_name} has no rigged model`)
    const gltf = await new GLTFLoader().loadAsync(`${STATIC_ROOT}${variation.model_file}`)
    const meshes: SkinnedMesh[] = []
    gltf.scene.traverse((child) => {
      if (child instanceof SkinnedMesh) meshes.push(child)
    })
    if (meshes.length === 0) throw new Error(`no skinned meshes in ${variation.model_file}`)
    Utility.parent_root_bones_to_skinned_meshes(meshes)
    this.skinned_meshes.forEach((mesh) => { Utility.remove_object_with_children(mesh) })
    this.skinned_meshes = meshes
    this.engine.get_scene().add(...meshes)
    const skeleton = meshes[0].skeleton
    this.engine.regenerate_skeleton_helper(skeleton)
    this.engine.sync_skeleton_helper_joint_visibility()
    await this.controller.cancel().catch(() => {})
    this.set_status(`Loaded ${rig.rig_display_name}.`)
  }

  private refresh_library (): void {
    this.animation_loader.set_static_root_path(STATIC_ROOT)
    this.animation_library.reset(this.rig_type, 1)
    this.render_library('')
  }

  private render_library (filter: string): void {
    const list = by_id('new-animation-source-list')
    list.replaceChildren()
    const entries = this.animation_library.all().filter((entry) =>
      entry.name.toLowerCase().includes(filter))
    for (const entry of entries.slice(0, 100)) {
      const button = window.document.createElement('button')
      button.type = 'button'
      button.className = 'm2m-track-row'
      button.textContent = entry.name
      button.setAttribute('aria-pressed', String(this.selected_source?.id === entry.id))
      button.addEventListener('click', () => {
        this.selected_source = entry
        this.render_library(filter)
        this.set_status(`Source selected: ${entry.name}. Create the draft to copy its tracks.`)
      })
      list.appendChild(button)
    }
    if (entries.length === 0) list.textContent = 'No animations match this filter.'
  }

  private async create_draft (): Promise<void> {
    const name = by_id<HTMLInputElement>('new-animation-name').value.trim() || 'Untitled Authored Clip'
    const duration = Number(by_id<HTMLInputElement>('new-animation-duration').value) || 2
    try {
      if (this.mode === 'scratch') {
        await this.controller.create_from_scratch(name, duration)
        this.set_status(`Created empty original clip "${name}" — no source animation was used.`)
      } else {
        if (this.selected_source === null) throw new Error('select a source animation first')
        const entry = await this.animation_library.load(this.selected_source.id)
        const clip: AnimationClip | undefined = entry.clip_pair?.original_animation_clip
          ?? entry.clip_pair?.display_animation_clip
        if (clip === undefined) throw new Error(`source animation ${entry.name} has no loadable clip`)
        const template = create_empty_document({
          skeleton: this.skinned_meshes[0].skeleton,
          rig_identifier: this.rig_type,
          clip_name: name,
          duration_seconds: Math.max(clip.duration, 0.001)
        })
        const imported = import_clip_as_document(clip, template, entry.name)
        await this.controller.create_from_existing(imported.document, entry.name)
        this.set_status(`Copied ${imported.report.imported} tracks from "${entry.name}" into a new draft.`)
      }
      this.editor.set_time(0)
      this.sync_controls()
    } catch (error) {
      this.set_status(`Could not create the draft: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async toggle_preview (): Promise<void> {
    try {
      this.previewing = !this.previewing
      await this.controller.preview(this.previewing)
      this.set_status(this.previewing ? 'Previewing the authored draft.' : 'Preview stopped.')
    } catch (error) {
      this.previewing = false
      this.set_status(`Preview failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async save_draft (): Promise<void> {
    try {
      const document = await this.controller.export_document()
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = `${document.clip.name.replace(/[^a-z0-9_-]/gi, '_') || 'animation'}.animation-document.json`
      link.click()
      URL.revokeObjectURL(url)
      this.set_status(`Saved authored document at revision ${document.revision}.`)
    } catch (error) {
      this.set_status(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async import_document (file: File | undefined): Promise<void> {
    if (file === undefined) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!is_animation_document(parsed)) throw new Error('file is not an animation-document/v1 document')
      await this.controller.create_from_existing(parsed, `file:${file.name}`)
      this.editor.set_time(0)
      this.set_status(`Imported ${parsed.channels.length} channels from ${file.name}.`)
    } catch (error) {
      this.set_status(`Import failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async commit (): Promise<void> {
    try {
      const result = await this.controller.commit()
      this.previewing = false
      this.set_status(`Committed animation to the library (revision ${String(result.revision ?? '')}).`)
      this.sync_controls()
    } catch (error) {
      this.set_status(`Commit failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async cancel (): Promise<void> {
    try {
      await this.controller.cancel()
      this.previewing = false
      this.set_status('Draft discarded.')
      this.sync_controls()
    } catch (error) {
      this.set_status(`Cancel failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private sync_controls (): void {
    const snapshot = this.controller.snapshot()
    const has_draft = snapshot.document !== null
    by_id<HTMLButtonElement>('new-animation-preview').disabled = !has_draft
    by_id<HTMLButtonElement>('new-animation-add-key').disabled = !has_draft
    by_id<HTMLButtonElement>('new-animation-commit').disabled = !has_draft
    by_id<HTMLButtonElement>('new-animation-undo').disabled = !this.controller.can_undo()
    by_id<HTMLButtonElement>('new-animation-redo').disabled = !this.controller.can_redo()
    const revision = by_id('new-animation-revision')
    revision.textContent = has_draft
      ? `revision ${snapshot.revision} · ${snapshot.document?.channels.length ?? 0} tracks · ${snapshot.mcp_session_active ? 'MCP session active' : 'GUI editing'}`
      : 'no active draft'
    this.editor.render()
  }
}
