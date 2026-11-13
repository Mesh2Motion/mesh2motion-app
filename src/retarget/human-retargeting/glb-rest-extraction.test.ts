import { describe, it, expect } from 'vitest'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Bone, Quaternion } from 'three'
import { readFileSync } from 'fs'

const ARM_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']

const RPM_TEST_REST: Record<string, [number, number, number, number]> = {
  Hips:          [-0.029978, -0.000026, 0.000001, 0.999551],
  Spine:         [-0.013786, 0.000026, 0, 0.999905],
  Spine1:        [-0.036357, 0, 0, 0.999339],
  Spine2:        [0.063592, 0, 0, 0.997976],
  LeftShoulder:  [0.481688, 0.492769, -0.588907, 0.422308],
  LeftArm:       [0.384802, 0.069137, 0.038288, 0.919610],
  LeftForeArm:   [0.015386, -0.009235, 0.237663, 0.971182],
  LeftHand:      [0.015976, -0.120418, -0.040059, 0.991786],
}

function loadGLB(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const nodeBuf = readFileSync(path)
    const ab = new ArrayBuffer(nodeBuf.byteLength)
    const view = new Uint8Array(ab)
    for (let i = 0; i < nodeBuf.byteLength; i++) view[i] = nodeBuf[i]
    const loader = new GLTFLoader()
    loader.parse(ab, '', resolve, reject)
  })
}

describe('GLB rest pose extraction', () => {
  it('extracts RPM avatar rest poses and compares with test data', async () => {
    const gltf = await loadGLB('static/test-files/retarget testing/rpm-avatar.glb')

    const bones: Bone[] = []
    gltf.scene.traverse((n: any) => { if ((n as Bone).isBone) bones.push(n as Bone) })

    console.log(`\nTotal RPM bones: ${bones.length}`)

    console.log('\nLeftArm full parent chain:')
    let node: any = bones.find(b => b.name === 'LeftArm')
    while (node) {
      const q = node.quaternion
      console.log(`  ${node.name} (type=${node.type}, isBone=${(node as any).isBone}): q=(${q.x.toFixed(6)}, ${q.y.toFixed(6)}, ${q.z.toFixed(6)}, ${q.w.toFixed(6)})`)
      node = node.parent
    }

    console.log('\n=== RPM REST POSE: GLB vs TEST DATA ===')
    console.log(
      'Bone'.padEnd(16),
      'GLB local rest'.padEnd(52),
      'Test local rest'.padEnd(52),
      'Diff'
    )

    for (const name of ARM_BONES) {
      const bone = bones.find(b => b.name === name)
      if (!bone) { console.log(`  ${name}: NOT FOUND`); continue }

      const glb_q = bone.quaternion
      const test_data = RPM_TEST_REST[name]
      const test_q = new Quaternion(test_data[0], test_data[1], test_data[2], test_data[3])

      const diff_deg = (glb_q.angleTo(test_q) * 180 / Math.PI).toFixed(1)

      console.log(
        name.padEnd(16),
        `(${glb_q.x.toFixed(6)}, ${glb_q.y.toFixed(6)}, ${glb_q.z.toFixed(6)}, ${glb_q.w.toFixed(6)})`.padEnd(52),
        `(${test_q.x.toFixed(6)}, ${test_q.y.toFixed(6)}, ${test_q.z.toFixed(6)}, ${test_q.w.toFixed(6)})`.padEnd(52),
        `${diff_deg}°`
      )
    }

    gltf.scene.updateMatrixWorld(true)
    console.log('\n=== RPM WORLD QUATERNIONS (from GLB) ===')
    for (const name of ARM_BONES) {
      const bone = bones.find(b => b.name === name)
      if (!bone) continue
      const wq = new Quaternion()
      bone.getWorldQuaternion(wq)
      console.log(`  ${name}: (${wq.x.toFixed(6)}, ${wq.y.toFixed(6)}, ${wq.z.toFixed(6)}, ${wq.w.toFixed(6)})`)
    }

    expect(bones.length).toBeGreaterThan(0)
  })
})
