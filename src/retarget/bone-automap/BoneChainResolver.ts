import { type BoneMetadata, BoneSide, BoneSlot } from './BoneTypes'
import { normalized_lookup_key, parse_bone_name } from './BoneNameTokenizer'
import { type ParsedBoneName } from './interfaces/ParsedBoneName'
import {
  is_arm_ambiguous_slot, is_finger_slot, is_leg_ambiguous_slot, resolve_slot, slot_to_category
} from './BoneSlotVocabulary'
import { type RawBoneRecord } from './interfaces/RawBoneRecord'

export class BoneChainResolver {
  /**
   * Build fully resolved metadata for a skeleton.
   * @param bones - flat list of bone names with their parent bone name
   */
  static build_metadata (bones: RawBoneRecord[]): BoneMetadata[] {
    const bone_names = new Set<string>(bones.map(b => b.name))

    // a bone's recorded parent can be the armature/scene node rather than another
    // bone - treat anything outside the bone set as "no parent"
    const parent_of = new Map<string, string | null>()
    const children_of = new Map<string, string[]>()
    for (const bone of bones) {
      const parent: string | null =
        (bone.parent_name !== null && bone_names.has(bone.parent_name)) ? bone.parent_name : null
      parent_of.set(bone.name, parent)
      if (!children_of.has(bone.name)) {
        children_of.set(bone.name, [])
      }
      if (parent !== null) {
        const siblings: string[] = children_of.get(parent) ?? []
        siblings.push(bone.name)
        children_of.set(parent, siblings)
      }
    }

    const depth_of = BoneChainResolver.compute_depths(bones, parent_of)
    const parsed_of = new Map<string, ParsedBoneName>()
    for (const bone of bones) {
      parsed_of.set(bone.name, parse_bone_name(bone.name))
    }

    // side first: slot rules need to know the side, and a finger named "Middle1"
    // only becomes mappable once it inherits Left/Right from an ancestor
    const side_of = BoneChainResolver.resolve_sides(bones, parent_of, depth_of, parsed_of)

    const metadata_of = new Map<string, BoneMetadata>()
    const rejected = new Set<string>()
    for (const bone of bones) {
      const parsed = parsed_of.get(bone.name) as ParsedBoneName
      const side = side_of.get(bone.name) as BoneSide
      const slot: BoneSlot = resolve_slot(parsed, side)

      // an Unknown slot on a bone that still had tokens means the vocabulary
      // rejected it (twist/IK/prop) or simply does not know the word - either way
      // the hierarchy pass must not promote it into a real joint
      if (slot === BoneSlot.Unknown) {
        rejected.add(bone.name)
      }

      metadata_of.set(bone.name, {
        name: bone.name,
        normalized_name: normalized_lookup_key(bone.name),
        side,
        category: slot_to_category(slot),
        parent_name: parent_of.get(bone.name) ?? null,
        depth: depth_of.get(bone.name) ?? 0,
        children_names: children_of.get(bone.name) ?? [],
        slot,
        slot_ordinal: 0,
        is_leaf_name: parsed.is_leaf
      })
    }

    BoneChainResolver.infer_missing_hands(metadata_of)
    BoneChainResolver.resolve_limb_chains(metadata_of, rejected)
    BoneChainResolver.assign_ordinals(metadata_of)

    // keep the caller's original ordering
    return bones.map(b => metadata_of.get(b.name) as BoneMetadata)
  }

  /**
   * Distance from the root. Iterative with a visited guard so a malformed skeleton
   * with a parent cycle cannot hang the mapper.
   */
  private static compute_depths (
    bones: RawBoneRecord[], parent_of: Map<string, string | null>
  ): Map<string, number> {
    const depth_of = new Map<string, number>()

    for (const bone of bones) {
      if (depth_of.has(bone.name)) continue

      const path: string[] = []
      const seen = new Set<string>()
      let current: string | null = bone.name

      while (current !== null && !depth_of.has(current) && !seen.has(current)) {
        seen.add(current)
        path.push(current)
        current = parent_of.get(current) ?? null
      }

      let depth: number = (current !== null && depth_of.has(current))
        ? (depth_of.get(current) as number) + 1
        : 0

      // path was built child-first, so walk it back down
      for (let i = path.length - 1; i >= 0; i--) {
        depth_of.set(path[i], depth)
        depth++
      }
    }

    return depth_of
  }

  /**
   * A bone with no side marker in its own name inherits the nearest ancestor that
   * has one. Only Left/Right is inherited - Center is never propagated, since a
   * bone hanging off the pelvis is not thereby a midline bone.
   */
  private static resolve_sides (
    bones: RawBoneRecord[],
    parent_of: Map<string, string | null>,
    depth_of: Map<string, number>,
    parsed_of: Map<string, ParsedBoneName>
  ): Map<string, BoneSide> {
    const side_of = new Map<string, BoneSide>()

    // shallowest first, so an ancestor is always resolved before its children
    const ordered: RawBoneRecord[] = [...bones].sort(
      (a, b) => (depth_of.get(a.name) ?? 0) - (depth_of.get(b.name) ?? 0)
    )

    for (const bone of ordered) {
      const own_side: BoneSide = (parsed_of.get(bone.name) as ParsedBoneName).side

      if (own_side === BoneSide.Left || own_side === BoneSide.Right) {
        side_of.set(bone.name, own_side)
        continue
      }

      const parent: string | null = parent_of.get(bone.name) ?? null
      const inherited: BoneSide | undefined = parent !== null ? side_of.get(parent) : undefined

      side_of.set(
        bone.name,
        (inherited === BoneSide.Left || inherited === BoneSide.Right) ? inherited : BoneSide.Center
      )
    }

    return side_of
  }

