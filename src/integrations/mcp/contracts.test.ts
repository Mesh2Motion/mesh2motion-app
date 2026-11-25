import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  CONTROL_ERROR_CODES,
  CONTROL_SCHEMA_VERSION,
  ControlRequest,
  ControlResult,
  RigsListData,
  TOOL_ALLOWED_PHASES
} from './contracts.ts'

describe('control contracts', () => {
  it('keeps a stable schema version and error code surface', () => {
    expect(CONTROL_SCHEMA_VERSION).toBe('1.0')
    expect(CONTROL_ERROR_CODES.STATE_UNAVAILABLE).toBe('STATE_UNAVAILABLE')
    expect(CONTROL_ERROR_CODES.INVALID_REQUEST).toBe('INVALID_REQUEST')
    expect(CONTROL_ERROR_CODES.UNSUPPORTED_CAPABILITY).toBe('UNSUPPORTED_CAPABILITY')
    expect(Object.keys(TOOL_ALLOWED_PHASES)).toHaveLength(5)
  })

  it('types results as a discriminated union', () => {
    expectTypeOf<ControlResult<RigsListData>>().toMatchTypeOf<
      | { ok: true, data: RigsListData }
      | { ok: false }
    >()
    const request: ControlRequest = { kind: 'renderer_get_state' }
    expect(request.kind).toBe('renderer_get_state')
  })
})
