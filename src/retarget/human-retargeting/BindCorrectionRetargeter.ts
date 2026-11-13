import {
  type AnimationClip, type Bone, type Object3D, type Skeleton,
  Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack
} from 'three'
import { RetargetUtils, type TrackNameParts } from '../RetargetUtils.ts'

const BIND_EPSILON = 1e-6

// Canonical rest poses of the Mixamo authoring rig — the skeleton that M2M's
// animations were originally created against. M2M renames bones (pelvis →
// Hips, upperarm_l → LeftArm) but keeps keyframe values in the original
// Mixamo rest space, so the source rest must match that authoring rig, NOT
// M2M's runtime skeleton (which has a different rest pose: Z-up root bone,
// restructured hierarchy, rotated fingers).
//
// These values are stable — Mixamo's base rig hasn't changed. Sourced from
// retarget.mjs lines 714-821, which has been validated in production.
//
// TODO: extract to a versioned JSON data file so the canonical rest can be
// updated without code changes if the authoring rig ever changes.

const _CANONICAL_REST: Record<string, [number, number, number, number]> = {
  Head: [-0.11706881878098431, 9438845082943482e-24, 372654613409334e-22, 0.993123804804428],
  Hips: [0.0010741148761599644, 6537898515070053e-23, 7022659074474357e-26, 0.9999994231384476],
  LeftArm: [-0.003089573263103852, 0.08018148459223169, -0.025041829737156785, 0.9964608827384491],
  LeftFoot: [0.5523737034239063, 2518875693487157e-19, 0.0036538113016644914, 0.8335885543726441],
  LeftForeArm: [-26826767953574183e-23, 12816740072681333e-23, 0.012369379808617674, 0.9999234962951223],
  LeftHand: [-0.0012910117424963744, 0.002537815819541244, 0.010116448936771993, 0.9999447735952517],
  LeftHandIndex1: [0.028803290204768833, 0.011362422123976328, 0.055965724298468224, 0.9979524555518633],
  LeftHandIndex2: [-0.005195237841915152, 0.014315447122751807, 21581682553071412e-20, 0.9998840087229335],
  LeftHandIndex3: [-0.0013151015878908295, -0.016941197343945148, -0.006458334440614796, 0.9998347644768737],
  LeftHandMiddle1: [0.027532617383276645, -0.031607746403852485, 0.016931179482824785, 0.9989775976007271],
  LeftHandMiddle2: [-0.001267981765488788, 0.0010468621884392817, -0.004466175725402764, 0.9999886747239598],
  LeftHandMiddle3: [-0.0015803533040544947, 0.0018352886876119797, 0.0038040706030556736, 0.9999898315711762],
  LeftHandPinky1: [0.009345046842530319, -0.07377447953394943, -0.04207784173776388, 0.9963430390695086],
  LeftHandPinky2: [-0.0019002180814112143, 2770864318134059e-19, 4968185265866393e-19, 0.9999980327809131],
  LeftHandPinky3: [-0.0014157518824255099, -0.005595319155644295, -0.004606740515194791, 0.9999727326242506],
  LeftHandRing1: [0.018207541076892743, -0.03436008716699126, -0.036855349348364555, 0.9985637451229231],
  LeftHandRing2: [-6571286469542868e-19, 0.015477225242721515, 0.01003471962236163, 0.9998296495318929],
  LeftHandRing3: [0.001815607007583071, -0.003099595768579846, 0.0072046170631637615, 0.999967594260012],
  LeftHandThumb1: [0.1900227602341495, -0.058826116539083484, 0.3478783626049766, 0.9161940209594684],
  LeftHandThumb2: [0.01801363066187901, -0.020968588375318502, -0.22063576333056306, 0.9749644544258214],
  LeftHandThumb3: [-0.014498565873099356, 0.03466160908487025, 0.011599642488048602, 0.9992266072970502],
  LeftLeg: [-0.022987686472704008, -6608912898930547e-19, 7960712093047862e-20, 0.9997355266049326],
  LeftShoulder: [0.5181706903502131, 0.5134387363832796, -0.48299308003518876, 0.4843526489955184],
  LeftToeBase: [0.23652217735689587, 6644108661216591e-19, -0.002051152932444189, 0.9716236982227819],
  LeftUpLeg: [-4952055077835167e-20, 0.0032567616062252223, 0.9999946186652781, -39203576089550014e-20],
  Neck: [0.2225107795455935, -23352293238692193e-23, -19647139012020554e-24, 0.974930229804142],
  RightArm: [-0.003089570938390283, -0.08018164882954634, 0.025041835809991725, 0.9964608693782484],
  RightFoot: [0.5523737112340288, -25188760500252676e-20, -0.0036538107149212758, 0.8335885491999105],
  RightForeArm: [-2706717415294191e-22, 60675494372234465e-25, -0.012369382961452784, 0.9999234962561284],
  RightHand: [-0.0012910114923260908, -0.002537815924782367, -0.010116450486313036, 0.9999447735796301],
  RightHandIndex1: [0.028803284769926347, -0.01136242475457741, -0.05596571258489258, 0.9979524563349205],
  RightHandIndex2: [-0.005195229421057241, -0.014315442233259087, -21582506177354608e-20, 0.9998840088349297],
  RightHandIndex3: [-0.0013151045827228072, 0.016941319655899355, 0.006458327385746035, 0.9998347624459482],
  RightHandMiddle1: [0.027532662650122483, 0.03160778647114273, -0.01693120529165708, 0.9989775946478099],
  RightHandMiddle2: [-0.0012680273836480952, -0.0010469047250576836, 0.004466199390698661, 0.9999886745158897],
  RightHandMiddle3: [-0.0015803562094451136, -0.001835288773706009, -0.003804068167924464, 0.9999898315756854],
  RightHandPinky1: [0.009345030274151258, 0.07377446325595405, 0.04207784564870347, 0.9963430402658229],
  RightHandPinky2: [-0.0019002008217559384, -2769620503994165e-19, -4968229018870381e-19, 0.9999980328459891],
  RightHandPinky3: [-0.0014157497333212687, 0.0055951881780210025, 0.004606743315319843, 0.9999727333471813],
  RightHandRing1: [0.01820754441109714, 0.03436008722907556, 0.03685535429214536, 0.9985637448787448],
  RightHandRing2: [-6571335802527884e-19, -0.015477230302375519, -0.010034723368684675, 0.999829649412505],
  RightHandRing3: [0.0018156069598940002, 0.003099598646436032, -0.007204626788931167, 0.9999675941811231],
  RightHandThumb1: [0.19002276085311107, 0.05882618704962336, -0.3478783387552461, 0.9161940229953188],
  RightHandThumb2: [0.018013663274561078, 0.020968550782212388, 0.22063584956274163, 0.9749644350943654],
  RightHandThumb3: [-0.014498582331377526, -0.03466161961137741, -0.011599713293476643, 0.9992266058762234],
  RightLeg: [-0.022987685898989207, 6609402907891899e-19, -7960698692017099e-20, 0.9997355265857409],
  RightShoulder: [0.5181706006117709, -0.5134387953473804, 0.4829931766210871, 0.4843525890882128],
  RightToeBase: [0.23652222014073046, -6644109035597298e-19, 0.0020511526077556528, 0.9716236878087238],
  RightUpLeg: [49438593286575395e-21, 0.003256759408127677, 0.9999946186765544, 3920356017771739e-19],
  Spine: [-0.018332562694809717, -14544833124647894e-23, 26976261645093277e-26, 0.9998319444511763],
  Spine1: [-0.03815628571181615, 20010687323521798e-24, 534807122500512e-23, 0.9992717837809081],
  Spine2: [-0.056998031890724846, 13546308636882866e-23, -8861325315468363e-25, 0.9983742907149431]
}

