import { BufferTarget, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny'

interface EncodedChunkEntry {
  chunk: EncodedVideoChunk
  meta: EncodedVideoChunkMetadata | undefined
}

/**
 * Encodes one preview clip to an H.264 MP4 with WebCodecs. Frames are given explicit timestamps,
 * so the output always has a constant frame rate and exactly the frames that were added,
 * no matter how long rendering takes.
 */
export class PreviewClipEncoder {
  // Constrained Baseline, level 3.1. Plays everywhere H.264 does (Safari/iOS included)
  public static readonly codec: string = 'avc1.42E01F'

  private readonly width: number
  private readonly height: number
  private readonly fps: number
  private readonly encoder: VideoEncoder
  private readonly chunks: EncodedChunkEntry[] = []
  private encoder_error: Error | null = null
  private frame_index: number = 0

  public static async is_supported (width: number, height: number): Promise<boolean> {
    if (typeof VideoEncoder === 'undefined') {
      return false
    }
    const support = await VideoEncoder.isConfigSupported({ codec: PreviewClipEncoder.codec, width, height })
    return support.supported === true
  }

  constructor (width: number, height: number, fps: number, bitrate: number) {
    this.width = width
    this.height = height
    this.fps = fps

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => { this.chunks.push({ chunk, meta }) },
      error: (error) => { this.encoder_error = error }
    })
    this.encoder.configure({
      codec: PreviewClipEncoder.codec,
      width,
      height,
      bitrate,
      framerate: fps,
      avc: { format: 'avc' } // length-prefixed NAL units, which is what MP4 expects
    })
  }

  /** Encodes a top-down RGBA buffer of width x height as the next frame */
  public add_frame (rgba_pixels: Uint8Array): void {
    const frame_duration_us = 1_000_000 / this.fps
    const frame = new VideoFrame(rgba_pixels, {
      format: 'RGBA',
      codedWidth: this.width,
      codedHeight: this.height,
      timestamp: Math.round(this.frame_index * frame_duration_us),
      duration: Math.round(frame_duration_us)
    })
    // first frame is a key frame so the video can start (and loop) cleanly
    this.encoder.encode(frame, { keyFrame: this.frame_index === 0 })
    frame.close()
    this.frame_index++
  }

  /** Finishes encoding and returns the MP4 file */
  public async finish (file_name: string): Promise<File> {
    await this.encoder.flush()
    this.encoder.close()
    if (this.encoder_error !== null) {
      throw this.encoder_error
    }

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }), // metadata up front so playback can start right away
      target: new BufferTarget()
    })
    const video_source = new EncodedVideoPacketSource('avc')
    output.addVideoTrack(video_source, { frameRate: this.fps })
    await output.start()

    for (const { chunk, meta } of this.chunks) {
      await video_source.add(EncodedPacket.fromEncodedChunk(chunk), meta)
    }
    await output.finalize()

    const buffer = (output.target as BufferTarget).buffer
    if (buffer === null) {
      throw new Error('MP4 muxer produced no data for ' + file_name)
    }
    return new File([buffer], file_name, { type: 'video/mp4' })
  }
}
