import * as THREE from 'three'

/**
 * Renders a scene into a small off-screen canvas and reads the pixels back as RGBA buffers.
 * The scene is rendered at a supersampled size and box-filtered down on the CPU for smoother edges.
 *
 * Why it works this way:
 * - Pixels are read back instead of creating a VideoFrame from the canvas. Canvas-backed VideoFrames
 *   are paced to the display refresh rate (~16ms each) when encoding, while RGBA buffers encode almost instantly.
 * - A plain readPixels call waits for a full round trip to the GPU (~7ms). Instead, frames are read into
 *   pixel buffer objects in batches and the GPU is waited on once per batch, which costs well under 1ms per frame.
 *
 * Usage: call queue_frame() up to `batch_size` times, then collect_frames() to get the pixels in the same order.
 */
export class PreviewFrameCapture {
  public readonly width: number
  public readonly height: number
  public readonly batch_size: number

  private readonly supersample: number
  private readonly full_width: number
  private readonly full_height: number
  private readonly renderer: THREE.WebGLRenderer
  private readonly gl: WebGL2RenderingContext
  private readonly pixel_buffers: WebGLBuffer[]
  private readonly full_pixels: Uint8Array
  private queued_count: number = 0

  constructor (width: number, height: number, supersample: number = 2, batch_size: number = 32) {
    this.width = width
    this.height = height
    this.supersample = supersample
    this.batch_size = batch_size
    this.full_width = width * supersample
    this.full_height = height * supersample

    const canvas = new OffscreenCanvas(this.full_width, this.full_height)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(this.full_width, this.full_height, false)
    this.renderer.shadowMap.enabled = true
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 2.0

    this.gl = this.renderer.getContext() as WebGL2RenderingContext
    const buffer_bytes = this.full_width * this.full_height * 4
    this.full_pixels = new Uint8Array(buffer_bytes)
    this.pixel_buffers = []
    for (let i = 0; i < batch_size; i++) {
      const buffer = this.gl.createBuffer()
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, buffer)
      this.gl.bufferData(this.gl.PIXEL_PACK_BUFFER, buffer_bytes, this.gl.STREAM_READ)
      this.pixel_buffers.push(buffer)
    }
    this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null)
  }

  /**
   * The video has no alpha channel, so the canvas is cleared to an opaque color
   * (the floor color) instead of being transparent.
   */
  public set_background_color (color: THREE.ColorRepresentation): void {
    this.renderer.setClearColor(color, 1)
  }

  public is_batch_full (): boolean {
    return this.queued_count >= this.batch_size
  }

  /** Renders the scene as it is now and queues its pixels to be read back by collect_frames() */
  public queue_frame (scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.is_batch_full()) {
      throw new Error('Frame batch is full. Call collect_frames() first.')
    }
    this.renderer.render(scene, camera)
    this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, this.pixel_buffers[this.queued_count])
    this.gl.readPixels(0, 0, this.full_width, this.full_height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, 0)
    this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null)
    this.queued_count++
  }

  /** Waits for the GPU to finish the queued frames and returns them as top-down RGBA buffers of width x height */
  public async collect_frames (): Promise<Uint8Array[]> {
    if (this.queued_count === 0) {
      return []
    }

    const sync = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    if (sync === null) {
      throw new Error('Could not create a WebGL fence to wait for frames')
    }
    this.gl.flush()
    await this.wait_for_sync(sync)
    this.gl.deleteSync(sync)

    const frames: Uint8Array[] = []
    for (let i = 0; i < this.queued_count; i++) {
      this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, this.pixel_buffers[i])
      this.gl.getBufferSubData(this.gl.PIXEL_PACK_BUFFER, 0, this.full_pixels)
      frames.push(this.downsample(this.full_pixels))
    }
    this.gl.bindBuffer(this.gl.PIXEL_PACK_BUFFER, null)
    this.queued_count = 0
    return frames
  }

  private async wait_for_sync (sync: WebGLSync): Promise<void> {
    while (true) {
      const status = this.gl.clientWaitSync(sync, 0, 0)
      if (status === this.gl.ALREADY_SIGNALED || status === this.gl.CONDITION_SATISFIED) {
        return
      }
      if (status === this.gl.WAIT_FAILED) {
        throw new Error('Waiting for the GPU to finish rendering preview frames failed')
      }
      await new Promise(resolve => setTimeout(resolve, 1))
    }
  }

  /**
   * Box-filters the supersampled frame down to the output size. readPixels rows go bottom-up, so it is
   * flipped vertically as well. A new buffer is returned since the VideoFrame that wraps it may outlive this call.
   */
  private downsample (full_pixels: Uint8Array): Uint8Array {
    const ss = this.supersample
    const samples_per_pixel = ss * ss
    const output = new Uint8Array(this.width * this.height * 4)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let r = 0; let g = 0; let b = 0
        for (let dy = 0; dy < ss; dy++) {
          const source_row = this.full_height - 1 - (y * ss + dy)
          let index = (source_row * this.full_width + x * ss) * 4
          for (let dx = 0; dx < ss; dx++) {
            r += full_pixels[index]
            g += full_pixels[index + 1]
            b += full_pixels[index + 2]
            index += 4
          }
        }
        const out_index = (y * this.width + x) * 4
        output[out_index] = r / samples_per_pixel
        output[out_index + 1] = g / samples_per_pixel
        output[out_index + 2] = b / samples_per_pixel
        output[out_index + 3] = 255
      }
    }
    return output
  }

  public dispose (): void {
    this.pixel_buffers.forEach((buffer) => { this.gl.deleteBuffer(buffer) })
    this.renderer.dispose()
  }
}
