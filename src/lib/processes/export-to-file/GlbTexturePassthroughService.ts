import { type Object3D, type Texture } from 'three'
import { TextureSourceRegistry, type EncodedTextureSource } from '../load-model/TextureSourceRegistry'

export interface MarkedTexture extends EncodedTextureSource {
  original_name: string
}

/**
 * The markers assigned before an export, plus the undo for the texture renaming.
 */
/** The parts of the exported glTF JSON this rewrites. */
interface GlbBufferViewDef {
  buffer?: number
  byteOffset?: number
  byteLength: number
}

interface GlbImageDef {
  bufferView?: number
  mimeType?: string
}

interface GlbTextureDef {
  name?: string
  source?: number
  extensions?: { EXT_texture_webp?: { source?: number } }
}

interface GlbJson {
  buffers?: Array<{ byteLength?: number }>
  bufferViews?: GlbBufferViewDef[]
  images?: GlbImageDef[]
  textures?: GlbTextureDef[]
}

export interface TexturePassthroughPlan {
  marked_textures: Map<string, MarkedTexture>
  restore: () => void
}

/**
 * Puts the original, untouched image bytes back into an exported GLB.
 *
 * GLTFExporter cannot re-use the bytes a texture came from, because by the time it
 * runs three only has the decoded pixels. It redraws every texture into a 2D canvas
 * and re-encodes it, which loses quality (see {@link TextureSourceRegistry}). This
 * service swaps the re-encoded images back out for the originals afterwards.
 *
 * Matching the two up is done with a marker name: `prepare_scene` renames every
 * eligible texture, GLTFExporter copies `texture.name` into the exported
 * `textures[i].name`, and `apply_original_textures` uses that to find which image
 * each original belongs to before restoring the real name.
 *
 * The marker doubles as a safety check. Whenever the exporter has to *derive* a new
 * texture rather than write one straight through - combining metalness and roughness
 * into one map, flipping a normal map channel, decompressing a KTX2 texture - it
 * builds a brand new Texture object that never carries a marker, so those are left
 * alone automatically.
 */
export class GlbTexturePassthroughService {
  private static readonly MARKER_PREFIX = '__m2m_texture_source_'
  private static readonly MARKER_SUFFIX = '__'

  private static readonly GLB_HEADER_BYTES = 12
  private static readonly CHUNK_HEADER_BYTES = 8
  private static readonly GLB_MAGIC = 0x46546C67 // 'glTF'
  private static readonly JSON_CHUNK_TYPE = 0x4E4F534A // 'JSON'
  private static readonly BIN_CHUNK_TYPE = 0x004E4942 // 'BIN\0'

  /** Formats glTF allows as a plain image, with no extension declaration needed. */
  private static readonly CORE_MIME_TYPES = ['image/png', 'image/jpeg']

  /**
   * Marks every texture in the scene whose original bytes we still have.
   *
   * @param root the scene about to be handed to GLTFExporter
   * @returns the markers to feed to {@link apply_original_textures}, and a
   * `restore` that puts the real texture names back. `restore` must run whether
   * the export succeeds or fails, since it mutates the live scene textures.
   */
  public static prepare_scene (root: Object3D): TexturePassthroughPlan {
    const marked_textures = new Map<string, MarkedTexture>()
    const renamed: Array<{ texture: Texture, original_name: string }> = []
    const seen = new Set<Texture>()

    root.traverse((node) => {
      this.collect_materials(node).forEach((material) => {
        Object.values(material).forEach((value) => {
          const texture = this.as_texture(value)
          if (texture === null || seen.has(texture)) {
            return
          }
          seen.add(texture)

          const source = TextureSourceRegistry.get(texture)
          if (source === undefined) {
            return
          }

          // A flipY texture (anything imported from FBX or Collada) has its vertical
          // flip baked into the exported pixels by GLTFExporter, because glTF has no
          // flipY flag. The original bytes are upside down relative to that, so they
          // cannot be passed through.
          if (texture.flipY) {
            return
          }

          const marker = `${this.MARKER_PREFIX}${marked_textures.size}${this.MARKER_SUFFIX}`
          marked_textures.set(marker, { ...source, original_name: texture.name })
          renamed.push({ texture, original_name: texture.name })
          texture.name = marker
        })
      })
    })

    return {
      marked_textures,
      restore: () => {
        renamed.forEach((entry) => {
          entry.texture.name = entry.original_name
        })
      }
    }
  }

