import { type Bone, Quaternion, Vector3 } from 'three'

/**
 * A two-segment limb (upper arm + forearm, thigh + shin, ...) that has a mirrored
 * twin on the other side of the body. Detected from skeleton geometry alone.
 *
 * The reference data is measured once, in the pose where both skeletons agree
 * (source rest pose / target aligned pose), and stored in the anchor bone's local
 * space so it rides along with the body during the animation.
 */
export interface ProportionLimb {
  /** The mirrored limb on the other side. */
  twin: ProportionLimb
  /** Bone both twins hang from (chest for arms, hips for legs). */
  source_anchor: Bone
  target_anchor: Bone
  /** Limb joints: root (shoulder/hip joint), mid (elbow/knee), end (wrist/ankle). */
  source_root: Bone
  source_end: Bone
  target_root: Bone
  target_mid: Bone
  target_end: Bone
  /**
   * The point on the end bone that is kept in place, in end-bone-local space: the
   * centre of the joints attached to it (middle of the palm, ball of the foot), or
   * the end joint itself if nothing is attached. Hands touch at the palm, not at the
   * wrist, so this is the point whose body-relative position has to survive.
   */
  source_contact: Vector3
  target_contact: Vector3
  /** Midpoint between the twin root joints, in anchor-local space. */
  source_center: Vector3
  target_center: Vector3
  /** Unit direction from that midpoint out to this limb's root, in anchor-local space. */
  source_axis: Vector3
  target_axis: Vector3
  /** Distance from the midpoint to this limb's root joint (half the shoulder/hip width). */
  source_half_width: number
  target_half_width: number
  /** target limb length / source limb length. */
  length_ratio: number
  /** target hand (foot) size / source hand (foot) size. */
  contact_ratio: number
  /** Source hand (foot) size in world units. */
  source_contact_size: number
  /** Source distance from the centre line inside which hand (foot) size sets the scale. */
  near_distance: number
  /**
   * True if the contact point rests on the floor in the rest pose (feet). These
   * limbs carry the body, so they decide how high it sits.
   */
  grounded: boolean
  /**
   * Height along `up` at which this limb's contact point is on the floor, in each
   * skeleton's world. For grounded limbs that is where it sits in the rest pose;
   * other limbs (hands) borrow the level from the grounded ones. Only valid if
   * floor_known.
   */
  source_floor: number
  target_floor: number
  floor_known: boolean
  /** World direction pointing away from the floor, worked out from the rest pose. Shared by all limbs. */
  up: Vector3
  /** Contact point in world space with each skeleton standing in its own rest pose. */
  source_rest_contact: Vector3
  target_rest_contact: Vector3
}

interface Measurement {
  /** unit root-to-root direction on the target, pointing out towards this limb's root */
  axis: Vector3
  /** contact point's coordinate along the root-to-root line, from the centre */
  source_along: number
  target_along: number
  /** the rest of its offset from the centre: the part across that line */
  source_across: Vector3
  target_across: Vector3
}

function new_measurement (): Measurement {
  return { axis: new Vector3(), source_along: 0, target_along: 0, source_across: new Vector3(), target_across: new Vector3() }
}

