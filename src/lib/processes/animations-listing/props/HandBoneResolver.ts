import { type Bone, type Skeleton } from 'three'
import { PropSide } from './PropSide.ts'

export class HandBoneResolver {
  private static readonly exact_names: Record<PropSide, string[]> = {
    [PropSide.Left]: ['hand_l', 'Hand_L', 'DEF-hand.L', 'mixamorigLeftHand', 'LeftHand', 'Hand.L', 'hand.L'],
    [PropSide.Right]: ['hand_r', 'Hand_R', 'DEF-hand.R', 'mixamorigRightHand', 'RightHand', 'Hand.R', 'hand.R']
  }

  private static readonly excluded_keywords: string[] = [
    'finger', 'thumb', 'index', 'middle', 'ring', 'pinky', 'twist', 'ik', 'end'
  ]

  public static resolve (skeleton: Skeleton, side: PropSide): Bone | null {
    return this.resolve_from_bones(skeleton.bones, side)
  }

  public static resolve_from_bones (all_bones: Bone[], side: PropSide): Bone | null {
    const bones = all_bones.filter((bone) => bone !== undefined && bone !== null)

    for (const exact_name of this.exact_names[side]) {
      const exact_match = bones.find((bone) => bone.name === exact_name)
      if (exact_match !== undefined) {
        return exact_match
      }
    }

    const fallback_match = bones.find((bone) => {
      const lower_name = bone.name.toLowerCase()
      if (!lower_name.includes('hand')) {
        return false
      }

      if (this.excluded_keywords.some((keyword) => lower_name.includes(keyword))) {
        return false
      }

      return this.name_has_side(bone.name, side)
    })

    return fallback_match ?? null
  }

  private static name_has_side (bone_name: string, side: PropSide): boolean {
    const side_letter = side === PropSide.Left ? 'l' : 'r'
    const side_word = side === PropSide.Left ? 'left' : 'right'
    const side_letter_pattern = new RegExp(`(^|[_.\\-\\s])${side_letter}($|[_.\\-\\s])`, 'i')

    return bone_name.toLowerCase().includes(side_word) || side_letter_pattern.test(bone_name)
  }
}
