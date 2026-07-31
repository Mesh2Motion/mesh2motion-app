/**
 * SpriteSheetSettings — sprite sheet export configuration with localStorage persistence.
 *
 * Persistent keys are prefixed 'mesh2motion-sprite-sheet:' so they don't collide with other
 * app settings.
 */

export interface DirectionEntry {
  readonly id: string
  readonly label: string
  readonly short_label: string
  readonly angle: number
  enabled: boolean
}

const ALL_DIRECTIONS: DirectionEntry[] = [
  { id: 'S',  label: '\u4e0b (Front)',     short_label: '\u4e0b', angle: 0,           enabled: true },
  { id: 'SW', label: '\u53f3\u4e0b (Fwd-R)', short_label: '\u53f3\u4e0b', angle: Math.PI / 4, enabled: true },
  { id: 'W',  label: '\u53f3 (Right)',       short_label: '\u53f3', angle: Math.PI / 2, enabled: true },
  { id: 'NW', label: '\u53f3\u4e0a (Bck-R)', short_label: '\u53f3\u4e0a', angle: 3 * Math.PI / 4, enabled: true },
  { id: 'N',  label: '\u4e0a (Back)',       short_label: '\u4e0a', angle: Math.PI,     enabled: true },
  { id: 'NE', label: '\u5de6\u4e0a (Bck-L)', short_label: '\u5de6\u4e0a', angle: 5 * Math.PI / 4, enabled: true },
  { id: 'E',  label: '\u5de6 (Left)',       short_label: '\u5de6', angle: 3 * Math.PI / 2, enabled: true },
  { id: 'SE', label: '\u5de6\u4e0b (Fwd-L)', short_label: '\u5de6\u4e0b', angle: 7 * Math.PI / 4, enabled: true },
]

export const DIRECTION_COUNT = ALL_DIRECTIONS.length

export interface SpriteSheetSettingsJSON {
  sample_every_n_frames: number
  canvas_width: number
  canvas_height: number
  frame_width: number
  frame_height: number
  padding: number
  pitch_angle_degrees: number
  camera_distance: number
  silhouette: boolean
  background_color: number
  one_row_per_direction: boolean
  directions: Array<{ id: string; enabled: boolean }>
}

const STORAGE_KEY = 'mesh2motion-sprite-sheet:settings'

/** Pitch range in degrees. 0 = camera at model's mid-height (horizontal view).
 *  Positive = camera above model (looking down at head/top), negative = below. */
const PITCH_MIN_DEG = -80
const PITCH_MAX_DEG = 80
const PITCH_DEFAULT_DEG = 60

/** Camera distance range (world units, matches OrbitControls min/max distance). */
const DISTANCE_MIN = 1
const DISTANCE_MAX = 50
const DISTANCE_DEFAULT = 10

/** Canvas size range. We default to 1024×1024 so the sheet is roughly square
 *  — much more useful than a single long horizontal strip. Users can still
 *  override per-export via the panel. */
const CANVAS_MIN = 64
const CANVAS_MAX = 4096
const CANVAS_DEFAULT = 1024

export class SpriteSheetSettings {
  public sample_every_n_frames: number = 1
  public canvas_width: number = CANVAS_DEFAULT
  public canvas_height: number = CANVAS_DEFAULT
  public frame_width: number = 128
  public frame_height: number = 128
  // Default the padding to 0 so a default 1024×1024 canvas with 128×128 frames
  // can fit the full 8 × 24 grid of one of the bundled animations with no
  // overflow warning. Users can still raise it for visual separation.
  public padding: number = 0
  public pitch_angle_degrees: number = PITCH_DEFAULT_DEG
  public camera_distance: number = DISTANCE_DEFAULT
  // Default the silhouette to OFF — most users want color. Toggle ON to
  // get the legacy black-on-green look that game engines can chroma-key.
  public silhouette: boolean = false
  // When false (default), cells are laid out col-major: the first action's
  // frames fill row 0 left-to-right, then the next direction, then continue
  // wrapping rows. When true, the grid is laid out with one direction per
  // row (the legacy "1 row per direction" style). With a single animation
  // the two modes differ only when rows > directions_enabled; multi-action
  // support is planned.
  public one_row_per_direction: boolean = false
  // Background color used in both silhouette and color modes. Default is
  // green (#00ff00) because it's the most common chroma-key color for
  // sprite sheet workflows — game engines can punch out the green pixels
  // to get a transparent character sprite. Users can override to white,
  // black, or any other color via the panel.
  public background_color: number = 0x00ff00
  public readonly directions: DirectionEntry[]