  /**
   * @param glb a binary glTF as produced by GLTFExporter
   * @param marked_textures the map returned by {@link prepare_scene}
   * @returns a new GLB with the re-encoded images replaced by their originals, or
   * the original buffer untouched when there is nothing to swap
   */
  public static apply_original_textures (glb: ArrayBuffer, marked_textures: Map<string, MarkedTexture>): ArrayBuffer {
    if (marked_textures.size === 0) {
      return glb
    }

    const parsed = this.parse_glb(glb)
    if (parsed === null) {
      return glb
    }

    const { json, bin_bytes } = parsed
    const replacements = this.plan_replacements(json, marked_textures)

    // The texture names were rewritten to markers either way, so the JSON always has
    // to be written back out even when no image ended up being replaced.
    if (replacements === null) {
      return this.write_glb(json, bin_bytes)
    }

    return this.write_glb(json, this.rebuild_bin_chunk(json, bin_bytes, replacements))
  }

  /**
   * Restores the real texture names and works out which buffer views hold an image
   * that can be swapped for its original.
   *
   * @returns buffer view index -> replacement bytes, or null when nothing is
   * replaceable
   */
  private static plan_replacements (json: GlbJson, marked_textures: Map<string, MarkedTexture>): Map<number, Uint8Array> | null {
    const texture_defs: GlbTextureDef[] = json.textures ?? []
    const image_defs: GlbImageDef[] = json.images ?? []
    const buffer_views: GlbBufferViewDef[] = json.bufferViews ?? []

    // A single buffer is all GLTFExporter ever writes for a GLB. Anything else means
    // the layout is not what rebuild_bin_chunk assumes, so leave the images alone.
    const single_buffer = buffer_views.every((view) => (view.buffer ?? 0) === 0)

    const replacements = new Map<number, Uint8Array>()

    texture_defs.forEach((texture_def) => {
      const marked = texture_def.name === undefined ? undefined : marked_textures.get(texture_def.name)
      if (marked === undefined) {
        return
      }

      if (marked.original_name === '') {
        delete texture_def.name
      } else {
        texture_def.name = marked.original_name
      }

      if (!single_buffer) {
        return
      }

      const image_index = this.source_index_for_texture(texture_def, marked.mime_type)
      const image_def = image_index === undefined ? undefined : image_defs[image_index]

      // Only ever swap an image the exporter embedded in the binary chunk, and never
      // one another texture already claimed.
      if (typeof image_def?.bufferView !== 'number' || replacements.has(image_def.bufferView)) {
        return
      }

      image_def.mimeType = marked.mime_type
      replacements.set(image_def.bufferView, marked.bytes)
    })

    return replacements.size === 0 ? null : replacements
  }

  /**
   * Finds the image a texture reads from, refusing any pairing that would change
   * which extensions the file depends on.
   *
   * A png or jpeg original is always safe: both are core glTF and sit in `source`.
   * A webp original is only safe when the exporter already routed this texture
   * through EXT_texture_webp, so the extension is declared either way.
   */
  private static source_index_for_texture (texture_def: GlbTextureDef, mime_type: string): number | undefined {
    const webp_source = texture_def.extensions?.EXT_texture_webp?.source

    if (mime_type === 'image/webp') {
      return typeof webp_source === 'number' ? webp_source : undefined
    }

    if (!this.CORE_MIME_TYPES.includes(mime_type) || webp_source !== undefined) {
      return undefined
    }

    return typeof texture_def.source === 'number' ? texture_def.source : undefined
  }

