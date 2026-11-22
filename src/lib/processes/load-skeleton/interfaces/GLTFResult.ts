import { type AnimationClip, type Object3D } from "three"

export default interface GLTFResult {
  scene: Object3D
  scenes: Object3D[]
  animations: AnimationClip[]
  cameras: Object3D[]
  asset: object
}
