import { afterEach, describe, it, expect } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, LoadingManager, MeshPhongMaterial, TextureLoader, Uint16BufferAttribute } from 'three'
import { FBXTreeParser } from './FBXTreeParser'
import { FBXTree } from './FBXTree'
import { fbxGlobals, type FBXConnectionEntry } from './fbx-globals'
import type { FBXMaterialNode } from './FBXNodes'

/** One vertex, influenced by the four clusters passed in. */
function make_skinned_geometry (cluster_indices: number[], weights: number[]): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(cluster_indices, 4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4))
  return geometry
}

function make_parser (): FBXTreeParser {
  return new FBXTreeParser(new TextureLoader(), new LoadingManager())
}

afterEach(() => {
  fbxGlobals.connections = new Map<number, FBXConnectionEntry>()
  fbxGlobals.fbxTree = new FBXTree()
})

describe('FBXTreeParser.remapSkinIndices', () => {
  it('points skin indices at the compacted bone list', () => {
    // cluster 1 had no bone in the file, so clusters 0, 2 and 3 shifted down
    const geometry = make_skinned_geometry([0, 2, 3, 0], [0.25, 0.25, 0.25, 0.25])

    make_parser().remapSkinIndices(geometry, [0, -1, 1, 2])

    expect(Array.from(geometry.attributes.skinIndex.array)).toEqual([0, 1, 2, 0])
  })

  it('drops influences of a missing bone and renormalizes what is left', () => {
    const geometry = make_skinned_geometry([0, 1, 2, 0], [0.5, 0.25, 0.25, 0])

    make_parser().remapSkinIndices(geometry, [0, -1, 1, 2])

    expect(Array.from(geometry.attributes.skinIndex.array)).toEqual([0, 0, 1, 0])

    const weights = Array.from(geometry.attributes.skinWeight.array)
    expect(weights[0]).toBeCloseTo(2 / 3)
    expect(weights[1]).toBe(0)
    expect(weights[2]).toBeCloseTo(1 / 3)
    expect(weights[0] + weights[1] + weights[2] + weights[3]).toBeCloseTo(1)
  })

  it('leaves an unweighted vertex alone', () => {
    const geometry = make_skinned_geometry([0, 0, 0, 0], [0, 0, 0, 0])

    make_parser().remapSkinIndices(geometry, [0, 1])

    expect(Array.from(geometry.attributes.skinWeight.array)).toEqual([0, 0, 0, 0])
  })
})

describe('FBXTreeParser material node validation', () => {
  it('preserves valid Phong material properties', () => {
    fbxGlobals.connections = new Map([[11, { parents: [], children: [] }]])
    const node: FBXMaterialNode = {
      id: 11,
      attrName: 'FixturePhong',
      ShadingModel: { value: 'Phong' },
      Diffuse: { value: [0.2, 0.4, 0.6] },
      Opacity: { value: 0.5 }
    }

    const material = make_parser().parseMaterial(node, new Map())

    expect(material).toBeInstanceOf(MeshPhongMaterial)
    expect(material?.name).toBe('FixturePhong')
    expect(material?.opacity).toBe(0.5)
    expect(material?.transparent).toBe(true)
  })

  it('rejects a material node without a shading model', () => {
    const tree = new FBXTree()
    tree.add('Objects', { Material: { '22': { id: 22, attrName: 'MalformedMaterial' } } })
    fbxGlobals.fbxTree = tree

    expect(() => make_parser().parseMaterials(new Map())).toThrow('Invalid FBX material node 22')
  })
})