const _CANONICAL_WORLD_REST: Record<string, [number, number, number, number]> = {
  Head: [-0.005402766806732544, -15440620455356296e-23, 834223242528311e-24, 0.9999854049488961],
  Hips: [0.0010741148761599644, 6537898515070053e-23, 7022659074474357e-26, 0.9999994231384476],
  LeftArm: [0.4889318420664182, 0.5108287295941205, -0.5108290884863605, 0.48893078190839623],
  LeftFoot: [-7112359875637768e-20, 0.5349085331963127, 0.8448985998862468, -0.004383145577274271],
  LeftForeArm: [0.49521300584988104, 0.5047420653526237, -0.5047420379230214, 0.4952120815979495],
  LeftHand: [0.5009334720626235, 0.5016127781291206, -0.4977959877649929, 0.49964931327533474],
  LeftHandIndex1: [0.5480286232738694, 0.46388966319384123, -0.47756977349452234, 0.506357703809076],
  LeftHandIndex2: [0.5522711480640051, 0.4734474077351049, -0.46714980714345783, 0.5026083894226862],
  LeftHandIndex3: [0.5405471533897316, 0.46903549072233974, -0.4790521335412708, 0.5082553896043159],
  LeftHandMiddle1: [0.5069366564823887, 0.46312011824587895, -0.5184714785961669, 0.5096295836965867],
  LeftHandMiddle2: [0.5047591066222094, 0.46656986579426646, -0.5196237813564338, 0.5074661907650336],
  LeftHandMiddle3: [0.5066805225023663, 0.46639751835165716, -0.5160243364733309, 0.509379123507728],
  LeftHandPinky1: [0.4459394011607033, 0.4793433042957962, -0.5586434331057456, 0.5092009093395086],
  LeftHandPinky2: [0.4453638702749085, 0.48032344738196137, -0.5573549331147079, 0.5101920146245817],
  LeftHandPinky3: [0.4392981168466072, 0.4802964151504903, -0.5615019919023976, 0.5109286011992389],
  LeftHandRing1: [0.47371996160924823, 0.4931227775910745, -0.5418410288696247, 0.4886999364902444],
  LeftHandRing2: [0.48665266892609377, 0.49620490515614146, -0.5291888435031511, 0.48673303168821197],
  LeftHandRing3: [0.48945530931580683, 0.4902132045285772, -0.5280743092981476, 0.4911843263440915],
  LeftHandThumb1: [0.6991138207882592, 0.16132571576360077, -0.40704633814367386, 0.5652673372230799],
  LeftHandThumb2: [0.64766423234777, 0.2923511094450446, -0.5391393932239583, 0.4520957758831027],
  LeftHandThumb3: [0.6626872004096495, 0.3080994487427915, -0.5067905211225114, 0.45725679518685386],
  LeftLeg: [6202111480182034e-19, -0.020805293540463354, 0.9997832430476497, -47118992773536965e-20],
  LeftShoulder: [0.4605450937998788, 0.4559956590278878, -0.537559006794696, 0.5394409087622226],
  LeftToeBase: [-0.002764355526654178, 0.7195640056310856, 0.6944147145329627, -0.0028643286082629046],
  LeftUpLeg: [-4987623525000119e-20, 0.0021826506059020026, 0.9999975399461294, -39198262713485737e-20],
  Neck: [0.11170149382802401, -1628868597421303e-22, -18309282630496044e-24, 0.9937418056399563],
  RightArm: [0.48893190585215524, -0.510828798312402, 0.5108290283825504, 0.48893071200502375],
  RightFoot: [7112360405196955e-20, 0.5349085398019146, 0.844898595705669, 0.004383145306035045],
  RightForeArm: [0.4952130023257164, -0.5047420673116668, 0.5047420415306929, 0.49521208229448166],
  RightHand: [0.5009334695181179, -0.5016127792807403, 0.49779599067075153, 0.49964931459617906],
  RightHandIndex1: [0.5480286139806538, -0.4638896746971551, 0.47756977858103167, 0.5063577013132781],
  RightHandIndex2: [0.5522711446711094, -0.4734474082706649, 0.4671498147721218, 0.5026083883587248],
  RightHandIndex3: [0.5405470934413514, -0.4690354263302402, 0.47905220274050364, 0.5082554503330304],
  RightHandMiddle1: [0.5069366680435416, -0.4631200623546733, 0.5184715098400317, 0.5096295939664325],
  RightHandMiddle2: [0.5047591061928465, -0.46656986723577604, 0.5196237819671778, 0.5074661920185282],
  RightHandMiddle3: [0.5066805195140975, -0.4663975225827095, 0.5160243369168757, 0.5093791249234989],
  RightHandPinky1: [0.44593939683725603, -0.4793433241517071, 0.5586434219640141, 0.5092009094272859],
  RightHandPinky2: [0.4453638073881448, -0.4803233923217868, 0.5573549834847424, 0.5101920690951159],
  RightHandPinky3: [0.4392981269307416, -0.4802964267888911, 0.5615019867791732, 0.5109285899785551],
  RightHandRing1: [0.473719957983008, -0.49312277921221886, 0.541841035805614, 0.4886999335659278],
  RightHandRing2: [0.48665266754747677, -0.4962049100848307, 0.5291888437972645, 0.4867330306200585],
  RightHandRing3: [0.4894553112113337, -0.49021320332208906, 0.5280743062058759, 0.4911843318554558],
  RightHandThumb1: [0.6991137732035737, -0.16132569450370315, 0.40704638897707807, 0.5652673641991798],
  RightHandThumb2: [0.6476641963757893, -0.2923511418798965, 0.5391394672107036, 0.45209571648691005],
  RightHandThumb3: [0.6626871862817486, -0.3080994479425299, 0.5067905521115058, 0.4572567801626834],
  RightLeg: [-6202113471683521e-19, -0.020805295090456907, 0.9997832430151556, 47119017271936915e-20],
  RightShoulder: [0.46054507521936333, -0.45599564278848104, 0.5375590232993736, 0.5394409245169026],
  RightToeBase: [0.0027643555231566678, 0.7195640416379069, 0.6944146772223956, 0.0028643286020973192],
  RightUpLeg: [49925034443819034e-21, 0.002182648459062353, 0.9999975399486299, 39198198974856475e-20],
  Spine: [-0.017258617754264162, -800818266828763e-22, 13823133775055108e-25, 0.9998510589648868],
  Spine1: [-0.055396652424023016, -5997624651397324e-23, 332759956947242e-23, 0.9984644264570511],
  Spine2: [-0.11221710079276989, 7513757486198981e-23, -8485311473269302e-24, 0.9936837134066652]
}

