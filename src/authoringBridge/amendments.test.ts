import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bone, Skeleton } from 'three'
import { AuthoringDispatcher, type AuthoringHandlers } from './dispatcher'
import { AUTHORING_BRIDGE_PROTOCOL, BRIDGE_LIMITS, type AuthoringOperation, type AuthoringRequest } from './types'
import type { TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair'
import type { AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry'
import { FrontendAuthoringBridge, type AuthoringBridgeApp } from './service'
import { NativeConfirmationPanel } from './confirmationPanel'
import { attachTauriAuthoringAdapter, TAURI_REQUEST_EVENT, TAURI_RESPOND_COMMAND } from './tauriAdapter'
import { create_confirmation_request } from '../animation-document/confirmation'

let sequence = 0
function req (
  operation_or_overrides: string | Partial<AuthoringRequest> = {},
  payload: Record<string, unknown> = {},
  id?: string
): AuthoringRequest {
  sequence += 1
  const overrides: Partial<AuthoringRequest> = typeof operation_or_overrides === 'string'
    ? { operation: operation_or_overrides as AuthoringOperation, payload, ...(id !== undefined ? { request_id: id } : {}) }
    : operation_or_overrides
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: `req-${sequence}`,
    session_id: 'session-1',
    sequence,
    deadline_ms: 5000,
    operation: 'session.status',
    payload: {},
    ...overrides
  }
}

function handlers (): AuthoringHandlers {
  return {
    rig_catalog_get: async () => ({}),
    draft_create: async () => ({ revision: 2 }),
    draft_set_keyframes: async () => ({ revision: 2 }),
    draft_validate: async () => ({ state: 'valid' }),
    draft_preview_start: async () => ({ previewing: true }),
    draft_preview_stop: async () => ({ previewing: false }),
    draft_commit: async () => ({ revision: 2 }),
    draft_cancel: async () => ({ cancelled: true }),
    draft_undo: async () => ({ revision: 3 }),
    draft_export: async () => ({}),
    draft_import: async () => ({ revision: 2 }),
    session_status: async () => ({ active: false }),
    session_cancel: async () => ({ cancelled: true })
  }
}

function skeleton (): Skeleton {
  const names = ['hips', 'spine', 'RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand']
  const bones = names.map((name) => {
    const bone = new Bone()
    bone.name = name
    return bone
  })
  bones.slice(1).forEach((bone, index) => bones[index].add(bone))
  return new Skeleton(bones)
}

function app (fail_insertion = false): AuthoringBridgeApp & { entries: string[], selection: string | null } {
  const skel = skeleton()
  const state: { entries: string[], selection: string | null } = { entries: [], selection: 'old' }
  return {
    skeleton: skel,
    rig_identifier: 'human',
    engine: {
      active_skinned_meshes: () => [{ skeleton: skel }],
      add_frame_listener: () => {},
      load_skeleton_step: { skeleton_type: () => 'human' },
      animations_listing_step: {
        add_authored_animation: (pair: TransformedAnimationClipPair): AnimationEntry => {
          if (fail_insertion) throw new Error('library insert failed')
          state.entries.push(pair.display_animation_clip.name)
          return { id: `entry-${state.entries.length}`, name: pair.display_animation_clip.name, metadata: pair.metadata, state: 'loaded', clip_pair: pair }
        },
        remove_authored_animation: (id: string): boolean => state.entries.splice(Number(id.replace('entry-', '')) - 1, 1).length > 0,
        current_selection: () => state.selection,
        select_animation: (id: string) => { state.selection = id }
      }
    },
    ...state
  } as unknown as AuthoringBridgeApp & { entries: string[], selection: string | null }
}

async function enabled_bridge (target: AuthoringBridgeApp = app()): Promise<FrontendAuthoringBridge> {
  const panel = new NativeConfirmationPanel(document.body)
  const bridge = new FrontendAuthoringBridge(target, panel)
  const toggles = document.querySelectorAll<HTMLButtonElement>('#m2m-authoring-toggle')
  toggles[toggles.length - 1]?.click()
  return bridge
}

afterEach(() => {
  document.querySelectorAll('.m2m-authoring-confirmation').forEach((node) => node.remove())
  document.querySelectorAll('#m2m-authoring-toggle').forEach((node) => node.remove())
})

describe('M2M-028B transport amendments', () => {
  it('counts UTF-8 bytes of the whole envelope at the 256 KiB ceiling', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const multibyte = req({ payload: { data: '€'.repeat(90000) } })
    const response = await dispatcher.handle(multibyte)
    expect(response.error?.code).toBe('PAYLOAD_TOO_LARGE')
    expect(BRIDGE_LIMITS.max_request_bytes).toBe(256 * 1024)
    dispatcher.dispose()
  })

  it('accepts a payload below the byte ceiling even when char count is large', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const response = await dispatcher.handle(req({ payload: { data: 'a'.repeat(200000) } }))
    expect(response.ok).toBe(true)
    dispatcher.dispose()
  })

  it('rejects non-increasing sequence and echoes the accepted sequence', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const first = await dispatcher.handle(req({ operation: 'session.status', sequence: 100 }))
    expect(first.ok).toBe(true)
    expect(first.sequence).toBe(100)
    const replay = await dispatcher.handle(req({ operation: 'session.status', sequence: 100 }))
    expect(replay.error?.code).toBe('BAD_REQUEST')
    dispatcher.dispose()
  })

  it('fails closed after 4096 retained request IDs', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    for (let i = 0; i < BRIDGE_LIMITS.max_retained_request_ids; i++) {
      const response = await dispatcher.handle(req({ request_id: `id-${i}` }))
      expect(response.ok).toBe(true)
    }
    const overflow = await dispatcher.handle(req({ request_id: 'id-overflow' }))
    expect(overflow.error?.code).toBe('SESSION_CONFLICT')
    dispatcher.dispose()
  })
})

