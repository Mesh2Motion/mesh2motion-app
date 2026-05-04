import { type BoneMetadata } from './BoneAutoMapper'

/**
 * RigifyMapper - Direct bone name mapping for Blender Rigify rigs
 * Source: Mesh2Motion skeleton
 * Target: Rigify deform bones (DEF- prefix)
 */
export class RigifyMapper {
  // Mesh2Motion bone name -> Rigify deform bone name
  private static readonly BONE_MAP: Record<string, string> = {
    // Torso
    pelvis: 'DEF-spine',
    spine_01: 'DEF-spine.001',
    spine_02: 'DEF-spine.002',
    spine_03: 'DEF-spine.003',
    neck_01: 'DEF-spine.004',
    head: 'DEF-spine.006',

    // Left Arm
    clavicle_l: 'DEF-shoulder.L',
    upperarm_l: 'DEF-upper_arm.L',
    lowerarm_l: 'DEF-forearm.L',
    hand_l: 'DEF-hand.L',

    // Right Arm
    clavicle_r: 'DEF-shoulder.R',
    upperarm_r: 'DEF-upper_arm.R',
    lowerarm_r: 'DEF-forearm.R',
    hand_r: 'DEF-hand.R',

    // Left Leg
    thigh_l: 'DEF-thigh.L',
    calf_l: 'DEF-shin.L',
    foot_l: 'DEF-foot.L',
    ball_l: 'DEF-toe.L',

    // Right Leg
    thigh_r: 'DEF-thigh.R',
    calf_r: 'DEF-shin.R',
    foot_r: 'DEF-foot.R',
    ball_r: 'DEF-toe.R',

    // Left Hand Fingers
    thumb_01_l: 'DEF-thumb.01.L',
    thumb_02_l: 'DEF-thumb.02.L',
    thumb_03_l: 'DEF-thumb.03.L',
    index_01_l: 'DEF-f_index.01.L',
    index_02_l: 'DEF-f_index.02.L',
    index_03_l: 'DEF-f_index.03.L',
    middle_01_l: 'DEF-f_middle.01.L',
    middle_02_l: 'DEF-f_middle.02.L',
    middle_03_l: 'DEF-f_middle.03.L',
    ring_01_l: 'DEF-f_ring.01.L',
    ring_02_l: 'DEF-f_ring.02.L',
    ring_03_l: 'DEF-f_ring.03.L',
    pinky_01_l: 'DEF-f_pinky.01.L',
    pinky_02_l: 'DEF-f_pinky.02.L',
    pinky_03_l: 'DEF-f_pinky.03.L',

    // Right Hand Fingers
    thumb_01_r: 'DEF-thumb.01.R',
    thumb_02_r: 'DEF-thumb.02.R',
    thumb_03_r: 'DEF-thumb.03.R',
    index_01_r: 'DEF-f_index.01.R',
    index_02_r: 'DEF-f_index.02.R',
    index_03_r: 'DEF-f_index.03.R',
    middle_01_r: 'DEF-f_middle.01.R',
    middle_02_r: 'DEF-f_middle.02.R',
    middle_03_r: 'DEF-f_middle.03.R',
    ring_01_r: 'DEF-f_ring.01.R',
    ring_02_r: 'DEF-f_ring.02.R',
    ring_03_r: 'DEF-f_ring.03.R',
    pinky_01_r: 'DEF-f_pinky.01.R',
    pinky_02_r: 'DEF-f_pinky.02.R',
    pinky_03_r: 'DEF-f_pinky.03.R'
  }

  // True if any bone name starts with "DEF-" (Rigify deform prefix)
  static is_target_valid_skeleton (bone_names: string[]): boolean {
    return bone_names.some(name => /^def-/i.test(name))
  }

  /**
   * Normalize a Rigify bone name for tolerant matching.
   * Different exporters strip or keep dots/underscores (e.g. Blender's GLTF exporter
   * turns "DEF-spine.001" into "DEF-spine001", "DEF-upper_arm.L" into "DEF-upper_armL").
   * Lowercase + strip dots/underscores/hyphens so all variants compare equal.
   */
  private static loose_key (name: string): string {
    return name.toLowerCase().replace(/[._\-]/g, '')
  }

  static map_rigify_bones (source_bones: BoneMetadata[], target_bones: BoneMetadata[]): Map<string, string> {
    const mappings = new Map<string, string>()

    // Build a loose-keyed lookup of target bones (first match wins on collisions)
    const target_by_loose_key = new Map<string, BoneMetadata>()
    for (const tb of target_bones) {
      const key = RigifyMapper.loose_key(tb.name)
      if (!target_by_loose_key.has(key)) {
        target_by_loose_key.set(key, tb)
      }
    }

    for (const source_bone of source_bones) {
      const expected_target_name: string | undefined = this.BONE_MAP[source_bone.name]
      if (expected_target_name === undefined) continue

      const target_bone = target_by_loose_key.get(RigifyMapper.loose_key(expected_target_name))
      if (target_bone !== undefined) {
        mappings.set(target_bone.name, source_bone.name)
      }
    }

    console.log(`Rigify mapping complete: ${mappings.size} bones mapped`)
    return mappings
  }
}
