import { describe, it, expect } from 'vitest'
import { BoneCategoryMapper } from './BoneCategoryMapper'
import { BoneCategory, type BoneMetadata, BoneSide } from './BoneAutoMapper'

/**
 * Helper function to create test bone metadata
 */
function create_bone_metadata (
  name: string,
  normalized_name: string,
  side: BoneSide = BoneSide.Center,
  category: BoneCategory = BoneCategory.Torso
): BoneMetadata {
  return { name, normalized_name, side, category }
}

describe('BoneCategoryMapper', () => {
  describe('map_torso_bones', () => {
    it('should map exact matching bone names', () => {
      const source_bones: BoneMetadata[] = [
        create_bone_metadata('Spine', 'spine', BoneSide.Center, BoneCategory.Torso),
        create_bone_metadata('Chest', 'chest', BoneSide.Center, BoneCategory.Torso),
        create_bone_metadata('Neck', 'neck', BoneSide.Center, BoneCategory.Torso)
      ]

      const target_bones: BoneMetadata[] = [
        create_bone_metadata('Spine', 'spine', BoneSide.Center, BoneCategory.Torso),
        create_bone_metadata('Chest', 'chest', BoneSide.Center, BoneCategory.Torso)
      ]

      const mappings = BoneCategoryMapper.map_torso_bones(source_bones, target_bones)

      expect(mappings.size).toBe(2)
      expect(mappings.get('Spine')).toBe('Spine')
      expect(mappings.get('Chest')).toBe('Chest')
    })
  })

  describe('map_arm_bones', () => {
    it('should map exact matching arm bone names', () => {
      const source_bones: BoneMetadata[] = [
        create_bone_metadata('LeftShoulder', 'leftshoulder', BoneSide.Left, BoneCategory.Arms),
        create_bone_metadata('LeftUpperArm', 'leftupperarm', BoneSide.Left, BoneCategory.Arms),
        create_bone_metadata('RightShoulder', 'rightshoulder', BoneSide.Right, BoneCategory.Arms)
      ]

      const target_bones: BoneMetadata[] = [
        create_bone_metadata('LeftShoulder', 'leftshoulder', BoneSide.Left, BoneCategory.Arms),
        create_bone_metadata('RightShoulder', 'rightshoulder', BoneSide.Right, BoneCategory.Arms)
      ]

      const mappings = BoneCategoryMapper.map_arm_bones(source_bones, target_bones)

      expect(mappings.size).toBe(2)
      expect(mappings.get('LeftShoulder')).toBe('LeftShoulder')
      expect(mappings.get('RightShoulder')).toBe('RightShoulder')
    })
  })

  describe('map_hand_bones', () => {
    it('should map exact matching hand bone names', () => {
      const source_bones: BoneMetadata[] = [
        create_bone_metadata('LeftHand', 'lefthand', BoneSide.Left, BoneCategory.Hands),
        create_bone_metadata('LeftThumb', 'leftthumb', BoneSide.Left, BoneCategory.Hands),
        create_bone_metadata('LeftIndex', 'leftindex', BoneSide.Left, BoneCategory.Hands)
      ]

      const target_bones: BoneMetadata[] = [
        create_bone_metadata('LeftHand', 'lefthand', BoneSide.Left, BoneCategory.Hands),
        create_bone_metadata('LeftThumb', 'leftthumb', BoneSide.Left, BoneCategory.Hands)
      ]

      const mappings = BoneCategoryMapper.map_hand_bones(source_bones, target_bones)

      expect(mappings.size).toBe(2)
      expect(mappings.get('LeftHand')).toBe('LeftHand')
      expect(mappings.get('LeftThumb')).toBe('LeftThumb')
    })
  })

  describe('map_leg_bones', () => {
    it('should map exact matching leg bone names', () => {
      const source_bones: BoneMetadata[] = [
        create_bone_metadata('LeftThigh', 'leftthigh', BoneSide.Left, BoneCategory.Legs),
        create_bone_metadata('LeftKnee', 'leftknee', BoneSide.Left, BoneCategory.Legs),
        create_bone_metadata('RightThigh', 'rightthigh', BoneSide.Right, BoneCategory.Legs)
      ]

      const target_bones: BoneMetadata[] = [
        create_bone_metadata('LeftThigh', 'leftthigh', BoneSide.Left, BoneCategory.Legs),
        create_bone_metadata('RightThigh', 'rightthigh', BoneSide.Right, BoneCategory.Legs)
      ]

      const mappings = BoneCategoryMapper.map_leg_bones(source_bones, target_bones)

      expect(mappings.size).toBe(2)
      expect(mappings.get('LeftThigh')).toBe('LeftThigh')
      expect(mappings.get('RightThigh')).toBe('RightThigh')
    })
  })

  describe('map_wing_bones', () => {
    it('should map exact matching wing bone names', () => {
      const source_bones: BoneMetadata[] = [
        create_bone_metadata('LeftWing1', 'leftwing1', BoneSide.Left, BoneCategory.Wings),
        create_bone_metadata('LeftWing2', 'leftwing2', BoneSide.Left, BoneCategory.Wings),
        create_bone_metadata('RightWing1', 'rightwing1', BoneSide.Right, BoneCategory.Wings)
      ]

      const target_bones: BoneMetadata[] = [
        create_bone_metadata('LeftWing1', 'leftwing1', BoneSide.Left, BoneCategory.Wings),
        create_bone_metadata('RightWing1', 'rightwing1', BoneSide.Right, BoneCategory.Wings)
      ]

      const mappings = BoneCategoryMapper.map_wing_bones(source_bones, target_bones)

      expect(mappings.size).toBe(2)
      expect(mappings.get('LeftWing1')).toBe('LeftWing1')
      expect(mappings.get('RightWing1')).toBe('RightWing1')
    })
  })

  describe('map_tail_bones', () => {
    it('should map exact matching tail bone names', () => {
      const source_bones: BoneMetadata[] = [
        create_bone_metadata('Tail1', 'tail1', BoneSide.Center, BoneCategory.Tail),
        create_bone_metadata('Tail2', 'tail2', BoneSide.Center, BoneCategory.Tail),
        create_bone_metadata('Tail3', 'tail3', BoneSide.Center, BoneCategory.Tail)
      ]

      const target_bones: BoneMetadata[] = [
        create_bone_metadata('Tail1', 'tail1', BoneSide.Center, BoneCategory.Tail),
        create_bone_metadata('Tail2', 'tail2', BoneSide.Center, BoneCategory.Tail)
      ]

      const mappings = BoneCategoryMapper.map_tail_bones(source_bones, target_bones)

      expect(mappings.size).toBe(2)
      expect(mappings.get('Tail1')).toBe('Tail1')
      expect(mappings.get('Tail2')).toBe('Tail2')
    })
  })

  describe('map_unknown_bones', () => {
    it('should handle empty unknown bones', () => {
      const source_bones: BoneMetadata[] = []
      const target_bones: BoneMetadata[] = []

      const mappings = BoneCategoryMapper.map_unknown_bones(source_bones, target_bones)

      expect(mappings.size).toBe(0)
    })
  })
})