  constructor () {
    this.directions = ALL_DIRECTIONS.map(d => ({ ...d }))
  }

  public enabled_directions (): DirectionEntry[] {
    return this.directions.filter(d => d.enabled)
  }

  public enabled_direction_count (): number {
    return this.directions.filter(d => d.enabled).length
  }

  public all_selected (): boolean {
    return this.directions.every(d => d.enabled)
  }

  public set_cardinal_only (): void {
    const cardinal = new Set(['S', 'N', 'E', 'W'])
    this.directions.forEach(d => { d.enabled = cardinal.has(d.id) })
  }

  public set_diagonal_only (): void {
    const diagonal = new Set(['SW', 'NW', 'NE', 'SE'])
    this.directions.forEach(d => { d.enabled = diagonal.has(d.id) })
  }

  public set_all (enabled: boolean): void {
    this.directions.forEach(d => { d.enabled = enabled })
  }

  public save (): void {
    const json: SpriteSheetSettingsJSON = {
      sample_every_n_frames: this.sample_every_n_frames,
      canvas_width: this.canvas_width,
      canvas_height: this.canvas_height,
      frame_width: this.frame_width,
      frame_height: this.frame_height,
      padding: this.padding,
      pitch_angle_degrees: this.pitch_angle_degrees,
      camera_distance: this.camera_distance,
      silhouette: this.silhouette,
      background_color: this.background_color,
      one_row_per_direction: this.one_row_per_direction,
      directions: this.directions.map(d => ({ id: d.id, enabled: d.enabled }))
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json))
    } catch {
      console.warn('SpriteSheetSettings: failed to save to localStorage')
    }
  }

  public load (): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw === null) return
      const json: SpriteSheetSettingsJSON = JSON.parse(raw)

      this.sample_every_n_frames = clamp(json.sample_every_n_frames ?? 1, 1, 60)
      this.canvas_width = clamp(json.canvas_width ?? CANVAS_DEFAULT, CANVAS_MIN, CANVAS_MAX)
      this.canvas_height = clamp(json.canvas_height ?? CANVAS_DEFAULT, CANVAS_MIN, CANVAS_MAX)
      this.frame_width = clamp(json.frame_width ?? 128, 16, 2048)
      this.frame_height = clamp(json.frame_height ?? 128, 16, 2048)
      this.padding = clamp_int(json.padding ?? 0, 0, 128)
      this.pitch_angle_degrees = clamp(json.pitch_angle_degrees ?? PITCH_DEFAULT_DEG, PITCH_MIN_DEG, PITCH_MAX_DEG)
      this.camera_distance = clamp(json.camera_distance ?? DISTANCE_DEFAULT, DISTANCE_MIN, DISTANCE_MAX)
      this.silhouette = json.silhouette ?? false
      this.one_row_per_direction = json.one_row_per_direction ?? false
      // background_color: a 24-bit RGB integer (0xRRGGBB). Reject values
      // outside that range so a corrupted localStorage entry can't make
      // the canvas invisible.
      this.background_color = clamp_int(json.background_color ?? 0x00ff00, 0, 0xffffff)

      if (Array.isArray(json.directions)) {
        const dir_map = new Map(json.directions.map(d => [d.id, d.enabled]))
        for (const dir of this.directions) {
          if (dir_map.has(dir.id)) {
            dir.enabled = dir_map.get(dir.id)!
          }
        }
      }
    } catch {
      console.warn('SpriteSheetSettings: parse failed, using defaults')
      this.reset_defaults()
    }
  }

  public reset_defaults (): void {
    this.sample_every_n_frames = 1
    this.canvas_width = CANVAS_DEFAULT
    this.canvas_height = CANVAS_DEFAULT
    this.frame_width = 128
    this.frame_height = 128
    this.padding = 0
    this.pitch_angle_degrees = PITCH_DEFAULT_DEG
    this.camera_distance = DISTANCE_DEFAULT
    this.silhouette = false
    this.background_color = 0x00ff00
    this.one_row_per_direction = false
    this.directions.forEach(d => { d.enabled = true })
  }
}

function clamp (v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

function clamp_int (v: number, lo: number, hi: number): number {
  // Like clamp, but for integer RGB values. We round and ensure the
  // result is a non-fractional integer inside [lo, hi].
  if (!Number.isFinite(v)) return lo
  return Math.min(Math.max(Math.round(v), lo), hi)
}