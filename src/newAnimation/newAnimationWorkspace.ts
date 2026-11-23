/**
 * M2M-031 — New Animation workspace.
 *
 * Two explicit creation modes (From Scratch / From Existing Animation) share the
 * application's authoritative AnimationDocument via SharedDraftController and
 * keep the normal 3D viewport. No MCP observation camera is ever shown here.
 */

import { SkinnedMesh, Vector2, Vector3, type AnimationClip, type Bone } from 'three'
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
import { apply_evaluated_pose, evaluate_document_at_time } from '../authoringObservation/poseEvaluation.ts'
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
  private selected_bone: Bone | null = null
  private selected_bone_index: number | null = null
  private bone_listener_bound = false
  private bone_filter = ''

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
      ruler: by_id('new-animation-ruler'),
      lanes: by_id('new-animation-lanes'),
      playhead: by_id('new-animation-playhead'),
      play_button: by_id<HTMLButtonElement>('new-animation-play'),
      stop_button: by_id<HTMLButtonElement>('new-animation-stop'),
      time_label: by_id('new-animation-time'),
      values: by_id('new-animation-values'),
      status: by_id('new-animation-status')
    }, this.engine)
    this.editor.set_pose_applier((time) => { this.apply_pose_at_time(time) })
    this.editor.set_time(0)
    this.controller.subscribe(() => {
      this.sync_controls()
      this.apply_pose_at_time(this.editor.current_time())
    })
    this.bind_controls()
    this.bind_bone_tools()
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

  /** Reuse the rigging tab's gizmo/selection machinery on the LIVE GLB bones. */
  private bind_bone_tools (): void {
    const controls = this.engine.transform_controls
    for (const button of window.document.querySelectorAll<HTMLButtonElement>('[data-bone-mode]')) {
      button.addEventListener('click', () => {
        const mode = button.dataset.boneMode
        if (mode === 'translate' || mode === 'rotate' || mode === 'scale') controls.setMode(mode)
        for (const other of window.document.querySelectorAll<HTMLButtonElement>('[data-bone-mode]')) {
          other.setAttribute('aria-pressed', String(other === button))
        }
      })
    }
    by_id<HTMLSelectElement>('new-animation-bone-space').addEventListener('change', (event) => {
      const space = (event.target as HTMLSelectElement).value
      controls.setSpace(space === 'world' ? 'world' : 'local')
    })
    by_id<HTMLInputElement>('new-animation-bone-filter').addEventListener('input', (event) => {
      this.bone_filter = (event.target as HTMLInputElement).value.trim().toLowerCase()
      this.render_bone_list()
    })
    by_id('new-animation-clear-bone').addEventListener('click', () => {
      controls.detach()
      this.selected_bone = null
      this.selected_bone_index = null
      by_id('new-animation-selected-bone').textContent = 'no bone selected'
      this.render_bone_list()
    })
  }

  /**
   * Canvas-relative bone picking. Utility.normalized_mouse_position() uses page
   * coordinates, which are wrong for the sidebar-aware viewport (the same class
   * of bug that moved the XYZ helper to the viewport centre). Using the canvas
   * rect keeps left/right joints on the correct side of the model.
   */
  private pick_bone (event: PointerEvent, skeleton: { bones: Bone[] }): { bone: Bone, index: number } | null {
    const canvas = this.engine.renderer.domElement
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const mouse = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    let best: { bone: Bone, index: number } | null = null
    let best_distance = Infinity
    skeleton.bones.forEach((bone, index) => {
      const projected = bone.getWorldPosition(new Vector3()).project(this.engine.camera)
      const distance = mouse.distanceTo(new Vector2(projected.x, projected.y))
      if (distance < best_distance) {
        best_distance = distance
        best = { bone, index }
      }
    })
    if (best === null || best_distance > this.engine.transform_controls_hover_distance) return null
    return best
  }

  /** Explicit, reliable selection path; the viewport click is only a convenience. */
  private select_bone (bone: Bone, skeleton_index: number): void {
    if (this.controller.snapshot().previewing) void this.toggle_preview()
    this.selected_bone = bone
    this.selected_bone_index = skeleton_index
    this.engine.transform_controls.attach(bone)
    by_id('new-animation-selected-bone').textContent = `selected: ${bone.name || `bone ${skeleton_index}`}`
    this.render_bone_list()
    this.apply_pose_at_time(this.editor.current_time())
  }

  private render_bone_list (): void {
    const list = by_id('new-animation-bone-list')
    list.replaceChildren()
    if (this.skinned_meshes.length === 0) return
    const bones = this.skinned_meshes[0].skeleton.bones
    const filtered = bones
      .map((bone, index) => ({ bone, index }))
      .filter(({ bone }) => bone.name.toLowerCase().includes(this.bone_filter))
    for (const { bone, index } of filtered) {
      const button = window.document.createElement('button')
      button.type = 'button'
      button.className = 'm2m-track-row'
      button.textContent = bone.name || `bone ${index}`
      button.setAttribute('aria-pressed', String(this.selected_bone_index === index))
      button.addEventListener('click', () => { this.select_bone(bone, index) })
      list.appendChild(button)
    }
    if (filtered.length === 0) list.textContent = 'No bones match this filter.'
  }

  private setup_bone_editing (): void {
    const controls = this.engine.transform_controls
    controls.enabled = true
    controls.setMode('rotate')
    controls.setSpace('local')
    // The default 1.0 gizmo dwarfs this rig and covers neighbouring joints;
    // a smaller handle makes joint picking practical.
    controls.size = 0.45
    if (this.bone_listener_bound) return
    this.bone_listener_bound = true

    // Engine EventListeners already own orbit enable/disable during drags; our
    // handler only maps the LIVE skeleton bone into the gizmo and writes keys.
    this.engine.renderer.domElement.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || controls.axis !== null || controls.dragging) return
      if (this.skinned_meshes.length === 0) return
      const skeleton = this.skinned_meshes[0].skeleton
      const picked = this.pick_bone(event, skeleton)
      if (picked === null || picked.bone.name === 'root') return
      this.select_bone(picked.bone, picked.index)
    })

    controls.addEventListener('dragging-changed', (event: Record<string, unknown>) => {
      if (Boolean(event.value) || this.selected_bone === null || this.selected_bone_index === null) return
      const authored = this.controller.document()
      if (authored === null) return
      const identity = authored.bones.find((bone) => bone.index === this.selected_bone_index)
      if (identity === undefined) return
      const mode = controls.getMode()
      const property = mode === 'translate' ? 'position' : mode === 'rotate' ? 'quaternion' : 'scale'
      const bone = this.selected_bone
      const values = property === 'position'
        ? [bone.position.x, bone.position.y, bone.position.z]
        : property === 'quaternion'
          ? [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w]
          : [bone.scale.x, bone.scale.y, bone.scale.z]
      void this.editor.upsert_channel_key(identity.id, property, values).catch((error: unknown) => {
        this.set_status(`Bone edit failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    })
  }

  /** Show the authored pose at the timeline cursor so gizmo edits start from it. */
  private apply_pose_at_time (time: number): void {
    const authored = this.controller.document()
    if (authored === null || this.skinned_meshes.length === 0) return
    if (this.controller.snapshot().previewing) return // the mixer owns the bones
    const evaluated = evaluate_document_at_time(authored, Math.min(time, authored.clip.duration_seconds))
    // Intentionally keep the applied pose: it is the current editing state.
    apply_evaluated_pose(this.skinned_meshes[0].skeleton, evaluated)
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
    // The New Animation tab is not the rigging ProcessStep, so make joints visible
    // explicitly to give the gizmo a clear click target.
    this.engine.skeleton_helper?.setJointsVisible(true)
    this.selected_bone = null
    this.selected_bone_index = null
    by_id('new-animation-selected-bone').textContent = 'no bone selected'
    this.render_bone_list()
    this.setup_bone_editing()
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
      if (this.previewing === false) this.editor.stop() // local timeline playback vs bridge preview
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
