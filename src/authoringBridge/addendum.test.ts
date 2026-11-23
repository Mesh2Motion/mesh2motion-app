import { afterEach, describe, expect, it, vi } from 'vitest'
import { Bone, Skeleton, type SkinnedMesh } from 'three'
import { attachAuthoringBridge, teardown } from './attach'
import { AuthoringDispatcher } from './dispatcher'
import { AUTHORING_BRIDGE_PROTOCOL, type AuthoringRequest } from './types'
import { FrontendAuthoringBridge, type AuthoringBridgeApp } from './service'
import { DraftPreviewSession } from '../animation-document/preview'

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
  document.querySelectorAll('#m2m-authoring-toggle').forEach((node) => node.remove())
  document.querySelectorAll('.m2m-authoring-confirmation').forEach((node) => node.remove())
})

describe('M2M-028A addendum — rig lifecycle attachment', () => {
  it('attaches when a rig finishes loading late, without re-entering a page', async () => {
    const fake = fake_engine()
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(window.m2mAuthoringBridge).toBeUndefined()
    fake.meshes.push({ skeleton: make_skeleton() })
    fake.skeleton_step.dispatchEvent(new Event('skeletonLoaded'))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(window.m2mAuthoringBridge).toBeDefined()
  })

  it('does not create duplicate bridges on repeated page entry', async () => {
    const fake = fake_engine()
    fake.meshes.push({ skeleton: make_skeleton() })
    attachAuthoringBridge(fake.engine as never)
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(document.querySelectorAll('#m2m-authoring-toggle')).toHaveLength(1)
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
    expect(window.m2mAuthoringBridge).toBeUndefined()
  })

  it('replaces the session when the rig fingerprint changes', async () => {
    const fake = fake_engine()
    fake.meshes.push({ skeleton: make_skeleton() })
    attachAuthoringBridge(fake.engine as never)
    await new Promise(resolve => setTimeout(resolve, 30))
    const first = window.m2mAuthoringBridge
    const replacement = make_skeleton()
    replacement.bones[0].position.x += 1
    fake.meshes.length = 0
    fake.meshes.push({ skeleton: replacement })
    fake.frame_listeners.forEach(listener => listener(0.016))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(window.m2mAuthoringBridge).not.toBe(first)
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

  it('permission toggles only through the native control', async () => {
    const fake = fake_engine()
    const bridge = new FrontendAuthoringBridge(bridge_app(fake.engine))
    expect(bridge.is_permission_enabled()).toBe(false)
    const toggles = document.querySelectorAll<HTMLButtonElement>('#m2m-authoring-toggle')
    toggles[toggles.length - 1]?.click()
    expect(bridge.is_permission_enabled()).toBe(true)
    expect(toggles[toggles.length - 1]?.textContent).toContain('enabled')
    bridge.dispose()
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
    const toggles = document.querySelectorAll<HTMLButtonElement>('#m2m-authoring-toggle')
    toggles[toggles.length - 1]?.click()
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
