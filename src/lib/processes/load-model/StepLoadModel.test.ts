import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { StepLoadModel } from './StepLoadModel.ts'

const { show_spy } = vi.hoisted(() => ({ show_spy: vi.fn() }))

vi.mock('../../ModalDialog.ts', () => ({
  ModalDialog: class {
    show = show_spy
  }
}))

beforeEach(() => {
  show_spy.mockClear()
  vi.restoreAllMocks()
})

describe('StepLoadModel GLB failure path', () => {
  it('passes an error callback and reports the failure instead of stalling', () => {
    const load_spy = vi.spyOn(GLTFLoader.prototype, 'load').mockImplementation(() => {})
    const step = new StepLoadModel()
    const handler = vi.fn()
    step.addEventListener('modelLoadError', handler)

    step.load_model_file('missing.glb', 'glb')

    expect(load_spy).toHaveBeenCalledOnce()
    const args = load_spy.mock.calls[0]
    expect(args[0]).toBe('missing.glb')
    expect(typeof args[1]).toBe('function') // existing onLoad behavior preserved
    expect(typeof args[3]).toBe('function') // added onError callback

    const error = new Error('file not found')
    const on_error = args[3] as (error: unknown) => void
    on_error(error)

    expect(handler).toHaveBeenCalledOnce()
    const event = handler.mock.calls[0][0] as CustomEvent
    expect(event.detail.format).toBe('GLB')
    expect(event.detail.path).toBe('missing.glb')
    expect(event.detail.error).toBe(error)
    expect(show_spy).toHaveBeenCalledOnce()
  })
})
