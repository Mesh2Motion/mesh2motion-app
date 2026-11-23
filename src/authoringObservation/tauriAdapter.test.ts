import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachTauriPoseObservationAdapter,
  OBSERVATION_IMAGE_REQUEST_EVENT,
  OBSERVATION_IMAGE_RESPOND_COMMAND,
  OBSERVATION_REQUEST_EVENT
} from './tauriAdapter'
import { OBSERVATION_PROTOCOL, type PoseObservationResponse } from './types'

type TauriHandler = (event: { event: string, payload: unknown }) => void

describe('Tauri pose image chunk adapter', () => {
  beforeEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  })

  it('returns exact bounded bytes and MIME for the owning session', async () => {
    const callbacks = new Map<number, TauriHandler>()
    const listeners = new Map<string, TauriHandler>()
    const commands: Array<{ command: string, args: unknown }> = []
    let callback_id = 0
    const invoke = vi.fn(async (command: string, args: unknown) => {
      commands.push({ command, args })
      if (command === 'plugin:event|listen') {
        const listener = args as { event: string, handler: number }
        const handler = callbacks.get(listener.handler)
        if (handler !== undefined) listeners.set(listener.event, handler)
      }
      return undefined
    })
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        invoke,
        transformCallback: (handler: TauriHandler) => {
          callback_id += 1
          callbacks.set(callback_id, handler)
          return callback_id
        }
      }
    })

    const adapter = await attachTauriPoseObservationAdapter(
      async (): Promise<PoseObservationResponse> => ({
        protocol: OBSERVATION_PROTOCOL,
        request_id: 'pose-1', session_id: 'session-1', sequence: 1, ok: true,
        result: { capture_id: 'capture-1' }
      }),
      vi.fn(),
      () => ({ mime: 'image/png', bytes: new Uint8Array([1, 2, 3, 4]) })
    )

    const request: Record<string, unknown> = {
      request_id: 'chunk-1', session_id: 'session-1', capture_id: 'capture-1',
      image_ref: 'capture-1:front', view: 'front', offset: 1, max_bytes: 2
    }
    listeners.get(OBSERVATION_REQUEST_EVENT)?.({
      event: OBSERVATION_REQUEST_EVENT,
      payload: { protocol: OBSERVATION_PROTOCOL, request_id: 'pose-1', session_id: 'session-1',
        sequence: 1, deadline_ms: 1000, operation: 'pose.capture', payload: {} }
    })
    await vi.waitFor(() => expect(commands.some((entry) => entry.command === 'mcp_pose_observation_respond')).toBe(true))
    listeners.get(OBSERVATION_IMAGE_REQUEST_EVENT)?.({ event: OBSERVATION_IMAGE_REQUEST_EVENT, payload: request })
    await vi.waitFor(() => expect(commands.some((entry) => entry.command === OBSERVATION_IMAGE_RESPOND_COMMAND)).toBe(true))

    const sent = commands.find((entry) => entry.command === OBSERVATION_IMAGE_RESPOND_COMMAND)?.args as {
      response: { mime: string, total_bytes: number, bytes_base64: string, offset: number }
    }
    expect(sent.response).toMatchObject({ mime: 'image/png', total_bytes: 4, offset: 1 })
    expect(Array.from(Uint8Array.from(atob(sent.response.bytes_base64), (value) => value.charCodeAt(0))))
      .toEqual([2, 3])
    await adapter.dispose()
    expect(adapter.listening()).toBe(false)
  })

  it('rejects cross-session capture reads without exposing bytes', async () => {
    const callbacks = new Map<number, TauriHandler>()
    const listeners = new Map<string, TauriHandler>()
    const commands: Array<{ command: string, args: unknown }> = []
    let callback_id = 0
    const invoke = vi.fn(async (command: string, args: unknown) => {
      commands.push({ command, args })
      if (command === 'plugin:event|listen') {
        const listener = args as { event: string, handler: number }
        const handler = callbacks.get(listener.handler)
        if (handler !== undefined) listeners.set(listener.event, handler)
      }
      return undefined
    })
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        invoke,
        transformCallback: (handler: TauriHandler) => {
          callback_id += 1
          callbacks.set(callback_id, handler)
          return callback_id
        }
      }
    })
    const get_image = vi.fn(() => ({ mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }))
    const adapter = await attachTauriPoseObservationAdapter(
      async (): Promise<PoseObservationResponse> => ({
        protocol: OBSERVATION_PROTOCOL,
        request_id: 'pose-1', session_id: 'session-1', sequence: 1, ok: true,
        result: { capture_id: 'capture-1' }
      }),
      vi.fn(), get_image
    )
    listeners.get('m2m-pose-observation-request')?.({
      event: 'm2m-pose-observation-request',
      payload: { protocol: OBSERVATION_PROTOCOL, request_id: 'pose-1', session_id: 'session-1',
        sequence: 1, deadline_ms: 1000, operation: 'pose.capture', payload: {} }
    })
    await vi.waitFor(() => expect(commands.some((entry) => entry.command === 'mcp_pose_observation_respond')).toBe(true))
    listeners.get(OBSERVATION_IMAGE_REQUEST_EVENT)?.({
      event: OBSERVATION_IMAGE_REQUEST_EVENT,
      payload: { request_id: 'chunk-2', session_id: 'session-2', capture_id: 'capture-1',
        image_ref: 'capture-1:front', view: 'front', offset: 0, max_bytes: 3 }
    })
    await vi.waitFor(() => expect(commands.filter((entry) => entry.command === OBSERVATION_IMAGE_RESPOND_COMMAND)).toHaveLength(1))
    const sent = commands.find((entry) => entry.command === OBSERVATION_IMAGE_RESPOND_COMMAND)?.args as {
      response: { error?: { code: string }, bytes_base64?: string }
    }
    expect(sent.response.error?.code).toBe('CAPTURE_NOT_FOUND')
    expect(sent.response.bytes_base64).toBeUndefined()
    expect(get_image).not.toHaveBeenCalled()
    await adapter.dispose()
  })

  it('bounds session ownership for captures retained by the adapter', async () => {
    const callbacks = new Map<number, TauriHandler>()
    const listeners = new Map<string, TauriHandler>()
    const commands: Array<{ command: string, args: unknown }> = []
    let callback_id = 0
    let capture_number = 0
    const invoke = vi.fn(async (command: string, args: unknown) => {
      commands.push({ command, args })
      if (command === 'plugin:event|listen') {
        const listener = args as { event: string, handler: number }
        const handler = callbacks.get(listener.handler)
        if (handler !== undefined) listeners.set(listener.event, handler)
      }
      return undefined
    })
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {
        invoke,
        transformCallback: (handler: TauriHandler) => {
          callback_id += 1
          callbacks.set(callback_id, handler)
          return callback_id
        }
      }
    })
    const get_image = vi.fn(() => ({ mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }))
    const adapter = await attachTauriPoseObservationAdapter(
      async (value): Promise<PoseObservationResponse> => {
        const request = value as { request_id: string, session_id: string, sequence: number }
        capture_number += 1
        return {
          protocol: OBSERVATION_PROTOCOL, request_id: request.request_id,
          session_id: request.session_id, sequence: request.sequence, ok: true,
          result: { capture_id: `capture-${capture_number}` }
        }
      }, vi.fn(), get_image
    )
    const request_listener = listeners.get(OBSERVATION_REQUEST_EVENT)!
    for (let sequence = 1; sequence <= 5; sequence++) {
      const before = commands.filter((entry) => entry.command === 'mcp_pose_observation_respond').length
      request_listener({
        event: OBSERVATION_REQUEST_EVENT,
        payload: { protocol: OBSERVATION_PROTOCOL, request_id: `pose-${sequence}`, session_id: 'session-1',
          sequence, deadline_ms: 1000, operation: 'pose.capture', payload: {} }
      })
      await vi.waitFor(() => expect(commands.filter((entry) => entry.command === 'mcp_pose_observation_respond')).toHaveLength(before + 1))
    }
    const image_listener = listeners.get(OBSERVATION_IMAGE_REQUEST_EVENT)!
    const image_request = (capture_id: string) => ({
      event: OBSERVATION_IMAGE_REQUEST_EVENT,
      payload: { request_id: `chunk-${capture_id}`, session_id: 'session-1', capture_id,
        image_ref: `${capture_id}:front`, view: 'front', offset: 0, max_bytes: 3 }
    })
    image_listener(image_request('capture-1'))
    image_listener(image_request('capture-5'))
    await vi.waitFor(() => expect(commands.filter((entry) => entry.command === OBSERVATION_IMAGE_RESPOND_COMMAND)).toHaveLength(2))
    expect(get_image).toHaveBeenCalledTimes(1)
    const responses = commands.filter((entry) => entry.command === OBSERVATION_IMAGE_RESPOND_COMMAND)
      .map((entry) => (entry.args as { response: { capture_id: string, error?: { code: string } } }).response)
    expect(responses.find((response) => response.capture_id === 'capture-1')?.error?.code).toBe('CAPTURE_NOT_FOUND')
    expect(responses.find((response) => response.capture_id === 'capture-5')?.error).toBeUndefined()
    await adapter.dispose()
  })
})
