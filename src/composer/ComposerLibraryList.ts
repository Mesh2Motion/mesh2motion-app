import { type SkeletonType } from '../lib/enums/SkeletonType.ts'
import { type ThemeManager } from '../lib/ThemeManager.ts'
import { type AnimationEntry } from '../lib/processes/animations-listing/interfaces/AnimationEntry.ts'
import { AnimationPreviewVideos } from '../lib/processes/animations-listing/AnimationPreviewVideos.ts'
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
  private readonly tile_elements = new Map<string, HTMLElement>()
  private readonly preview_videos: AnimationPreviewVideos = new AnimationPreviewVideos()

  constructor (
    private readonly list_container: HTMLElement,
    private readonly filter_input: HTMLInputElement | null,
    private readonly count_element: HTMLElement | null,
    private readonly theme_manager: ThemeManager,
    private readonly skeleton_type: SkeletonType
  ) {
    this.add_event_listeners()
  }

  public set_animations (entries: AnimationEntry[]): void {
    this.entries = entries
    this.build_tiles()
  }

  /**
   * Marks the tiles that are in a slot, so it is clear which animations make up the result.
   */
  public set_slot_markers (upper_animation_id: string | null, lower_animation_id: string | null): void {
    this.tile_elements.forEach((tile, animation_id) => {
      tile.classList.toggle('in-upper-slot', animation_id === upper_animation_id)
      tile.classList.toggle('in-lower-slot', animation_id === lower_animation_id)
    })
  }

  public scroll_to_animation (animation_id: string): void {
    this.tile_elements.get(animation_id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  static display_name (animation_name: string): string {
    return animation_name.replace(/_/g, ' ')
  }

  private build_tiles (): void {
    this.tile_elements.clear()
    const theme_name: string = this.theme_manager.get_current_theme()

    this.list_container.innerHTML = this.entries.map((entry) => {
      const name: string = ComposerLibraryList.display_name(entry.name)
      // custom imports have no preview video
      const is_custom_import: boolean = entry.metadata.source_type === 'custom-import'
      const preview_src: string | null = is_custom_import
        ? null
        : AnimationPreviewVideos.preview_src(this.skeleton_type, theme_name, entry.name)
      const data_src_attribute: string = preview_src === null ? '' : ` data-src="${preview_src}"`
      const preview_html: string = is_custom_import
        ? '<div class="anim-preview-placeholder composer-custom-preview"><span class="composer-imported-chip">Imported</span></div>'
        : `<div class="anim-preview-placeholder"${data_src_attribute}></div>`

      return `
        <div class="composer-library-item" draggable="true" data-animation-id="${entry.id}" title="Drag ${name} onto a slot">
          <span class="composer-drag-grip" aria-hidden="true"></span>
          <span class="composer-slot-badge composer-slot-badge-upper" aria-hidden="true">Upper</span>
          <span class="composer-slot-badge composer-slot-badge-lower" aria-hidden="true">Lower</span>
          <div class="composer-library-item-preview">
            ${preview_html}
          </div>
          <span class="composer-library-item-name">${name}</span>
        </div>`
    }).join('') + '<div class="composer-library-empty" style="display: none">No animations match the filter.</div>'

    this.list_container.querySelectorAll<HTMLElement>('.composer-library-item').forEach((tile) => {
      this.tile_elements.set(tile.dataset.animationId ?? '', tile)
    })

    this.apply_filter()
    this.preview_videos.observe_placeholders(this.list_container)
  }

  /**
   * Hides tiles that don't match the filter text. Tiles are hidden instead of rebuilt so their videos keep playing.
   */
  private apply_filter (): void {
    // names can use underscores or spaces, so compare with spaces. tags like 'combat' match too
    const search_text: string = (this.filter_input?.value ?? '').toLowerCase().replace(/_/g, ' ').trim()
    let visible_count: number = 0

    this.entries.forEach((entry) => {
      const matches: boolean = entry.name.toLowerCase().replace(/_/g, ' ').includes(search_text) ||
        entry.metadata.tags.some(tag => tag.toLowerCase().includes(search_text))

      const tile = this.tile_elements.get(entry.id)
      if (tile !== undefined) {
        tile.style.display = matches ? '' : 'none'
      }
      if (matches) {
        visible_count++
      }
    })

    const empty_message = this.list_container.querySelector<HTMLElement>('.composer-library-empty')
    if (empty_message !== null) {
      empty_message.style.display = visible_count === 0 ? '' : 'none'
    }

    if (this.count_element !== null) {
      this.count_element.textContent = `${visible_count} ${visible_count === 1 ? 'result' : 'results'}`
    }
  }

  private add_event_listeners (): void {
    this.filter_input?.addEventListener('input', () => { this.apply_filter() })

    // preview video file names depend on the theme
    this.theme_manager.addEventListener('theme-changed', () => { this.build_tiles() })

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
    })

    // fires on the dragged tile whether the drop landed on a slot or was cancelled
    this.list_container.addEventListener('dragend', (event: DragEvent) => {
      (event.target as HTMLElement).closest('.composer-library-item')?.classList.remove('is-dragging')
      document.body.classList.remove(ComposerLibraryList.dragging_body_class)
    })
  }
}
