// Supported skeleton types
// the file names for the skeleton types are associated with the const
export enum SkeletonType {
  Quadraped = 'rigs/rig-fox.glb',
  Human = 'rigs/rig-human.glb',
  Bird = 'rigs/rig-bird.glb',
  Dragon = 'rigs/rig-dragon.glb',
  Kaiju = 'rigs/rig-kaiju.glb',
  Custom = 'CUSTOM',
  Error = 'ERROR',
  None = 'NONE'
}

// Hand skeleton variation types for human skeleton
export enum HandSkeletonType {
  AllFingers = 'all-fingers',
  ThumbAndIndex = 'thumb-and-index',
  SimplifiedHand = 'simplified-hand',
  SingleBone = 'single-bone'
}
