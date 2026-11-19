import { type Group, type Object3DEventMap } from 'three'

export interface FBXResults {
  fbx_scene: Group<Object3DEventMap>
  is_missing_dependencies: boolean
}
