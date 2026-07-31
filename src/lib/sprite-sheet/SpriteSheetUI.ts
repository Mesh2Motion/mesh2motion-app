import { SpriteSheetSettings, type DirectionEntry } from './SpriteSheetSettings.ts'
import { SpriteSheetExporter } from './SpriteSheetExporter.ts'
import { UI } from '../UI.ts'
import { type Mesh2MotionEngine } from '../../Mesh2MotionEngine.ts'
import {
  type Scene,
  type SkinnedMesh,
  type AnimationMixer,
  type AnimationClip,
  WebGLRenderer,
  PerspectiveCamera,
  Vector3
} from 'three'

export class SpriteSheetUI {
  private readonly settings: SpriteSheetSettings = new SpriteSheetSettings()
  private readonly ui: UI = UI.getInstance()
  private is_exporting: boolean = false
  // The main 3D engine. We use it to read / write the main camera (OrbitControls
  // target + position) and to render a live preview into our small canvas.
  private readonly engine: Mesh2MotionEngine
  // The preview uses its OWN WebGLRenderer bound to the small canvas, so we
  // don't have to fight the main renderer's `preserveDrawingBuffer: false`
  // (which makes drawImage(mainCanvas) return a black frame). The preview
  // shares the main scene and the model's animations; only the camera +
  // renderer are independent, so the user can keep orbiting the main view
  // while the mini-canvas reflects the sprite sheet's pitch + distance.
  private preview_renderer: WebGLRenderer | null = null
  private preview_camera: PerspectiveCamera | null = null
  private preview_animation_handle: number | null = null
  private preview_last_render_ms: number = 0
  private preview_direction_deg: number = 0

