import { type SkeletonType } from '../lib/enums/SkeletonType.ts'
import { type ThemeManager } from '../lib/ThemeManager.ts'
import { type AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry.ts'
import { AnimationPreviewVideos } from '../features/animation-previews/AnimationPreviewVideos.ts'
import { VirtualizedAnimationCatalog } from '../features/animation-catalog/VirtualizedAnimationCatalog.ts'
/**
 * Library of animations shown on the Composer page. Animations are not selected here.
 * They are dragged onto a slot, which reads the animation id from the drag data.
 */
export class ComposerLibraryList {
  // data transfer type for drags, so slots can ignore files or text dragged in from elsewhere
  static readonly drag_data_type: string = 'application/x-mesh2motion-animation-id'

  // added to the body while a tile is dragged, so every slot can show it accepts drops
  static readonly dragging_body_class: string = 'composer-is-dragging'

  private entries: AnimationEntry[] = []
  private filtered_entries: AnimationEntry[] = []
  private readonly tile_elements = new Map<string, HTMLElement>()
  private readonly preview_videos: AnimationPreviewVideos = new AnimationPreviewVideos()
  private readonly catalog: VirtualizedAnimationCatalog<AnimationEntry>
  private upper_animation_id: string | null = null
  private lower_animation_id: string | null = null
  private readonly lifetime = new AbortController()

  constructor (
    private readonly list_container: HTMLElement,
    private readonly filter_input: HTMLInputElement | null,
    private readonly count_element: HTMLElement | null,
    private readonly theme_manager: ThemeManager,
    private readonly skeleton_type: SkeletonType
  ) {
    this.catalog = new VirtualizedAnimationCatalog(this.list_container, {
      get_id: entry => entry.id,
      render_item: entry => this.render_tile(entry),
      item_width: 103,
      item_height: 160,
      gap: 8,
      overscan_rows: 2,
      focus_target: element => element,
      on_window_change: viewport => { this.sync_mounted_tiles(viewport) }
    })
    this.catalog.set_footer('<div class="composer-library-empty" style="display: none">No animations match the filter.</div>')
    this.add_event_listeners()
    window.addEventListener('pagehide', () => { this.dispose() }, { once: true, signal: this.lifetime.signal })
  }

  public set_animations (entries: AnimationEntry[]): void {
    this.entries = entries
    this.build_tiles()
  }

  /**
   * Marks the tiles that are in a slot, so it is clear which animations make up the result.
   */
  public set_slot_markers (upper_animation_id: string | null, lower_animation_id: string | null): void {
    this.upper_animation_id = upper_animation_id
    this.lower_animation_id = lower_animation_id
    this.tile_elements.forEach((tile, animation_id) => {
      this.apply_slot_markers(tile, animation_id)
    })
  }

  public scroll_to_animation (animation_id: string): void {
    this.catalog.scroll_to_id(animation_id)
  }

  public dispose (): void {
    this.lifetime.abort()
    this.catalog.dispose()
    this.preview_videos.disconnect()
    document.body.classList.remove(ComposerLibraryList.dragging_body_class)
  }

  static display_name (animation_name: string): string {
    return animation_name.replace(/_/g, ' ')
  }

  private build_tiles (): void {
    this.preview_videos.disconnect()
    this.apply_filter()
    this.catalog.set_items(this.filtered_entries, true)
    this.preview_videos.observe_placeholders(this.list_container)
  }

  private render_tile (entry: AnimationEntry): HTMLElement {
    const name = ComposerLibraryList.display_name(entry.name)
    const is_custom_import = entry.metadata.source_type === 'custom-import'
    const preview_src = is_custom_import
      ? null
      : AnimationPreviewVideos.preview_src(this.skeleton_type, this.theme_manager.get_current_theme(), entry.name)
    const poster_src = AnimationPreviewVideos.poster_src(preview_src)
    const preview_html = is_custom_import
      ? '<div class="anim-preview-placeholder composer-custom-preview"><span class="composer-imported-chip">Imported</span></div>'
      : `<div class="anim-preview-placeholder${poster_src === null ? ' anim-preview-placeholder--no-poster' : ''}"${preview_src === null ? '' : ` data-src="${preview_src}" data-poster-src="${poster_src}"`}>${poster_src === null ? '' : '<img class="anim-preview-poster" alt="" aria-hidden="true" decoding="async">'}</div>`
    const template = document.createElement('template')
    template.innerHTML = `
      <div class="composer-library-item" draggable="true" tabindex="0" data-animation-id="${entry.id}" title="Drag ${name} onto a slot">
        <span class="composer-drag-grip" aria-hidden="true"></span>
        <span class="composer-slot-badge composer-slot-badge-upper" aria-hidden="true">Upper</span>
        <span class="composer-slot-badge composer-slot-badge-lower" aria-hidden="true">Lower</span>
        <div class="composer-library-item-preview">${preview_html}</div>
        <span class="composer-library-item-name">${name}</span>
      </div>`
    const tile = template.content.firstElementChild
    if (!(tile instanceof HTMLElement)) throw new Error('Could not render Remix animation tile')
    return tile
  }

  private sync_mounted_tiles (viewport: HTMLElement): void {
    this.tile_elements.clear()
    viewport.querySelectorAll<HTMLElement>('.composer-library-item').forEach(tile => {
      const id = tile.dataset.animationId
      if (id === undefined) return
      this.tile_elements.set(id, tile)
      this.apply_slot_markers(tile, id)
    })
    this.preview_videos.refresh_placeholders()
  }

  private apply_slot_markers (tile: HTMLElement, animation_id: string): void {
    const in_slot = animation_id === this.upper_animation_id || animation_id === this.lower_animation_id
    tile.classList.toggle('in-upper-slot', animation_id === this.upper_animation_id)
    tile.classList.toggle('in-lower-slot', animation_id === this.lower_animation_id)
    const preview = tile.querySelector<HTMLElement>('.anim-preview-placeholder')
    if (preview !== null) this.preview_videos.set_selected(preview, in_slot)
  }

  /**
   * Hides tiles that don't match the filter text. Tiles are hidden instead of rebuilt so their videos keep playing.
   */
  private apply_filter (): void {
    // names can use underscores or spaces, so compare with spaces. tags like 'combat' match too
    const search_text: string = (this.filter_input?.value ?? '').toLowerCase().replace(/_/g, ' ').trim()
    this.filtered_entries = this.entries.filter((entry) => {
      return entry.name.toLowerCase().replace(/_/g, ' ').includes(search_text) ||
        entry.metadata.tags.some(tag => tag.toLowerCase().includes(search_text))
    })
    const visible_count = this.filtered_entries.length
    this.catalog.set_items(this.filtered_entries)

    const empty_message = this.catalog.get_footer().querySelector<HTMLElement>('.composer-library-empty')
    if (empty_message !== null) {
      empty_message.style.display = visible_count === 0 ? '' : 'none'
    }

    if (this.count_element !== null) {
      this.count_element.textContent = `${visible_count} ${visible_count === 1 ? 'result' : 'results'}`
    }
  }

  private add_event_listeners (): void {
    this.filter_input?.addEventListener('input', () => { this.apply_filter() }, { signal: this.lifetime.signal })

    // preview video file names depend on the theme
    this.theme_manager.addEventListener('theme-changed', () => { this.build_tiles() }, { signal: this.lifetime.signal })

    this.list_container.addEventListener('dragstart', (event: DragEvent) => {
      const tile = (event.target as HTMLElement).closest<HTMLElement>('.composer-library-item')
      const animation_id = tile?.dataset.animationId
      if (tile === null || tile === undefined || animation_id === undefined || event.dataTransfer === null) {
        return
      }

      event.dataTransfer.setData(ComposerLibraryList.drag_data_type, animation_id)
      event.dataTransfer.setData('text/plain', animation_id)
      event.dataTransfer.effectAllowed = 'copy'

      tile.classList.add('is-dragging')
      document.body.classList.add(ComposerLibraryList.dragging_body_class)
    }, { signal: this.lifetime.signal })

    // fires on the dragged tile whether the drop landed on a slot or was cancelled
    this.list_container.addEventListener('dragend', (event: DragEvent) => {
      (event.target as HTMLElement).closest('.composer-library-item')?.classList.remove('is-dragging')
      document.body.classList.remove(ComposerLibraryList.dragging_body_class)
    }, { signal: this.lifetime.signal })
  }
}
