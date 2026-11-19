import { BoneCategory, BoneSide, BoneSlot } from './BoneTypes'
import { type ParsedBoneName } from './interfaces/ParsedBoneName'

/**
 * BoneSlotVocabulary - the synonym table that turns tokenized bone names into
 * canonical joint slots.
 *
 * This is the file that grows as new rigs turn up, so it is deliberately a
 * declarative rule list rather than branching code. Rules are evaluated in order
 * and the first match wins, which is why the compound forms ("fore" + "arm") sit
 * above the bare fallbacks (a lone "arm").
 *
 * Genuinely ambiguous names are resolved here only as a best guess; where the
 * skeleton hierarchy disagrees, BoneChainResolver overrides this. The two known
 * ambiguities:
 *   - "shoulder" is the clavicle in Mixamo but the upper arm in DAZ/Poser
 *   - "leg" is the calf in Mixamo but the thigh in plenty of hand-rolled rigs
 */

interface SlotRule {
  slot: BoneSlot
  all?: string[] // every one of these tokens must be present
  any?: string[] // at least one of these tokens must be present
  require_side?: boolean // only matches when the bone has a known left/right side
  forbid_side?: boolean // only matches when the bone has no left/right side
}

/**
 * Tokens that disqualify a bone from ever being mapped.
 *
 * This guard matters more than it looks. Loose matching without it happily binds a
 * forearm *twist* bone to lowerarm_l, or an IK pole target to a real joint, and the
 * result is a retarget that looks broken rather than one that looks unmapped.
 */
const REJECTED_TOKENS = new Set([
  'twist', 'roll', 'helper', 'ik', 'fk', 'pole', 'target', 'ctrl', 'control',
  'attach', 'prop', 'weapon', 'socket', 'camera', 'ground', 'marker', 'tag',
  'adj', 'corrective', 'wrinkle', 'root', 'cog', 'reference',
  'eye', 'eyelid', 'pupil', 'jaw', 'tongue', 'teeth', 'muzzle', 'nose', 'brow',
  'cheek', 'lip', 'chin', 'ear', 'horn', 'breast', 'belly',
  'cloth', 'hair', 'skirt', 'cape', 'coat', 'tassel', 'buckle'
])

/**
 * Ordered rule list. First match wins.
 */
const SLOT_RULES: SlotRule[] = [
  // --- Fingers, before Hand: "LeftHandIndex1" carries both "hand" and "index".
  // All finger rules require a side - a finger with no left/right marker cannot be
  // mapped usefully anyway, and requiring it stops a stray "middle" or "ring"
  // elsewhere in the rig from being read as a finger.
  { slot: BoneSlot.FingerThumb, any: ['thumb'], require_side: true },
  { slot: BoneSlot.FingerIndex, any: ['index', 'pointer'], require_side: true },
  { slot: BoneSlot.FingerMiddle, any: ['middle', 'mid'], require_side: true },
  { slot: BoneSlot.FingerRing, any: ['ring'], require_side: true },
  { slot: BoneSlot.FingerPinky, any: ['pinky', 'pink', 'little', 'small'], require_side: true },

  // --- Arm segments. Compound forms first so "upper arm" never falls through to
  // the bare "arm" rule at the bottom.
  { slot: BoneSlot.LowerArm, all: ['fore', 'arm'] },
  { slot: BoneSlot.LowerArm, all: ['lower', 'arm'] },
  { slot: BoneSlot.LowerArm, all: ['lo', 'arm'] },
  { slot: BoneSlot.LowerArm, any: ['elbow', 'ulna', 'radius'] },
  { slot: BoneSlot.UpperArm, all: ['upper', 'arm'] },
  { slot: BoneSlot.UpperArm, all: ['up', 'arm'] },
  { slot: BoneSlot.UpperArm, any: ['humerus', 'shldr'] },

  // --- Leg segments
  { slot: BoneSlot.Thigh, all: ['upper', 'leg'] },
  { slot: BoneSlot.Thigh, all: ['up', 'leg'] },
  { slot: BoneSlot.Thigh, any: ['thigh', 'femur'] },
  { slot: BoneSlot.Thigh, any: ['hip'], require_side: true }, // "hip_l" is a thigh
  { slot: BoneSlot.Calf, all: ['lower', 'leg'] },
  { slot: BoneSlot.Calf, all: ['lo', 'leg'] },
  { slot: BoneSlot.Calf, any: ['calf', 'shin', 'knee', 'tibia', 'fibula'] },

  // --- Limb terminals. Ball before Foot so "ToeBase" is not read as a foot.
  { slot: BoneSlot.Ball, all: ['toe', 'base'] },
  { slot: BoneSlot.Ball, any: ['ball', 'toe', 'toes'] },
  { slot: BoneSlot.Foot, any: ['foot', 'feet', 'ankle'] },
  { slot: BoneSlot.Hand, any: ['hand', 'wrist', 'palm'] },

  // --- Shoulder girdle. "shoulder" defaults to the clavicle (Mixamo, Unreal,
  // Rigify all use it that way); DAZ's "shldr" is caught by the UpperArm rule above.
  { slot: BoneSlot.Clavicle, any: ['clavicle', 'collar', 'scapula', 'shoulder'] },

  // --- Torso and head
  { slot: BoneSlot.Head, any: ['head', 'skull'] },
  { slot: BoneSlot.Neck, any: ['neck'] },
  { slot: BoneSlot.Spine, all: ['upper', 'chest'] },
  { slot: BoneSlot.Spine, any: ['spine', 'chest', 'torso', 'abdomen', 'ribcage', 'waist'] },
  { slot: BoneSlot.Pelvis, any: ['pelvis', 'hips'] },
  { slot: BoneSlot.Pelvis, any: ['hip'], forbid_side: true },

  // --- Non-humanoid chains
  { slot: BoneSlot.Tail, any: ['tail'] },
  { slot: BoneSlot.Wing, any: ['wing', 'feather', 'pinion'] },

  // --- Bare fallbacks, lowest priority. Mixamo names the upper arm "LeftArm" and
  // the calf "LeftLeg"; the hierarchy pass corrects rigs that mean otherwise.
  { slot: BoneSlot.UpperArm, any: ['arm'] },
  { slot: BoneSlot.Calf, any: ['leg'] }
]

