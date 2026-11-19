import { BoneSide } from './BoneTypes'
import { type ParsedBoneName } from './interfaces/ParsedBoneName'

/**
 * Rig namespace prefixes that appear as a single glued-on chunk. Stripped from the
 * raw string before tokenizing, because tokenizing them first would produce junk:
 * "Bip01" would split into "bip" + "01" and the "01" would be mistaken for a
 * segment index.
 */
const GLUED_PREFIXES = /^(mixamorig|valvebiped|bip001|bip01|ccbase|cc_base)[-_.\s]?/i

/**
 * Shorter prefixes that only count as a prefix when followed by a separator, so a
 * bone genuinely named "org" or "b" is not mangled.
 */
const SEPARATED_PREFIXES = /^(def|org|mch|ctrl|bn|jnt|bone|armature|b|j)[-_.]/i

/**
 * Tokens that carry no anatomical meaning and are dropped after splitting.
 * "f" comes from Rigify's f_index / f_middle finger bones; proximal/intermediate/
 * distal come from VRM, where segment order is recovered from the hierarchy anyway.
 */
const NOISE_TOKENS = new Set([
  'bone', 'bones', 'jnt', 'joint', 'joints', 'def', 'deform', 'org', 'mch',
  'f', 'skin', 'rig', 'proximal', 'intermediate', 'distal'
])

/** A token that is exactly one of these marks the bone's side */
const LEFT_TOKENS = new Set(['l', 'lf', 'lft', 'left'])
const RIGHT_TOKENS = new Set(['r', 'rt', 'rgt', 'right'])

/** Markers that this bone is the terminating tip of a chain */
const LEAF_TOKENS = new Set(['end', 'tip', 'leaf', 'nub', 'top'])

/**
 * Glued compound words split into the same tokens a camelCase name would produce,
 * so "upperarm", "upper_arm" and "UpperArm" all end up as ["upper", "arm"].
 * These splits are mechanical only - deciding that upper+arm means the upper arm
 * is BoneSlotVocabulary's job.
 */
const COMPOUND_TOKENS: Record<string, string[]> = {
  upperarm: ['upper', 'arm'],
  uparm: ['up', 'arm'],
  lowerarm: ['lower', 'arm'],
  loarm: ['lo', 'arm'],
  forearm: ['fore', 'arm'],
  upperleg: ['upper', 'leg'],
  upleg: ['up', 'leg'],
  lowerleg: ['lower', 'leg'],
  loleg: ['lo', 'leg'],
  upperchest: ['upper', 'chest'],
  toebase: ['toe', 'base'],
  collarbone: ['collar', 'bone'],
  headtop: ['head', 'top'],
  handthumb: ['hand', 'thumb'],
  handindex: ['hand', 'index'],
  handmiddle: ['hand', 'middle'],
  handring: ['hand', 'ring'],
  handpinky: ['hand', 'pinky'],
  indexfinger: ['index', 'finger'],
  middlefinger: ['middle', 'finger'],
  ringfinger: ['ring', 'finger'],
  pinkyfinger: ['pinky', 'finger'],
  thumbfinger: ['thumb', 'finger']
}

/**
 * Split a raw bone name into lowercase word tokens.
 * Handles separators, camelCase boundaries, acronym boundaries (LArm -> l arm)
 * and letter/digit boundaries (Index1 -> index 1).
 */
function split_into_tokens (name: string): string[] {
  const spaced: string = name
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase: LeftFore -> Left Fore
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // acronym run: LArm -> L Arm
    .replace(/([A-Za-z])(\d)/g, '$1 $2') // Index1 -> Index 1
    .replace(/(\d)([A-Za-z])/g, '$1 $2') // 1Index -> 1 Index
    .toLowerCase()

  const raw_tokens: string[] = spaced.split(/[^a-z0-9]+/).filter(t => t.length > 0)

  // expand glued compound words into their parts
  const expanded: string[] = []
  for (const token of raw_tokens) {
    const compound: string[] | undefined = COMPOUND_TOKENS[token]
    if (compound !== undefined) {
      expanded.push(...compound)
    } else {
      expanded.push(token)
    }
  }

  return expanded
}

/**
 * Strip rig namespaces and known prefixes from a raw bone name.
 * Maya/glTF namespaces ("Armature|mixamorig:Hips") keep only the last segment.
 */
function strip_prefixes (bone_name: string): string {
  // keep only the last namespace segment
  const segments: string[] = bone_name.split(/[|:]/)
  const last_segment: string = segments[segments.length - 1]

  // a trailing separator can leave an empty segment - fall back to the whole name
  let name: string = last_segment.length > 0 ? last_segment : bone_name

  name = name.replace(GLUED_PREFIXES, '')
  name = name.replace(SEPARATED_PREFIXES, '')

  // if stripping left nothing behind, the "prefix" was the entire name - keep it
  if (name.trim().length === 0) {
    return last_segment.length > 0 ? last_segment : bone_name
  }

  return name
}

/**
 * Parse a bone name into tokens, side, numeric index and leaf marker.
 */
export function parse_bone_name (bone_name: string): ParsedBoneName {
  const tokens: string[] = split_into_tokens(strip_prefixes(bone_name))

  let side: BoneSide = BoneSide.Unknown
  let index: number | null = null
  let is_leaf: boolean = false
  const remaining: string[] = []

  for (const token of tokens) {
    if (LEFT_TOKENS.has(token)) {
      side = BoneSide.Left
      continue
    }

    if (RIGHT_TOKENS.has(token)) {
      side = BoneSide.Right
      continue
    }

    if (LEAF_TOKENS.has(token)) {
      is_leaf = true
      continue
    }

    if (/^\d+$/.test(token)) {
      // last numeric token wins: "f_index.01" -> 1, "Spine2" -> 2
      index = parseInt(token, 10)
      continue
    }

    if (NOISE_TOKENS.has(token)) {
      continue
    }

    remaining.push(token)
  }

  return { tokens: remaining, side, index, is_leaf }
}

/**
 * Build a loose lookup key for comparing a bone name against a hardcoded template
 * table (MixamoMapper / RigifyMapper). Both sides of the comparison run through
 * this, so exporter variations cancel out:
 *   "mixamorig:LeftForeArm" / "mixamorigLeftForeArm" / "LeftForeArm" -> "leftforearm"
 *   "DEF-upper_arm.L" / "DEF-upper_armL"                             -> "upperarml"
 *   "DEF-thumb.01.L" / "DEF-thumb01L"                                -> "thumb1l"
 *
 * Unlike parse_bone_name this keeps the side and index tokens, since those are what
 * distinguish one template entry from another.
 */
export function normalized_lookup_key (bone_name: string): string {
  const tokens: string[] = split_into_tokens(strip_prefixes(bone_name))

  return tokens
    .filter(token => !NOISE_TOKENS.has(token))
    .map((token) => {
      // normalize numeric segments so "01" and "1" compare equal
      if (/^\d+$/.test(token)) {
        return String(parseInt(token, 10))
      }
      return token
    })
    .join('')
}
