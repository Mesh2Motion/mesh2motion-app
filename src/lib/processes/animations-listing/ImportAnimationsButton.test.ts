import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportAnimationsButton } from './ImportAnimationsButton.ts'

function setup (import_files: ReturnType<typeof vi.fn>): {
  button: HTMLButtonElement
  input: HTMLInputElement
  subject: ImportAnimationsButton
} {
  const button = document.createElement('button')
  const input = document.createElement('input')
  input.type = 'file'
  document.body.append(button, input)
  return { button, input, subject: new ImportAnimationsButton({ import_files } as never, button, input) }
}

function select_file (input: HTMLInputElement): void {
  Object.defineProperty(input, 'files', {
    value: [new File(['x'], 'clip.glb')],
    configurable: true
  })
  input.dispatchEvent(new Event('change'))
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('ImportAnimationsButton', () => {
  it('shows an error dialog and restores state when import rejects', async () => {
    const import_files = vi.fn().mockRejectedValue(new Error('parser exploded'))
    const console_spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { button, input, subject } = setup(import_files)

    select_file(input)
    await vi.waitFor(() => expect(document.querySelector('.modal-dialog-overlay')).not.toBeNull())

    expect(import_files).toHaveBeenCalledOnce()
    expect(document.querySelector('.modal-dialog-body')?.textContent).toContain('could not be imported')
    expect(console_spy).toHaveBeenCalled()
    expect(button.disabled).toBe(false)
    expect(input.value).toBe('')
    subject.dispose()
  })

  it('does not show an error dialog on a successful import', async () => {
    const import_files = vi.fn().mockResolvedValue(undefined)
    const console_spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { button, input, subject } = setup(import_files)

    select_file(input)
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    expect(document.querySelector('.modal-dialog-overlay')).toBeNull()
    expect(console_spy).not.toHaveBeenCalled()
    subject.dispose()
  })
})
