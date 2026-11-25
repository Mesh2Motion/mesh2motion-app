import { describe, it, expect, vi } from 'vitest'
import { TextParser } from './TextParser'
import { isFbxFormatASCII, getFbxVersion } from './fbx-utils'

/**
 * A minimal but structurally realistic ASCII FBX document, exercising the shapes that
 * previously desynchronised the parser:
 *  - no leading `; FBX 7.x.x project file` comment block
 *  - document-level properties (`CreationTime`, `Creator`) outside any node
 *  - a node header carrying attributes before the brace (`SceneInfo: ..., ... {`)
 *  - property values containing `{` and `}`
 */
const ASCII_FBX = [
  'FBXHeaderExtension:  {',
  '\tFBXHeaderVersion: 1003',
  '\tFBXVersion: 7400',
  '\tCreationTimeStamp:  {',
  '\t\tVersion: 1000',
  '\t\tYear: 2026',
  '\t}',
  '\tCreator: "FBX SDK/FBX Plugins version 2020.0"',
  '\tSceneInfo: "SceneInfo::GlobalInfo", "UserData" {',
  '\t\tType: "UserData"',
  '\t\tProperties70:  {',
  '\t\t\tP: "DocumentUrl", "KString", "Url", "", "D:\\Art\\{Project}\\char.fbx"',
  '\t\t}',
  '\t}',
  '}',
  'CreationTime: "2026-08-03 10:15:00:000"',
  'Creator: "FBX SDK/FBX Plugins version 2020.0"',
  '',
  '; Object definitions',
  ';------------------------------------------------------------------',
  '',
  'GlobalSettings:  {',
  '\tVersion: 1000',
  '\tProperties70:  {',
  '\t\tP: "UpAxis", "int", "Integer", "",1',
  '\t\tP: "UnitScaleFactor", "double", "Number", "",1',
  '\t}',
  '}',
  'Objects:  {',
  '\tGeometry: 140234, "Geometry::", "Mesh" {',
  '\t\tVertices: *9 {',
  '\t\t\ta: 0,0,0,1,0,0,0,1,0',
  '\t\t}',
  '\t\tPolygonVertexIndex: *3 {',
  '\t\t\ta: 0,1,-3',
  '\t\t}',
  '\t}',
  '}',
  'Connections:  {',
  '\tC: "OO",140234,0',
  '}'
].join('\n')

describe('ASCII FBX format detection', () => {
  it('accepts a document with no leading comment block', () => {
    // Regression: the upstream heuristic sampled offset 6 ('d' of "FBXHeaderExtension")
    // against the 4th char of the binary magic and rejected the file as "Unknown format".
    expect(isFbxFormatASCII(ASCII_FBX)).toBe(true)
  })

  it('accepts a document with a leading comment block', () => {
    expect(isFbxFormatASCII('; FBX 7.4.0 project file\n\n' + ASCII_FBX)).toBe(true)
  })

  it('rejects a binary FBX', () => {
    expect(isFbxFormatASCII('Kaydara FBX Binary  \0\u001a\0')).toBe(false)
  })

  it('rejects files that are not FBX at all', () => {
    expect(isFbxFormatASCII('<!DOCTYPE html>\n<html><title>404</title></html>')).toBe(false)
    expect(isFbxFormatASCII('{"asset":{"version":"2.0"}}')).toBe(false)
  })

  it('reads the version regardless of spacing after the colon', () => {
    expect(getFbxVersion(ASCII_FBX)).toBe(7400)
    expect(getFbxVersion('\tFBXVersion:7300')).toBe(7300)
  })
})

describe('TextParser', () => {
  it('parses without throwing and returns to indent 0', () => {
    const parser = new TextParser()
    const tree = parser.parse(ASCII_FBX)

    expect(parser.currentIndent).toBe(0)
    expect(tree).toBeDefined()
  })

  it('stores document-level properties on the tree root', () => {
    // Regression: these lines crashed with
    // "TypeError: Cannot read properties of undefined (reading 'name')".
    const tree = new TextParser().parse(ASCII_FBX)

    expect(tree.CreationTime).toBe('2026-08-03 10:15:00:000')
    expect(tree.Creator).toBe('FBX SDK/FBX Plugins version 2020.0')
  })

  it('does not treat a brace inside a property value as a block delimiter', () => {
    // Regression: the unanchored '(\\w+):(.*){' pattern read this P: line as a node
    // beginning, so the indent drifted and every later node was silently discarded.
    const tree = new TextParser().parse(ASCII_FBX)
    // Both parsers flatten `Properties70` entries onto the enclosing node.
    const sceneInfo = tree.FBXHeaderExtension.SceneInfo

    expect(sceneInfo.DocumentUrl.value).toContain('{Project}')
    // Nodes that follow the offending line must still be present.
    expect(tree.GlobalSettings).toBeDefined()
    expect(tree.Objects).toBeDefined()
    expect(tree.Connections).toBeDefined()
  })

  it('parses the nodes that FBXTreeParser depends on', () => {
    const tree = new TextParser().parse(ASCII_FBX)

    expect(tree.GlobalSettings.UpAxis.value).toBe(1)
    expect(tree.GlobalSettings.UnitScaleFactor.value).toBe(1)
    expect(tree.Connections.connections).toEqual([[140234, 0]])

    const geometry = tree.Objects.Geometry[140234]
    expect(geometry.attrType).toBe('Mesh')
    expect(geometry.Vertices!.a).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(geometry.PolygonVertexIndex!.a).toEqual([0, 1, -3])
  })

  it('handles arrays split across multiple lines', () => {
    const tree = new TextParser().parse([
      'Objects:  {',
      '\tGeometry: 1, "Geometry::", "Mesh" {',
      '\t\tVertices: *6 {',
      '\t\t\ta: 1,2,3,',
      '4,5,6',
      '\t\t}',
      '\t}',
      '}'
    ].join('\n'))

    expect(tree.Objects.Geometry[1].Vertices!.a).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('reports the offending line instead of a TypeError on a truncated document', () => {
    // An extra closing brace empties the node stack while nodes remain open.
    const truncated = [
      'Objects:  {',
      '\tGeometry: 1, "Geometry::", "Mesh" {',
      '\t\tVersion: 100',
      '\t}',
      '}',
      '}',
      'Connections:  {',
      '\tC: "OO",1,0',
      '}'
    ].join('\n')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // The stray brace is skipped with a warning rather than corrupting the tree.
    const tree = new TextParser().parse(truncated)

    expect(tree.Connections.connections).toEqual([[1, 0]])
    warn.mockRestore()
  })
})
