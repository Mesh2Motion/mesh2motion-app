import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Regression for the white-on-white rig picker reported on the staged native app. */
describe('New Animation select theming', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/newAnimation/newAnimation.css'), 'utf8')

  it('overrides the native WebKitGTK select appearance', () => {
    expect(css).toContain('-webkit-appearance: none')
    expect(css).toContain('appearance: none')
  })

  it('uses the same surface and text colours as the working textboxes', () => {
    expect(css).toContain('#new-animation-rig,')
    expect(css).toMatch(/#new-animation-panel select \{[^}]*background-color: var\(--bg-primary\)/)
    expect(css).toMatch(/#new-animation-panel select \{[^}]*color: var\(--text-primary\)/)
    expect(css).toMatch(/#new-animation-panel select \{[^}]*border: 1px solid var\(--bg-tertiary\)/)
  })

  it('keeps option text readable and adapts the chevron to the light theme', () => {
    expect(css).toMatch(/#new-animation-panel select option \{[^}]*background-color: var\(--bg-primary\)/)
    expect(css).toContain("html[data-theme='light'] #new-animation-rig")
  })
})
