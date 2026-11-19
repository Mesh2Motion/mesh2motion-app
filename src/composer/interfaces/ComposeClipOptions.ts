import { type AnimationClip } from 'three'
import { type UprightUpperBodyRig } from './UprightUpperBodyRig'

export interface ComposeClipOptions {
  upper_clip: AnimationClip
  lower_clip: AnimationClip
  // bones driven by the upper clip. every other bone is driven by the lower clip
  upper_body_bone_names: Set<string>
  // frames per second the combined clip is baked at
  fps: number
  name: string
  // when set, the upper body keeps the orientation it had in the upper clip instead of following the lower clip's hips
  upright_upper_body?: UprightUpperBodyRig
}
