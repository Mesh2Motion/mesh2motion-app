import { describe, expect, it } from 'vitest'
import {
  ApplicationCommitController,
  type AnimationApplicationOwner
} from './applicationCommit'
import {
  DenyConfirmationBridge,
  type NativeConfirmationBridge,
  type NativeConfirmationRequest,
  type NativeConfirmationResult
} from './confirmation'
import { InMemoryAnimationDocumentStore } from './store'
import { DraftPreviewSession } from './preview'
import { create_agent_wave_skeleton } from './fixtures/AgentWave01'
import { create_document_from_live_rig } from './liveRigAdapter'
import { with_animation_channel } from './create'
import type { AnimationDocument } from './types'

function with_one_channel (document: AnimationDocument): AnimationDocument {
  return with_animation_channel(document, {
    bone_id: 'human:bone:010',
    property: 'quaternion',
    keyframes: [
      { time_seconds: 0, values: [0, 0, 0, 1], interpolation: 'slerp' },
      { time_seconds: 1, values: [0, 0, 0.5, Math.sqrt(0.75)], interpolation: 'slerp' }
    ]
  })
}

class ApproveConfirmationBridge implements NativeConfirmationBridge {
  readonly requests: NativeConfirmationRequest[] = []
  async request_confirmation (request: NativeConfirmationRequest): Promise<NativeConfirmationResult> {
    this.requests.push(request)
    return {
      schema_version: 'native-confirmation/v1',
      request_id: request.request_id,
      approved: true,
      decided_by: 'user',
      decided_at_utc: new Date().toISOString()
    }
  }
}

function setup (confirmation: NativeConfirmationBridge = new ApproveConfirmationBridge()) {
  const skeleton = create_agent_wave_skeleton()
  const initial = with_one_channel(create_document_from_live_rig({
    skeleton, rig_identifier: 'human', clip_name: 'base', duration_seconds: 1
  }))
  const store = new InMemoryAnimationDocumentStore(initial)
  const preview = new DraftPreviewSession({
    active_skinned_meshes: () => [],
    add_frame_listener: () => {}
  })
  const events: string[] = []
  const owner: AnimationApplicationOwner = {
    apply_committed_clip: () => { events.push('apply') },
    capture_selection: () => { events.push('capture'); return 'selection-1' },
    restore_selection: (snapshot) => { events.push(`restore:${String(snapshot)}`) }
  }
  const controller = new ApplicationCommitController({ store, preview, owner, confirmation, skeleton })
  const draft = with_one_channel(create_document_from_live_rig({
    skeleton, rig_identifier: 'human', clip_name: 'draft', duration_seconds: 1
  }))
  return { controller, store, preview, owner, confirmation, events, draft, skeleton }
}

describe('ApplicationCommitController', () => {
  it('requires native confirmation and applies a committed clip', async () => {
    const ctx = setup()
    ctx.controller.begin_draft(ctx.draft)
    ctx.controller.show_preview()
    const outcome = await ctx.controller.commit()
    expect(outcome.status).toBe('committed')
    expect(ctx.store.current().revision).toBe(2)
    expect(ctx.controller.draft()).toBeNull()
    expect(ctx.events).toContain('capture')
    expect(ctx.events).toContain('apply')
  })

  it('cancels without mutating the store when confirmation is denied', async () => {
    const ctx = setup(new DenyConfirmationBridge())
    ctx.controller.begin_draft(ctx.draft)
    ctx.controller.show_preview()
    const outcome = await ctx.controller.commit()
    expect(outcome.status).toBe('cancelled')
    expect(ctx.store.current().revision).toBe(1)
    // A denied confirmation keeps the draft so the user can revise and retry;
    // only an explicit cancel() discards it.
    expect(ctx.controller.draft()).not.toBeNull()
    expect(ctx.events.some((event) => event.startsWith('restore:'))).toBe(true)
    expect(ctx.events).not.toContain('apply')
  })

  it('cancel discards the draft and restores selection without confirmation', () => {
    const ctx = setup()
    ctx.controller.begin_draft(ctx.draft)
    ctx.controller.show_preview()
    ctx.controller.cancel()
    expect(ctx.controller.draft()).toBeNull()
    expect(ctx.events.some((event) => event.startsWith('restore:'))).toBe(true)
    expect(ctx.store.current().revision).toBe(1)
  })

  it('undo requires confirmation and applies the restored document', async () => {
    const ctx = setup()
    ctx.controller.begin_draft(ctx.draft)
    ctx.controller.show_preview()
    await ctx.controller.commit()
    const outcome = await ctx.controller.undo(1)
    expect(outcome.status).toBe('committed')
    expect(ctx.store.current().revision).toBe(3)
    expect(ctx.store.history().map((document) => document.revision)).toEqual([1, 2, 3])
  })

  it('undo cancellation leaves the store untouched', async () => {
    const ctx = setup()
    ctx.controller.begin_draft(ctx.draft)
    ctx.controller.show_preview()
    await ctx.controller.commit()
    const deny = new DenyConfirmationBridge()
    const denied = new ApplicationCommitController({
      store: ctx.store,
      preview: ctx.preview,
      owner: {
        apply_committed_clip: () => {},
        capture_selection: () => null,
        restore_selection: () => {}
      },
      confirmation: deny,
      skeleton: ctx.skeleton
    })
    const outcome = await denied.undo(1)
    expect(outcome.status).toBe('cancelled')
    expect(ctx.store.current().revision).toBe(2)
  })

  it('rejects commits without a draft', async () => {
    const ctx = setup()
    const outcome = await ctx.controller.commit()
    expect(outcome.status).toBe('rejected')
  })

  it('never mutates the Remix/composer state (no such dependency exists)', () => {
    const ctx = setup()
    ctx.controller.begin_draft(ctx.draft)
    const before = JSON.stringify(ctx.draft)
    ctx.controller.update_draft((draft) => ({ ...draft, clip: { ...draft.clip, name: 'renamed draft' } }))
    expect(before).not.toBe(JSON.stringify(ctx.controller.draft()))
    expect(ctx.store.current().clip.name).toBe('base')
  })

  it('confirmation requests carry operation, revision and clip identity', async () => {
    const ctx = setup()
    ctx.controller.begin_draft(ctx.draft)
    ctx.controller.show_preview()
    await ctx.controller.commit()
    const confirmation = ctx.confirmation as ApproveConfirmationBridge
    expect(confirmation.requests).toHaveLength(1)
    expect(confirmation.requests[0]).toMatchObject({
      schema_version: 'native-confirmation/v1',
      operation: 'commit',
      clip_name: 'draft',
      proposed_revision: 2,
      target_revision: null,
      reason: 'application-owned-animation-mutation'
    })
  })

  it('refuses a draft whose rig fingerprint no longer matches', () => {
    const ctx = setup()
    ctx.controller.begin_draft(ctx.draft)
    ctx.controller.update_draft((draft): AnimationDocument => ({
      ...draft,
      rig: { ...draft.rig, fingerprint: 'deadbeef' }
    }))
    expect(() => ctx.controller.show_preview()).toThrow(/incompatible live rig/)
    expect(ctx.store.current().revision).toBe(1)
  })
})