function smoothstep (x: number, from: number, to: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

interface Contact {
  source_contact: Vector3
  target_contact: Vector3
  source_size: number
  target_size: number
  source_rest_contact: Vector3
  target_rest_contact: Vector3
}

interface LimbJoints { root: Bone, mid: Bone, end: Bone, upper_length: number, lower_length: number }

const SYMMETRY_TOLERANCE = 0.1
const MIN_LENGTH = 1e-5
/** A contact point this low in the rest pose, as a fraction of skeleton height, stands on the floor. */
const GROUNDED_HEIGHT = 0.1
/** Most the mid joint may be opened or closed in one correction. Radians. */
const MAX_HINGE_CHANGE = Math.PI / 6

const _center = new Vector3()
const _axis = new Vector3()
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _across = new Vector3()
const _ba = new Vector3()
const _bc = new Vector3()
const _hinge_axis = new Vector3()
const _from = new Vector3()
const _to = new Vector3()
const _hinge = new Quaternion()
const _swing = new Quaternion()
const _q = new Quaternion()
const _own = new_measurement()
const _twin = new_measurement()

/**
 * Corrects limb end positions for proportion differences between two skeletons.
 *
 * Copying bone rotations preserves bone *directions*, so a hand ends up wherever the
 * target's arm length puts it. If the target has longer arms relative to its shoulder
 * width, a hand that met the midline on the source overshoots it on the target. No
 * constant rotation offset can fix that, because the error depends on the pose.
 *
 * Instead, per frame, the source limb's contact point (palm, ball of the foot) is
 * measured against the body rather than against its own limb:
 *
 *   - along the line joining the twin root joints (shoulder to shoulder), its
 *     coordinate is rescaled to fit the target's body width while it is between the
 *     two roots. So "at the midline" stays at the midline and "at the opposite
 *     shoulder" stays at the opposite shoulder. Right at the midline the scale is the
 *     hand size ratio instead, so a gap between two palms is not squeezed shut.
 *   - outside its own root joint, and in every other direction, the rotation-copied
 *     position is kept as is.
 *
 * Both twins use the same mapping, so two palms that meet on the source meet on the
 * target. The limb is then re-posed to put the contact point there with a
 * hinge change at the mid joint plus a swing at the root. That is a few degrees on
 * top of the rotation-copied pose, so the mesh stays close to what plain rotation
 * copying gives.
 */
export class LimbProportionCorrector {
  /**
   * Find mirrored limb pairs. Walks the mapped bones from the top down. Wherever a
   * bone has two children whose limbs match in segment lengths and sit at the same
   * distance from it, those are twins. Subtrees below a twin pair are not searched,
   * so fingers are never mistaken for limbs.
   *
   * Call with both skeletons in the reference pose (source rest, target aligned)
   * and world matrices up to date. target_rest_positions holds the target bones'
   * world positions in the target's own rest pose, from before it was aligned. It
   * is what tells where the target's floor is.
   */
  static detect_limbs (
    bone_mapping: Map<string, string>,
    source_by_name: Map<string, Bone>,
    target_by_name: Map<string, Bone>,
    target_rest_positions: Map<Bone, Vector3> = new Map()
  ): ProportionLimb[] {
    // tree of mapped target bones (unmapped bones in between are skipped over)
    const is_mapped = (bone: Bone): boolean => {
      const source_name = bone_mapping.get(bone.name)
      return target_by_name.get(bone.name) === bone && source_name !== undefined && source_by_name.has(source_name)
    }
    const children = new Map<Bone, Bone[]>()
    const top_level: Bone[] = []
    for (const bone of target_by_name.values()) {
      if (!is_mapped(bone)) continue
      let ancestor = bone.parent
      while (ancestor !== null && !((ancestor as Bone).isBone === true && is_mapped(ancestor as Bone))) {
        ancestor = ancestor.parent
      }
      if (ancestor === null) { top_level.push(bone); continue }
      const siblings = children.get(ancestor as Bone)
      if (siblings === undefined) children.set(ancestor as Bone, [bone])
      else siblings.push(bone)
    }

    const world = (bone: Bone): Vector3 => bone.getWorldPosition(new Vector3())

    // longest path from each bone down to a leaf
    const reach = new Map<Bone, number>()
    const longest_child = new Map<Bone, Bone>()
    const measure_reach = (bone: Bone): number => {
      let best = 0
      for (const child of children.get(bone) ?? []) {
        const length = world(bone).distanceTo(world(child)) + measure_reach(child)
        if (length >= best) { best = length; longest_child.set(bone, child) }
      }
      reach.set(bone, best)
      return best
    }
    top_level.forEach(measure_reach)

    // the limb below a bone = the two longest consecutive segments on its longest path
    const limb_below = (start: Bone): LimbJoints | null => {
      const path: Bone[] = [start]
      for (let next = longest_child.get(start); next !== undefined; next = longest_child.get(next)) path.push(next)

      let best: LimbJoints | null = null
      for (let i = 0; i + 2 < path.length; i++) {
        const upper_length = world(path[i]).distanceTo(world(path[i + 1]))
        const lower_length = world(path[i + 1]).distanceTo(world(path[i + 2]))
        if (upper_length < MIN_LENGTH || lower_length < MIN_LENGTH) continue
        if (best === null || upper_length + lower_length > best.upper_length + best.lower_length) {
          best = { root: path[i], mid: path[i + 1], end: path[i + 2], upper_length, lower_length }
        }
      }
      return best
    }

    // 0 = perfect mirror image, Infinity = not twins
    const asymmetry = (anchor: Bone, one: LimbJoints, other: LimbJoints): number => {
      const length = (one.upper_length + one.lower_length + other.upper_length + other.lower_length) / 2
      const anchor_position = world(anchor)
      const worst = Math.max(
        Math.abs(one.upper_length - other.upper_length),
        Math.abs(one.lower_length - other.lower_length),
        Math.abs(anchor_position.distanceTo(world(one.root)) - anchor_position.distanceTo(world(other.root)))
      ) / length
      return worst <= SYMMETRY_TOLERANCE ? worst : Infinity
    }

    const rest_position = (bone: Bone): Vector3 => target_rest_positions.get(bone) ?? world(bone)

    // centre of the joints hanging off a limb's end bone, in that bone's local space
    const contact_point = (end: Bone, attached: Bone[]): Vector3 => {
      const centre = new Vector3()
      if (attached.length === 0) return centre
      for (const child of attached) centre.add(world(child))
      return end.worldToLocal(centre.divideScalar(attached.length))
    }
    const contacts = (joints: LimbJoints): Contact => {
      const attached = children.get(joints.end) ?? []
      const source_of = (bone: Bone): Bone => source_by_name.get(bone_mapping.get(bone.name) as string) as Bone

      // hand/foot size: wrist to fingertip (ankle to toe tip) along the longest digit
      let source_size = 0
      for (let bone = joints.end, next = longest_child.get(bone); next !== undefined; bone = next, next = longest_child.get(bone)) {
        source_size += world(source_of(bone)).distanceTo(world(source_of(next)))
      }

      // the contact point with each skeleton standing in its own rest pose
      const centre = (bones: Bone[], position: (bone: Bone) => Vector3): Vector3 =>
        bones.reduce((sum, bone) => sum.add(position(bone)), new Vector3()).divideScalar(bones.length)
      const target_bones = attached.length > 0 ? attached : [joints.end]

      return {
        target_contact: contact_point(joints.end, attached),
        source_contact: contact_point(source_of(joints.end), attached.map(source_of)),
        target_size: reach.get(joints.end) ?? 0,
        source_size,
        source_rest_contact: centre(target_bones.map(source_of), world),
        target_rest_contact: centre(target_bones, rest_position)
      }
    }

    const limbs: ProportionLimb[] = []
    const queue: Bone[] = [...top_level]
    while (queue.length > 0) {
      const anchor = queue.shift() as Bone
      const candidates = (children.get(anchor) ?? []).map(child => ({ child, joints: limb_below(child) }))
      const paired = new Set<Bone>()

      // best-matching pairs first
      const matches: Array<{ one: number, other: number, score: number }> = []
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const one = candidates[i].joints
          const other = candidates[j].joints
          if (one === null || other === null) continue
          const score = asymmetry(anchor, one, other)
          if (score !== Infinity) matches.push({ one: i, other: j, score })
        }
      }
      matches.sort((x, y) => x.score - y.score)

      for (const match of matches) {
        const one = candidates[match.one]
        const other = candidates[match.other]
        if (paired.has(one.child) || paired.has(other.child)) continue

        const pair = this.build_pair(anchor, one.joints as LimbJoints, other.joints as LimbJoints,
          bone_mapping, source_by_name)
        if (pair === null) continue
        this.set_contact(pair[0], contacts(one.joints as LimbJoints))
        this.set_contact(pair[1], contacts(other.joints as LimbJoints))
        limbs.push(...pair)
        paired.add(one.child)
        paired.add(other.child)
      }

      for (const candidate of candidates) {
        if (!paired.has(candidate.child)) queue.push(candidate.child)
      }
    }

    // ── which way is up, where is the floor, who stands on it ──
    // The pair that hangs furthest below its anchor is the one being stood on, and
    // the line from its contact points up to that anchor is vertical. Snapped to a
    // world axis so a slouching rest pose cannot tilt the floor.
    const up = new Vector3(0, 1, 0)
    let longest = 0
    for (const limb of limbs) {
      const rise = rest_position(limb.target_anchor).clone()
        .sub(limb.target_rest_contact.clone().add(limb.twin.target_rest_contact).multiplyScalar(0.5))
      if (rise.length() <= longest) continue
      longest = rise.length()
      const axis = Math.abs(rise.x) > Math.abs(rise.y)
        ? (Math.abs(rise.x) > Math.abs(rise.z) ? 'x' : 'z')
        : (Math.abs(rise.y) > Math.abs(rise.z) ? 'y' : 'z')
      up.set(0, 0, 0)[axis] = Math.sign(rise[axis])
    }

    // lowest and highest joint of each skeleton standing in its rest pose
    const extent = (heights: number[]): { low: number, high: number } =>
      ({ low: Math.min(...heights), high: Math.max(...heights) })
    const mapped_targets = [...children.values()].flat().concat(top_level)
    const target_extent = extent(mapped_targets.map(bone => rest_position(bone).dot(up)))
    const source_extent = extent(mapped_targets.map(bone =>
      world(source_by_name.get(bone_mapping.get(bone.name) as string) as Bone).dot(up)))
    const is_low = (height: number, range: { low: number, high: number }): boolean =>
      height - range.low <= GROUNDED_HEIGHT * (range.high - range.low)

    for (const limb of limbs) {
      limb.up = up
      limb.source_floor = limb.source_rest_contact.dot(up)
      limb.target_floor = limb.target_rest_contact.dot(up)
      limb.grounded = is_low(limb.target_floor, target_extent) && is_low(limb.source_floor, source_extent)
      limb.floor_known = limb.grounded
    }
    // limbs that do not stand on the floor can still be put down on it (hands in a
    // crawl or a push-up). They use the floor level the grounded limbs establish
    const grounded = limbs.filter(limb => limb.grounded)
    for (const limb of limbs) {
      if (limb.grounded || grounded.length === 0) continue
      limb.source_floor = grounded.reduce((sum, other) => sum + other.source_floor, 0) / grounded.length
      limb.target_floor = grounded.reduce((sum, other) => sum + other.target_floor, 0) / grounded.length
      limb.floor_known = true
    }
    return limbs
  }

  /** Measure the reference data for a twin pair. Null if the source side is unusable. */
  private static build_pair (
    target_anchor: Bone, one: LimbJoints, other: LimbJoints,
    bone_mapping: Map<string, string>, source_by_name: Map<string, Bone>
  ): ProportionLimb[] | null {
    const source_of = (bone: Bone): Bone => source_by_name.get(bone_mapping.get(bone.name) as string) as Bone
    const world = (bone: Bone): Vector3 => bone.getWorldPosition(new Vector3())
    const source_anchor = source_of(target_anchor)

    const half_width = (root: Bone, twin_root: Bone): number => world(root).distanceTo(world(twin_root)) / 2
    const target_half_width = half_width(one.root, other.root)
    const source_half_width = half_width(source_of(one.root), source_of(other.root))
    if (target_half_width < MIN_LENGTH || source_half_width < MIN_LENGTH) return null

    // a point / direction fixed to the anchor bone, expressed in its local space
    const anchored_center = (anchor: Bone, root: Bone, twin_root: Bone): Vector3 =>
      anchor.worldToLocal(world(root).add(world(twin_root)).multiplyScalar(0.5))
    const anchored_axis = (anchor: Bone, root: Bone, twin_root: Bone): Vector3 => {
      anchor.getWorldQuaternion(_q)
      return world(root).sub(world(twin_root)).normalize().applyQuaternion(_q.invert())
    }

    const pair: ProportionLimb[] = []
    for (const [joints, twin] of [[one, other], [other, one]]) {
      const source_root = source_of(joints.root)
      const source_mid = source_of(joints.mid)
      const source_end = source_of(joints.end)
      const source_twin_root = source_of(twin.root)
      const source_length = world(source_root).distanceTo(world(source_mid)) +
        world(source_mid).distanceTo(world(source_end))
      if (source_length < MIN_LENGTH) return null

      pair.push({
        source_anchor,
        target_anchor,
        source_root,
        source_end,
        target_root: joints.root,
        target_mid: joints.mid,
        target_end: joints.end,
        source_contact: new Vector3(),
        target_contact: new Vector3(),
        source_center: anchored_center(source_anchor, source_root, source_twin_root),
        target_center: anchored_center(target_anchor, joints.root, twin.root),
        source_axis: anchored_axis(source_anchor, source_root, source_twin_root),
        target_axis: anchored_axis(target_anchor, joints.root, twin.root),
        source_half_width,
        target_half_width,
        length_ratio: (joints.upper_length + joints.lower_length) / source_length,
        contact_ratio: target_half_width / source_half_width,
        source_contact_size: source_half_width / 2,
        near_distance: source_half_width / 2,
        grounded: false,
        floor_known: false,
        source_floor: 0,
        target_floor: 0
      } as ProportionLimb)
    }
    pair[0].twin = pair[1]
    pair[1].twin = pair[0]
    return pair
  }

  /** Record the contact points and derive the hand/foot scale from them. */
  private static set_contact (limb: ProportionLimb, contact: Contact): void {
    limb.source_contact.copy(contact.source_contact)
    limb.target_contact.copy(contact.target_contact)
    limb.source_rest_contact = contact.source_rest_contact
    limb.target_rest_contact = contact.target_rest_contact
    if (contact.source_size < MIN_LENGTH || contact.target_size < MIN_LENGTH) return

    limb.contact_ratio = contact.target_size / contact.source_size
    limb.source_contact_size = contact.source_size
    // half a hand-length either side of the centre line, but always leaving room for
    // the stretch out to the root joint to stay monotonic
    limb.near_distance = Math.min(contact.source_size / 2, limb.source_half_width / 2,
      limb.target_half_width / (2 * limb.contact_ratio))
  }

  /**
   * Where a contact point at this distance from the body's centre line (measured
   * along the root-to-root line, in source units) belongs on the target.
   *
   *   - close to the centre line, distances are in units of the hand/foot, because
   *     that is what is about to touch its twin there
   *   - from there out to the root joint, they stretch to fit the body width
   *   - beyond the root joint, they follow the limb length, like rotation copying does
   */
  static remap_along_axis (coordinate: number, limb: ProportionLimb): number {
    const distance = Math.abs(coordinate)
    const near = limb.near_distance
    let remapped: number
    if (distance <= near) {
      remapped = distance * limb.contact_ratio
    } else if (distance <= limb.source_half_width) {
      const near_end = near * limb.contact_ratio
      remapped = near_end + (distance - near) * (limb.target_half_width - near_end) / (limb.source_half_width - near)
    } else {
      remapped = limb.target_half_width + (distance - limb.source_half_width) * limb.length_ratio
    }
    return Math.sign(coordinate) * remapped
  }

  /**
   * Measure a limb's contact point against the body on both skeletons, as posed now.
   * Results are in world space of the respective skeleton. The two skeletons' axes
   * agree in direction whenever the anchor is retargeted faithfully.
   */
  private static measure (limb: ProportionLimb, out: Measurement): Measurement {
    limb.source_anchor.getWorldQuaternion(_q)
    _axis.copy(limb.source_axis).applyQuaternion(_q)
    limb.source_anchor.localToWorld(_center.copy(limb.source_center))
    limb.source_end.localToWorld(out.source_across.copy(limb.source_contact)).sub(_center)
    out.source_along = out.source_across.dot(_axis)
    out.source_across.addScaledVector(_axis, -out.source_along)

    limb.target_anchor.getWorldQuaternion(_q)
    out.axis.copy(limb.target_axis).applyQuaternion(_q)
    limb.target_anchor.localToWorld(_center.copy(limb.target_center))
    limb.target_end.localToWorld(out.target_across.copy(limb.target_contact)).sub(_center)
    out.target_along = out.target_across.dot(out.axis)
    out.target_across.addScaledVector(out.axis, -out.target_along)
    return out
  }

  /**
   * Where the target limb's end joint should be this frame, in target world space.
   * Both skeletons must be posed for the frame (target by rotation copy) with world
   * matrices up to date.
   *
   * Along the root-to-root line the contact point is placed by remap_along_axis.
   * On the outer side of the limb's own root joint that shift is exactly zero: there
   * rotation copying already is the right answer, and leaving it alone avoids
   * disturbing straight limbs, where a millimetre of length needs degrees of bend.
   *
   * Across that line (up/down, front/back) the limb is only moved when its contact
   * point is close to its twin's. Then the offset between the two is set to what the
   * source has, in hand sizes, split evenly between both limbs.
   *
   * @param lift extra movement of the end joint away from the floor, see height_error
   */
  static compute_goal (limb: ProportionLimb, out: Vector3, lift: number = 0): Vector3 {
    const own = this.measure(limb, _own)
    const twin = this.measure(limb.twin, _twin)

    // ── along the root-to-root line ──
    // what rotation copying gives on an ideal rig: everything scaled about the root joint
    const copied = limb.target_half_width + (own.source_along - limb.source_half_width) * limb.length_ratio

    // Near the centre line trust the measured target position, so the contact point
    // lands exactly. Towards the root joint fade over to the ideal figure, which makes
    // the shift reach zero at the root joint no matter how the rigs differ in detail.
    const distance = Math.abs(own.source_along)
    const measured_weight = distance >= limb.source_half_width
      ? 0
      : 1 - smoothstep(distance, limb.near_distance, limb.source_half_width)
    const current = copied + (own.target_along - copied) * measured_weight
    let shift = this.remap_along_axis(own.source_along, limb) - current

    // Reaching past the twin's root joint the limb is leaving the body again (end of
    // a sword swing, a wind-up). Let go of the correction over one more half-width
    // so a long outstretched reach across is not dragged around.
    if (own.source_along < -limb.source_half_width) {
      shift *= 1 - smoothstep(distance, limb.source_half_width, 2 * limb.source_half_width)
    }

    // ── across it ──
    // the twin's axis points the other way, so its along-coordinate flips sign here
    const separation = Math.hypot(own.source_along + twin.source_along,
      own.source_across.distanceTo(twin.source_across))
    const together = 1 - smoothstep(separation, limb.source_contact_size, 2 * limb.source_contact_size)

    limb.target_end.getWorldPosition(out).addScaledVector(own.axis, shift)
    if (lift !== 0) out.addScaledVector(limb.up, lift)
    if (together > 0) {
      // half the source offset between the two contact points, in target hand sizes,
      // minus half the offset rotation copying produced
      _across.subVectors(own.source_across, twin.source_across).multiplyScalar(limb.contact_ratio)
        .sub(own.target_across).add(twin.target_across)
      out.addScaledVector(_across, 0.5 * together)
    }
    return out
  }

  /** Height of the source's contact point above its floor, as posed now. */
  private static source_height (limb: ProportionLimb): number {
    return limb.source_end.localToWorld(_from.copy(limb.source_contact)).dot(limb.up) - limb.source_floor
  }

  /**
   * How much too high (positive) the target's contact point is above its floor,
   * compared with the source's height above its own floor scaled to the target's
   * size. Only meaningful if the limb's floor_known.
   */
  static height_error (limb: ProportionLimb, scale: number): number {
    const target_height = limb.target_end.localToWorld(_to.copy(limb.target_contact)).dot(limb.up) - limb.target_floor
    return target_height - this.source_height(limb) * scale
  }

  /**
   * How much a limb is bearing on the floor, judged from the source: 1 with
   * the contact point on the floor, falling towards 0 as it lifts off (about 0.2 at
   * half a foot-length up). Heights of limbs in the air are not worth correcting.
   */
  static floor_weight (limb: ProportionLimb): number {
    const relative = Math.max(0, this.source_height(limb)) / (0.25 * limb.source_contact_size)
    return 1 / (1 + relative * relative)
  }

  /**
   * How far to raise the whole body (negative = lower) so that the grounded limbs
   * carrying the weight sit at the right height, and how much that figure can be
   * trusted this frame. Each limb counts by its floor_weight, so a planted foot
   * decides and two planted feet share. With nothing near the floor (mid-stride,
   * mid-air) the figure means little and the confidence says so.
   */
  static body_lift (limbs: ProportionLimb[], scale: number): { lift: number, confidence: number } {
    let total = 0
    let weights = 0
    for (const limb of limbs) {
      if (!limb.grounded) continue
      const weight = this.floor_weight(limb)
      total -= weight * this.height_error(limb, scale)
      weights += weight
    }
    return { lift: weights > 0 ? total / weights : 0, confidence: Math.min(1, weights) }
  }

  /**
   * Re-pose the limb so its end joint reaches the goal, starting from the pose the
   * target skeleton is currently in. Writes the new world rotations for the root and
   * mid bones into world_rotations (keyed by bone name). The caller converts those
   * to local rotations.
   *
   * @returns how far the end joint was asked to move, in target world units
   */
  static solve (limb: ProportionLimb, goal: Vector3, world_rotations: Map<string, Quaternion>): number {
    limb.target_root.getWorldPosition(_a)
    limb.target_mid.getWorldPosition(_b)
    limb.target_end.getWorldPosition(_c)
    const moved = _c.distanceTo(goal)

    _ba.subVectors(_a, _b)
    _bc.subVectors(_c, _b)
    const upper_length = _ba.length()
    const lower_length = _bc.length()
    if (upper_length < MIN_LENGTH || lower_length < MIN_LENGTH) return 0

    // 1. open or close the mid joint, about the axis it is already bent around, to
    //    bring the root-to-end distance towards the goal's distance from the root.
    //
    //    The straighter the limb, the more bend a given change in reach costs (it grows
    //    without bound at full extension) and the less defined its bend plane is. So
    //    only part of the change in reach is taken, shrinking smoothly to none as the
    //    limb straightens or folds flat. What is left over is a small shortfall along
    //    the limb's own direction, never across it.
    const current_angle = _ba.angleTo(_bc)
    const bend = Math.sin(current_angle)
    const reach = _a.distanceTo(_c)
    const shortest = Math.abs(upper_length - lower_length) * 1.001
    const longest = (upper_length + lower_length) * 0.9999
    const wanted = Math.min(longest, Math.max(shortest, reach + (_a.distanceTo(goal) - reach) * bend * bend))
    const cosine = (upper_length * upper_length + lower_length * lower_length - wanted * wanted) /
      (2 * upper_length * lower_length)
    const wanted_angle = Math.acos(Math.min(1, Math.max(-1, cosine)))
    const change = Math.min(MAX_HINGE_CHANGE, Math.max(-MAX_HINGE_CHANGE, wanted_angle - current_angle))

    _hinge.identity()
    _hinge_axis.crossVectors(_ba, _bc)
    if (_hinge_axis.lengthSq() > 0 && change !== 0) {
      _hinge.setFromAxisAngle(_hinge_axis.normalize(), change)
      _c.copy(_bc).applyQuaternion(_hinge).add(_b)
    }

    // 2. swing the whole limb about the root joint so the end joint lands on the goal
    _from.subVectors(_c, _a).normalize()
    _to.subVectors(goal, _a).normalize()
    _swing.setFromUnitVectors(_from, _to)

    const root_rotation = world_rotations.get(limb.target_root.name)
    const mid_rotation = world_rotations.get(limb.target_mid.name)
    if (root_rotation === undefined || mid_rotation === undefined) return 0
    root_rotation.premultiply(_swing)
    mid_rotation.premultiply(_hinge).premultiply(_swing)
    return moved
  }
}
