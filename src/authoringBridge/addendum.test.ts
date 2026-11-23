import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bone, Skeleton, Vector3, type SkinnedMesh } from 'three'
import {
  attachAuthoringBridge,
  AUTHORING_REQUEST_EVENT,
  AUTHORING_RESPONSE_EVENT,
  get_authoring_bridge_for_testing,
  teardown
} from './attach'
import { AuthoringDispatcher } from './dispatcher'
import { AUTHORING_BRIDGE_PROTOCOL, type AuthoringRequest, type AuthoringResponse } from './types'
import { FrontendAuthoringBridge, type AuthoringBridgeApp } from './service'
import { DraftPreviewSession } from '../animation-document/preview'
import { compute_rig_fingerprint } from '../animation-document/rigIdentity'

function make_skeleton (): Skeleton {
  const names = ['hips', 'spine', 'RightShoulder', 'RightUpperArm', 'RightForeArm', 'RightHand']
  const bones = names.map((name) => {
    const bone = new Bone()
    bone.name = name
    return bone
  })
  bones.slice(1).forEach((bone, index) => bones[index].add(bone))
  return new Skeleton(bones)
}

function fake_engine () {
  const meshes: Array<{ skeleton: Skeleton }> = []
  const frame_listeners: Array<(delta: number) => void> = []
  const skeleton_step = new EventTarget() as EventTarget & { skeleton_type: () => string }
  skeleton_step.skeleton_type = () => 'human'
  const engine = {
    active_skinned_meshes: () => meshes as unknown as SkinnedMesh[],
    add_frame_listener: (listener: (delta: number) => void) => { frame_listeners.push(listener) },
    remove_frame_listener: (listener: (delta: number) => void) => {
      const index = frame_listeners.indexOf(listener)
      if (index >= 0) frame_listeners.splice(index, 1)
    },
    load_skeleton_step: skeleton_step,
    animations_listing_step: {
      add_authored_animation: () => ({ id: 'entry-1', name: 'x', metadata: { source_type: 'custom-import', tags: [] }, state: 'loaded', clip_pair: null }),
      remove_authored_animation: () => true,
      current_selection: () => 'old',
      select_animation: () => {}
    }
  }
  return { engine, meshes, frame_listeners, skeleton_step }
}

function bridge_app (engine: ReturnType<typeof fake_engine>['engine']): AuthoringBridgeApp {
  return {
    engine: engine as unknown as AuthoringBridgeApp['engine'],
    skeleton: make_skeleton(),
    rig_identifier: 'human'
  }
}

let seq = 0
function req (operation: string, payload: Record<string, unknown> = {}, id?: string, deadline_ms = 5000): AuthoringRequest {
  seq += 1
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: id ?? `r-${seq}`,
    session_id: 'session-1',
    sequence: seq,
    deadline_ms,
    operation: operation as AuthoringRequest['operation'],
    payload
  }
}

afterEach(async () => {
  await teardown()
  document.querySelectorAll('.m2m-authoring-confirmation').forEach((node) => node.remove())
})

describe('M2M-028A addendum — rig lifecycle attachment', () => {
  it('attaches when a rig finishes loading late, without re-entering a page', async () => {
    const fake = fake_engine()
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(get_authoring_bridge_for_testing()).toBeUndefined()
    fake.meshes.push({ skeleton: make_skeleton() })
    fake.skeleton_step.dispatchEvent(new Event('skeletonLoaded'))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(get_authoring_bridge_for_testing()).toBeDefined()
  })

  it('does not create duplicate bridges on repeated page entry', async () => {
    const fake = fake_engine()
    fake.meshes.push({ skeleton: make_skeleton() })
    attachAuthoringBridge(fake.engine as never)
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(document.querySelectorAll('#m2m-authoring-toggle')).toHaveLength(0)
  })

  it('teardown removes frame listeners and the authoring bridge', async () => {
    const fake = fake_engine()
    fake.meshes.push({ skeleton: make_skeleton() })
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    const before = fake.frame_listeners.length
    expect(before).toBeGreaterThan(0)
    await teardown()
    expect(fake.frame_listeners.length).toBe(0)
    expect(get_authoring_bridge_for_testing()).toBeUndefined()
  })

  it('replaces the session when the rig fingerprint changes', async () => {
    const fake = fake_engine()
    fake.meshes.push({ skeleton: make_skeleton() })
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    const first = get_authoring_bridge_for_testing()
    const replacement = make_skeleton()
    replacement.bones[0].position.x += 1
    replacement.bones[0].updateWorldMatrix(true, true)
    replacement.calculateInverses()
    fake.meshes.length = 0
    fake.meshes.push({ skeleton: replacement })
    fake.frame_listeners.forEach(listener => listener(0.016))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(get_authoring_bridge_for_testing()).not.toBe(first)
  })

  it('rebinds to a replacement skeleton with the same rig fingerprint', async () => {
    const fake = fake_engine()
    const original = make_skeleton()
    fake.meshes.push({ skeleton: original })
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    const first = get_authoring_bridge_for_testing()
    const replacement = make_skeleton()
    expect(replacement).not.toBe(original)
    expect(compute_rig_fingerprint(replacement)).toBe(compute_rig_fingerprint(original))
    fake.meshes[0] = { skeleton: replacement }
    fake.frame_listeners.forEach(listener => listener(0.016))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(get_authoring_bridge_for_testing()).toBeDefined()
    expect(get_authoring_bridge_for_testing()).not.toBe(first)
  })

  it('keeps one bridge while the mixer changes live bone pose', async () => {
    const fake = fake_engine()
    const skeleton = make_skeleton()
    fake.meshes.push({ skeleton })
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    const first = get_authoring_bridge_for_testing()
    skeleton.bones[3].quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.6)
    fake.frame_listeners.forEach(listener => listener(0.016))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(get_authoring_bridge_for_testing()).toBe(first)
  })

  it('keeps watching after unload and attaches again when a new rig loads', async () => {
    const fake = fake_engine()
    fake.meshes.push({ skeleton: make_skeleton() })
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    const first = get_authoring_bridge_for_testing()
    fake.meshes.length = 0
    fake.skeleton_step.dispatchEvent(new Event('skeletonLoaded'))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(get_authoring_bridge_for_testing()).toBeUndefined()
    fake.meshes.push({ skeleton: make_skeleton() })
    fake.skeleton_step.dispatchEvent(new Event('skeletonLoaded'))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(get_authoring_bridge_for_testing()).toBeDefined()
    expect(get_authoring_bridge_for_testing()).not.toBe(first)
  })
})

