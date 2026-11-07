import { SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RigConfig } from '../lib/RigConfig.ts'
import { Utility } from '../lib/Utilities.ts'
import { ComposerConfig } from './ComposerConfig.ts'

/**
 * Loads the pre-rigged human model that the Composer previews animations on.
 * Model variations are already skinned, so the Composer can skip the load/edit/skin steps.
 */
export class ComposerModelLoader {
  private readonly gltf_loader: GLTFLoader = new GLTFLoader()

  public async load (): Promise<SkinnedMesh[]> {
    const model_file: string = this.model_file_path()
    const gltf = await this.gltf_loader.loadAsync(`${ComposerConfig.static_root_path}${model_file}`)

    const skinned_meshes: SkinnedMesh[] = []
    gltf.scene.traverse((child) => {
      if (child instanceof SkinnedMesh) {
        child.castShadow = true
        child.receiveShadow = true
        skinned_meshes.push(child)
      }
    })

    if (skinned_meshes.length === 0) {
      throw new Error(`No skinned meshes found in ${model_file}`)
    }

    Utility.parent_root_bones_to_skinned_meshes(skinned_meshes)
    return skinned_meshes
  }

  private model_file_path (): string {
    const rig = RigConfig.by_skeleton_type(ComposerConfig.skeleton_type)
    if (rig === undefined) {
      throw new Error(`Rig for ${ComposerConfig.skeleton_type} is not in the asset manifest`)
    }

    const variation = rig.model_variations.find(v => v.name === ComposerConfig.model_variation_name) ??
      rig.model_variations[0]
    if (variation === undefined) {
      throw new Error(`Rig ${rig.rig_display_name} has no rigged model variations`)
    }

    return variation.model_file
  }
}
