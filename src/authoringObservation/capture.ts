/**
 * M2M-030A — offscreen WebGL2 capture of the live model.
 *
 * The user's renderer, camera, scene, orbit controls and XYZ helper are never
 * modified permanently. One reusable render target is resized per request and
 * every renderer/scissor/clear state is restored in a finally transaction, even
 * on failure or cancellation. No camera or helper is added to the scene.
 */

import {
  Color,
  LinearFilter,
  RGBAFormat,
  Raycaster,
  UnsignedByteType,
  Vector3,
  Vector4,
  type Object3D,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type SkinnedMesh,
  type WebGLRenderer
} from 'three'
import type { EvaluatedJoint, ImageMime, JointObservation, OverlayOptions } from './types'
import { ObservationError } from './types'

export interface CaptureHost {
  renderer: WebGLRenderer
  scene: Scene
  active_skinned_meshes? (): readonly SkinnedMesh[]
  /** Editor-only scene helpers that must never appear in model captures. */
  capture_excluded_objects? (): readonly Object3D[]
}

export interface EncodedImage {
  mime: ImageMime
  bytes: Uint8Array
}

export interface OverlayInput {
  joints: JointObservation[]
  options: OverlayOptions
}

/**
 * Injectable encoder. Production uses a 2D canvas + toDataURL (works in
 * WebKitGTK/WebGL2); tests can inject a deterministic encoder without a GPU.
 */
export type PixelEncoder = (
  pixels: Uint8Array,
  width: number,
  height: number,
  mime: ImageMime,
  quality: number,
  overlays: OverlayInput | null
) => EncodedImage

function flip_vertically (pixels: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const flipped = new Uint8ClampedArray(pixels.length)
  const stride = width * 4
  for (let row = 0; row < height; row++) {
    const source = (height - 1 - row) * stride
    flipped.set(pixels.subarray(source, source + stride), row * stride)
  }
  return flipped
}

function decode_data_url (data_url: string): Uint8Array {
  const comma = data_url.indexOf(',')
  if (comma < 0) throw new Error('invalid image data URL')
  const base64 = data_url.slice(comma + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function draw_overlays (
  context: CanvasRenderingContext2D,
  overlays: OverlayInput,
  width: number,
  height: number
): void {
  if (overlays.options.skeleton === true) {
    const by_id = new Map(overlays.joints.map((joint) => [joint.bone_id, joint]))
    context.strokeStyle = 'rgba(120, 220, 255, 0.9)'
    context.lineWidth = Math.max(1, Math.round(width / 512))
    for (const joint of overlays.joints) {
      if (joint.parent_id === null || !joint.projected.in_frame) continue
      const parent = by_id.get(joint.parent_id)
      if (parent === undefined || !parent.projected.in_frame) continue
      context.beginPath()
      context.moveTo(parent.projected.u * width, parent.projected.v * height)
      context.lineTo(joint.projected.u * width, joint.projected.v * height)
      context.stroke()
    }
  }
  if (overlays.options.bone_labels === true) {
    context.fillStyle = 'rgba(255, 255, 255, 0.95)'
    context.font = `${Math.max(9, Math.round(width / 64))}px sans-serif`
    for (const joint of overlays.joints) {
      if (!joint.projected.in_frame) continue
      const x = joint.projected.u * width
      const y = joint.projected.v * height
      context.fillText(joint.display_name, x + 2, y - 2)
    }
  }
}

/** Production encoder: real PNG/JPEG bytes produced from the readback pixels. */
export function canvas_pixel_encoder (
  pixels: Uint8Array,
  width: number,
  height: number,
  mime: ImageMime,
  quality: number,
  overlays: OverlayInput | null
): EncodedImage {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) throw new ObservationError('RENDER_FAILED', '2D canvas unavailable for image encoding')
  const image = new ImageData(width, height)
  image.data.set(flip_vertically(pixels, width, height))
  context.putImageData(image, 0, 0)
  if (overlays !== null) draw_overlays(context, overlays, width, height)
  const data_url = canvas.toDataURL(mime, quality)
  return { mime, bytes: decode_data_url(data_url) }
}

/**
 * Owns the single reusable render target and performs one view capture.
 * The render target is disposed only by dispose(), never per request.
 */
export class OffscreenCapture {
  private readonly host: CaptureHost
  private readonly encoder: PixelEncoder
  private target: WebGLRenderTarget | null = null
  private disposed = false

  constructor (host: CaptureHost, encoder: PixelEncoder = canvas_pixel_encoder) {
    this.host = host
    this.encoder = encoder
  }

  render (
    camera: Camera,
    width: number,
    height: number,
    mime: ImageMime,
    quality: number,
    overlays: OverlayInput | null
  ): EncodedImage {
    if (this.disposed) throw new ObservationError('RENDER_FAILED', 'capture renderer is disposed')
    const { renderer } = this.host
    if (renderer.getContext().isContextLost()) {
      throw new ObservationError('CONTEXT_LOST', 'WebGL context is lost')
    }
    if (this.target === null) {
      this.target = new WebGLRenderTarget(width, height, {
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        format: RGBAFormat,
        type: UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false
      })
      this.target.texture.name = 'm2m-observation-capture'
    } else if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height)
    }
    const target = this.target

    const previous_target = renderer.getRenderTarget()
    const previous_viewport = renderer.getViewport(new Vector4())
    const previous_scissor = renderer.getScissor(new Vector4())
    const previous_scissor_test = renderer.getScissorTest()
    const previous_clear_color = renderer.getClearColor(new Color())
    const previous_clear_alpha = renderer.getClearAlpha()
    const previous_auto_clear = renderer.autoClear
    const excluded_objects = [...new Set(this.host.capture_excluded_objects?.() ?? [])]
    const previous_visibility = excluded_objects.map((object) => [object, object.visible] as const)

    try {
      for (const object of excluded_objects) object.visible = false
      renderer.setRenderTarget(target)
      renderer.setViewport(0, 0, width, height)
      renderer.setScissorTest(false)
      renderer.setClearColor(0x000000, 0)
      renderer.autoClear = true
      renderer.clear(true, true, true)
      renderer.render(this.host.scene, camera)
      const pixels = new Uint8Array(width * height * 4)
      renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
      return this.encoder(pixels, width, height, mime, quality, overlays)
    } catch (error) {
      if (error instanceof ObservationError) throw error
      throw new ObservationError('RENDER_FAILED', error instanceof Error ? error.message : String(error), error)
    } finally {
      for (const [object, visible] of previous_visibility) object.visible = visible
      renderer.setRenderTarget(previous_target)
      renderer.setViewport(previous_viewport)
      renderer.setScissor(previous_scissor)
      renderer.setScissorTest(previous_scissor_test)
      renderer.setClearColor(previous_clear_color, previous_clear_alpha)
      renderer.autoClear = previous_auto_clear
    }
  }

  /** Grounded visibility: raycast against the live evaluated skinned meshes. */
  occlusion_for (joint: EvaluatedJoint, camera: Camera): JointObservation['projected']['occlusion'] {
    const meshes = this.host.active_skinned_meshes?.() ?? []
    if (meshes.length === 0) return 'unknown'
    const target = new Vector3(joint.world_position[0], joint.world_position[1], joint.world_position[2])
    const direction = target.clone().sub(camera.position)
    const distance = direction.length()
    if (distance < 1e-6) return 'none'
    const raycaster = new Raycaster(camera.position.clone(), direction.normalize(), 0, Math.max(0, distance - 1e-3))
    return raycaster.intersectObjects([...meshes], true).length > 0 ? 'self' : 'none'
  }

  dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.target?.dispose()
    this.target = null
  }
}

