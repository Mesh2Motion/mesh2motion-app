export interface RigAnimation {
  name: string // clip name inside the GLB, e.g. 'Walk'
  file: string // GLB file path relative to the static root, e.g. 'assets/human/animations/walk.glb'
  tags: string[]
  loop: boolean
  root_motion: boolean
  frame_count: number
  duration: number // seconds
}
