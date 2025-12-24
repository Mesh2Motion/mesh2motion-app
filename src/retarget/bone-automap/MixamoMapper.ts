import { type BoneMetadata } from './BoneAutoMapper'

/**
 * MixamoMapper - Direct bone name mapping for Mixamo rigs
 * Source: Mesh2Motion skeleton (hardcoded names)
 * Target: Mixamo skeleton (mixamorig: prefix)
 */
export class MixamoMapper {
  /**
   * Direct mapping: Mesh2Motion bone name -> Mixamo bone name
   */
  private static readonly BONE_MAP: Record<string, string> = {
    // Torso
    'DEF-hips': 'mixamorigHips',
    'DEF-spine001': 'mixamorigSpine',
    'DEF-spine002': 'mixamorigSpine1',
    'DEF-spine003': 'mixamorigSpine2',
    'DEF-neck': 'mixamorigNeck',
    'DEF-head': 'mixamorigHead',
    'DEF-headtip': 'mixamorigHeadTop_End',

    // Left Arm
    'DEF-shoulderL': 'mixamorigLeftShoulder',
    'DEF-upper_armL': 'mixamorigLeftArm',
    'DEF-forearmL': 'mixamorigLeftForeArm',
    'DEF-handL': 'mixamorigLeftHand',

    // Right Arm
    'DEF-shoulderR': 'mixamorigRightShoulder',
    'DEF-upper_armR': 'mixamorigRightArm',
    'DEF-forearmR': 'mixamorigRightForeArm',
    'DEF-handR': 'mixamorigRightHand',

    // Left Leg
    'DEF-thighL': 'mixamorigLeftUpLeg',
    'DEF-shinL': 'mixamorigLeftLeg',
    'DEF-footL': 'mixamorigLeftFoot',
    'DEF-toeL': 'mixamorigLeftToeBase',
    'DEF-toe_tipL': 'mixamorigLeftToe_End',

    // Right Leg
    'DEF-thighR': 'mixamorigRightUpLeg',
    'DEF-shinR': 'mixamorigRightLeg',
    'DEF-footR': 'mixamorigRightFoot',
    'DEF-toeR': 'mixamorigRightToeBase',
    'DEF-toe_tipR': 'mixamorigRightToe_End',

    // Left Hand Fingers - Thumb
    'DEF-thumb01L': 'mixamorigLeftHandThumb1',
    'DEF-thumb02L': 'mixamorigLeftHandThumb2',
    'DEF-thumb03L': 'mixamorigLeftHandThumb3',
    'DEF-thumb_04_tipL': 'mixamorigLeftHandThumb4',

    // Left Hand Fingers - Index
    'DEF-f_index01L': 'mixamorigLeftHandIndex1',
    'DEF-f_index02L': 'mixamorigLeftHandIndex2',
    'DEF-f_index03L': 'mixamorigLeftHandIndex3',
    'DEF-f_index04_tipL': 'mixamorigLeftHandIndex4',

    // Left Hand Fingers - Middle
    'DEF-f_middle01L': 'mixamorigLeftHandMiddle1',
    'DEF-f_middle02L': 'mixamorigLeftHandMiddle2',
    'DEF-f_middle03L': 'mixamorigLeftHandMiddle3',
    'DEF-f_middle04_tipL': 'mixamorigLeftHandMiddle4',

    // Left Hand Fingers - Ring
    'DEF-f_ring01L': 'mixamorigLeftHandRing1',
    'DEF-f_ring02L': 'mixamorigLeftHandRing2',
    'DEF-f_ring03L': 'mixamorigLeftHandRing3',
    'DEF-f_ring04_tipL': 'mixamorigLeftHandRing4',

    // Left Hand Fingers - Pinky
    'DEF-f_pinky01L': 'mixamorigLeftHandPinky1',
    'DEF-f_pinky02L': 'mixamorigLeftHandPinky2',
    'DEF-f_pinky03L': 'mixamorigLeftHandPinky3',
    'DEF-f_pinky04_tipL': 'mixamorigLeftHandPinky4',

    // Right Hand Fingers - Thumb
    'DEF-thumb01R': 'mixamorigRightHandThumb1',
    'DEF-thumb02R': 'mixamorigRightHandThumb2',
    'DEF-thumb03R': 'mixamorigRightHandThumb3',
    'DEF-thumb04_tipR': 'mixamorigRightHandThumb4',

    // Right Hand Fingers - Index
    'DEF-f_index01R': 'mixamorigRightHandIndex1',
    'DEF-f_index02R': 'mixamorigRightHandIndex2',
    'DEF-f_index03R': 'mixamorigRightHandIndex3',
    'DEF-f_index04_tipR': 'mixamorigRightHandIndex4',

    // Right Hand Fingers - Middle
    'DEF-f_middle01R': 'mixamorigRightHandMiddle1',
    'DEF-f_middle02R': 'mixamorigRightHandMiddle2',
    'DEF-f_middle03R': 'mixamorigRightHandMiddle3',
    'DEF-f_middle04_tipR': 'mixamorigRightHandMiddle4',

    // Right Hand Fingers - Ring
    'DEF-f_ring01R': 'mixamorigRightHandRing1',
    'DEF-f_ring02R': 'mixamorigRightHandRing2',
    'DEF-f_ring03R': 'mixamorigRightHandRing3',
    'DEF-f_ring04_tipR': 'mixamorigRightHandRing4',

    // Right Hand Fingers - Pinky
    'DEF-f_pinky01R': 'mixamorigRightHandPinky1',
    'DEF-f_pinky02R': 'mixamorigRightHandPinky2',
    'DEF-f_pinky03R': 'mixamorigRightHandPinky3',
    'DEF-f_pinky04_tipR': 'mixamorigRightHandPinky4'
  }

  /**
   * Check if the given skeleton is a Mixamo skeleton
   * @param bones - Bones to check
   * @returns True if any bone name contains "mixamorig"
   */
  static is_target_valid_skeleton (bone_names: string[]): boolean {
    return bone_names.some(name => name.toLowerCase().includes('mixamorig'))
  }

  /**
   * Map Mesh2Motion bones to Mixamo bones
   * @param source_bones - Mesh2Motion skeleton bones
   * @param target_bones - Mixamo skeleton bones
   * @returns Map of target bone name -> source bone name
   */
  static map_mixamo_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    const mappings = new Map<string, string>()

    console.log('=== MIXAMO DIRECT MAPPING ===')

    // For each source bone (Mesh2Motion), find matching target bone (Mixamo)
    for (const source_bone of source_bones) {
      const expected_mixamo_name = this.BONE_MAP[source_bone.name]

      if (expected_mixamo_name) {
        // Find target bone with this Mixamo name
        const target_bone = target_bones.find(tb => tb.name === expected_mixamo_name)

        if (target_bone) {
          mappings.set(target_bone.name, source_bone.name)
          console.log(`Mapped: ${target_bone.name} -> ${source_bone.name}`)
        }
      }
    }

    console.log(`Mixamo mapping complete: ${mappings.size} bones mapped`)
    return mappings
  }
}
