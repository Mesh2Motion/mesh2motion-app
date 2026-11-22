import { describe, it, expect } from 'vitest'
import { GeometryParser } from './GeometryParser'

type GeometryFixtureNode = {
  Vertices: { a: number[] }
  PolygonVertexIndex: { a: number[] }
}

interface SkeletonFixture {
  rawBones: Array<{ indices: number[]; weights: number[] }>
}

/** A single triangle. PolygonVertexIndex marks the last vertex of a face as (index ^ -1). */
function make_geo_node (): GeometryFixtureNode {
  return {
    Vertices: { a: [0, 0, 0, 1, 0, 0, 0, 1, 0] },
    PolygonVertexIndex: { a: [0, 1, -3] }
  }
}

/** Minimal stand-in for the skeleton deformer: each raw bone weights vertices by index. */
function make_skeleton (raw_bones: SkeletonFixture['rawBones']): SkeletonFixture {
  return { rawBones: raw_bones }
}

describe('GeometryParser skin weights', () => {
  it('drops zero-weight cluster entries so their bone ids never pair with a zero weight', () => {
    // bone 2 lists all three vertices but only actually influences vertex 1.
    // Exporters like Maya write the full cluster membership this way, and glTF
    // validators reject a non-zero joint index that carries a zero weight.
    const skeleton = make_skeleton([
      { indices: [0, 1, 2], weights: [1, 0.5, 1] },
      { indices: [], weights: [] },
      { indices: [0, 1, 2], weights: [0, 0.5, 0] }
    ])

    const parser = new GeometryParser()
    const geo_info = parser.parseGeoNode(make_geo_node(), skeleton)
    const buffers = parser.genBuffers(geo_info)

    expect(buffers.weightsIndices.length).toBe(12) // 3 vertices x 4 influences
    for (let i = 0; i < buffers.weightsIndices.length; i++) {
      if (buffers.vertexWeights[i] === 0) {
        expect(buffers.weightsIndices[i]).toBe(0)
      }
    }
  })

  it('keeps real influences and still normalizes each vertex to a full weight', () => {
    const skeleton = make_skeleton([
      { indices: [0, 1, 2], weights: [1, 0.5, 1] },
      { indices: [], weights: [] },
      { indices: [0, 1, 2], weights: [0, 0.5, 0] }
    ])

    const parser = new GeometryParser()
    const buffers = parser.genBuffers(parser.parseGeoNode(make_geo_node(), skeleton))

    // vertex 1 (second corner of the face) keeps both of its real influences
    const vertex_one_indices = buffers.weightsIndices.slice(4, 8)
    expect(vertex_one_indices).toContain(0)
    expect(vertex_one_indices).toContain(2)

    for (let vertex = 0; vertex < 3; vertex++) {
      const total = buffers.vertexWeights
        .slice(vertex * 4, vertex * 4 + 4)
        .reduce((sum: number, weight: number) => sum + weight, 0)
      expect(total).toBeCloseTo(1)
    }
  })

  it('leaves a vertex whose influences are all zero-weight fully unskinned', () => {
    const skeleton = make_skeleton([
      { indices: [0, 1, 2], weights: [1, 1, 0] },
      { indices: [2], weights: [0] }
    ])

    const parser = new GeometryParser()
    const buffers = parser.genBuffers(parser.parseGeoNode(make_geo_node(), skeleton))

    // vertex 2 had only zero-weight entries, so it pads out to joint 0 / weight 0
    expect(buffers.weightsIndices.slice(8, 12)).toEqual([0, 0, 0, 0])
    expect(buffers.vertexWeights.slice(8, 12)).toEqual([0, 0, 0, 0])
  })
})
