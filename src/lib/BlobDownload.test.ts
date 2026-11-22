import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { download_blob, REVOKE_DELAY_MS } from './BlobDownload.ts'

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:download-test'),
    configurable: true
  })
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('download_blob', () => {
  it('clicks the link and revokes the object URL after the download is dispatched', () => {
    const link = document.createElement('a')
    const click = vi.spyOn(link, 'click')

    download_blob(new Blob(['x']), 'model.glb', link)

    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(link.href).toBe('blob:download-test')
    expect(link.download).toBe('model.glb')
    expect(click).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download-test')
  })
})
