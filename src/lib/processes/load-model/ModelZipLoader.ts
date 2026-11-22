import JSZip from 'jszip'

import { CustomGLTFLoader } from './CustomGLTFLoader'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { type Group, type Scene } from 'three'
import { CustomDAELoader } from './CustomDAELoader'
import { type ModelFormat } from './interfaces/ModelFormat'
import { type ZipModelInfo } from './interfaces/ZipModelInfo'

export class ModelZipLoader {
  /**
   * Unzips and analyzes a ZIP file buffer, returning model file info and format.
   * @param buffer - ZIP file as ArrayBuffer
   * @returns ZipModelInfo or throws error if not found
   */
  public async analyzeZip (buffer: ArrayBuffer): Promise<ZipModelInfo> {
    const zip = await JSZip.loadAsync(buffer)
    const file_names = Object.keys(zip.files)
    const model_file = this.findModelFile(file_names)
    if (model_file == null || model_file === '') {
      throw new Error('No supported model file found in ZIP')
    }
    const format = this.detectFormat(model_file)
    const file_data = await zip.files[model_file].async('arraybuffer')
    return { format, fileName: model_file, fileData: file_data }
  }

  /**
   * Loads a model from a ZIP buffer using the appropriate loader and returns the loaded object.
   * @param buffer - ZIP file as ArrayBuffer
   * @returns Promise<Group | Scene> - The loaded model object
   */
  public async loadModelFromZip (buffer: ArrayBuffer): Promise<Group | Scene> {
    const info = await this.analyzeZip(buffer)
    switch (info.format) {
      case 'gltf': {
        const gltf_loader_instance = new GLTFLoader()
        const custom_gltf_loader = new CustomGLTFLoader(gltf_loader_instance)
        // Wrap callback in a Promise to return the loaded scene
        return await new Promise((resolve, reject) => {
          custom_gltf_loader.load_from_zip(
            buffer,
            (scene) => { resolve(scene as Group) },
            (err) => { reject(err) }
          )
        })
      }
      // TODO: OBJ can use this too. They have external texture files
      //   case 'obj': {
      //     console.log('Using OBJ loader since OBJ file detected in ZIP')
      //     const obj_loader = new CustomOBJLoader()
      //     return await obj_loader.load_from_zip(buffer)
      //   }
      case 'dae': {
        console.log('Using DAE loader since DAE file detected in ZIP')
        // use custom dae loader
        const collada_loader_instance = new CustomDAELoader(new ColladaLoader())
        return await new Promise((resolve, reject) => {
          collada_loader_instance.load_from_zip(
            buffer,
            (scene) => { resolve(scene as Group) },
            (err) => { reject(err) }
          )
        })
      }
      default:
        throw new Error('Unsupported model format')
    }
  }

  private findModelFile (file_names: string[]): string | null {
    // Prioritize GLTF, then DAE
    const priorities = [/\.gltf$/i, /\.dae$/i]
    for (const regex of priorities) {
      const found = file_names.find(name => regex.test(name))
      if (found != null && found !== '') return found
    }
    return null
  }

  private detectFormat (file_name: string): ModelFormat {
    if (/\.gltf$/i.test(file_name)) return 'gltf'
    if (/\.dae$/i.test(file_name)) return 'dae'
    // if (/\.obj$/i.test(file_name)) return 'obj'
    return 'unknown'
  }
}
