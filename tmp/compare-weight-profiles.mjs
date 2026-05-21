import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { LoadingManager, Texture, TextureLoader, ImageLoader, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'

const dom = new JSDOM('', { contentType: 'text/html' })

globalThis.window ??= dom.window
globalThis.document ??= dom.window.document
globalThis.DOMParser ??= dom.window.DOMParser
globalThis.XMLSerializer ??= dom.window.XMLSerializer
globalThis.self ??= globalThis

window.URL ??= {
  createObjectURL: () => 'blob:node',
  revokeObjectURL: () => {}
}

TextureLoader.prototype.load = function load (_url, onLoad) {
  const texture = new Texture()
  if (onLoad) onLoad(texture)
  return texture
}

ImageLoader.prototype.load = function load (_url, onLoad) {
  const image = { width: 0, height: 0 }
  if (onLoad) onLoad(image)
  return image
}

const toArrayBuffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

const findSkinnedMesh = (root) => {
  let found = null
  root.traverse((object) => {
    if (found === null && (object.isSkinnedMesh || object instanceof SkinnedMesh)) {
      found = object
    }
  })
  return found
}

const summarizeWeights = (mesh, label) => {
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  const vertexCount = skinWeight.count

  let activeSum = 0
  let strongestSum = 0
  let secondSum = 0
  const activeHistogram = new Map()
  const strongestBuckets = {
    rigid_95_plus: 0,
    strong_80_95: 0,
    mixed_60_80: 0,
    blended_under_60: 0
  }

  for (let index = 0; index < vertexCount; index++) {
    const weights = [
      skinWeight.getX(index),
      skinWeight.getY(index),
      skinWeight.getZ(index),
      skinWeight.getW(index)
    ].filter((value) => value > 1e-4).sort((a, b) => b - a)

    const activeCount = weights.length
    const strongest = weights[0] ?? 0
    const second = weights[1] ?? 0

    activeSum += activeCount
    strongestSum += strongest
    secondSum += second
    activeHistogram.set(activeCount, (activeHistogram.get(activeCount) ?? 0) + 1)

    if (strongest >= 0.95) strongestBuckets.rigid_95_plus++
    else if (strongest >= 0.80) strongestBuckets.strong_80_95++
    else if (strongest >= 0.60) strongestBuckets.mixed_60_80++
    else strongestBuckets.blended_under_60++
  }

  console.log(`=== ${label} ===`)
  console.log('mesh_name', mesh.name || '<unnamed>')
  console.log('vertex_count', vertexCount)
  console.log('avg_active_influences', (activeSum / vertexCount).toFixed(4))
  console.log('avg_strongest_weight', (strongestSum / vertexCount).toFixed(4))
  console.log('avg_second_weight', (secondSum / vertexCount).toFixed(4))
  console.log('active_histogram', JSON.stringify(Object.fromEntries([...activeHistogram.entries()].sort((a, b) => a[0] - b[0]))))
  console.log('strongest_buckets', JSON.stringify(strongestBuckets))
  console.log()
}

const loadGlb = async (file) => {
  const buffer = fs.readFileSync(file)
  const loader = new GLTFLoader(new LoadingManager())
  return await new Promise((resolve, reject) => {
    loader.parse(toArrayBuffer(buffer), `${path.dirname(file)}/`, resolve, reject)
  })
}

const loadDae = (file) => {
  const text = fs.readFileSync(file, 'utf8')
  const loader = new ColladaLoader(new LoadingManager())
  return loader.parse(text, path.dirname(file))
}

const glbFile = 'C:/Users/jeffa/Downloads/testmixamo.glb'
const daeFile = 'C:/Users/jeffa/Downloads/testmixamoconverted.dae'

const gltf = await loadGlb(glbFile)
const dae = loadDae(daeFile)

const glbMesh = findSkinnedMesh(gltf.scene)
const daeMesh = findSkinnedMesh(dae.scene)

if (glbMesh === null) throw new Error('No skinned mesh found in GLB')
if (daeMesh === null) throw new Error('No skinned mesh found in DAE')

summarizeWeights(glbMesh, 'glb')
summarizeWeights(daeMesh, 'dae')