const CANONICAL_SOURCE_REST: ReadonlyMap<string, Quaternion> = new Map(
  Object.entries(_CANONICAL_REST).map(
    ([bone, [x, y, z, w]]) => [bone, new Quaternion(x, y, z, w)] as const
  )
)

const CANONICAL_SOURCE_WORLD_REST: ReadonlyMap<string, Quaternion> = new Map(
  Object.entries(_CANONICAL_WORLD_REST).map(
    ([bone, [x, y, z, w]]) => [bone, new Quaternion(x, y, z, w)] as const
  )
)

export const CANONICAL_SOURCE_HIP_HEIGHT = 0.984089

export interface BindCorrection {
  L: Quaternion | null
  R: Quaternion | null
}

export interface BindCorrectionRetargetOptions {
  hip_scale: number
  root_correction_quat: Quaternion | null
  position_bone_name: string | null
}

export class BindCorrectionRetargeter {
  private static world_quat (bone: Bone): Quaternion {
    const q = bone.quaternion.clone()
    let current: Object3D | null = bone.parent
    while (current !== null && (current as Bone).isBone === true) {
      q.premultiply(current.quaternion)
      current = current.parent
    }
    return q
  }

  /**
   * Compute L/R bind correction quaternions using hardcoded canonical source
   * rest and the target skeleton's actual rest pose.
   *
   * Formula:
   *   L = Rt × Wt⁻¹ × Ws × Rs⁻¹   (pre-multiply correction)
   *   R = Ws⁻¹ × Wt                  (post-multiply correction)
   *
   * Rs/Ws come from the canonical Mixamo authoring rig (frozen constants).
   * Rt/Wt are computed from the target skeleton at runtime.
   *
   * @param target_skeleton target skeleton at rest pose
   * @param bone_mapping target bone name → source bone name
   */
  static compute_bind_corrections (
    target_skeleton: Skeleton,
    bone_mapping: Map<string, string>
  ): Map<string, BindCorrection> {
    const target_by_name = new Map<string, Bone>(
      target_skeleton.bones.map(b => [b.name, b])
    )

    const corrections = new Map<string, BindCorrection>()

    for (const [target_bone_name] of bone_mapping) {
      const Rs = CANONICAL_SOURCE_REST.get(target_bone_name)
      const Ws = CANONICAL_SOURCE_WORLD_REST.get(target_bone_name)
      if (Rs === undefined || Ws === undefined) continue

      const target_bone = target_by_name.get(target_bone_name)
      if (target_bone === undefined) continue

      const Rt = target_bone.quaternion.clone()
      const Wt = this.world_quat(target_bone)

      // L = Rt × Wt⁻¹ × Ws × Rs⁻¹
      const L = Rt.clone()
        .multiply(Wt.clone().invert())
        .multiply(Ws.clone())
        .multiply(Rs.clone().invert())

      // R = Ws⁻¹ × Wt
      const R = Ws.clone().invert().multiply(Wt.clone())

      if (L.w < 0) { L.x = -L.x; L.y = -L.y; L.z = -L.z; L.w = -L.w }
      if (R.w < 0) { R.x = -R.x; R.y = -R.y; R.z = -R.z; R.w = -R.w }

      const identity_L = (1 - Math.abs(L.w)) < BIND_EPSILON
      const identity_R = (1 - Math.abs(R.w)) < BIND_EPSILON

      if (identity_L && identity_R) continue

      corrections.set(target_bone_name, {
        L: identity_L ? null : L,
        R: identity_R ? null : R
      })
    }

    return corrections
  }

