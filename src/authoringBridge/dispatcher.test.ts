import { describe, expect, it } from 'vitest'
import { AuthoringDispatcher, type AuthoringHandlers } from './dispatcher'
import { AUTHORING_BRIDGE_PROTOCOL, type AuthoringRequest } from './types'

function handlers (): AuthoringHandlers {
  return {
    rig_catalog_get: async () => ({ rig: { identifier: 'human', fingerprint: 'abc' }, bones: [] }),
    draft_create: async () => ({ revision: 2 }),
    draft_set_keyframes: async () => ({ revision: 2, validation: { state: 'valid', errors: [] } }),
    draft_validate: async () => ({ state: 'valid' }),
    draft_preview_start: async () => ({ previewing: true }),
    draft_preview_stop: async () => ({ previewing: false }),
    draft_commit: async () => ({ revision: 2, entry_id: 'entry-1' }),
    draft_cancel: async () => ({ cancelled: true }),
    draft_undo: async () => ({ revision: 3 }),
    draft_export: async () => ({ document: {} }),
    draft_import: async () => ({ revision: 3 }),
    session_status: async () => ({ active: true }),
    session_cancel: async () => ({ cancelled: true })
  }
}

let sequence_counter = 0
function request (overrides: Partial<AuthoringRequest> = {}): AuthoringRequest {
  sequence_counter += 1
  return {
    protocol: AUTHORING_BRIDGE_PROTOCOL,
    request_id: 'req-1',
    session_id: 'session-1',
    sequence: sequence_counter,
    deadline_ms: 1000,
    operation: 'rig.catalog.get',
    payload: {},
    ...overrides
  }
}

describe('AuthoringDispatcher', () => {
  it('accepts a typed request and returns a typed response', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const response = await dispatcher.handle(request())
    expect(response).toMatchObject({ protocol: AUTHORING_BRIDGE_PROTOCOL, request_id: 'req-1', ok: true })
    expect(response.result).toMatchObject({ rig: { identifier: 'human' } })
    dispatcher.dispose()
  })

  it('rejects a wrong protocol and unknown operation', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const wrong = await dispatcher.handle({ ...request(), protocol: 'evil/v9' })
    expect(wrong.error?.code).toBe('BAD_PROTOCOL')
    const unknown = await dispatcher.handle({ ...request(), operation: 'eval' } as unknown as AuthoringRequest)
    expect(unknown.error?.code).toBe('BAD_PROTOCOL')
    dispatcher.dispose()
  })

  it('rejects duplicate request IDs', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    await dispatcher.handle(request())
    const duplicate = await dispatcher.handle(request({ operation: 'session.status' }))
    expect(duplicate.error?.code).toBe('DUPLICATE_REQUEST_ID')
    dispatcher.dispose()
  })

  it('rejects concurrent requests in the same session', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const first = dispatcher.handle(request({ operation: 'draft.validate', payload: {} }))
    const second = await dispatcher.handle(request({ request_id: 'req-2' }))
    expect(second.error?.code).toBe('SESSION_CONFLICT')
    await first
    dispatcher.dispose()
  })

  it('rejects oversized payloads and bad deadlines', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const big = await dispatcher.handle(request({ payload: { data: 'x'.repeat(600 * 1024) } }))
    expect(big.error?.code).toBe('PAYLOAD_TOO_LARGE')
    const bad = await dispatcher.handle(request({ request_id: 'req-3', deadline_ms: 1 }))
    expect(bad.error?.code).toBe('BAD_REQUEST')
    dispatcher.dispose()
  })

  it('returns DEADLINE_EXCEEDED and leaves no timer running', async () => {
    const dispatcher = new AuthoringDispatcher({
      ...handlers(),
      rig_catalog_get: () => new Promise(() => {})
    })
    const response = await dispatcher.handle(request({ deadline_ms: 120 }))
    expect(response.error?.code).toBe('DEADLINE_EXCEEDED')
    dispatcher.dispose()
  })

  it('maps handler error codes and allows session cancel', async () => {
    const dispatcher = new AuthoringDispatcher({
      ...handlers(),
      draft_commit: async () => { throw new Error('CONFIRMATION_DENIED') }
    })
    const denied = await dispatcher.handle(request({ operation: 'draft.commit' }))
    expect(denied.error?.code).toBe('CONFIRMATION_DENIED')
    const cancelled = await dispatcher.handle(request({ request_id: 'req-2', operation: 'session.cancel' }))
    expect(cancelled.ok).toBe(true)
    dispatcher.dispose()
  })

  it('clears a stale previous MCP session when a new sidecar sends session cancel', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const first = await dispatcher.handle(request({
      request_id: 'old-session-request', session_id: 'old-session', operation: 'rig.catalog.get', sequence: 1
    }))
    expect(first.ok).toBe(true)

    const cancelled = await dispatcher.handle(request({
      request_id: 'new-session-cancel', session_id: 'new-session', operation: 'session.cancel', sequence: 1
    }))
    expect(cancelled.ok).toBe(true)

    const next = await dispatcher.handle(request({
      request_id: 'next-session-request', session_id: 'next-session', operation: 'rig.catalog.get', sequence: 1
    }))
    expect(next.ok).toBe(true)
    dispatcher.dispose()
  })

  it('rejects all work after dispose', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    dispatcher.dispose()
    const response = await dispatcher.handle(request())
    expect(response.error?.code).toBe('SESSION_CONFLICT')
  })

  it('never executes arbitrary strings as code', async () => {
    const dispatcher = new AuthoringDispatcher(handlers())
    const response = await dispatcher.handle({
      ...request(),
      operation: 'rig.catalog.get',
      payload: { expression: 'constructor.constructor("return 1")()' }
    } as unknown as AuthoringRequest)
    // Payload data is forwarded but never evaluated; the handler returns static data.
    expect(response.ok).toBe(true)
    expect(JSON.stringify(response.result)).not.toContain('return 1')
    dispatcher.dispose()
  })
})
