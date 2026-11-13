import { RetargetUtils } from '../RetargetUtils.ts'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class HumanChainConfig {
  // Master list of human bone/joint names that we can use and part of the Mesh2Motion rig
  // this will always be the source config we start with for retargeting
  public static readonly mesh2motion_config: Record<string, string[]> = {
    pelvis: ['pelvis'],
    spine: ['spine_01', 'spine_02', 'spine_03'],
    head: ['neck_01', 'head'],
    armL: ['clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l'],
    armR: ['clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r'],
    legL: ['thigh_l', 'calf_l', 'foot_l'],
    legR: ['thigh_r', 'calf_r', 'foot_r'],
    fingersThumbL: ['thumb_01_l', 'thumb_02_l', 'thumb_03_l', 'thumb_04_leaf_l'],
    fingersThumbR: ['thumb_01_r', 'thumb_02_r', 'thumb_03_r', 'thumb_04_leaf_r'],
    fingersIndexL: ['index_01_l', 'index_02_l', 'index_03_l', 'index_04_leaf_l'],
    fingersIndexR: ['index_01_r', 'index_02_r', 'index_03_r', 'index_04_leaf_r'],
    fingersMiddleL: ['middle_01_l', 'middle_02_l', 'middle_03_l', 'middle_04_leaf_l'],
    fingersMiddleR: ['middle_01_r', 'middle_02_r', 'middle_03_r', 'middle_04_leaf_r'],
    fingersRingL: ['ring_01_l', 'ring_02_l', 'ring_03_l', 'ring_04_leaf_l'],
    fingersRingR: ['ring_01_r', 'ring_02_r', 'ring_03_r', 'ring_04_leaf_r'],
    fingersPinkyL: ['pinky_01_l', 'pinky_02_l', 'pinky_03_l', 'pinky_04_leaf_l'],
    fingersPinkyR: ['pinky_01_r', 'pinky_02_r', 'pinky_03_r', 'pinky_04_leaf_r']
  }

  public static readonly mixamo_config: Record<string, string[]> = {
    pelvis: ['mixamorigHips'],
    spine: ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2'],
    head: ['mixamorigNeck', 'mixamorigHead'],
    armL: ['mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand'],
    armR: ['mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand'],
    legL: ['mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot'],
    legR: ['mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot'],
    fingersThumbL: ['mixamorigLeftHandThumb1', 'mixamorigLeftHandThumb2', 'mixamorigLeftHandThumb3', 'mixamorigLeftHandThumb4'],
    fingersThumbR: ['mixamorigRightHandThumb1', 'mixamorigRightHandThumb2', 'mixamorigRightHandThumb3', 'mixamorigRightHandThumb4'],
    fingersIndexL: ['mixamorigLeftHandIndex1', 'mixamorigLeftHandIndex2', 'mixamorigLeftHandIndex3', 'mixamorigLeftHandIndex4'],
    fingersIndexR: ['mixamorigRightHandIndex1', 'mixamorigRightHandIndex2', 'mixamorigRightHandIndex3', 'mixamorigRightHandIndex4'],
    fingersMiddleL: ['mixamorigLeftHandMiddle1', 'mixamorigLeftHandMiddle2', 'mixamorigLeftHandMiddle3', 'mixamorigLeftHandMiddle4'],
    fingersMiddleR: ['mixamorigRightHandMiddle1', 'mixamorigRightHandMiddle2', 'mixamorigRightHandMiddle3', 'mixamorigRightHandMiddle4'],
    fingersRingL: ['mixamorigLeftHandRing1', 'mixamorigLeftHandRing2', 'mixamorigLeftHandRing3', 'mixamorigLeftHandRing4'],
    fingersRingR: ['mixamorigRightHandRing1', 'mixamorigRightHandRing2', 'mixamorigRightHandRing3', 'mixamorigRightHandRing4'],
    fingersPinkyL: ['mixamorigLeftHandPinky1', 'mixamorigLeftHandPinky2', 'mixamorigLeftHandPinky3', 'mixamorigLeftHandPinky4'],
    fingersPinkyR: ['mixamorigRightHandPinky1', 'mixamorigRightHandPinky2', 'mixamorigRightHandPinky3', 'mixamorigRightHandPinky4']
  }

  // then we can duplicate that source config to a target config. We can go through the bone
  // mapping and swap out all the source bone names for the target bone names

  /**
   * Build the chain configs for both sides of a bone mapping. The mapping is direction
   * neutral, so the caller decides which config drives the animation and which receives it:
   * the retarget page plays Mesh2Motion animations onto the other rig, while importing
   * animations in the main app goes the other way.
   * @param bone_mapping - other rig bone name -> Mesh2Motion bone name
   */
  public static build_mapped_chain_configs (bone_mapping: Map<string, string>): {
    mesh2motion_config: Record<string, string[]>
    other_rig_config: Record<string, string[]>
  } {
    const mesh2motion_config = HumanChainConfig.build_custom_source_config(bone_mapping)
    const other_rig_config = HumanChainConfig.build_custom_target_config(mesh2motion_config, bone_mapping)
    return { mesh2motion_config, other_rig_config }
  }

  public static build_custom_source_config (bone_mapping: Map<string, string>): Record<string, string[]> {
    // we will bring in the bones that are mapped
    const base_source_config = structuredClone(HumanChainConfig.mesh2motion_config)

    // values store the Mesh2Motion bones. A Set keeps 'head' from matching 'head_leaf'
    const mapped_source_bone_names = new Set<string>(bone_mapping.values())

    for (const chain_name in base_source_config) {
      const bone_names_in_chain = base_source_config[chain_name]
      for (let i = 0; i < bone_names_in_chain.length; i++) {
        const bone_name = bone_names_in_chain[i]
        if (!mapped_source_bone_names.has(bone_name)) {
          // no mapping for this bone, so we will replace it with an empty string
          bone_names_in_chain[i] = ''
        }
      }
    }

    console.log('Custom Source Config has been CREATED!!!:', base_source_config)

    return base_source_config
  }

  public static build_custom_target_config (source_config: Record<string, string[]>, bone_mapping: Map<string, string>): Record<string, string[]> {
    // swap key/value so source (Mesh2Motion) bone names can resolve to target rig names
    const reverse_bone_mapping = RetargetUtils.reverse_bone_mapping_one_to_one(bone_mapping)

    // our source config will only have the bones that need to be mapped. Non-mapped bones will be empty strings
    const custom_target_config: Record<string, string[]> = structuredClone(source_config)

    // we can go through each chain and bone in the source config. If there is no bone mapping done, we want to replace it with an empty string
    // we will have to later update the retargeting algorithm to handle bones that are effectively skipped
    for (const chain_name in custom_target_config) {
      const bone_names = custom_target_config[chain_name]
      for (let i = 0; i < bone_names.length; i++) {
        const source_bone_name = bone_names[i]

        if (source_bone_name === '') { continue } // no source bone name, so skip it

        // update bone with mapped target bone name
        const target_bone_name = reverse_bone_mapping.get(source_bone_name)
        if (target_bone_name !== undefined) {
          bone_names[i] = target_bone_name
        } else {
          console.warn('No target bone mapping found for source bone. This should NOT happen:', source_bone_name)
          bone_names[i] = ''
        }
      }
    }

    console.log('Custom Target Config has been CREATED!!!:', custom_target_config)
    return custom_target_config
  }
}
