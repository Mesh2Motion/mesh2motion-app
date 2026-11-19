import { type Quaternion } from 'three'

export interface BoneRestRotation {
  name: string
  rest_quaternion: Quaternion
}
