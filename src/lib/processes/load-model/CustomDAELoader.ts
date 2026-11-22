import JSZip from 'jszip'
import { EventDispatcher, type Object3D } from 'three'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { ModalDialog } from '../../ModalDialog'

/**
 * Loads a DAE (with textures) from a ZIP file buffer, using in-memory URLs for all assets.
 * Usage: new CustomDAELoader(colladaLoaderInstance).loadFromZip(zipBuffer, (scene) => { ... })
 */
export class CustomDAELoader extends EventDispatcher {
  private readonly loader: ColladaLoader

  constructor (loader: ColladaLoader) {
    super()
    this.loader = loader
  }

  /**
   * Main entry: Loads a DAE (with textures) from a ZIP file buffer, using in-memory URLs for all assets.
   */
  public async load_from_zip (
    zip_data: ArrayBuffer,
    onLoad: (scene: Object3D) => void,
    onError?: (err: unknown) => void
  ): Promise<void> {
    try {
      // 1. Load and scan the ZIP for DAE file
      const zip_file: JSZip = await JSZip.loadAsync(zip_data)
      const dae_file = this.find_dae_file(zip_file)
      if (!dae_file) throw new Error('No DAE file found in ZIP')

      // 2. Build a map of all relevant files (textures, dae) by filename
      const file_map: Record<string, Uint8Array> = await this.build_file_map(zip_file)

      // 3. Patch loader to use in-memory blobs for all referenced files
      this.loader.manager.setURLModifier(this.make_url_modifier(file_map))

      // Add error listener for texture/resource loading
      this.loader.manager.itemError = (url: string) => {
        new ModalDialog('Could not find file in ZIP', `${this.get_last_segment_of_url(url)}`).show()
      }

      // 4. Load the DAE from the in-memory XML blob
      const dae_text = await dae_file.async('text')
      const dae_blob = new Blob([dae_text], { type: 'model/vnd.collada+xml' })
      const dae_url = URL.createObjectURL(dae_blob)

      this.loader.load(
        dae_url,
        (collada) => {
          if (collada === null) {
            if (onError !== undefined) {
              onError(new Error('DAE loader returned no scene'))
            }
            return
          }
          const loaded_scene = collada.scene

          console.log('DAE model loaded from ZIP:', loaded_scene)
 
          onLoad(loaded_scene)
          URL.revokeObjectURL(dae_url)
        },
        undefined,
        (err) => {
          if (onError != null) {
            onError(err)
          }
        }
      )
    } catch (err) {
      if (onError != null) {
        onError(err)
      }
    }
    // cleanup error handler
    this.loader.manager.onError = () => {}
  }

  /**
   * Scans the ZIP for .dae file and returns its file object.
   */
  private find_dae_file (zip: JSZip): JSZip.JSZipObject | null {
    let dae_file: JSZip.JSZipObject | null = null
    zip.forEach((relativePath, file) => {
      if (relativePath.toLowerCase().endsWith('.dae')) {
        dae_file = file
      }
    })
    return dae_file
  }

  /**
   * Builds a map of all relevant files (textures, dae) by filename (case-insensitive, handles spaces).
   */
  private async build_file_map (zip: JSZip): Promise<Record<string, Uint8Array>> {
    const fileMap: Record<string, Uint8Array> = {}
    const filePromises = Object.keys(zip.files).map(async (filename) => {
      const file = zip.files[filename]
      if (!file.dir) {
        const nameOnly = filename.split('/').pop() ?? filename
        if (/\.(dae|png|jpg|jpeg|webp)$/i.test(nameOnly)) {
          const buffer = new Uint8Array(await file.async('arraybuffer'))
          fileMap[nameOnly] = buffer
          fileMap[nameOnly.toLowerCase()] = buffer
          try {
            const decoded = decodeURIComponent(nameOnly)
            fileMap[decoded] = buffer
            fileMap[decoded.toLowerCase()] = buffer
          } catch {
            // Keep the original name when a ZIP entry contains malformed percent escapes.
          }
        }
      }
    })
    await Promise.all(filePromises)
    return fileMap
  }

  /**
   * Returns a URL modifier function for the loader, serving in-memory blobs for referenced files.
   */
  private make_url_modifier (file_map: Record<string, Uint8Array>): (url: string) => string {
    return (url: string) => {
      const clean_url = url.split(/[?#]/)[0]
      const name_only: string = clean_url.split('/').pop() ?? clean_url
      let buffer: Uint8Array | undefined = file_map[name_only]
      if (!buffer) buffer = file_map[name_only.toLowerCase()]
      if (!buffer) {
        try {
          const decoded = decodeURIComponent(name_only)
          buffer = file_map[decoded] || file_map[decoded.toLowerCase()]
        } catch {
          // Keep the original path when a URL contains malformed percent escapes.
        }
      }
      if (buffer) {
        let mime = 'application/octet-stream'
        if (/\.png$/i.test(name_only)) mime = 'image/png'
        else if (/\.jpe?g$/i.test(name_only)) mime = 'image/jpeg'
        else if (/\.webp$/i.test(name_only)) mime = 'image/webp'
        else if (/\.dae$/i.test(name_only)) mime = 'model/vnd.collada+xml'
        const blob = new Blob([new Uint8Array(buffer).buffer as ArrayBuffer], { type: mime })
        return URL.createObjectURL(blob)
      }
      return url
    }
  }

  /**
   * Gets the last segment of a URL path.
   */
  private get_last_segment_of_url (path: string): string {
    const segments = path.split('/')
    return segments[segments.length - 1]
  }
}
