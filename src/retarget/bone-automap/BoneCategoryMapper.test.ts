import { describe, it, expect } from 'vitest'
import { BoneCategoryMapper } from './BoneCategoryMapper'
import { BoneChainResolver } from './BoneChainResolver'
import { type RawBoneRecord } from './interfaces/RawBoneRecord'
import { type BoneMetadata } from './BoneTypes'

/**
 * BoneCategoryMapper is the exact-name safety net that runs after the canonical
 * slot pass. Building its input through BoneChainResolver keeps these tests honest -
 * the old suite hand-fed normalized_name values the real normalizer never produced.
 */
function metadata (names: string[]): BoneMetadata[] {
  const bones: RawBoneRecord[] = names.map((name, i) => ({
    name,
    parent_name: i === 0 ? null : names[i - 1]
  }))
  return BoneChainResolver.build_metadata(bones)
}

describe('BoneCategoryMapper name matching', () => {
  it('matches bones the two rigs name identically', () => {
    const source = metadata(['spine_01', 'spine_02', 'custom_prop_a'])
    const target = metadata(['spine_01', 'custom_prop_a'])

    const mappings = BoneCategoryMapper.match_loose_names(source, target, new Map())

    expect(mappings.get('spine_01')).toBe('spine_01')
    expect(mappings.get('custom_prop_a')).toBe('custom_prop_a')
  })

  it('matches across separator and case differences', () => {
    const source = metadata(['tail_01', 'tail_02'])
    const target = metadata(['Tail.001', 'Tail.002'])

    const mappings = BoneCategoryMapper.match_loose_names(source, target, new Map())

    expect(mappings.get('Tail.001')).toBe('tail_01')
    expect(mappings.get('Tail.002')).toBe('tail_02')
  })

  it('will not pair a left bone with a right one', () => {
    const source = metadata(['wing_01_l'])
    const target = metadata(['wing_01_r'])

    expect(BoneCategoryMapper.match_loose_names(source, target, new Map()).size).toBe(0)
  })

  it('leaves existing mappings alone and never hands out their source bones twice', () => {
    const source = metadata(['spine_01', 'spine_02'])
    const target = metadata(['spine_01', 'spine_02'])

    // the canonical slot pass already gave spine_01 away to a different target
    const existing = new Map<string, string>([['spine_02', 'spine_01']])
    const mappings = BoneCategoryMapper.match_loose_names(source, target, existing)

    expect(mappings.get('spine_02')).toBe('spine_01')
    // target spine_01 is left unmapped rather than taking spine_01 a second time
    expect(mappings.has('spine_01')).toBe(false)
    expect(new Set(mappings.values()).size).toBe(mappings.size)
  })

  it('matches only literal name agreement in the exact pass', () => {
    const source = metadata(['tail_01', 'tail_02'])
    const target = metadata(['tail_01', 'Tail.002'])

    const mappings = BoneCategoryMapper.match_exact_names(source, target, new Map())

    expect(mappings.get('tail_01')).toBe('tail_01')
    expect(mappings.has('Tail.002')).toBe(false)
  })

  it('handles empty skeletons', () => {
    expect(BoneCategoryMapper.match_exact_names([], [], new Map()).size).toBe(0)
    expect(BoneCategoryMapper.match_loose_names([], [], new Map()).size).toBe(0)
  })
})
