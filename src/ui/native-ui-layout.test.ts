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

function collect_relative_files (directory: string, parent = ''): string[] {
  const paths: string[] = []
  for (const entry of readdirSync(join(directory, parent), { withFileTypes: true })) {
    const relative_path = join(parent, entry.name)
    if (entry.isDirectory()) paths.push(...collect_relative_files(directory, relative_path))
    else paths.push(relative_path)
  }
  return paths
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
    const media_root = join(project_root, 'static', 'animpreviews')
    const counts = mp4_and_poster_counts(media_root)
    expect(counts.mp4).toBeGreaterThan(0)
    expect(counts.posters).toBe(counts.mp4)
    const paths = new Set(collect_relative_files(media_root))
    for (const path of paths) {
      if (path.toLowerCase().endsWith('.mp4')) {
        expect(paths.has(path.slice(0, -4) + '.webp'), `missing poster for ${path}`).toBe(true)
      }
    }
    for (const key of [
      'human/dark_Angry.webp',
      'fox/dark_Bark.webp',
      'horse/dark_Walk.webp'
    ]) {
      expect(readFileSync(join(project_root, 'static', 'animpreviews', key)).byteLength).toBeGreaterThan(100)
    }
  })

  it('always renders a static poster image and never an explicit play control', () => {
    const search = readFileSync(join(project_root, 'src/features/animation-catalog/AnimationSearch.ts'), 'utf8')
    const composer = readFileSync(join(project_root, 'src/composer/ComposerLibraryList.ts'), 'utf8')
    const styles = css('src/styles.css')
    expect(search).toContain('class="anim-preview-poster"')
    expect(composer).toContain('class="anim-preview-poster"')
    expect(search).not.toContain('data-action="preview-video"')
    expect(composer).not.toContain('data-action="preview-video"')
    expect(styles).not.toContain('.anim-preview-control')
  })
})

describe('M2M-023A Props viewport anchoring', () => {
  const props_css = css('src/lib/processes/animations-listing/props/props.css')
  const styles = css('src/styles.css')
  const panel_ts = readFileSync(
    join(project_root, 'src/lib/processes/animations-listing/props/PropsPanel.ts'), 'utf8'
  )

  it('uses the renderer viewport as the real absolute positioning container', () => {
    expect(props_css).toMatch(/#props-dock\s*\{[\s\S]*?position:\s*absolute/)
    expect(props_css).toMatch(/#props-dock\s*\{[\s\S]*?top:\s*0\.5rem/)
    expect(props_css).toMatch(/#props-dock\s*\{[\s\S]*?right:\s*0\.5rem/)
    const scene_manager = readFileSync(join(project_root, 'src/lib/SceneEnvironmentManager.ts'), 'utf8')
    expect(scene_manager).toMatch(/viewport\.appendChild\(props_dock\)/)
    expect(scene_manager).toContain('viewport.getBoundingClientRect()')
    expect(scene_manager).toContain('props_dock.getBoundingClientRect()')
    expect(scene_manager).toContain('rightInset:')
    expect(styles).toMatch(/body\.explore-page\s+#m2m-viewport\s*\{[\s\S]*?left:\s*var\(--explore-sidebar-width/)
    expect(styles).toMatch(/body\.tool-panel-page\s+#m2m-viewport\s*\{[\s\S]*?right:\s*var\(--responsive-right-width/)
  })

  it('does not hardcode a window-relative right offset', () => {
    expect(props_css).not.toMatch(/right:\s*26rem/)
    expect(panel_ts).not.toMatch(/dock\.style\.right/)
    expect(panel_ts).not.toMatch(/new ResizeObserver/)
    expect(props_css).not.toMatch(/position:\s*fixed/)
  })

  it('keeps the Props dock content-sized and right-anchored in narrow viewports', () => {
    const narrow_layout = props_css.match(/@media\s*\(max-width:\s*48rem\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(narrow_layout).not.toMatch(/#props-dock\s*\{/)
    expect(narrow_layout).not.toMatch(/left:\s*0\.5rem/)
    expect(narrow_layout).not.toMatch(/right:\s*0\.5rem\s*!important/)
    expect(props_css).toMatch(/#props-dock\s*\{[\s\S]*?right:\s*0\.5rem/)
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

describe('M2M-023D native layout fixes', () => {
  const styles = css('src/styles.css')
  const retarget_css = css('src/retarget/retarget.css')
  const retarget_html = readFileSync(join(project_root, 'src/retarget/index.html'), 'utf8')

  it('keeps the settings dropdown above the fixed tool panel', () => {
    expect(styles).toMatch(/nav\s*\{[^}]*z-index:\s*30/)
    expect(styles).toMatch(/#tool-panel\s*\{[^}]*z-index:\s*2/)
  })

  it('gives tool-panel pages an upstream-width right rail', () => {
    expect(styles).toMatch(/body\.tool-panel-page\s*\{[^}]*--responsive-right-width:\s*clamp\(32rem, 46vw, 54rem\)/)
  })

  it('keeps bone-map columns side by side and shrinks them to fit the panel', () => {
    expect(retarget_html).toContain('class="bone-map-grid"')
    expect(retarget_css).toMatch(/\.bone-map-grid\s*\{[^}]*flex-wrap:\s*nowrap/)
    expect(retarget_css).toMatch(/\.bone-map-section\s*\{[^}]*flex:\s*1 1 0/)
    expect(retarget_css).toMatch(/\.bone-map-section\s*\{[^}]*min-width:\s*0/)
  })

  it('loads posters from the embedded dist without a Rust asset command', () => {
    const videos = readFileSync(
      join(project_root, 'src/features/animation-previews/AnimationPreviewVideos.ts'), 'utf8'
    )
    expect(videos).toMatch(/image\.src = new URL\(poster_src, document\.baseURI\)\.href/)
    expect(videos).not.toMatch(/invoke\('animation_preview_asset_path'.*poster/)
  })
})