  /**
   * Rewrites the binary chunk with the replacement images in place.
   *
   * Swapping an image changes its length, so every later buffer view moves. Each
   * view is copied out in index order and re-laid-out on a 4 byte boundary, which is
   * the alignment glTF requires of accessor data and the same one GLTFExporter uses.
   */
  private static rebuild_bin_chunk (json: GlbJson, bin_bytes: Uint8Array, replacements: Map<number, Uint8Array>): Uint8Array {
    const buffer_views: GlbBufferViewDef[] = json.bufferViews ?? []

    const segments: Uint8Array[] = buffer_views.map((view, index) => {
      const replacement = replacements.get(index)
      if (replacement !== undefined) {
        return replacement
      }

      const byte_offset: number = view.byteOffset ?? 0
      return bin_bytes.subarray(byte_offset, byte_offset + view.byteLength)
    })

    let total_length = 0
    const offsets: number[] = segments.map((segment) => {
      const offset = total_length
      total_length += Math.ceil(segment.byteLength / 4) * 4
      return offset
    })

    const rebuilt = new Uint8Array(total_length)
    segments.forEach((segment, index) => {
      rebuilt.set(segment, offsets[index])
      buffer_views[index].byteOffset = offsets[index]
      buffer_views[index].byteLength = segment.byteLength
    })

    if (json.buffers?.[0] != null) {
      json.buffers[0].byteLength = total_length
    }

    return rebuilt
  }

  private static parse_glb (glb: ArrayBuffer): { json: GlbJson, bin_bytes: Uint8Array } | null {
    const header_and_chunk = this.GLB_HEADER_BYTES + this.CHUNK_HEADER_BYTES
    if (glb.byteLength < header_and_chunk) {
      return null
    }

    const view = new DataView(glb)
    if (view.getUint32(0, true) !== this.GLB_MAGIC) {
      return null
    }

    // the JSON chunk is required to be first in a GLB
    const json_length = view.getUint32(this.GLB_HEADER_BYTES, true)
    const json_start = header_and_chunk
    if (view.getUint32(this.GLB_HEADER_BYTES + 4, true) !== this.JSON_CHUNK_TYPE ||
      json_start + json_length > glb.byteLength) {
      return null
    }

    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, json_start, json_length))) as GlbJson

    const bin_header_start = json_start + json_length
    if (bin_header_start + this.CHUNK_HEADER_BYTES > glb.byteLength) {
      return null
    }

    const bin_length = view.getUint32(bin_header_start, true)
    const bin_start = bin_header_start + this.CHUNK_HEADER_BYTES
    if (view.getUint32(bin_header_start + 4, true) !== this.BIN_CHUNK_TYPE ||
      bin_start + bin_length > glb.byteLength) {
      return null
    }

    return { json, bin_bytes: new Uint8Array(glb, bin_start, bin_length) }
  }

  private static write_glb (json: GlbJson, bin_bytes: Uint8Array): ArrayBuffer {
    const encoded_json = new TextEncoder().encode(JSON.stringify(json))

    // the spec pads the JSON chunk to 4 bytes with spaces and the binary chunk with zeros
    const padded_json_length = Math.ceil(encoded_json.byteLength / 4) * 4
    const padded_bin_length = Math.ceil(bin_bytes.byteLength / 4) * 4

    const json_start = this.GLB_HEADER_BYTES + this.CHUNK_HEADER_BYTES
    const bin_header_start = json_start + padded_json_length
    const bin_start = bin_header_start + this.CHUNK_HEADER_BYTES
    const total_length = bin_start + padded_bin_length

    const output = new ArrayBuffer(total_length)
    const output_bytes = new Uint8Array(output)
    const output_view = new DataView(output)

    output_view.setUint32(0, this.GLB_MAGIC, true)
    output_view.setUint32(4, 2, true) // glTF version
    output_view.setUint32(8, total_length, true)

    output_view.setUint32(this.GLB_HEADER_BYTES, padded_json_length, true)
    output_view.setUint32(this.GLB_HEADER_BYTES + 4, this.JSON_CHUNK_TYPE, true)
    output_bytes.fill(0x20, json_start + encoded_json.byteLength, bin_header_start)
    output_bytes.set(encoded_json, json_start)

    output_view.setUint32(bin_header_start, padded_bin_length, true)
    output_view.setUint32(bin_header_start + 4, this.BIN_CHUNK_TYPE, true)
    output_bytes.set(bin_bytes, bin_start)

    return output
  }

  private static as_texture (value: unknown): Texture | null {
    if (typeof value !== 'object' || value === null || (value as Texture).isTexture !== true) {
      return null
    }
    return value as Texture
  }

  private static collect_materials (node: Object3D): Array<Record<string, unknown>> {
    const material = (node as Object3D & { material?: unknown }).material
    if (material == null || typeof material !== 'object') {
      return []
    }

    const material_list = Array.isArray(material) ? material : [material]
    return material_list.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
  }
}
