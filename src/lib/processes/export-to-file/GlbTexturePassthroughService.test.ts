import { describe, it, expect, vi } from 'vitest'
import { BoxGeometry, Mesh, MeshStandardMaterial, Scene, Texture } from 'three'
import { GlbTexturePassthroughService } from './GlbTexturePassthroughService'
import { TextureSourceRegistry } from '../load-model/TextureSourceRegistry'

const GLB_MAGIC = 0x46546C67
const JSON_CHUNK_TYPE = 0x4E4F534A
const BIN_CHUNK_TYPE = 0x004E4942

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ParsedGlb {
  json: Record<string, any[]>
  bin_bytes: Uint8Array
}

function parse_glb (glb: ArrayBuffer): ParsedGlb {
  const view = new DataView(glb)
  expect(view.getUint32(0, true)).toBe(GLB_MAGIC)
  expect(view.getUint32(8, true)).toBe(glb.byteLength)

  const json_length = view.getUint32(12, true)
  expect(view.getUint32(16, true)).toBe(JSON_CHUNK_TYPE)
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, json_length)))

  const bin_header = 20 + json_length
  const bin_length = view.getUint32(bin_header, true)
  expect(view.getUint32(bin_header + 4, true)).toBe(BIN_CHUNK_TYPE)

  return { json, bin_bytes: new Uint8Array(glb, bin_header + 8, bin_length) }
}

function build_glb (json: object, bin_bytes: Uint8Array): ArrayBuffer {
  const encoded_json = new TextEncoder().encode(JSON.stringify(json))
  const padded_json_length = Math.ceil(encoded_json.byteLength / 4) * 4
  const padded_bin_length = Math.ceil(bin_bytes.byteLength / 4) * 4
  const total = 20 + padded_json_length + 8 + padded_bin_length

  const output = new ArrayBuffer(total)
  const bytes = new Uint8Array(output)
  const view = new DataView(output)

  view.setUint32(0, GLB_MAGIC, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, total, true)
  view.setUint32(12, padded_json_length, true)
  view.setUint32(16, JSON_CHUNK_TYPE, true)
  bytes.fill(0x20, 20 + encoded_json.byteLength, 20 + padded_json_length)
  bytes.set(encoded_json, 20)
  view.setUint32(20 + padded_json_length, padded_bin_length, true)
  view.setUint32(24 + padded_json_length, BIN_CHUNK_TYPE, true)
  bytes.set(bin_bytes, 28 + padded_json_length)

  return output
}

/** A texture whose decoded image is irrelevant; only the remembered bytes matter. */
function make_registered_texture (name: string, bytes: Uint8Array, mime_type: string): Texture {
  const texture = new Texture()
  texture.name = name
  texture.flipY = false
  TextureSourceRegistry.remember(texture, { bytes, mime_type })
  return texture
}

function make_scene (texture: Texture): Scene {
  const scene = new Scene()
  const material = new MeshStandardMaterial()
  material.map = texture
  scene.add(new Mesh(new BoxGeometry(1, 1, 1), material))
  return scene
}

/**
 * Stands in for a GLTFExporter result: a mesh accessor's buffer view followed by
 * the re-encoded image, so a replacement of a different length has to shift the
 * accessor data that comes after it.
 */
function make_exported_glb (marker: string, reencoded_image: Uint8Array, accessor_bytes: Uint8Array): ArrayBuffer {
  const image_offset = Math.ceil(accessor_bytes.byteLength / 4) * 4
  const bin = new Uint8Array(image_offset + reencoded_image.byteLength)
  bin.set(accessor_bytes, 0)
  bin.set(reencoded_image, image_offset)

  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: accessor_bytes.byteLength, target: 34962 },
      { buffer: 0, byteOffset: image_offset, byteLength: reencoded_image.byteLength }
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    images: [{ bufferView: 1, mimeType: 'image/png' }],
    textures: [{ sampler: 0, source: 0, name: marker }],
    samplers: [{}],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }]
  }

  return build_glb(json, bin)
}