  /**
   * Some rigs name the wrist joint something the vocabulary does not recognise, but
   * a bone with three or more finger children is a hand no matter what it is called.
   * The arm walk anchors on Hand, so recovering it here is what lets the rest of the
   * arm resolve.
   */
  private static infer_missing_hands (metadata_of: Map<string, BoneMetadata>): void {
    for (const bone of metadata_of.values()) {
      if (bone.slot === BoneSlot.Hand) continue

      let finger_children: number = 0
      for (const child_name of bone.children_names) {
        const child: BoneMetadata | undefined = metadata_of.get(child_name)
        if (child !== undefined && is_finger_slot(child.slot)) {
          finger_children++
        }
      }

      if (finger_children >= 3) {
        bone.slot = BoneSlot.Hand
        bone.category = slot_to_category(BoneSlot.Hand)
      }
    }
  }

  /**
   * Walk up from each hand and each foot, assigning the joints above them by
   * position rather than by name.
   */
  private static resolve_limb_chains (
    metadata_of: Map<string, BoneMetadata>, rejected: Set<string>
  ): void {
    for (const bone of metadata_of.values()) {
      if (bone.slot === BoneSlot.Hand) {
        BoneChainResolver.walk_limb(
          bone, metadata_of, rejected,
          [BoneSlot.LowerArm, BoneSlot.UpperArm, BoneSlot.Clavicle],
          [BoneSlot.Hand],
          is_arm_ambiguous_slot
        )
      }

      if (bone.slot === BoneSlot.Foot) {
        BoneChainResolver.walk_limb(
          bone, metadata_of, rejected,
          [BoneSlot.Calf, BoneSlot.Thigh],
          [BoneSlot.Foot, BoneSlot.Ball],
          is_leg_ambiguous_slot
        )
      }
    }
  }

  /**
   * Assign `targets` to successive ancestors of `terminal`.
   * @param passthrough_slots - slots that belong to the terminal cluster (a wrist
   *                            above a hand) and are stepped over without consuming
   *                            a target
   * @param is_ambiguous - whether a slot is weakly enough named to be overwritten;
   *                       hitting a confidently named joint (Spine, Neck) ends the walk
   */
  private static walk_limb (
    terminal: BoneMetadata,
    metadata_of: Map<string, BoneMetadata>,
    rejected: Set<string>,
    targets: BoneSlot[],
    passthrough_slots: BoneSlot[],
    is_ambiguous: (slot: BoneSlot) => boolean
  ): void {
    let target_index: number = 0
    let current: BoneMetadata | undefined =
      terminal.parent_name !== null ? metadata_of.get(terminal.parent_name) : undefined

    while (current !== undefined && target_index < targets.length) {
      // stepping outside the limb (into the spine, or across the midline) ends the walk
      if (current.side !== terminal.side) break

      // twist / IK / prop bones sit in the chain but are never real joints
      if (rejected.has(current.name)) {
        current = current.parent_name !== null ? metadata_of.get(current.parent_name) : undefined
        continue
      }

      if (passthrough_slots.includes(current.slot)) {
        current = current.parent_name !== null ? metadata_of.get(current.parent_name) : undefined
        continue
      }

      if (!is_ambiguous(current.slot)) break

      current.slot = targets[target_index]
      current.category = slot_to_category(current.slot)
      target_index++

      current = current.parent_name !== null ? metadata_of.get(current.parent_name) : undefined
    }
  }

  /**
   * Number each (slot, side) group 1..N from the root outward.
   *
   * Doing this from the hierarchy rather than from the digits in the name is what
   * makes chains line up across rigs that number differently: Mixamo's
   * Spine/Spine1/Spine2 and Mesh2Motion's spine_01/spine_02/spine_03 both become
   * 1/2/3, and Mixamo's Head + HeadTop_End pairs with head + head_leaf without
   * either being a special case.
   */
  private static assign_ordinals (metadata_of: Map<string, BoneMetadata>): void {
    const groups = new Map<string, BoneMetadata[]>()

    for (const bone of metadata_of.values()) {
      if (bone.slot === BoneSlot.Unknown) continue
      const key = `${bone.slot}|${bone.side}`
      const group: BoneMetadata[] = groups.get(key) ?? []
      group.push(bone)
      groups.set(key, group)
    }

    for (const group of groups.values()) {
      group.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth
        // flat hierarchies (every bone parented to the armature) tie on depth, so
        // fall back to the number in the name, then to the name itself
        if (a.is_leaf_name !== b.is_leaf_name) return a.is_leaf_name ? 1 : -1
        const a_index: number = parse_bone_name(a.name).index ?? 0
        const b_index: number = parse_bone_name(b.name).index ?? 0
        if (a_index !== b_index) return a_index - b_index
        return a.name.localeCompare(b.name)
      })

      group.forEach((bone, i) => {
        bone.slot_ordinal = i + 1
      })
    }
  }
}
