import { readFileSync } from 'fs'

function parseGLBJson(path) {
  const buf = readFileSync(path)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const c0Len = view.getUint32(12, true)
  const jsonBytes = buf.subarray(20, 20 + c0Len)
  return JSON.parse(jsonBytes.toString('utf8'))
}

function dumpRestPoses(label, path) {
  const json = parseGLBJson(path)
  const nodes = json.nodes || []
  const skins = json.skins || []

  const parentOf = new Map()
  nodes.forEach((n, i) => {
    if (Array.isArray(n.children)) for (const c of n.children) parentOf.set(c, i)
  })

  const jointIndices = new Set()
  for (const skin of skins) {
    if (Array.isArray(skin.joints)) for (const j of skin.joints) jointIndices.add(j)
  }

  console.log(`\n=== ${label} ===`)
  console.log(`Joints: ${jointIndices.size}`)

  for (const idx of jointIndices) {
    const node = nodes[idx]
    if (!node?.name) continue
    const r = node.rotation || [0, 0, 0, 1]
    const parentIdx = parentOf.get(idx)
    const parentName = parentIdx != null ? (nodes[parentIdx]?.name ?? `node_${parentIdx}`) : 'none'
    console.log(`  ${node.name}: local=[${r.map(v => v.toFixed(6)).join(', ')}] parent=${parentName}`)
  }
}

dumpRestPoses('M2M Rig', '/tmp/mesh2motion-app/static/test-files/retarget testing/m2m-sample-rig.glb')
dumpRestPoses('Mixamo Rig', '/tmp/mesh2motion-app/static/test-files/retarget testing/mixamo-sample-rig.glb')

try {
  dumpRestPoses('RPM Avatar', '/Users/mdproctor/claude/casehub/slots/223/agency/speech-demo/src/main/resources/META-INF/resources/avatar.glb')
} catch(e) {
  console.log('Could not load RPM avatar:', e.message)
}
