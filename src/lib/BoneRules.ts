import { type Bone } from 'three'

/**
 * Shared rules for bones that belong to rig controls rather than the visible
 * deforming skeleton. These bones may be animated internally, but mesh vertices
 * should not be weighted to them and users should not be asked to position them.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class BoneRules {
  static is_non_deforming_control_bone (bone: Bone): boolean {
    return this.is_non_deforming_control_bone_name(bone.name)
  }

  static is_non_deforming_control_bone_name (bone_name: string): boolean {
    const name = bone_name.toLowerCase()

    return name.startsWith('ik') ||
      name.includes('poletarget') ||
      name.startsWith('pole') ||
      /^ff[blr]{0,2}$/.test(name)
  }
}
