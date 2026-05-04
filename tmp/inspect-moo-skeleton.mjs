import fs from 'node:fs'
import path from 'node:path'
import { Bone, ImageLoader, SkinnedMesh, Texture, TextureLoader } from 'three'
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

const file = 'C:/Users/jeffa/Downloads/moosetest.glb'
const to_array_buffer = (buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)

const loader = new GLTFLoader()
const buffer = fs.readFileSync(file)
const gltf = await new Promise((resolve, reject) => {
  loader.parse(to_array_buffer(buffer), `${path.dirname(file)}/`, resolve, reject)
})

const bones = []
const skinned_meshes = []

gltf.scene.traverse((object) => {
  if (object.isBone || object instanceof Bone) bones.push(object)
  if (object.isSkinnedMesh || object instanceof SkinnedMesh) skinned_meshes.push(object)
})

const root_bones = bones.filter((bone) => !(bone.parent && (bone.parent.isBone || bone.parent instanceof Bone)))

console.log('total_bones', bones.length)
console.log('root_bones', root_bones.map((bone) => bone.name || '<unnamed>').join(' | ') || 'none')
console.log('skinned_meshes', skinned_meshes.map((mesh) => mesh.name || '<unnamed>').join(' | ') || 'none')

for (const bone of bones) {
  const parent = bone.parent && (bone.parent.isBone || bone.parent instanceof Bone)
    ? bone.parent.name || '<unnamed>'
    : '<scene>'
  const children = bone.children
    .filter((child) => child.isBone || child instanceof Bone)
    .map((child) => child.name || '<unnamed>')
    .join('|')

  console.log(`bone ${bone.name || '<unnamed>'} | parent=${parent} | children=${children || 'none'}`)
}