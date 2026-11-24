/**
 * M2M-031 — one authoritative AnimationDocument for GUI and MCP.
 *
 * The controller does not own a second document model. Every operation is
 * dispatched through the live FrontendAuthoringBridge, which owns the single
 * InMemoryAnimationDocumentStore also used by MCP requests. GUI edits therefore
 * increment the same revision, are visible to MCP, and stale MCP revisions are
 * rejected instead of silently overwriting user edits.
 */

import { Quaternion } from 'three'
import type { FrontendAuthoringBridge } from '../authoringBridge/service'
import type { AuthoringResponse } from '../authoringBridge/types'
import { with_animation_channel } from './create'
import type { AnimationDocument, AnimationKeyframe, AnimationProperty } from './types'

export type BridgeProvider = () => FrontendAuthoringBridge | undefined

export interface SharedDraftSnapshot {
  document: AnimationDocument | null
  revision: number
  fingerprint: string
  previewing: boolean
  mcp_session_active: boolean
}

/**
 * Rest-aware authoring: a local rotation DELTA must be composed with the bone's
 * bind/rest quaternion, never written as an identity-based absolute rotation.
 * XYZW order matches animation-document/v1.
 */
export function compose_rest_delta (
  rest_quaternion: readonly number[],
  delta: readonly number[]
): [number, number, number, number] {
  if (rest_quaternion.length !== 4 || delta.length !== 4) {
    throw new Error('quaternions must have 4 values')
  }
  const rest = new Quaternion(...rest_quaternion as [number, number, number, number]).normalize()
  const rotation = new Quaternion(...delta as [number, number, number, number]).normalize()
  const result = rest.multiply(rotation)
  return [result.x, result.y, result.z, result.w]
}

export class SharedDraftController {
  private sequence = 0
  private readonly undo_stack: AnimationDocument[] = []
  private readonly redo_stack: AnimationDocument[] = []
  private readonly listeners = new Set<() => void>()
  private source_attribution: string | null = null

  constructor (
    private readonly bridge_provider: BridgeProvider,
    private readonly session_id: string = `gui-${Date.now().toString(16)}`
  ) {}