describe('M2M-028A addendum — authorization boundaries', () => {
  it('DOM CustomEvents cannot spoof approval or bypass permission', async () => {
    const fake = fake_engine()
    const bridge = new FrontendAuthoringBridge(bridge_app(fake.engine))
    const result = await bridge.handle({ ...req('draft.commit'), approved: true, payload: { approved: true } })
    expect(result.error?.code).toBe('AUTHORING_DISABLED')
    bridge.dispose()
  })

  it('DOM events cannot grant MCP authoring permission', async () => {
    const fake = fake_engine()
    const bridge = new FrontendAuthoringBridge(bridge_app(fake.engine))
    expect(bridge.is_permission_enabled()).toBe(false)
    const event_request = await bridge.handle(req('session.status'))
    expect(event_request.error?.code).toBe('AUTHORING_DISABLED')
    expect(bridge.is_permission_enabled()).toBe(false)
    await bridge.handle_mcp_request(req('session.status'))
    expect(bridge.is_permission_enabled()).toBe(true)
    bridge.dispose()
  })

  it('browser CustomEvents stay on the untrusted handler path', async () => {
    const fake = fake_engine()
    fake.meshes.push({ skeleton: make_skeleton() })
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    const bridge = get_authoring_bridge_for_testing()
    expect(bridge).toBeDefined()
    const response = new Promise<AuthoringResponse>((resolve) => {
      window.addEventListener(AUTHORING_RESPONSE_EVENT, (event) => resolve((event as CustomEvent<AuthoringResponse>).detail), { once: true })
    })
    window.dispatchEvent(new CustomEvent(AUTHORING_REQUEST_EVENT, { detail: req('session.status') }))
    const result = await response
    expect(result.error?.code).toBe('AUTHORING_DISABLED')
    expect(bridge?.is_permission_enabled()).toBe(false)
  })

  it('rejects cross-session requests while a session is active', async () => {
    const dispatcher = new AuthoringDispatcher({
      rig_catalog_get: async () => ({}), draft_create: async () => ({}), draft_set_keyframes: async () => ({}),
      draft_validate: async () => ({}), draft_preview_start: async () => ({}), draft_preview_stop: async () => ({}),
      draft_commit: async () => ({}), draft_cancel: async () => ({}), draft_undo: async () => ({}),
      draft_export: async () => ({}), draft_import: async () => ({}), session_status: async () => ({}),
      session_cancel: async () => ({})
    })
    const first = await dispatcher.handle(req('rig.catalog.get'))
    expect(first.ok).toBe(true)
    const other = await dispatcher.handle({ ...req('rig.catalog.get'), session_id: 'other-session' })
    expect(other.error?.code).toBe('SESSION_CONFLICT')
    dispatcher.dispose()
  })

  it('expires a confirmation using the request deadline', async () => {
    const fake = fake_engine()
    const bridge = new FrontendAuthoringBridge(bridge_app(fake.engine))
    await bridge.handle_mcp_request(req('session.status'))
    const created = await bridge.handle(req('draft.create', { name: 'Wave', duration_seconds: 1 }))
    expect(created.ok).toBe(true)
    const result = await bridge.handle(req('draft.commit', {}, undefined, 100))
    expect(result.error?.code).toBe('CONFIRMATION_EXPIRED')
    expect(document.querySelector('.m2m-authoring-confirmation')).toBeNull()
    bridge.dispose()
  })
})

describe('M2M-028A addendum — preview cleanup', () => {
  it('unregisters its frame listener on dispose', () => {
    const remove = vi.fn()
    const session = new DraftPreviewSession({
      active_skinned_meshes: () => [],
      add_frame_listener: () => {},
      remove_frame_listener: remove
    })
    session.dispose()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('does not update a disposed mixer from a retained callback', () => {
    let callback: ((delta: number) => void) | null = null
    const remove = vi.fn()
    const session = new DraftPreviewSession({
      active_skinned_meshes: () => [],
      add_frame_listener: (listener) => { callback = listener },
      remove_frame_listener: remove
    })
    session.dispose()
    expect(() => callback?.(0.016)).not.toThrow()
    expect(session.is_active()).toBe(false)
  })
})