describe('M2M-028B incremental authoring', () => {
  it('creates an empty live draft and applies one atomic keyframe revision', async () => {
    const bridge = await enabled_bridge()
    const created = await bridge.handle(req('draft.create', { name: 'Wave', duration_seconds: 2 }, 'setup'))
    expect(created.ok).toBe(true)
    const doc = ((await bridge.handle(req('draft.export', {}, 'exp'))).result as { document: import('../animation-document/types').AnimationDocument }).document
    const bone = doc.bones.find((candidate) => candidate.display_name === 'RightUpperArm')
    expect(bone).toBeDefined()
    const set = await bridge.handle(req('draft.set_keyframes', {
      expected_revision: 1,
      bone_id: bone?.id,
      property: 'quaternion',
      keyframes: [
        { time_seconds: 0, values: [0, 0, 0, 1], interpolation: 'slerp' },
        { time_seconds: 1, values: [0, 0, 0.5, Math.sqrt(0.75)], interpolation: 'slerp' }
      ]
    }, 'set'))
    expect(set.ok).toBe(true)
    expect(set.result?.revision).toBe(2)
    const stale = await bridge.handle(req('draft.set_keyframes', {
      expected_revision: 1, bone_id: bone?.id, property: 'quaternion', keyframes: []
    }, 'stale'))
    expect(stale.error?.code).toBe('BAD_REQUEST')
    const after = ((await bridge.handle(req('draft.export', {}, 'exp2'))).result as { document: import('../animation-document/types').AnimationDocument }).document
    expect(after.revision).toBe(2)
    expect(after.channels).toHaveLength(1)
    bridge.dispose()
  })
})

