import { type BoneSide } from '../BoneTypes'

/**
 * BoneNameTokenizer - turns a raw bone name from any rig into structured tokens.
 *
 * The old normalize_bone_name() worked on the raw string with substring/suffix
 * regexes, which is what made "shoulder" end in "r" (detected as right side) and
 * "tail" end in "l" (detected as left, and stripped down to "tai"). Splitting the
 * name into whole word tokens first removes that entire class of bug: a side
 * marker only counts when it stands alone as a token.
 *
 * This module stays purely mechanical - it splits and cleans names but knows
 * nothing about anatomy. All synonym knowledge lives in BoneSlotVocabulary.
 *
 * Pure functions, no three.js - directly unit testable.
 */

export interface ParsedBoneName {
  tokens: string[] // canonical lowercase word tokens, prefixes and side/index removed
  side: BoneSide // Unknown when the name carried no side marker
  index: number | null // numeric segment index found in the name, null if absent
  is_leaf: boolean // name carried an end/tip/leaf/nub marker
}
