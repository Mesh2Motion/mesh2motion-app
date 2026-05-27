import { EventDispatcher, type Object3DEventMap, type Group } from 'three'
import { FBXLoader } from '../../../lib/io/FBXLoader'
import { ModalDialog } from '../../ModalDialog'

export interface FBXResults {
  fbx_scene: Group<Object3DEventMap>
  is_missing_dependencies: boolean
}

export class CustomFBXLoader extends EventDispatcher {
  private readonly loader: FBXLoader

  constructor () {
    super()
    this.loader = new FBXLoader()
  }

  public async loadFBX (url: string): Promise<FBXResults> {
    return await new Promise<FBXResults>((resolve, reject) => {
      let has_finished_loading_fbx = false
      let has_finished_loading_all_dependencies = false
      let is_missing_dependencies = false
      let loaded_fbx: Group

      const check_if_complete = (): void => {
        const is_complete = has_finished_loading_fbx && has_finished_loading_all_dependencies
        if (is_complete) {
          const fbx_results: FBXResults = {
            fbx_scene: loaded_fbx,
            is_missing_dependencies
          } satisfies FBXResults
          resolve(fbx_results)
        }
      }

      // check for errors while loading dependencies like images
      this.loader.manager.itemError = (url: string) => {
        is_missing_dependencies = true
        new ModalDialog(
          'Error loading resource associated with FBX.',
          `The material will be replaced with a basic material for now. You will need to update this outside the application: ${url
            .split('/')
            .pop()}`
        ).show()
      }

      this.loader.load(url, (fbx) => {
        // FBX files are often in centimeters, scale down to meters
        // scale down to normalize to 1 unit = 1 meter
        loaded_fbx = fbx
        has_finished_loading_fbx = true
        check_if_complete()
      },
      undefined, // onProgress callback
      (error) => {
        reject(error)
      }
      )

      // check for image loading errors
      this.loader.manager.onLoad = () => {
        has_finished_loading_all_dependencies = true
        check_if_complete()
      }
    })
  }
}