describe('M2M-028B Tauri adapter', () => {
  it('routes events to the bridge and responds with correlation', async () => {
    const calls: Array<{ command: string, args: unknown }> = []
    const callbacks: Array<(event: { event: string, payload: unknown }) => void> = []
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      writable: true,
      value: {
        invoke: async (command: string, args: unknown) => { calls.push({ command, args }) },
        transformCallback: (handler: (event: { event: string, payload: unknown }) => void) => {
          callbacks.push(handler)
          return callbacks.length
        }
      }
    })
    const response = {
      protocol: AUTHORING_BRIDGE_PROTOCOL, request_id: 'r1', session_id: 's1', sequence: 1, ok: true
    }
    const cancel = vi.fn()
    const adapter = await attachTauriAuthoringAdapter(async () => response, cancel)
    expect(adapter.listening()).toBe(true)
    expect(calls[0].command).toBe('plugin:event|listen')
    callbacks[0]({ event: TAURI_REQUEST_EVENT, payload: { request_id: 'r1' } })
    await new Promise(resolve => setTimeout(resolve, 0))
    const ack = calls.find((call) => call.command === TAURI_RESPOND_COMMAND)
    expect(ack?.args).toEqual({ response })
    callbacks[1]({ event: 'm2m-authoring-cancel', payload: { protocol: AUTHORING_BRIDGE_PROTOCOL, request_id: 'r1', session_id: 's1' } })
    expect(cancel).toHaveBeenCalled()
    await adapter.dispose()
    expect(adapter.listening()).toBe(false)
  })
})

describe('M2M-028B state integrity', () => {
  it('permission is default-off and cannot be enabled by a request', async () => {
    const bridge = new FrontendAuthoringBridge(app())
    expect(bridge.is_permission_enabled()).toBe(false)
    const result = await bridge.handle(req('draft.create', { name: 'x', duration_seconds: 1 }, 'blocked'))
    expect(result.error?.code).toBe('BAD_REQUEST')
    bridge.dispose()
  })

  it('rolls back the store if application owner insertion fails', async () => {
    const bridge = await enabled_bridge(app(true))
    const created = await bridge.handle(req('draft.create', { name: 'Wave', duration_seconds: 1 }, 'setup'))
    expect(created.ok).toBe(true)
    const pending = bridge.handle(req('draft.commit', {}, 'commit'))
    await new Promise(resolve => setTimeout(resolve, 0))
    document.querySelector<HTMLElement>('.m2m-authoring-confirmation [data-m2m-confirm="approve"]')?.click()
    const result = await pending
    expect(result.error?.code).toBe('COMMIT_FAILED')
    const restored = ((await bridge.handle(req('draft.export', {}, 'check'))).result as { document: import('../animation-document/types').AnimationDocument }).document
    expect(restored.revision).toBe(1)
    bridge.dispose()
  })

  it('cancel event clears the active session and preview', async () => {
    const bridge = await enabled_bridge()
    await bridge.handle(req('draft.create', { name: 'Wave', duration_seconds: 1 }, 'setup'))
    bridge.handle_cancel({ protocol: AUTHORING_BRIDGE_PROTOCOL, request_id: 'r', session_id: 'session-1' })
    const status = await bridge.handle(req('session.status', {}, 'status'))
    expect(status.result?.active).toBe(false)
    bridge.dispose()
  })

  it('approval acknowledgement carries digest-bound fields', () => {
    const doc = { clip: { name: 'Wave' }, revision: 3 } as never
    const request = create_confirmation_request('commit', doc, 3)
    const panel = new NativeConfirmationPanel(document.body)
    const binding = {
      request_id: request.request_id,
      session_id: 'session-1',
      operation: 'commit' as const,
      rig_fingerprint: 'deadbeef',
      revision: 3,
      document_digest: 'abc123',
      target_revision: null
    }
    const pending = panel.request_confirmation(request, {
      animation_name: 'Wave', rig_identifier: 'human', fingerprint_prefix: 'abc',
      duration_seconds: 2, track_count: 1, keyframe_count: 2, operation: 'commit'
    }, binding, 1000)
    document.querySelector<HTMLElement>('.m2m-authoring-confirmation [data-m2m-confirm="approve"]')?.click()
    void pending.then((result) => {
      expect(result.binding).toEqual(binding)
    })
    panel.dispose()
  })
})