  subscribe (listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify (): void {
    for (const listener of this.listeners) listener()
  }

  attach (): () => void {
    const unsubscribe = this.bridge_provider()?.on_change(() => this.notify())
    // The live bridge can attach after this controller is constructed (rig
    // loading is asynchronous). The event is a UI refresh signal only, so the
    // GUI always reflects drafts created through MCP as well as GUI edits.
    if (typeof window === 'undefined') return () => { unsubscribe?.() }
    const on_document_changed = (): void => { this.notify() }
    window.addEventListener('m2m-authoring-document-changed', on_document_changed)
    return () => {
      unsubscribe?.()
      window.removeEventListener('m2m-authoring-document-changed', on_document_changed)
    }
  }

  private async operation (operation: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const bridge = this.bridge_provider()
    if (bridge === undefined) throw new Error('RIG_UNAVAILABLE: load a rig before authoring an animation')
    const response: AuthoringResponse = await bridge.handle_gui_request({
      protocol: 'authoring-bridge/v1',
      request_id: `gui-${++this.sequence}`,
      session_id: this.session_id,
      sequence: this.sequence,
      deadline_ms: 30000,
      operation,
      payload
    })
    if (!response.ok) throw new Error(response.error?.message ?? response.error?.code ?? 'authoring operation failed')
    return response.result ?? {}
  }

  snapshot (): SharedDraftSnapshot {
    const bridge = this.bridge_provider()
    return {
      document: bridge?.current_document() ?? null,
      revision: bridge?.current_revision() ?? 0,
      fingerprint: bridge?.rig_fingerprint() ?? '',
      previewing: bridge?.is_previewing() ?? false,
      mcp_session_active: bridge?.is_permission_enabled() ?? false
    }
  }

  document (): AnimationDocument | null {
    return this.bridge_provider()?.current_document() ?? null
  }

  /** From Scratch: an empty, original document bound to the live rig. */
  async create_from_scratch (name: string, duration_seconds: number): Promise<AnimationDocument> {
    this.undo_stack.length = 0
    this.redo_stack.length = 0
    this.source_attribution = null
    await this.operation('draft.create', { name, duration_seconds })
    this.notify()
    return this.document()!
  }

  /** From Existing Animation: explicit import/copy, never a silent source reuse. */
  async create_from_existing (document: AnimationDocument, source_name: string): Promise<AnimationDocument> {
    this.undo_stack.length = 0
    this.redo_stack.length = 0
    this.source_attribution = source_name
    this.bridge_provider()?.set_source_attribution(document.clip.name, source_name)
    await this.operation('draft.import', { document })
    this.notify()
    return this.document()!
  }

  source (): string | null {
    return this.source_attribution
  }

  private assert_revision (expected_revision: number): void {
    const current = this.document()
    if (current === null) throw new Error('STALE_REVISION: no active draft')
    if (current.revision !== expected_revision) {
      throw new Error(`STALE_REVISION: expected ${expected_revision}, draft is at ${current.revision}`)
    }
  }

  /** Atomic single-channel edit at an expected revision. */
  async set_channel (
    expected_revision: number,
    bone_id: string,
    property: AnimationProperty,
    keyframes: AnimationKeyframe[]
  ): Promise<AnimationDocument> {
    const current = this.document()
    if (current === null) throw new Error('no active draft')
    this.assert_revision(expected_revision)
    this.undo_stack.push(current)
    this.redo_stack.length = 0
    try {
      await this.operation('draft.set_keyframes', { expected_revision, bone_id, property, keyframes })
    } catch (error) {
      this.undo_stack.pop()
      throw error
    }
    this.notify()
    return this.document()!
  }

  /** Replace several channels atomically at one revision using a single import. */
  async set_channels (expected_revision: number, channels: Array<{ bone_id: string, property: AnimationProperty, keyframes: AnimationKeyframe[] }>): Promise<AnimationDocument> {
    const current = this.document()
    if (current === null) throw new Error('no active draft')
    this.assert_revision(expected_revision)
    let next = current
    for (const channel of channels) {
      next = with_animation_channel(next, channel)
    }
    this.undo_stack.push(current)
    this.redo_stack.length = 0
    try {
      await this.operation('draft.import', { document: { ...next, revision: current.revision } })
    } catch (error) {
      this.undo_stack.pop()
      throw error
    }
    this.notify()
    return this.document()!
  }

  async undo_edit (): Promise<AnimationDocument | null> {
    const previous = this.undo_stack.pop()
    if (previous === undefined) return null
    const current = this.document()
    if (current !== null) this.redo_stack.push(current)
    await this.operation('draft.import', { document: previous })
    this.notify()
    return this.document()
  }

  async redo_edit (): Promise<AnimationDocument | null> {
    const next = this.redo_stack.pop()
    if (next === undefined) return null
    const current = this.document()
    if (current !== null) this.undo_stack.push(current)
    await this.operation('draft.import', { document: next })
    this.notify()
    return this.document()
  }

  can_undo (): boolean { return this.undo_stack.length > 0 }
  can_redo (): boolean { return this.redo_stack.length > 0 }

  async preview (start: boolean): Promise<void> {
    await this.operation(start ? 'draft.preview.start' : 'draft.preview.stop', {})
    this.notify()
  }

  async commit (): Promise<Record<string, unknown>> {
    const result = await this.operation('draft.commit', {})
    this.undo_stack.length = 0
    this.redo_stack.length = 0
    this.notify()
    return result
  }

  async cancel (): Promise<void> {
    await this.operation('draft.cancel', {})
    this.undo_stack.length = 0
    this.redo_stack.length = 0
    this.notify()
  }

  async undo_commit (target_revision: number): Promise<Record<string, unknown>> {
    const result = await this.operation('draft.undo', { target_revision })
    this.notify()
    return result
  }

  async export_document (): Promise<AnimationDocument> {
    const result = await this.operation('draft.export', {})
    return result.document as AnimationDocument
  }
}
