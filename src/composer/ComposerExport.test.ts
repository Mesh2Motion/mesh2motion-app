import { describe, it, expect } from 'vitest'
import { ComposerExport } from './ComposerExport'

describe('ComposerExport.clean_name', () => {
  it('replaces spaces with underscores', () => {
    expect(ComposerExport.clean_name('  Wave while walking ')).toBe('Wave_while_walking')
  })

  it('removes characters that are not safe in file names', () => {
    expect(ComposerExport.clean_name('Punch/Walk: v2?')).toBe('PunchWalk_v2')
  })

  it('keeps letters, numbers, underscores and dashes', () => {
    expect(ComposerExport.clean_name('Idle-A_2_Remix')).toBe('Idle-A_2_Remix')
  })
})
