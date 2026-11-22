import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AnimationPreviewVideos } from '../features/animation-previews/AnimationPreviewVideos.ts'

const project_root = resolve(import.meta.dirname, '..', '..')

function css (relative_path: string): string {
  return readFileSync(join(project_root, relative_path), 'utf8')
}

function mp4_and_poster_counts (directory: string): { mp4: number, posters: number } {
  let mp4 = 0
  let posters = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      const counts = mp4_and_poster_counts(full)
      mp4 += counts.mp4
      posters += counts.posters
    } else if (entry.name.toLowerCase().endsWith('.mp4')) {
      mp4++
    } else if (entry.name.toLowerCase().endsWith('.webp')) {
      posters++
    }
  }
  return { mp4, posters }
}

describe('M2M-023A preview posters', () => {
  it('maps every animation MP4 to an offline poster path', () => {
    expect(AnimationPreviewVideos.poster_src('../animpreviews/human/dark_Angry.mp4'))
      .toBe('../animpreviews/human/dark_Angry.webp')
    expect(AnimationPreviewVideos.poster_src('../animpreviews/horse/light_Gallop.MP4'))
      .toBe('../animpreviews/horse/light_Gallop.webp')
  })

  it('returns no poster for custom imports or non-video sources', () => {
    expect(AnimationPreviewVideos.poster_src(null)).toBeNull()
    expect(AnimationPreviewVideos.poster_src('../animpreviews/human/note.txt')).toBeNull()
  })

  it('has a generated poster for every bundled animation video', () => {
    const counts = mp4_and_poster_counts(join(project_root, 'static', 'animpreviews'))
    expect(counts.mp4).toBeGreaterThan(0)
    expect(counts.posters).toBe(counts.mp4)
  })
})

describe('M2M-023A Props viewport anchoring', () => {
  const props_css = css('src/lib/processes/animations-listing/props/props.css')
  const styles = css('src/styles.css')
  const panel_ts = readFileSync(
    join(project_root, 'src/lib/processes/animations-listing/props/PropsPanel.ts'), 'utf8'
  )

  it('shares the viewport inset variables instead of window pixel math', () => {
    expect(props_css).toMatch(/#props-dock\s*\{[\s\S]*?--viewport-top/)
    expect(props_css).toMatch(/#props-dock\s*\{[\s\S]*?--viewport-left/)
    expect(props_css).toMatch(/#props-dock\s*\{[\s\S]*?--viewport-right/)
    expect(styles).toMatch(/--viewport-top:\s*var\(--navigation-height\)/)
    expect(styles).toMatch(/--viewport-left:\s*0px/)
    expect(styles).toMatch(/--viewport-right:\s*0px/)
  })

  it('does not hardcode a window-relative right offset', () => {
    expect(props_css).not.toMatch(/right:\s*26rem/)
    expect(styles).not.toMatch(/#props-dock\s*\{[^}]*right:[^;]*!important/)
    expect(panel_ts).not.toMatch(/dock\.style\.right/)
    expect(panel_ts).not.toMatch(/new ResizeObserver/)
  })

  it('keeps the control clickable and accessible', () => {
    expect(props_css).toMatch(/#props-dock\s*\{[\s\S]*?pointer-events:\s*none/)
    expect(props_css).toMatch(/#props-dock\s*>\s*\*\s*\{[\s\S]*?pointer-events:\s*auto/)
    const index_html = readFileSync(join(project_root, 'src/index.html'), 'utf8')
    expect(index_html).toMatch(/id="props-toggle-button"[^>]*aria-label="Attach props to the hands"/)
  })
})

describe('M2M-023A settings text layout', () => {
  const settings_css = css('src/settings-dropdown.css')

  it('lets MCP values shrink instead of overlapping adjacent rows', () => {
    expect(settings_css).toMatch(/\.mcp-row\s*\{[\s\S]*?grid-template-columns:[^;]*minmax\(0,\s*1fr\)/)
    expect(settings_css).toMatch(/\.mcp-label,\s*\.mcp-value\s*\{[\s\S]*?min-width:\s*0/)
    expect(settings_css).toMatch(/\.mcp-label,\s*\.mcp-value\s*\{[\s\S]*?overflow-wrap:\s*anywhere/)
  })

  it('bounds the dropdown for narrow and tiled windows', () => {
    expect(settings_css).toMatch(/#settings-dropdown-content\s*\{[\s\S]*?max-width:/)
    expect(settings_css).toMatch(/#settings-dropdown-content\s*\{[\s\S]*?overflow-y:\s*auto/)
  })
})