  /**
   * Retarget a source animation clip onto a target skeleton using bind corrections.
   *
   * For each track:
   * - Quaternion tracks: rename bone, apply L/R correction
   * - Position tracks (hips only): rename, rotate by root correction, scale
   * - Other tracks: skip
   */
  static retarget (
    source_clip: AnimationClip,
    corrections: Map<string, BindCorrection>,
    bone_mapping: Map<string, string>,
    options: BindCorrectionRetargetOptions
  ): AnimationClip {
    const reverse_mapping = RetargetUtils.reverse_bone_mapping_one_to_one(bone_mapping)
    const new_tracks: Array<QuaternionKeyframeTrack | VectorKeyframeTrack> = []
    const tmp_q = new Quaternion()
    const tmp_v = new Vector3()

    for (const track of source_clip.tracks) {
      const parts: TrackNameParts | null = RetargetUtils.parse_track_name_for_metadata(track.name)
      if (parts === null) continue

      const source_bone_name = parts.bone_name
      const property = parts.property

      const target_bone_name = reverse_mapping.get(source_bone_name)
      if (target_bone_name === undefined) continue

      if (property === 'quaternion') {
        const next = track.clone()
        next.name = `${target_bone_name}.quaternion`

        const correction = corrections.get(target_bone_name)
        if (correction !== undefined) {
          for (let i = 0; i < next.values.length; i += 4) {
            tmp_q.set(next.values[i], next.values[i + 1], next.values[i + 2], next.values[i + 3])
            if (correction.L !== null) tmp_q.premultiply(correction.L)
            if (correction.R !== null) tmp_q.multiply(correction.R)
            next.values[i] = tmp_q.x
            next.values[i + 1] = tmp_q.y
            next.values[i + 2] = tmp_q.z
            next.values[i + 3] = tmp_q.w
          }
        }

        new_tracks.push(next as QuaternionKeyframeTrack)
      } else if (property === 'position' && source_bone_name === (options.position_bone_name ?? '')) {
        const next = track.clone()
        next.name = `${target_bone_name}.position`

        for (let i = 0; i < next.values.length; i += 3) {
          if (options.root_correction_quat !== null) {
            tmp_v.set(next.values[i], next.values[i + 1], next.values[i + 2])
              .applyQuaternion(options.root_correction_quat)
            next.values[i] = tmp_v.x
            next.values[i + 1] = tmp_v.y
            next.values[i + 2] = tmp_v.z
          }
          if (options.hip_scale !== 1) {
            next.values[i] *= options.hip_scale
            next.values[i + 1] *= options.hip_scale
            next.values[i + 2] *= options.hip_scale
          }
        }

        new_tracks.push(next as VectorKeyframeTrack)
      }
    }

    const retargeted = source_clip.clone()
    retargeted.tracks = new_tracks
    return retargeted
  }
}