describe('GlbTexturePassthroughService', () => {
  it('marks registered textures and restores their names afterwards', () => {
    const texture = make_registered_texture('body_diffuse', new Uint8Array([1, 2, 3]), 'image/png')
    const plan = GlbTexturePassthroughService.prepare_scene(make_scene(texture))

    expect(plan.marked_textures.size).toBe(1)
    expect(texture.name).not.toBe('body_diffuse')

    plan.restore()
    expect(texture.name).toBe('body_diffuse')
  })

  it('skips flipY textures, whose vertical flip the exporter bakes into the pixels', () => {
    const texture = make_registered_texture('from_fbx', new Uint8Array([1, 2, 3]), 'image/png')
    texture.flipY = true

    const plan = GlbTexturePassthroughService.prepare_scene(make_scene(texture))

    expect(plan.marked_textures.size).toBe(0)
    expect(texture.name).toBe('from_fbx')
  })

  it('skips textures with no remembered source bytes', () => {
    const texture = new Texture()
    texture.name = 'generated'
    texture.flipY = false

    expect(GlbTexturePassthroughService.prepare_scene(make_scene(texture)).marked_textures.size).toBe(0)
  })

  it('puts the original jpeg bytes back and relocates the buffer views around them', () => {
    const original_image = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x11, 0x22])
    const texture = make_registered_texture('skin', original_image, 'image/jpeg')

    const plan = GlbTexturePassthroughService.prepare_scene(make_scene(texture))
    const marker = [...plan.marked_textures.keys()][0]

    const accessor_bytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2])
    // deliberately a different length from the original, so every later view moves
    const reencoded_image = new Uint8Array(64).fill(0xAB)
    const exported = make_exported_glb(marker, reencoded_image, accessor_bytes)

    const result = GlbTexturePassthroughService.apply_original_textures(exported, plan.marked_textures)
    const { json, bin_bytes } = parse_glb(result)

    expect(json.textures[0].name).toBe('skin')
    expect(json.images[0].mimeType).toBe('image/jpeg')
    expect(json.buffers[0].byteLength).toBe(bin_bytes.byteLength)

    const image_view = json.bufferViews[json.images[0].bufferView]
    expect(image_view.byteLength).toBe(original_image.byteLength)
    expect([...bin_bytes.subarray(image_view.byteOffset, image_view.byteOffset + image_view.byteLength)])
      .toEqual([...original_image])

    // the mesh data has to survive the relayout untouched, and stay 4 byte aligned
    const accessor_view = json.bufferViews[0]
    expect(accessor_view.byteOffset % 4).toBe(0)
    expect(accessor_view.target).toBe(34962)
    expect([...bin_bytes.subarray(accessor_view.byteOffset, accessor_view.byteOffset + accessor_view.byteLength)])
      .toEqual([...accessor_bytes])
  })

  it('drops the texture name entirely when the source texture was unnamed', () => {
    const texture = make_registered_texture('', new Uint8Array([1, 2, 3, 4]), 'image/png')
    const plan = GlbTexturePassthroughService.prepare_scene(make_scene(texture))
    const marker = [...plan.marked_textures.keys()][0]

    const exported = make_exported_glb(marker, new Uint8Array(16).fill(0xCD), new Uint8Array([1, 2, 3, 4]))
    const { json } = parse_glb(GlbTexturePassthroughService.apply_original_textures(exported, plan.marked_textures))

    expect('name' in json.textures[0]).toBe(false)
  })

  it('leaves a webp original alone when the exporter did not use EXT_texture_webp', () => {
    const texture = make_registered_texture('webp_map', new Uint8Array([0x52, 0x49, 0x46, 0x46]), 'image/webp')
    const plan = GlbTexturePassthroughService.prepare_scene(make_scene(texture))
    const marker = [...plan.marked_textures.keys()][0]

    const reencoded_image = new Uint8Array(16).fill(0xEE)
    const exported = make_exported_glb(marker, reencoded_image, new Uint8Array([1, 2, 3, 4]))
    const { json, bin_bytes } = parse_glb(
      GlbTexturePassthroughService.apply_original_textures(exported, plan.marked_textures))

    // the name still comes back, but the image is untouched
    expect(json.textures[0].name).toBe('webp_map')
    expect(json.images[0].mimeType).toBe('image/png')
    const image_view = json.bufferViews[json.images[0].bufferView]
    expect([...bin_bytes.subarray(image_view.byteOffset, image_view.byteOffset + image_view.byteLength)])
      .toEqual([...reencoded_image])
  })

  it('returns the export untouched when nothing was marked', () => {
    const exported = make_exported_glb('unused', new Uint8Array([1, 2]), new Uint8Array([3, 4]))
    expect(GlbTexturePassthroughService.apply_original_textures(exported, new Map())).toBe(exported)
  })
})

/**
 * The unit tests above hand-build an export so the buffer relayout can be checked
 * precisely. This one goes through the real GLTFExporter to confirm the marker
 * survives it, which is the assumption the whole approach rests on.
 */
describe('GlbTexturePassthroughService against a real GLTFExporter run', () => {
  it('swaps the exported image for the remembered bytes', async () => {
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

    // jsdom has no 2D canvas, so stand in for the re-encode the exporter does. The
    // bytes it produces are exactly what the passthrough is meant to throw away.
    const reencoded_image = new Uint8Array(48).fill(0xAB)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
      translate: () => {},
      scale: () => {}
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
      callback(new Blob([reencoded_image]))
    })

    // A 1x1 canvas stands in for a decoded image, since jsdom cannot decode a real one.
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1

    const original_image = new Uint8Array([0xFF, 0xD8, 0xFF, 0xDB, 0x42, 0x43, 0x44])
    const texture = new Texture(canvas as unknown as HTMLCanvasElement)
    texture.name = 'diffuse'
    texture.flipY = false
    texture.needsUpdate = true
    TextureSourceRegistry.remember(texture, { bytes: original_image, mime_type: 'image/jpeg' })

    const scene = make_scene(texture)
    const plan = GlbTexturePassthroughService.prepare_scene(scene)
    expect(plan.marked_textures.size).toBe(1)

    const exported = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false }) as ArrayBuffer
    plan.restore()
    expect(texture.name).toBe('diffuse')

    const { json, bin_bytes } = parse_glb(
      GlbTexturePassthroughService.apply_original_textures(exported, plan.marked_textures))

    expect(json.textures[0].name).toBe('diffuse')
    expect(json.images[0].mimeType).toBe('image/jpeg')

    const image_view = json.bufferViews[json.images[0].bufferView]
    expect([...bin_bytes.subarray(image_view.byteOffset, image_view.byteOffset + image_view.byteLength)])
      .toEqual([...original_image])

    // every accessor must still land on a valid, aligned slice of the rebuilt buffer
    json.accessors.forEach((accessor: { bufferView: number }) => {
      const view = json.bufferViews[accessor.bufferView]
      expect(view.byteOffset % 4).toBe(0)
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(bin_bytes.byteLength)
    })

    vi.restoreAllMocks()
  })
})
