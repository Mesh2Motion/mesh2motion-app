import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { is_desktop_control_enabled, maybe_attach_desktop_control } from './attachControl.ts'
import type { ControlEngineLike } from './ControlPublisher.ts'
import { ControlSnapshot } from './contracts.ts'

function set_tauri (invoke: unknown): void {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: invoke === null ? undefined : { invoke },
    configurable: true,
    writable: true
  })
}

function set_flag (value: boolean | undefined): void {
  Object.defineProperty(window, '__M2M_MCP_ENABLED__', { value, configurable: true, writable: true })
}

function set_local_storage (data: Map<string, string>): void {
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => { data.set(key, value) }
    },
    configurable: true,
    writable: true
  })
}

function mock_engine (): ControlEngineLike {
  const target = () => ({
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
  return {
    renderer: { domElement: { width: 800, height: 600, ...target() } },
    camera: { position: { x: 0, y: 0, z: 0 } },
    scene: { children: [] },
    process_step: 'load-model',
    load_model_step: { vertex_count: 0, triangle_count: 0, model_meshes: () => ({ children: [] }), ...target() },
    load_skeleton_step: { skeleton_type: () => 'none', ...target() },
    edit_skeleton_step: { skeleton: () => ({ bones: [] }) },
    animations_listing_step: { loaded_animation_entries: () => [] },
    control_state: () => ({
      first_frame_rendered: false,
      context_lost: false,
      render_loop_stopped: false,
      render_failures: 0
    })
  } as unknown as ControlEngineLike
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  set_tauri(null)
  set_flag(undefined)
  window.history.replaceState({}, '', '/')
  set_local_storage(new Map())
})

afterEach(() => {
  set_tauri(null)
  set_flag(undefined)
  window.history.replaceState({}, '', '/')
  set_local_storage(new Map())
  vi.useRealTimers()
})

describe('desktop control activation gate', () => {
  it('is disabled in web builds without Tauri', () => {
    expect(is_desktop_control_enabled()).toBe(false)
  })

  it('stays disabled on a desktop bridge without explicit opt-in', () => {
    set_tauri(vi.fn())
    expect(is_desktop_control_enabled()).toBe(false)
  })

  it('enables via global flag, URL parameter or localStorage on Tauri only', () => {
    set_tauri(vi.fn())

    set_flag(true)
    expect(is_desktop_control_enabled()).toBe(true)
    set_flag(undefined)

    window.history.replaceState({}, '', '/?m2m-control=1')
    expect(is_desktop_control_enabled()).toBe(true)
    window.history.replaceState({}, '', '/')

    window.localStorage.setItem('m2m-control-enabled', '1')
    expect(is_desktop_control_enabled()).toBe(true)
  })

  it('does not publish when the gate is disabled', async () => {
    const sink = { publish: vi.fn() }
    set_tauri(vi.fn())
    maybe_attach_desktop_control(mock_engine(), { sink })
    await vi.advanceTimersByTimeAsync(1000)
    expect(sink.publish).not.toHaveBeenCalled()
  })

  it('publishes one real snapshot when explicitly enabled', async () => {
    const sink = { publish: vi.fn() }
    set_tauri(vi.fn())
    set_flag(true)
    const handle = await maybe_attach_desktop_control(mock_engine(), { sink })
    expect(handle).not.toBeNull()

    expect(sink.publish).toHaveBeenCalledTimes(1)
    const snapshot = sink.publish.mock.calls[0][0] as ControlSnapshot
    expect(snapshot.application.phase).toBe('loading')
    expect(snapshot.application.page).toBe('unknown')
    handle?.dispose()
  })
})
