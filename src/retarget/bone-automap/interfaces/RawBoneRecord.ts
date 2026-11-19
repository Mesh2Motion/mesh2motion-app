/**
 * BoneChainResolver - builds BoneMetadata from a flat list of (bone, parent) pairs
 * and resolves each bone to a canonical slot.
 *
 * Names alone cannot settle every joint. The two that matter in practice:
 *   - Mixamo calls the clavicle "LeftShoulder" and the upper arm "LeftArm";
 *     DAZ calls the upper arm "lShldr" and the clavicle "lCollar".
 *   - Mixamo calls the calf "LeftLeg"; plenty of rigs call the thigh "leg_l".
 * Both are settled by walking up from the hand and the foot, where the terminal
 * joint is named unambiguously in every rig we care about.
 *
 * Deliberately takes plain records rather than three.js Bones so it can be unit
 * tested with nothing more than a list of names and parents.
 */

export interface RawBoneRecord {
  name: string
  parent_name: string | null
}
