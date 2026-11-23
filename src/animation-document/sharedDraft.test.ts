import { beforeEach, describe, expect, it } from 'vitest'
import { Quaternion } from 'three'
import { create_empty_document, with_animation_channel } from './create'
import { compose_rest_delta, SharedDraftController } from './sharedDraft'
import type { AnimationDocument } from './types'
import type { AuthoringResponse } from '../authoringBridge/types'
import type { FrontendAuthoringBridge } from '../authoringBridge/service'
import { make_test_rig } from '../authoringObservation/testFixtures'

interface FakeBridgeRequest {
  operation: string
  request_id: string
  session_id: string
  sequence: number
  payload: Record<string, unknown>
}

/** Simulates the real bridge store: one authoritative document, atomic revisions. */
class FakeBridge {
  document: AnimationDocument | null = null
  source_attribution: string | null = null
  previewing = false
  committed: AnimationDocument[] = []
  private readonly listeners = new Set<() => void>()

  on_change (listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  notify (): void { for (const listener of this.listeners) listener() }

  current_document (): AnimationDocument | null {
    return this.document === null ? null : JSON.parse(JSON.stringify(this.document)) as AnimationDocument
  }

  current_revision (): number { return this.document?.revision ?? 0 }
  rig_fingerprint (): string { return 'a'.repeat(64) }
  is_previewing (): boolean { return this.previewing }
  is_permission_enabled (): boolean { return true }
  set_source_attribution (_name: string, source: string): void { this.source_attribution = source }

  async handle_gui_request (request: unknown): Promise<AuthoringResponse> {
    const typed = request as FakeBridgeRequest
    const payload = typed.payload
    const ok = (result: Record<string, unknown>): AuthoringResponse => ({
      protocol: 'authoring-bridge/v1', request_id: typed.request_id, session_id: typed.session_id,
      sequence: typed.sequence, ok: true, result
    })
    const fail = (message: string): AuthoringResponse => ({
      protocol: 'authoring-bridge/v1', request_id: typed.request_id, session_id: typed.session_id,
      sequence: typed.sequence, ok: false, error: { code: 'BAD_REQUEST', message }
    })
    switch (typed.operation) {
      case 'draft.create': {
        const source = make_test_rig().skeleton
        const document = create_empty_document({
          skeleton: source,
          rig_identifier: 'human',
          clip_name: String(payload.name ?? 'Untitled'),
          duration_seconds: Number(payload.duration_seconds ?? 2)
        })
        this.document = document
        this.notify()
        return ok({ revision: document.revision })
      }
      case 'draft.import': {
        const document = payload.document as AnimationDocument
        this.document = JSON.parse(JSON.stringify(document)) as AnimationDocument
        this.notify()
        return ok({ revision: this.document.revision })
      }
      case 'draft.set_keyframes': {
        if (this.document === null) return fail('no active draft')
        if (payload.expected_revision !== this.document.revision) return fail('STALE_REVISION')
        this.document = with_animation_channel(this.document, {
          bone_id: String(payload.bone_id),
          property: payload.property as 'quaternion' | 'position' | 'scale',
          keyframes: payload.keyframes as AnimationDocument['channels'][number]['keyframes']
        })
        this.document = { ...this.document, revision: this.document.revision + 1 }
        this.notify()
        return ok({ revision: this.document.revision })
      }
      case 'draft.preview.start':
        this.previewing = true
        return ok({ previewing: true })
      case 'draft.preview.stop':
        this.previewing = false
        return ok({ previewing: false })
      case 'draft.commit':
        if (this.document === null) return fail('no active draft')
        this.committed.push(this.document)
        this.document = null
        this.previewing = false
        return ok({ revision: this.committed[this.committed.length - 1].revision })
      case 'draft.cancel':
        this.document = null
        this.notify()
        return ok({ cancelled: true })
      case 'draft.export':
        return ok({ document: this.current_document() })
      default:
        return fail(`unsupported operation ${typed.operation}`)
    }
  }

  /** Simulates an MCP edit from another actor, invalidating GUI revisions. */
  mcp_set_keyframes (): void {
    if (this.document === null) return
    const channel = this.document.channels[0]
    if (channel !== undefined) {
      this.document = with_animation_channel(this.document, {
        bone_id: channel.bone_id,
        property: channel.property,
        keyframes: [...channel.keyframes, { ...channel.keyframes[channel.keyframes.length - 1], time_seconds: 1.5 }]
      })
    }
    this.document = { ...this.document, revision: this.document.revision + 1 }
    this.notify()
  }
}

function make_controller (): { controller: SharedDraftController, bridge: FakeBridge } {
  const bridge = new FakeBridge()
  return {
    bridge,
    controller: new SharedDraftController(() => bridge as unknown as FrontendAuthoringBridge)
  }
}

function keyframes () {
  return [{ time_seconds: 0, values: [0, 0, 0, 1], interpolation: 'slerp' as const }]
}

describe('SharedDraftController — one authoritative document', () => {
  let controller: SharedDraftController
  let bridge: FakeBridge

  beforeEach(() => {
    const made = make_controller()
    controller = made.controller
    bridge = made.bridge
  })

  it('creates an empty original document in From Scratch mode', async () => {
    const document = await controller.create_from_scratch('Wave', 3)
    expect(document.clip.name).toBe('Wave')
    expect(document.clip.duration_seconds).toBe(3)
    expect(document.channels).toHaveLength(0)
    expect(document.revision).toBe(1)
    expect(controller.source()).toBeNull()
  })

  it('imports tracks explicitly in From Existing Animation mode', async () => {
    const template = await controller.create_from_scratch('Base', 2)
    const bone = template.bones[0]
    const imported = with_animation_channel(template, {
      bone_id: bone.id, property: 'quaternion', keyframes: keyframes()
    })
    const result = await controller.create_from_existing(imported, 'Idle_A')
    expect(result.channels).toHaveLength(1)
    expect(controller.source()).toBe('Idle_A')
    expect(bridge.source_attribution).toBe('Idle_A')
  })

  it('increments revisions on timeline edits and rejects stale revisions', async () => {
    const document = await controller.create_from_scratch('Wave', 2)
    const bone = document.bones[0]
    const updated = await controller.set_channel(document.revision, bone.id, 'quaternion', keyframes())
    expect(updated.revision).toBe(2)
    await expect(controller.set_channel(1, bone.id, 'quaternion', keyframes())).rejects.toThrow(/STALE_REVISION/)
  })

  it('supports undo and redo of draft edits', async () => {
    const document = await controller.create_from_scratch('Wave', 2)
    const bone = document.bones[0]
    await controller.set_channel(document.revision, bone.id, 'quaternion', keyframes())
    expect(controller.can_undo()).toBe(true)
    const undone = await controller.undo_edit()
    expect(undone?.channels).toHaveLength(0)
    expect(controller.can_redo()).toBe(true)
    const redone = await controller.redo_edit()
    expect(redone?.channels).toHaveLength(1)
  })

  it('rejects stale GUI edits after an MCP mutation and notifies subscribers', async () => {
    const document = await controller.create_from_scratch('Wave', 2)
    const bone = document.bones[0]
    let notifications = 0
    controller.attach()
    controller.subscribe(() => { notifications++ })
    bridge.mcp_set_keyframes()
    expect(notifications).toBeGreaterThan(0)
    expect(controller.document()?.revision).toBe(2)
    await expect(controller.set_channel(1, bone.id, 'quaternion', keyframes())).rejects.toThrow(/STALE_REVISION/)
  })

  it('exports an equivalent document after commit/undo lifecycle', async () => {
    const document = await controller.create_from_scratch('Wave', 2)
    const bone = document.bones[0]
    await controller.set_channel(document.revision, bone.id, 'quaternion', keyframes())
    const exported = await controller.export_document()
    await controller.create_from_existing(exported, 'export')
    const reimported = await controller.export_document()
    expect(reimported.channels).toEqual(exported.channels)
    expect(reimported.clip).toEqual(exported.clip)
    const commit = await controller.commit()
    expect(commit.revision).toBeDefined()
    expect(bridge.committed).toHaveLength(1)
  })

  it('tracks preview lifecycle', async () => {
    await controller.create_from_scratch('Wave', 2)
    await controller.preview(true)
    expect(controller.snapshot().previewing).toBe(true)
    await controller.preview(false)
    expect(controller.snapshot().previewing).toBe(false)
  })
})

describe('rest-aware rotation authoring', () => {
  it('composes a local delta with a non-identity rest quaternion', () => {
    const rest_values = [0.381, 0.563, 0.211, 0.692]
    const delta = [0, 0.7071, 0, 0.7071]
    const composed = compose_rest_delta(rest_values, delta)
    const expected = new Quaternion(...rest_values as [number, number, number, number]).normalize()
      .multiply(new Quaternion(...delta as [number, number, number, number]).normalize())
    expect(composed[0]).toBeCloseTo(expected.x, 5)
    expect(composed[1]).toBeCloseTo(expected.y, 5)
    expect(composed[2]).toBeCloseTo(expected.z, 5)
    expect(composed[3]).toBeCloseTo(expected.w, 5)
  })

  it('differs from an identity-based absolute delta for non-identity rests', () => {
    const rest = [0.381, 0.563, 0.211, 0.692]
    const delta = [0, 0.7071, 0, 0.7071]
    expect(compose_rest_delta(rest, delta)).not.toEqual(delta)
  })

  it('handles parent-child composition and finger joints', () => {
    const parent = new Quaternion(0.2, 0.1, 0.05, 0.97).normalize()
    const child = new Quaternion(0, 0.3, 0, 0.95).normalize()
    const world = parent.clone().multiply(child)
    const value = compose_rest_delta(
      [parent.x, parent.y, parent.z, parent.w],
      [child.x, child.y, child.z, child.w]
    )
    expect(value[0]).toBeCloseTo(world.x, 5)
    expect(value[3]).toBeCloseTo(world.w, 5)
  })

  it('recomputes after a rig switch (different bind pose)', () => {
    const delta = [0, 0.5, 0, 0.866]
    const human = compose_rest_delta([0.1, 0.2, 0.3, 0.9], delta)
    const fox = compose_rest_delta([0.4, 0.1, 0.2, 0.8], delta)
    expect(human).not.toEqual(fox)
  })
})