/** Slots whose length varies a lot between rigs and should be paired proportionally */
const PROPORTIONAL_CHAIN_SLOTS = new Set<BoneSlot>([
  BoneSlot.Spine,
  BoneSlot.Tail,
  BoneSlot.Wing
])

/** Legacy BoneCategory for each slot, so the existing category field stays meaningful */
const SLOT_CATEGORY: Record<BoneSlot, BoneCategory> = {
  [BoneSlot.Pelvis]: BoneCategory.Torso,
  [BoneSlot.Spine]: BoneCategory.Torso,
  [BoneSlot.Neck]: BoneCategory.Torso,
  [BoneSlot.Head]: BoneCategory.Torso,
  [BoneSlot.Clavicle]: BoneCategory.Arms,
  [BoneSlot.UpperArm]: BoneCategory.Arms,
  [BoneSlot.LowerArm]: BoneCategory.Arms,
  [BoneSlot.Hand]: BoneCategory.Arms,
  [BoneSlot.Thigh]: BoneCategory.Legs,
  [BoneSlot.Calf]: BoneCategory.Legs,
  [BoneSlot.Foot]: BoneCategory.Legs,
  [BoneSlot.Ball]: BoneCategory.Legs,
  [BoneSlot.FingerThumb]: BoneCategory.Hands,
  [BoneSlot.FingerIndex]: BoneCategory.Hands,
  [BoneSlot.FingerMiddle]: BoneCategory.Hands,
  [BoneSlot.FingerRing]: BoneCategory.Hands,
  [BoneSlot.FingerPinky]: BoneCategory.Hands,
  [BoneSlot.Tail]: BoneCategory.Tail,
  [BoneSlot.Wing]: BoneCategory.Wings,
  [BoneSlot.Unknown]: BoneCategory.Unknown
}

/**
 * Resolve a parsed bone name to a canonical slot.
 * @param parsed - output of parse_bone_name()
 * @param effective_side - the bone's side after hierarchy inheritance, which can be
 *                         more informative than the side in its own name
 */
export function resolve_slot (parsed: ParsedBoneName, effective_side: BoneSide): BoneSlot {
  const tokens = new Set(parsed.tokens)

  // a single rejected token disqualifies the whole bone
  for (const token of tokens) {
    if (REJECTED_TOKENS.has(token)) {
      return BoneSlot.Unknown
    }
  }

  const has_side: boolean = effective_side === BoneSide.Left || effective_side === BoneSide.Right

  for (const rule of SLOT_RULES) {
    if (rule.require_side === true && !has_side) continue
    if (rule.forbid_side === true && has_side) continue
    if (rule.all !== undefined && !rule.all.every(token => tokens.has(token))) continue
    if (rule.any !== undefined && !rule.any.some(token => tokens.has(token))) continue

    return rule.slot
  }

  return BoneSlot.Unknown
}

export function slot_to_category (slot: BoneSlot): BoneCategory {
  return SLOT_CATEGORY[slot]
}

export function is_proportional_chain_slot (slot: BoneSlot): boolean {
  return PROPORTIONAL_CHAIN_SLOTS.has(slot)
}

export function is_finger_slot (slot: BoneSlot): boolean {
  return slot === BoneSlot.FingerThumb || slot === BoneSlot.FingerIndex ||
    slot === BoneSlot.FingerMiddle || slot === BoneSlot.FingerRing ||
    slot === BoneSlot.FingerPinky
}

/**
 * Slots the arm/leg hierarchy pass is allowed to overwrite. Anything outside this
 * set was named unambiguously enough that we trust the name over the walk.
 */
export function is_arm_ambiguous_slot (slot: BoneSlot): boolean {
  return slot === BoneSlot.Unknown || slot === BoneSlot.Clavicle ||
    slot === BoneSlot.UpperArm || slot === BoneSlot.LowerArm
}

export function is_leg_ambiguous_slot (slot: BoneSlot): boolean {
  return slot === BoneSlot.Unknown || slot === BoneSlot.Thigh || slot === BoneSlot.Calf
}
