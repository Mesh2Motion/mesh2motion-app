import { type Euler } from 'three'

export interface PropMountOffset {
  // meters for a rig at skeleton scale 1.0, along the hand bone toward the fingers
  along_hand: number
  // meters for a rig at skeleton scale 1.0, along world down in the bind pose
  below_palm: number
  // applied after the prop's +Y is aligned with the grip axis (world forward)
  rotation: Euler
}
