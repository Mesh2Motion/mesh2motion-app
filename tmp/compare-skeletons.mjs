import fs from 'node:fs'
import path from 'node:path'
import { Bone, SkinnedMesh, Texture, TextureLoader, ImageLoader } from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

globalThis.window ??= {
  URL: {
    createObjectURL: () => 'blob:node',
    revokeObjectURL: () => {}
  }
}

globalThis.self ??= globalThis

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
const fbxFile = 'C:/Users/jeffa/Downloads/Meshy_AI_Icebound_Dragon_Knighmix.fbx'
const glbFile = 'C:/Users/jeffa/Downloads/testmixamo.glb'

const summarize = (root, label) => {
  const bones = []
  const skinnedMeshes = []
  const objectLines = []

  root.traverse((object) => {
    if (object.isBone || object instanceof Bone) bones.push(object)
    if (object.isSkinnedMesh || object instanceof SkinnedMesh) skinnedMeshes.push(object)
    objectLines.push(`${object.type} ${object.name || '<unnamed>'}`)
  })

  const rootBones = bones.filter((bone) => !(bone.parent && (bone.parent.isBone || bone.parent instanceof Bone)))
  const byName = new Map()

  for (const bone of bones) {
    byName.set(bone.name, (byName.get(bone.name) ?? 0) + 1)
  }

  console.log(`=== ${label} ===`)
  console.log('total_bones', bones.length)
  console.log('root_bones', rootBones.map((bone) => bone.name || '<unnamed>').join(' | ') || 'none')
  console.log('skinned_meshes', skinnedMeshes.map((mesh) => mesh.name || '<unnamed>').join(' | ') || 'none')
  console.log('object_types')
  for (const line of objectLines) console.log(line)

  for (const bone of bones) {
    const parentName = bone.parent && (bone.parent.isBone || bone.parent instanceof Bone)
      ? bone.parent.name || '<unnamed>'
      : '<scene>'
    const childBones = bone.children
      .filter((child) => child.isBone || child instanceof Bone)
      .map((child) => child.name || '<unnamed>')

    console.log(`bone ${bone.name || '<unnamed>'} | parent=${parentName} | children=${childBones.join('|') || 'none'}`)
  }

  console.log()

  return new Set(bones.map((bone) => bone.name))
}

console.log('read fbx')
const fbxBuffer = fs.readFileSync(fbxFile)
console.log('parse fbx')
const fbxRoot = new FBXLoader().parse(toArrayBuffer(fbxBuffer), `${path.dirname(fbxFile)}/`)

console.log('read glb')
const glbBuffer = fs.readFileSync(glbFile)
console.log('parse glb')
const gltf = await new Promise((resolve, reject) => {
  new GLTFLoader().parse(toArrayBuffer(glbBuffer), `${path.dirname(glbFile)}/`, resolve, reject)
})

const fbxNames = summarize(fbxRoot, 'fbx')
const glbNames = summarize(gltf.scene, 'glb')
const onlyInFbx = [...fbxNames].filter((name) => !glbNames.has(name))
const onlyInGlb = [...glbNames].filter((name) => !fbxNames.has(name))

console.log('=== name_set_diff ===')
console.log('only_in_fbx', onlyInFbx.join(' | ') || 'none')
console.log('only_in_glb', onlyInGlb.join(' | ') || 'none')
