import { describe, expect, it } from 'vitest'
import { Bone, Skeleton } from 'three'
import { FrontendAuthoringBridge, type AuthoringBridgeApp } from './service'
import { NativeConfirmationPanel } from './confirmationPanel'
import { publish_live_rig_catalog } from './rigCatalog'
import { create_live_agent_wave } from './liveWave'
import { AUTHORING_BRIDGE_PROTOCOL, type AuthoringRequest } from './types'
import { compute_rig_fingerprint } from '../animation-document/rigIdentity'
import { draft_document_to_clip } from '../animation-document/liveRigAdapter'
import type { TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair'
import type { AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry'

const BONE_NAMES = [
  'hips', 'spine', 'spine_02', 'neck', 'head',
  'LeftShoulder', 'LeftUpperArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand'
]

function make_skeleton (): Skeleton {
  const bones = BONE_NAMES.map((name) => {
    const bone = new Bone()
    bone.name = name
    return bone
  })
  const by_name = new Map(bones.map((bone, index) => [bone.name, index]))
  const attach = (child: string, parent: string): void => {
    const c = bones[by_name.get(child) as number]
    const p = bones[by_name.get(parent) as number]
    p.add(c)
  }
  bones[0].position.set(0, 1, 0)
  attach('spine', 'hips')
  attach('spine_02', 'spine')
  attach('neck', 'spine_02')
  attach('head', 'neck')
  attach('LeftShoulder', 'spine_02')
  attach('LeftUpperArm', 'LeftShoulder')
  attach('LeftForeArm', 'LeftUpperArm')
  attach('LeftHand', 'LeftForeArm')
  attach('RightShoulder', 'spine_02')
  attach('RightUpperArm', 'RightShoulder')
  attach('RightForeArm', 'RightUpperArm')
  attach('RightHand', 'RightForeArm')
  return new Skeleton(bones)
}

function make_app (): AuthoringBridgeApp & { entries: AnimationEntry[], selection: string | null } {
  const skeleton = make_skeleton()
  const entries: AnimationEntry[] = []
  let counter = 0
  const state: { selection: string | null } = { selection: 'existing-animation' }
  const app = {
    skeleton,
    rig_identifier: 'human',
    engine: {
      active_skinned_meshes: () => [{ skeleton }],
      add_frame_listener: () => {},
      load_skeleton_step: { skeleton_type: () => 'human' },
      animations_listing_step: {
        add_authored_animation: (pair: TransformedAnimationClipPair): AnimationEntry => {
          counter += 1
          const entry: AnimationEntry = {
            id: `custom-import-${counter}`,
            name: pair.display_animation_clip.name,
            metadata: pair.metadata,
            state: 'loaded',
            clip_pair: pair
          }
          entries.push(entry)
          return entry
        },
        remove_authored_animation: (id: string): boolean => {
          const index = entries.findIndex((entry) => entry.id === id)
          if (index < 0) return false
          entries.splice(index, 1)
          return true
        },
        current_selection: () => state.selection,
        select_animation: (id: string | null) => { state.selection = id }
      }
    },
    entries,
    get selection () { return state.selection }
  } as unknown as AuthoringBridgeApp & { entries: AnimationEntry[], selection: string | null }
  return app
}

let sequence_counter = 0
function req (operation: string, payload: Record<string, unknown> = {}, id = 'req-1'): AuthoringRequest {
  sequence_counter += 1
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: id,
    session_id: 'session-1',
    sequence: sequence_counter,
    deadline_ms: 5000,
    operation: operation as AuthoringRequest['operation'],
    payload
  }
}

async function create_wave_bridge (): Promise<{ bridge: FrontendAuthoringBridge, app: ReturnType<typeof make_app>, document: ReturnType<typeof create_live_agent_wave>['document'] }> {
  const app = make_app()
  const panel = new NativeConfirmationPanel(document.body)
  const bridge = new FrontendAuthoringBridge(app, panel)
  expect(bridge.is_permission_enabled()).toBe(false)
  await bridge.handle_mcp_request(req('session.status', {}, 'authorize'))
  expect(bridge.is_permission_enabled()).toBe(true)
  const { document: wave } = create_live_agent_wave(app.skeleton, 'human')
  const response = await bridge.handle(req('draft.create', { document: wave }, 'setup'))
  expect(response.ok).toBe(true)
  return { bridge, app, document: wave }
}

describe('FrontendAuthoringBridge — real rig catalog', () => {
  it('publishes only live bone IDs and the live fingerprint', () => {
    const app = make_app()
    const catalog = publish_live_rig_catalog(app.engine as never, compute_rig_fingerprint(app.skeleton))
    expect(catalog.rig.identifier).toBe('human')
    expect(catalog.rig.fingerprint).toBe(compute_rig_fingerprint(app.skeleton))
    expect(catalog.bones).toHaveLength(BONE_NAMES.length)
    expect(catalog.bones.some((bone) => bone.display_name === 'RightUpperArm' && bone.id === 'human:bone:010')).toBe(true)
    expect(catalog.bones[0].parent_id).toBeNull()
    expect(catalog.bones[7].local_position.length).toBe(3)
  })

  it('rejects a fingerprint that does not match the live rig', () => {
    const app = make_app()
    expect(() => publish_live_rig_catalog(app.engine as never, 'deadbeef')).toThrow('RIG_MISMATCH')
  })
})

describe('FrontendAuthoringBridge — live Agent_Wave_01', () => {
  it('uses real bone IDs and the real fingerprint', () => {
    const app = make_app()
    const { document, mapping } = create_live_agent_wave(app.skeleton, 'human')
    expect(document.rig.fingerprint).toBe(compute_rig_fingerprint(app.skeleton))
    expect(mapping.upper_arm_r).toBe('human:bone:010')
    expect(mapping.forearm_r).toBe('human:bone:011')
    expect(mapping.hand_r).toBe('human:bone:012')
    expect(document.validation.state).toBe('valid')
    expect(document.clip.duration_seconds).toBe(2)
    expect(document.channels.every((channel) => channel.keyframes.every(
      (keyframe) => keyframe.interpolation === 'slerp'))).toBe(true)
  })
})

describe('FrontendAuthoringBridge — preview and validation', () => {
  it('previews a valid live document and stops cleanly', async () => {
    const { bridge } = await create_wave_bridge()
    // serde serializes absent Option<AnimationDocument> values as null.
    const started = await bridge.handle(req('draft.preview.start', { action: 'start', document: null }))
    expect(started.ok).toBe(true)
    expect(started.result?.previewing).toBe(true)
    const stopped = await bridge.handle(req('draft.preview.stop', {}, 'req-2'))
    expect(stopped.result?.previewing).toBe(false)
    bridge.dispose()
  })

  it('rejects an invalid bone or fingerprint', async () => {
    const { bridge, document: wave } = await create_wave_bridge()
    const bad_bone = structuredClone(wave)
    bad_bone.channels[0].bone_id = 'human:bone:999'
    const response = await bridge.handle(req('draft.preview.start', { document: bad_bone }, 'req-2'))
    expect(response.error?.code).toBe('INVALID_DOCUMENT')
    bridge.dispose()
  })

  it('rejects a rig change during an active session', async () => {
    const { bridge, app, document: wave } = await create_wave_bridge()
    await bridge.handle(req('draft.preview.start', { document: wave }))
    app.skeleton.bones[0].position.x += 0.5
    app.skeleton.bones[0].updateWorldMatrix(true, true)
    app.skeleton.calculateInverses()
    const response = await bridge.handle(req('draft.validate', {}, 'req-2'))
    expect(response.error?.code).toBe('RIG_MISMATCH')
    bridge.dispose()
  })
})

describe('FrontendAuthoringBridge — confirmation and commit', () => {
  it('requires a native click; no client field can approve', async () => {
    const { bridge, document: wave, app } = await create_wave_bridge()
    const pending = bridge.handle(req('draft.commit', { document: wave, approved: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    const panel = document.body.querySelector<HTMLElement>('.m2m-authoring-confirmation')
    expect(panel).not.toBeNull()
    expect(app.entries).toHaveLength(0)
    panel?.querySelector<HTMLButtonElement>('[data-m2m-confirm="reject"]')?.click()
    const response = await pending
    expect(response.error?.code).toBe('CONFIRMATION_DENIED')
    expect(app.entries).toHaveLength(0)
    bridge.dispose()
  })

  it('commits to the real library only after approval and supports undo', async () => {
    const { bridge, document: wave, app } = await create_wave_bridge()
    // The Rust MCP tool sends document:null when the optional argument is omitted.
    const pending = bridge.handle(req('draft.commit', { document: null }))
    await new Promise(resolve => setTimeout(resolve, 0))
    const panel = document.body.querySelector<HTMLElement>('.m2m-authoring-confirmation')
    expect(panel?.textContent).toContain('Agent_Wave_01')
    panel?.querySelector<HTMLButtonElement>('[data-m2m-confirm="approve"]')?.click()
    const committed = await pending
    expect(committed.ok).toBe(true)
    const committed_entry_id = (committed.result as { entry_id: string }).entry_id
    expect(app.entries).toHaveLength(1)
    expect(app.entries[0].metadata.tags).toContain('authored-animation-document')
    const committed_export = await bridge.handle(req('draft.export', {}, 'export-committed'))
    const committed_document = (committed_export.result as { document: typeof wave }).document
    expect(committed_document.revision).toBe((committed.result as { revision: number }).revision)
    expect(committed_document.channels).toEqual(wave.channels)

    const undo_pending = bridge.handle(req('draft.undo', { target_revision: 1 }, 'req-2'))
    await new Promise(resolve => setTimeout(resolve, 0))
    const undo_panel = document.body.querySelector<HTMLElement>('.m2m-authoring-confirmation')
    undo_panel?.querySelector<HTMLButtonElement>('[data-m2m-confirm="approve"]')?.click()
    const undone = await undo_pending
    expect(undone.ok).toBe(true)
    const undone_entry_id = (undone.result as { entry_id: string }).entry_id
    // Real undo: the undone entry is removed, not merely appended over.
    expect(app.entries).toHaveLength(1)
    expect(app.entries[0].name).toBe('Agent_Wave_01')
    expect(undone_entry_id).not.toBe(committed_entry_id)
    expect(app.selection).toBe('existing-animation')
    bridge.dispose()
  })

  it('export/reimport preserves transform values', async () => {
    const { bridge, app, document: wave } = await create_wave_bridge()
    const exported = await bridge.handle(req('draft.export', {}, 'req-2'))
    const exported_document = (exported.result as { document: typeof wave }).document
    const reimported = await bridge.handle(req('draft.import', { document: exported_document }, 'req-3'))
    expect(reimported.ok).toBe(true)
    const before = draft_document_to_clip(wave, app.skeleton)
    const after = draft_document_to_clip(exported_document, app.skeleton)
    expect(after.tracks.map(track => track.name)).toEqual(before.tracks.map(track => track.name))
    before.tracks.forEach((track, index) => {
      expect(Array.from(after.tracks[index].values)).toEqual(Array.from(track.values))
    })
    bridge.dispose()
  })

  it('session.cancel stops preview and clears state', async () => {
    const { bridge, document: wave } = await create_wave_bridge()
    await bridge.handle(req('draft.preview.start', { document: wave }))
    const status_before = await bridge.handle(req('session.status', {}, 'req-2'))
    expect(status_before.result?.previewing).toBe(true)
    const cancelled = await bridge.handle(req('session.cancel', {}, 'req-3'))
    expect(cancelled.ok).toBe(true)
    const status_after = await bridge.handle(req('session.status', {}, 'req-4'))
    expect(status_after.result?.active).toBe(false)
    expect(status_after.result?.previewing).toBe(false)
    bridge.dispose()
  })
})
