// TEMPORARY harness. Exercises RetargetDiagnostics against the two known-good sample
// rigs so we can confirm the instrumentation runs and reports "clean" before pointing it
// at the rig that actually misbehaves. Delete once the real bug is found.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Object3D, Quaternion, SkinnedMesh, type Skeleton } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RetargetUtils } from './RetargetUtils.ts'
import { RetargetDiagnostics } from './RetargetDiagnostics.ts'
import { type RestPoseSnapshot } from './interfaces/RestPoseSnapshot'
import { Rig } from './human-retargeting/Rig.ts'
import { HumanChainConfig } from './human-retargeting/HumanChainConfig.ts'

async function load_glb (path: string): Promise<Object3D> {
  const buffer = readFileSync(path)

  // allocate inside this realm. A Node ArrayBuffer fails GLTFLoader's
  // `data instanceof ArrayBuffer` check under jsdom and gets parsed as JSON instead
  const array_buffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(array_buffer).set(buffer)

  const loader = new GLTFLoader()
  return await new Promise((resolve, reject) => {
    loader.parse(array_buffer, '', (gltf) => resolve(gltf.scene), reject)
  })
}

function first_skinned_mesh (root: Object3D): SkinnedMesh {
  let found: SkinnedMesh | null = null
  root.traverse((child) => {
    if (found === null && child instanceof SkinnedMesh) found = child
  })
  if (found === null) throw new Error('no skinned mesh')
  return found
}

describe('RetargetDiagnostics against known-good rigs', () => {
  // m2m-sample-rig.glb is skipped: its embedded texture never finishes decoding under
  // jsdom, so GLTFLoader's onLoad never fires. The Mixamo rig is enough of a baseline.

  it('reports a clean rest pose for the Mixamo sample rig', async () => {
    const scene = await load_glb('static/test-files/retarget testing/mixamo-sample-rig.glb')
    scene.updateMatrixWorld(true)
    RetargetUtils.reset_skinned_mesh_to_rest_pose(scene)

    const real_skeleton: Skeleton = first_skinned_mesh(scene).skeleton
    const rest = RetargetUtils.capture_bone_rest_transforms(real_skeleton)
    const snapshot: RestPoseSnapshot = RetargetDiagnostics.capture_rest_snapshot(real_skeleton, rest)

    const clone: Skeleton = RetargetUtils.clone_skeleton(real_skeleton, rest)
    const rig: Rig = new Rig(clone).fromConfig(HumanChainConfig.mixamo_config)

    RetargetDiagnostics.report_skeleton_structure('MIXAMO-TARGET', real_skeleton)
    RetargetDiagnostics.report_pose_fidelity('MIXAMO-TARGET', snapshot, rig)

    expect(max_local_delta_degrees(snapshot, rig)).toBeLessThan(NOISE_DEGREES)
  })

  // Reproduce the condition I believe the custom rig hits: a non-identity transform on
  // the armature node above the bones. If clone_skeleton's native Skeleton.pose() folds
  // that transform into the root bone's LOCAL, the fidelity check must light up.
  it('detects a corrupted rest pose when the armature carries a rotation', async () => {
    const scene = await load_glb('static/test-files/retarget testing/mixamo-sample-rig.glb')

    // author the rig the way a Z-up tool would export it
    const armature: Object3D | undefined = scene.children.find((c) => c.name.toLowerCase().includes('armature'))
    if (armature === undefined) throw new Error('no armature node')
    armature.rotation.x = -Math.PI / 2
    scene.updateMatrixWorld(true)

    const real_skeleton: Skeleton = first_skinned_mesh(scene).skeleton

    // crucial: a rig actually authored this way has the armature transform baked into its
    // inverse bind matrices, because glTF inverseBindMatrices are in scene space. Rotating
    // the node alone leaves boneInverses stale and the bug stays hidden
    real_skeleton.calculateInverses()

    const rest = RetargetUtils.capture_bone_rest_transforms(real_skeleton)
    const snapshot: RestPoseSnapshot = RetargetDiagnostics.capture_rest_snapshot(real_skeleton, rest)

    console.log('\n=== -90 X armature, cloned WITH the rest snapshot (the fix) ===')
    const fixed: Rig = new Rig(RetargetUtils.clone_skeleton(real_skeleton, rest))
      .fromConfig(HumanChainConfig.mixamo_config)
    RetargetDiagnostics.report_skeleton_structure('ROTATED-ARMATURE', real_skeleton)
    RetargetDiagnostics.report_pose_fidelity('FIXED', snapshot, fixed)

    // and the old behaviour: native Skeleton.pose() folds the armature transform into the
    // root bone's local. Kept so the check is proven to have teeth, not passing vacuously
    console.log('\n=== same rig, restored with native Skeleton.pose() (the old bug) ===')
    const posed_clone: Skeleton = RetargetUtils.clone_skeleton(real_skeleton, rest)
    posed_clone.pose()
    const broken: Rig = new Rig(posed_clone).fromConfig(HumanChainConfig.mixamo_config)
    RetargetDiagnostics.report_pose_fidelity('NATIVE-POSE', snapshot, broken)

    expect(max_local_delta_degrees(snapshot, fixed)).toBeLessThan(NOISE_DEGREES)
    expect(max_local_delta_degrees(snapshot, broken)).toBeGreaterThan(89)
  })
})

// glTF stores rotations as float32 and Matrix4.decompose round-trips them, so a fraction
// of a degree of residual is expected. The defect this guards against is ~90 degrees
const NOISE_DEGREES = 0.5

/** Largest rest-pose local rotation error across all bones, in degrees. */
function max_local_delta_degrees (snapshot: RestPoseSnapshot, rig: Rig): number {
  let worst = 0

  rig.tpose.joints.forEach((joint, index) => {
    const reference: Quaternion | undefined = snapshot.local_rotations[index]
    if (reference === undefined) return

    const rot = joint.local.rot
    const actual = new Quaternion(rot[0], rot[1], rot[2], rot[3])
    const delta = reference.clone().invert().multiply(actual)
    const w = Math.min(1, Math.abs(delta.w))
    worst = Math.max(worst, Math.acos(w) * 2 * 180 / Math.PI)
  })

  return worst
}
