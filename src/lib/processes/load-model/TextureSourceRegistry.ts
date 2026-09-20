import { type Texture } from 'three'
import { type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

/**
 * The compressed bytes a texture was originally decoded from, plus the mime type
 * that describes them.
 */
export interface EncodedTextureSource {
  bytes: Uint8Array
  mime_type: string
}

/** The parts of the glTF JSON and of GLTFLoader's parser this needs, which three does not type. */
interface GltfImageDef {
  uri?: string
  mimeType?: string
  bufferView?: number
}

interface GltfTextureDef {
  source?: number
  extensions?: { EXT_texture_webp?: { source?: number } }
}

interface GltfParserLike {
  json?: { images?: GltfImageDef[], textures?: GltfTextureDef[] }
  associations?: Map<object, { textures?: number }>
  options?: { manager?: { resolveURL?: (url: string) => string } }
  getDependency: (type: string, index: number) => Promise<ArrayBuffer>
}

/**
 * Remembers the original compressed image bytes behind an imported texture.
 *
 * Once a texture is loaded, three only keeps the *decoded* pixels (an ImageBitmap).
 * GLTFExporter therefore has to re-encode every texture through a 2D canvas on the
 * way out, which is lossy in three separate ways:
 *
 *   - a JPEG source is re-compressed at the browser's default quality (~0.92 in
 *     Blink), so every rig-and-export round trip adds another generation of
 *     blocking and ringing artifacts
 *   - `drawImage` into a 2D canvas round-trips through premultiplied alpha, which
 *     quantises the colour of any partially transparent texel and zeroes the colour
 *     of fully transparent ones (dark fringes around cut-out edges)
 *   - a palette PNG comes back out as full RGBA, inflating the file for no gain
 *
 * Keeping the source bytes lets {@link GlbTexturePassthroughService} put the exact
 * original image back into the exported GLB instead of the re-encoded one.
 *
 * A WeakMap is used rather than `texture.userData` because userData is deep-cloned
 * through `JSON.stringify` by both `Texture.copy` and GLTFExporter's extras
 * serialisation, neither of which survives a Uint8Array.
 */
export class TextureSourceRegistry {
  private static readonly sources = new WeakMap<Texture, EncodedTextureSource>()

  public static remember (texture: Texture, source: EncodedTextureSource): void {
    this.sources.set(texture, source)
  }

  public static get (texture: Texture): EncodedTextureSource | undefined {
    return this.sources.get(texture)
  }

  /**
   * Records the source bytes for every texture in a freshly loaded glTF/GLB.
   *
   * Failures are swallowed per texture: a missing source only means that texture
   * falls back to the re-encoded image, which is what happened before this existed.
   */
  public static async capture_from_gltf (gltf: GLTF): Promise<void> {
    const parser = (gltf as unknown as { parser?: GltfParserLike }).parser
    const json = parser?.json

    if (parser?.associations == null || !Array.isArray(json?.images) || !Array.isArray(json?.textures)) {
      return
    }

    const pending: Array<Promise<void>> = []

    parser.associations.forEach((mapping, key) => {
      const texture = key as Texture
      if (texture?.isTexture !== true || typeof mapping?.textures !== 'number') {
        return
      }

      const image_index = this.source_index_for_texture(json.textures?.[mapping.textures])
      if (image_index === undefined) {
        return
      }

      pending.push(this.capture_single_image(parser, json.images?.[image_index], texture))
    })

    await Promise.all(pending)
  }

  /**
   * glTF stores webp images behind EXT_texture_webp rather than the plain
   * `source` property, so both spellings have to be checked.
   */
  private static source_index_for_texture (texture_def: GltfTextureDef | undefined): number | undefined {
    if (typeof texture_def?.source === 'number') {
      return texture_def.source
    }

    const webp_source = texture_def?.extensions?.EXT_texture_webp?.source
    return typeof webp_source === 'number' ? webp_source : undefined
  }

  private static async capture_single_image (
    parser: GltfParserLike,
    image_def: GltfImageDef | undefined,
    texture: Texture
  ): Promise<void> {
    if (image_def == null) {
      return
    }

    try {
      const bytes = await this.read_image_bytes(parser, image_def)
      const mime_type: string | null = image_def.mimeType ?? this.mime_type_from_uri(image_def.uri)

      if (bytes != null && bytes.byteLength > 0 && mime_type != null) {
        this.remember(texture, { bytes, mime_type })
      }
    } catch (error) {
      console.warn('Could not keep the original bytes for a texture, it will be re-encoded on export:', error)
    }
  }

  private static async read_image_bytes (parser: GltfParserLike, image_def: GltfImageDef): Promise<Uint8Array | null> {
    if (typeof image_def.bufferView === 'number') {
      return new Uint8Array(await parser.getDependency('bufferView', image_def.bufferView))
    }

    if (typeof image_def.uri !== 'string') {
      return null
    }

    // Resolving through the LoadingManager applies the same URL modifier the ZIP
    // loader installs, so images that live inside an uploaded archive resolve to
    // their in-memory blob instead of a 404.
    const resolved_url = parser.options?.manager?.resolveURL?.(image_def.uri) ?? image_def.uri
    const response = await fetch(resolved_url)
    return new Uint8Array(await response.arrayBuffer())
  }

  private static mime_type_from_uri (uri: string | undefined): string | null {
    if (uri === undefined) {
      return null
    }

    const data_uri_match = /^data:(image\/[^;,]+)/i.exec(uri)
    if (data_uri_match != null) {
      return data_uri_match[1].toLowerCase()
    }

    const extension = /\.(png|jpe?g|webp)(?:[?#]|$)/i.exec(uri)?.[1].toLowerCase()
    if (extension === undefined) {
      return null
    }

    return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`
  }
}
