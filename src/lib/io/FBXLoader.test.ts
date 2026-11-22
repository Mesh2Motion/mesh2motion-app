import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FBXLoader } from './FBXLoader'

describe('FBXLoader Mixamo compatibility', () => {
  it('loads the checked-in Mixamo rig and its skeleton', () => {
    const source = readFileSync(resolve(process.cwd(), 'static/test-files/retarget testing/mixamo-original-rig.fbx'))
    const data = new ArrayBuffer(source.byteLength)
    new Uint8Array(data).set(source)

    const loaded = new FBXLoader().parse(data, '')
    let bones = 0
    loaded.traverse((object) => {
      if (object.type === 'Bone') bones += 1
    })

    expect(loaded.children.length).toBeGreaterThan(0)
    expect(bones).toBeGreaterThan(0)
  })
})
