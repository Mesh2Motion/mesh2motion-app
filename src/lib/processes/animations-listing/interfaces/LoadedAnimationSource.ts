import { type AnimationClip, type Object3D } from 'three'

export interface LoadedAnimationSource {
  animations: AnimationClip[]
  // scene the animations came with. Holds the rig they were authored on
  scene: Object3D
}