  constructor (engine: Mesh2MotionEngine) {
    this.engine = engine
    this.settings.load()
    this.build_direction_checkboxes()
    this.sync_ui_from_settings()
    this.add_event_listeners()
    // Preview is always-on now. We defer the first start until the tab
    // is visible — starting a WebGLRenderer against an offscreen canvas
    // wastes GPU cycles and the panel may not have a size yet.
    queueMicrotask(() => {
      const panel = this.ui.dom_sidebar_panel_sprite_sheet
      if (panel !== null && !panel.hidden) {
        this.start_live_preview()
      }
    })
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  /** Trigger the export. Called when the user clicks the in-panel "Export" button. */
  public async do_export (
    skinned_meshes: SkinnedMesh[],
    clip: AnimationClip,
    mixer: AnimationMixer,
    scene: Scene
  ): Promise<void> {
    if (this.is_exporting) return
    if (!skinned_meshes.length || !clip) {
      console.warn('SpriteSheetUI: nothing to export')
      return
    }

    this.is_exporting = true

    // Stop live preview so we don't waste a frame before the export capture.
    this.stop_live_preview()

    // Pull latest values from UI
    this.read_ui_into_settings()
    this.settings.save()

    const anim_name = clip.name.replace(/[^a-zA-Z0-9_-]/g, '_')

    // Build sprite sheet
    try {
      const sheet_name = `spritesheet_${anim_name}_${this.settings.frame_width}x${this.settings.frame_height}`

      const result = await SpriteSheetExporter.export(
        skinned_meshes,
        clip,
        mixer,
        this.settings,
        scene,
        (pct) => {
          console.debug(`SpriteSheet export: ${Math.round(pct * 100)}%`)
        }
      )

      // Download the PNG
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${sheet_name}.png`
      link.click()
      URL.revokeObjectURL(url)

      console.debug(
        `SpriteSheet exported: ${result.total_width}x${result.total_height}, ` +
        `${result.frame_count} frames x ${result.direction_count} directions`
      )
    } catch (err) {
      console.error('SpriteSheet export failed:', err)
    } finally {
      this.is_exporting = false
      // Restart preview so the panel keeps showing the model.
      const panel = this.ui.dom_sidebar_panel_sprite_sheet
      if (panel !== null && !panel.hidden) {
        this.start_live_preview()
      }
    }
  }

  /** Re-read UI inputs into the in-memory settings. Called before exporting
   *  and whenever an input fires (so the live preview reflects edits). */
  public read_ui_into_settings (): void {
    this.settings.sample_every_n_frames = this.num_value(this.ui.dom_ss_sample_every, 1)
    this.settings.canvas_width = this.num_value(this.ui.dom_ss_canvas_width, 1024)
    this.settings.canvas_height = this.num_value(this.ui.dom_ss_canvas_height, 1024)
    this.settings.frame_width = this.num_value(this.ui.dom_ss_frame_width, 128)
    this.settings.frame_height = this.num_value(this.ui.dom_ss_frame_height, 128)
    this.settings.padding = this.num_value(this.ui.dom_ss_padding, 2)
    this.settings.pitch_angle_degrees = this.num_value(this.ui.dom_ss_pitch_angle, 60)
    this.settings.camera_distance = this.float_value(this.ui.dom_ss_camera_distance, 10)
    if (this.ui.dom_ss_silhouette) {
      this.settings.silhouette = this.ui.dom_ss_silhouette.checked
    }
    if (this.ui.dom_ss_one_row_per_direction) {
      this.settings.one_row_per_direction = this.ui.dom_ss_one_row_per_direction.checked
    }
    if (this.ui.dom_ss_background_color) {
      // color picker value is "#rrggbb" (or "#rgb" shorthand). parseInt
      // happily ignores the leading "#" so we just take the substring.
      const raw = this.ui.dom_ss_background_color.value.replace(/^#/, '').trim()
      const expanded = raw.length === 3
        ? raw.split('').map(c => c + c).join('')
        : raw
      const parsed = parseInt(expanded, 16)
      if (Number.isFinite(parsed) && expanded.length === 6) {
        this.settings.background_color = parsed
      }
    }

    const cbs = this.get_dir_checkboxes()
    for (const cb of cbs) {
      const dir = this.settings.directions.find(d => d.id === cb.dataset.dirId)
      if (dir) dir.enabled = cb.checked
    }
  }

  /** Persist current settings to localStorage. */
  public save_settings (): void {
    this.settings.save()
  }

  /* ------------------------------------------------------------------ */
  /*  Internal                                                           */
  /* ------------------------------------------------------------------ */

  private build_direction_checkboxes (): void {
    const grid = this.ui.dom_ss_direction_grid
    if (!grid) return

    grid.innerHTML = ''
    for (const dir of this.settings.directions) {
      const label = document.createElement('label')
      label.className = 'direction-checkbox-label'

      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.id = `ss-dir-${dir.id}`
      cb.checked = dir.enabled
      cb.dataset.dirId = dir.id

      const span = document.createElement('span')
      span.textContent = dir.label

      label.appendChild(cb)
      label.appendChild(span)
      grid.appendChild(label)
    }
  }

  /** Push settings values into the DOM inputs. */
  private sync_ui_from_settings (): void {
    this.set_value(this.ui.dom_ss_sample_every, this.settings.sample_every_n_frames)
    this.set_value(this.ui.dom_ss_canvas_width, this.settings.canvas_width)
    this.set_value(this.ui.dom_ss_canvas_height, this.settings.canvas_height)
    this.set_value(this.ui.dom_ss_frame_width, this.settings.frame_width)
    this.set_value(this.ui.dom_ss_frame_height, this.settings.frame_height)
    this.set_value(this.ui.dom_ss_padding, this.settings.padding)
    this.set_value(this.ui.dom_ss_pitch_angle, this.settings.pitch_angle_degrees)
    this.set_value_float(this.ui.dom_ss_camera_distance, this.settings.camera_distance)
    if (this.ui.dom_ss_silhouette) {
      this.ui.dom_ss_silhouette.checked = this.settings.silhouette
    }
    if (this.ui.dom_ss_one_row_per_direction) {
      this.ui.dom_ss_one_row_per_direction.checked = this.settings.one_row_per_direction
    }
    if (this.ui.dom_ss_background_color) {
      // Hex color picker value is "#RRGGBB"; settings stores the raw int.
      this.ui.dom_ss_background_color.value = '#' + this.settings.background_color.toString(16).padStart(6, '0')
    }

    // Sync checkboxes
    const cbs = this.get_dir_checkboxes()
    for (const cb of cbs) {
      cb.checked = this.settings.directions.find(d => d.id === cb.dataset.dirId)?.enabled ?? true
    }
  }

  private add_event_listeners (): void {
    // ----- Sidebar tab bar (Animations / Sprite Sheet) -----
    // The Sprite Sheet settings used to live in a floating popup; now
    // it's a full in-sidebar tab. These tabs control which panel is
    // visible in the sidebar (only one at a time).
    for (const tab of document.querySelectorAll<HTMLElement>('.sidebar-tab')) {
      tab.addEventListener('click', (e) => {
        const target = tab.dataset.tabTarget
        if (target === 'animations' || target === 'sprite-sheet') {
          this.switch_tab(target)
        }
      })
    }

    // Select All
    this.ui.dom_ss_select_all?.addEventListener('click', () => {
      this.set_all_directions(true)
    })

    // Select Cardinal only (S, N, E, W / 下上左右)
    this.ui.dom_ss_select_cardinal?.addEventListener('click', () => {
      this.set_cardinal_directions()
    })

    // Select Diagonal only (SW, NW, NE, SE / 右下右上左上左下)
    this.ui.dom_ss_select_diagonal?.addEventListener('click', () => {
      this.set_diagonal_directions()
    })

    // Reset defaults
    this.ui.dom_ss_reset_defaults?.addEventListener('click', () => {
      this.settings.reset_defaults()
      this.sync_ui_from_settings()
      this.settings.save()
    })

    // Export button inside the panel — kick off the actual export.
    this.ui.dom_ss_apply_and_export?.addEventListener('click', () => {
      this.read_ui_into_settings()
      this.settings.save()
      // Dispatch a custom event so the main bootstrap can pick it up
      this.ui.dom_ss_apply_and_export?.dispatchEvent(
        new CustomEvent('sprite-sheet-start-export', { bubbles: true })
      )
    })

    // -------- Camera pitch / distance sync buttons --------
    // These keep their Apply/Read semantics: Apply pushes the panel's
    // pitch/distance values into the MAIN 3D viewport camera; Read pulls
    // them back. The live preview always tracks the panel's values (no
    // Apply needed for preview).
    this.ui.dom_ss_pitch_apply?.addEventListener('click', () => {
      this.read_ui_into_settings()
      this.engine.set_camera_angles(this.settings.pitch_angle_degrees, this.settings.camera_distance)
    })
    this.ui.dom_ss_pitch_read?.addEventListener('click', () => {
      const a = this.engine.get_camera_angles()
      if (a === null) return
      this.settings.pitch_angle_degrees = a.pitch_degrees
      this.set_value(this.ui.dom_ss_pitch_angle, a.pitch_degrees)
    })
    this.ui.dom_ss_distance_apply?.addEventListener('click', () => {
      this.read_ui_into_settings()
      this.engine.set_camera_angles(this.settings.pitch_angle_degrees, this.settings.camera_distance)
    })
    this.ui.dom_ss_distance_read?.addEventListener('click', () => {
      const a = this.engine.get_camera_angles()
      if (a === null) return
      this.settings.camera_distance = a.distance
      this.set_value_float(this.ui.dom_ss_camera_distance, a.distance)
    })

    // -------- Live sync: input changes flow into settings --------
    // Pitch / distance drive the preview camera + apply buttons.
    // Canvas / frame / padding drive the exporter's layout math.
    // Silhouette drives the exporter's material swap.
    // Sample-every drives the exporter's frame skipping.
    // We keep direction toggles out of this — they already write
    // directly via their own checkbox change handlers below.
    const live_inputs: Array<HTMLInputElement | null> = [
      this.ui.dom_ss_sample_every,
      this.ui.dom_ss_canvas_width,
      this.ui.dom_ss_canvas_height,
      this.ui.dom_ss_frame_width,
      this.ui.dom_ss_frame_height,
      this.ui.dom_ss_padding,
      this.ui.dom_ss_pitch_angle,
      this.ui.dom_ss_camera_distance,
      this.ui.dom_ss_silhouette,
      this.ui.dom_ss_one_row_per_direction,
      this.ui.dom_ss_background_color
    ]
    for (const el of live_inputs) {
      el?.addEventListener('input', () => {
        this.read_ui_into_settings()
        this.settings.save()
      })
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Tab handling                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Switch the sidebar's visible tab. The Sprite Sheet settings panel
   * used to be a 380×612 floating popup — too cramped for the growing
   * list of options. Now it's a dedicated sidebar tab, switched via
   * the tab bar at the top of the sidebar.
   *
   * The preview render loop is started/stopped based on which tab is
   * active so we don't burn GPU cycles when the user is looking at
   * the Animations tab.
   *
   * @param target 'animations' (default landing) or 'sprite-sheet'
   */
  private switch_tab (target: 'animations' | 'sprite-sheet'): void {
    // Update tabs
    for (const tab of document.querySelectorAll<HTMLElement>('.sidebar-tab')) {
      const is_active = tab.dataset.tabTarget === target
      tab.classList.toggle('active', is_active)
      tab.setAttribute('aria-selected', is_active ? 'true' : 'false')
    }
    // Update panels: show the active one, hide the other.
    // We toggle `hidden` so screen readers / no-JS users still get
    // the right semantic.
    for (const panel of document.querySelectorAll<HTMLElement>('[data-tab-panel]')) {
      const is_active = panel.dataset.tabPanel === target
      panel.classList.toggle('active', is_active)
      if (is_active) {
        panel.removeAttribute('hidden')
      } else {
        panel.setAttribute('hidden', '')
      }
    }
    // Start/stop preview based on which tab is active.
    if (target === 'sprite-sheet') {
      this.start_live_preview()
    } else {
      this.stop_live_preview()
    }
    // When switching to the sprite sheet tab, make sure the form reflects
    // the latest saved settings (in case the user changed something
    // externally since last open).
    if (target === 'sprite-sheet') {
      this.sync_ui_from_settings()
    }
  }

  private set_all_directions (enabled: boolean): void {
    const cbs = this.get_dir_checkboxes()
    for (const cb of cbs) {
      cb.checked = enabled
      const dir = this.settings.directions.find(d => d.id === cb.dataset.dirId)
      if (dir) dir.enabled = enabled
    }
    this.settings.save()
  }

  private set_cardinal_directions (): void {
    this.settings.set_cardinal_only()
    this.sync_dir_checkboxes_from_settings()
    this.settings.save()
  }

  private set_diagonal_directions (): void {
    this.settings.set_diagonal_only()
    this.sync_dir_checkboxes_from_settings()
    this.settings.save()
  }

  private sync_dir_checkboxes_from_settings (): void {
    const cbs = this.get_dir_checkboxes()
    for (const cb of cbs) {
      const dir = this.settings.directions.find(d => d.id === cb.dataset.dirId)
      cb.checked = dir?.enabled ?? true
    }
  }

  /* ---- live preview in the small canvas ---- */

  /**
   * Start rendering the main 3D scene into the sidebar's small canvas using
   * the sprite sheet's pitch + distance settings. Throttled to ~15 fps to
   * keep the UI responsive while the user is fiddling with the inputs.
   *
   * Approach: instead of duplicating the entire WebGL renderer (which is
   * expensive and brittle — the main scene has its own animation, lights,
   * and OrbitControls), we sample the main renderer's canvas at the
   * predicted sprite-sheet "capture" region. The main renderer's frame
   * is already being drawn at 60fps by the engine's render loop, so the
   * preview just copies a sub-region of it into the small canvas.
   *
   * Always-on: no start/stop button. The render loop is started when
   * the user switches to the Sprite Sheet tab and stopped when they
   * switch back.
   */
  private start_live_preview (): void {
    if (this.preview_animation_handle !== null) return
    const canvas = this.ui.dom_ss_preview_canvas
    if (!canvas) return

    // Set up a fresh, independent WebGLRenderer bound to the small canvas.
    // We use this instead of drawImage(main_canvas) because the main
    // renderer was created with preserveDrawingBuffer:false, so reading
    // pixels back from it returns a black frame. Note: we explicitly set
    // `preserveDrawingBuffer: true` here so drawImage(preview_canvas, ...)
    // and readPixels() return the last rendered frame instead of zeros
    // (the default of `false` causes the browser to clear the buffer after
    // each composite, which makes a thumbnail / screenshot black).
    try {
      this.preview_renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true
      })
      this.preview_renderer.setPixelRatio(window.devicePixelRatio || 1)
      this.preview_renderer.setSize(canvas.width, canvas.height, false)
      this.preview_renderer.setClearColor(0x0d1b22, 1)
    } catch (e) {
      console.warn('sprite sheet preview: failed to create WebGLRenderer', e)
      this.preview_renderer = null
      this.stop_live_preview()
      return
    }

    // Independent PerspectiveCamera. The main renderer's camera stays in
    // whatever orbit position the user dragged it to — this one is driven
    // entirely by the sprite sheet's pitch + distance.
    this.preview_camera = new PerspectiveCamera(
      45,
      canvas.width / canvas.height,
      0.1,
      100
    )

    // Make sure the small canvas matches its displayed CSS size to its
    // backing buffer — the panel max-height + scroll can resize it after open.
    this.resize_preview_renderer_to_canvas()

    const tick = (): void => {
      this.preview_animation_handle = requestAnimationFrame(tick)
      if (this.preview_renderer === null || this.preview_camera === null) return
      const now = performance.now()
      // Throttle to ~15 fps; the preview is a sanity check, not a live editor.
      if (now - this.preview_last_render_ms < 60) return
      this.preview_last_render_ms = now
      this.render_preview_frame()
    }
    this.preview_animation_handle = requestAnimationFrame(tick)
  }

  private stop_live_preview (): void {
    if (this.preview_animation_handle !== null) {
      cancelAnimationFrame(this.preview_animation_handle)
      this.preview_animation_handle = null
    }
    if (this.preview_renderer !== null) {
      // Dispose the renderer's GL resources, but leave the canvas itself
      // alone (it's a UI element, not owned by us).
      this.preview_renderer.dispose()
      this.preview_renderer = null
    }
    this.preview_camera = null
    this.preview_last_render_ms = 0
  }

  /**
   * Re-measure the preview canvas's CSS box and update the renderer to
   * match. Called once at preview start and on window resize.
   */
  private resize_preview_renderer_to_canvas (): void {
    if (this.preview_renderer === null) return
    const canvas = this.ui.dom_ss_preview_canvas
    if (canvas === null) return
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    this.preview_renderer.setSize(w, h, false)
    if (this.preview_camera !== null) {
      this.preview_camera.aspect = w / h
      this.preview_camera.updateProjectionMatrix()
    }
  }

  /**
   * One pass of the preview renderer: position the camera, then render the
   * main scene. The scene contains the loaded model + skeleton helper, so
   * we get the same look as the main viewport (modulo lighting + tone
   * mapping; the preview renderer inherits three.js defaults, which is
   * close enough for a sanity check).
   */
  private render_preview_frame (): void {
    if (this.preview_renderer === null || this.preview_camera === null) return
    const scene = this.engine.get_scene()
    if (scene === null) return
    // Lazily create / update the camera position based on the sprite sheet
    // settings. We rotate the preview around the orbit target over time so
    // the user actually sees the model from all sides without dragging.
    this.update_preview_camera()
    this.preview_renderer.render(scene, this.preview_camera)
  }

  /**
   * Position the preview camera relative to the main scene's OrbitControls
   * target. The preview always faces the target; the user's current orbit
   * angle is ignored so the preview shows "front" by default and
   * auto-rotates so the model is visible from all directions.
   */
  private update_preview_camera (): void {
    if (this.preview_camera === null) return
    const target = this.engine.get_camera_target()
    const pitch_rad = (this.settings.pitch_angle_degrees * Math.PI) / 180
    const distance = Math.max(0.5, this.settings.camera_distance)
    const horizontal = distance * Math.cos(pitch_rad)
    const vertical = distance * Math.sin(pitch_rad)
    // Auto-rotate direction so the preview isn't a frozen frame.
    this.preview_direction_deg = (this.preview_direction_deg + 0.6) % 360
    const dir_rad = (this.preview_direction_deg * Math.PI) / 180
    this.preview_camera.position.set(
      target.x + horizontal * Math.sin(dir_rad),
      target.y + vertical,
      target.z + horizontal * Math.cos(dir_rad)
    )
    this.preview_camera.lookAt(target)
    this.preview_camera.updateMatrixWorld(true)
  }

  /* ---- helpers ---- */

  private get_dir_checkboxes (): HTMLInputElement[] {
    if (!this.ui.dom_ss_direction_grid) return []
    return Array.from(
      this.ui.dom_ss_direction_grid.querySelectorAll('input[type="checkbox"]')
    ) as HTMLInputElement[]
  }

  private num_value (el: HTMLInputElement | null, fallback: number): number {
    if (!el) return fallback
    const v = parseInt(el.value, 10)
    return isNaN(v) ? fallback : v
  }

  private float_value (el: HTMLInputElement | null, fallback: number): number {
    if (!el) return fallback
    const v = parseFloat(el.value)
    return isNaN(v) ? fallback : v
  }

  private set_value (el: HTMLInputElement | null, val: number): void {
    if (el) el.value = String(val)
  }

  private set_value_float (el: HTMLInputElement | null, val: number): void {
    if (el) el.value = val.toFixed(1)
  }
}