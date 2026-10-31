import { SkeletonType } from './enums/SkeletonType'
import { asset_manifest, asset_path, type ManifestRig, type ManifestVariation } from './AssetManifest'

/**
 * App-specific settings for a model variation. The model file itself comes from the asset manifest.
 * Variations in the manifest without settings are still shown, using their manifest name and a CC0 license.
 */
interface VariationSettings {
  display_name: string // Display name shown in the model dropdown, e.g. 'Police Female'
  attribution?: string // only needed for CC-SA and CC-BY
  license?: string // defaults to CC0
  expand_arms?: number // Explore page arm expansion value, defaults to 0
  // Multiplier applied to the position keyframes of the rig's position tracking bone (e.g. pelvis/hips).
  // Taller variations need a value above 1.0 so their feet stay on the ground instead of sinking below it.
  pelvis_position_scale?: number
}

/**
 * App-specific settings for a rig. Everything about which files exist (model, skeleton,
 * variations, animations) comes from the asset manifest, looked up with manifest_key.
 */
interface RigSettings {
  skeleton_type: SkeletonType // The SkeletonType enum member for this rig
  manifest_key: string // key of this rig in the asset manifest, e.g. 'human'
  rig_display_name: string // Display name shown in both the model and skeleton dropdowns
  animation_preview_folder: string // Sub-folder name used when referencing animation preview thumbnails
  skeleton_template_image_url: string // URL for the skeleton template image shown in the edit skeleton step
  // The bone used for position tracking (e.g., 'hips' or 'head').
  // we only have one bone per rig that we allow position keyframes (besides root)
  position_tracking_bone_name: string
  // keyed by the variation name in the asset manifest. Variations listed here are shown first, in this order
  variations?: Record<string, VariationSettings>
}

export interface ModelVariation {
  name: string // variation name in the asset manifest, e.g. 'psx-05'
  model_file: string // Model file path relative to the static root, e.g. 'assets/human/variations/psx-05.glb'
  display_name: string // Display name shown in the model dropdown, e.g. 'Human (A-Pose)'
  attribution: string // Free-form attribution text to be shown in the UI when this model variation is selected, e.g. 'Model by Artist Name'
  preview_image: string // Preview image path relative to the static root, e.g. 'variation-previews/human/psx-05.png'
  license: string // License string for this model variation, e.g. 'CC0', 'CC-SA 4.0'
  expandArms: number // Explore page arm expansion value, default 0 for human rigs
  pelvis_position_scale: number
}

export interface RigAnimation {
  name: string // clip name inside the GLB, e.g. 'Walk'
  file: string // GLB file path relative to the static root, e.g. 'assets/human/animations/walk.glb'
  tags: string[]
  loop: boolean
  root_motion: boolean
  frame_count: number
  duration: number // seconds
}

export interface RigConfigEntry extends Omit<RigSettings, 'variations'> {
  model_file: string // Model file path relative to the static root, e.g. 'assets/human/model.glb'
  rig_file: string // Rig/skeleton GLB file path relative to the static root, e.g. 'assets/human/skeleton.glb'
  fps: number
  animations: RigAnimation[]
  model_variations: ModelVariation[] // similar models (human, zombie, etc)
}

const rig_settings: RigSettings[] = [
  {
    skeleton_type: SkeletonType.Human,
    manifest_key: 'human',
    rig_display_name: 'Human',
    animation_preview_folder: 'human',
    position_tracking_bone_name: 'pelvis',
    skeleton_template_image_url: 'rig-reference/human.png',
    variations: {
      base: { display_name: 'Male', attribution: 'Quaternius' },
      zombie: { display_name: 'Zombie', attribution: 'Kenney.nl' },
      'psx-female-08': { display_name: 'Female 8', attribution: 'elbolilloduro' },
      'psx-female-09': { display_name: 'Female 9', attribution: 'elbolilloduro', pelvis_position_scale: 1.02 },
      'psx-31-female': { display_name: 'Female 31', attribution: 'elbolilloduro', pelvis_position_scale: 0.92 },
      'psx-05': { display_name: 'Male 5', attribution: 'elbolilloduro' },
      'psx-06': { display_name: 'Male 6', attribution: 'elbolilloduro' },
      'psx-10': { display_name: 'Male 10', attribution: 'elbolilloduro' },
      'psx-15': { display_name: 'Male 15', attribution: 'elbolilloduro' },
      'psx-32': { display_name: 'Male 32', attribution: 'elbolilloduro', pelvis_position_scale: 0.96 },
      'psx-26-doctor': { display_name: 'Doctor Male', attribution: 'elbolilloduro' },
      'psx-21-police': { display_name: 'SWAT Male', attribution: 'elbolilloduro' },
      'psx-18-police': { display_name: 'Police Male', attribution: 'elbolilloduro' },
      'psx-17-female-police': { display_name: 'Police Female', attribution: 'elbolilloduro' },
      'psx-28-female-hm': { display_name: 'Hazmat Female', attribution: 'elbolilloduro' },
      'psx-28-hm': { display_name: 'Hazmat Suit Male', attribution: 'elbolilloduro', pelvis_position_scale: 1.05 },
      'psx-killer-04': { display_name: 'Killer 4', attribution: 'elbolilloduro', pelvis_position_scale: 1.02 },
      'psx-killer-05': { display_name: 'Killer 5', attribution: 'elbolilloduro', pelvis_position_scale: 1.05 },
      'psx-killer-06': { display_name: 'Killer 6', attribution: 'elbolilloduro', pelvis_position_scale: 1.05 },
      'psx-killer-07': { display_name: 'Killer 7', attribution: 'elbolilloduro' },
      'psx-monster': { display_name: 'Monster', attribution: 'elbolilloduro', pelvis_position_scale: 1.37 },
      'psx-monster-03': { display_name: 'Monster 3', attribution: 'elbolilloduro', pelvis_position_scale: 1.05 },
      'psx-monster-04': { display_name: 'Monster 4', attribution: 'elbolilloduro', pelvis_position_scale: 1.55 },
      'psx-monster-05': { display_name: 'Monster 5', attribution: 'elbolilloduro', pelvis_position_scale: 1.12 },
      sophia: { display_name: 'Sophia', attribution: 'Tysan Tan', license: 'CC-SA 4.0' },
      jay: { display_name: 'Jay', attribution: 'Blender Studio', license: 'CC-BY' },
      sintel: { display_name: 'Sintel', attribution: 'Blender Studio', license: 'CC-BY' },
      bunny: { display_name: 'Bunny', attribution: 'Blender Studio', license: 'CC-BY', expand_arms: -30 }
    }
  },
  {
    skeleton_type: SkeletonType.Fox,
    manifest_key: 'fox',
    rig_display_name: 'Fox',
    animation_preview_folder: 'fox',
    position_tracking_bone_name: 'hips',
    skeleton_template_image_url: 'rig-reference/fox.png',
    variations: {
      base: { display_name: 'Fox' },
      dog: { display_name: 'Dog' },
      cat: { display_name: 'Carrot', attribution: 'David Revoy', license: 'CC-BY' },
      panda: { display_name: 'Panda' }
    }
  },
  {
    skeleton_type: SkeletonType.Bird,
    manifest_key: 'bird',
    rig_display_name: 'Bird',
    animation_preview_folder: 'bird',
    position_tracking_bone_name: 'hips',
    skeleton_template_image_url: 'rig-reference/bird.png',
    variations: {
      seagull: { display_name: 'Seagull' },
      eagle: { display_name: 'Bald Eagle' }
    }
  },
  {
    skeleton_type: SkeletonType.Dragon,
    manifest_key: 'dragon',
    rig_display_name: 'Dragon',
    animation_preview_folder: 'dragon',
    position_tracking_bone_name: 'hips',
    skeleton_template_image_url: 'rig-reference/dragon.png'
  },
  {
    skeleton_type: SkeletonType.Kaiju,
    manifest_key: 'kaiju',
    rig_display_name: 'Kaiju',
    animation_preview_folder: 'kaiju',
    position_tracking_bone_name: 'hips',
    skeleton_template_image_url: 'rig-reference/kaiju.png',
    variations: {
      base: { display_name: 'Lizard' },
      trex: { display_name: 'T-Rex' }
    }
  },
  {
    skeleton_type: SkeletonType.Spider,
    manifest_key: 'spider',
    rig_display_name: 'Spider',
    animation_preview_folder: 'spider',
    position_tracking_bone_name: 'hips',
    skeleton_template_image_url: 'rig-reference/spider.png'
  },
  {
    skeleton_type: SkeletonType.Snake,
    manifest_key: 'snake',
    rig_display_name: 'Snake',
    animation_preview_folder: 'snake',
    position_tracking_bone_name: 'head', // snake doesn't have hips, so we track position from the head instead
    skeleton_template_image_url: 'rig-reference/snake.png'
  },
  {
    skeleton_type: SkeletonType.Fish,
    manifest_key: 'shark',
    rig_display_name: 'Fish',
    animation_preview_folder: 'shark',
    position_tracking_bone_name: 'pelvis',
    skeleton_template_image_url: 'rig-reference/shark.png',
    variations: {
      shark: { display_name: 'Shark' },
      whale: { display_name: 'Whale' }
    }
  },
  {
    skeleton_type: SkeletonType.Horse,
    manifest_key: 'horse',
    rig_display_name: 'Horse',
    animation_preview_folder: 'horse',
    position_tracking_bone_name: 'hips',
    skeleton_template_image_url: 'rig-reference/horse.png'
  }
]

// 'mannequin-female' -> 'Mannequin Female'
function display_name_from_manifest_name (name: string): string {
  return name.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// The asset manifest does not include variation previews yet, so they live in the app's static folder by variation name
const VARIATION_PREVIEWS_FOLDER = 'variation-previews/'

function create_variation (rig_key: string, manifest_variation: ManifestVariation, settings: VariationSettings | undefined): ModelVariation {
  return {
    name: manifest_variation.name,
    model_file: asset_path(manifest_variation.file),
    preview_image: `${VARIATION_PREVIEWS_FOLDER}${rig_key}/${manifest_variation.name}.png`,
    display_name: settings?.display_name ?? display_name_from_manifest_name(manifest_variation.name),
    attribution: settings?.attribution ?? '',
    license: settings?.license ?? 'CC0',
    expandArms: settings?.expand_arms ?? 0,
    pelvis_position_scale: settings?.pelvis_position_scale ?? 1.0 // 1.0 keeps the authored hip height from the animation data
  }
}

function create_variations (settings: RigSettings, manifest_rig: ManifestRig): ModelVariation[] {
  const variation_settings = settings.variations ?? {}
  const configured_names = Object.keys(variation_settings)

  for (const name of configured_names) {
    if (!manifest_rig.variations.some(v => v.name === name)) {
      console.warn(`RigConfig: variation '${name}' for rig '${settings.manifest_key}' is not in the asset manifest`)
    }
  }

  // configured variations first in their configured order, then any others in manifest order
  const sorted = [...manifest_rig.variations].sort((a, b) => {
    const a_index = configured_names.indexOf(a.name)
    const b_index = configured_names.indexOf(b.name)
    return (a_index === -1 ? Infinity : a_index) - (b_index === -1 ? Infinity : b_index)
  })

  return sorted.map(v => create_variation(settings.manifest_key, v, variation_settings[v.name]))
}

function create_entry (settings: RigSettings): RigConfigEntry | undefined {
  const manifest_rig = asset_manifest.rigs[settings.manifest_key]
  if (manifest_rig === undefined) {
    console.warn(`RigConfig: rig '${settings.manifest_key}' is not in the asset manifest. Skipping it.`)
    return undefined
  }

  return {
    skeleton_type: settings.skeleton_type,
    manifest_key: settings.manifest_key,
    rig_display_name: settings.rig_display_name,
    animation_preview_folder: settings.animation_preview_folder,
    skeleton_template_image_url: settings.skeleton_template_image_url,
    position_tracking_bone_name: settings.position_tracking_bone_name,
    model_file: asset_path(manifest_rig.model.file),
    rig_file: asset_path(manifest_rig.skeleton.file),
    fps: manifest_rig.fps,
    animations: manifest_rig.animations.map(animation => ({
      name: animation.name,
      file: asset_path(animation.file),
      tags: animation.tags,
      loop: animation.loop,
      root_motion: animation.root_motion,
      frame_count: animation.frame_count,
      duration: animation.duration
    })),
    model_variations: create_variations(settings, manifest_rig)
  }
}

/**
 * Single source of truth for every supported rig type.
 * Combines the app-specific settings above with the asset manifest exported from the assets repository.
 * To add a new rig, export it from the assets repository, then append one entry to `rig_settings`.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class RigConfig {
  static readonly all: RigConfigEntry[] = rig_settings
    .map(create_entry)
    .filter((entry): entry is RigConfigEntry => entry !== undefined)

  /** Look up a rig by its SkeletonType enum value (which is also used as the key). */
  static by_key (rig_key: string): RigConfigEntry | undefined {
    return this.all.find(r => r.skeleton_type === rig_key as SkeletonType)
  }

  /** Look up a rig by its SkeletonType enum value. */
  static by_skeleton_type (skeleton_type: SkeletonType): RigConfigEntry | undefined {
    return this.all.find(r => r.skeleton_type === skeleton_type)
  }

  /** Get the rig GLB file path for a given skeleton type. Returns undefined for Error/None. */
  static rig_file_for (skeleton_type: SkeletonType): string | undefined {
    return this.by_skeleton_type(skeleton_type)?.rig_file
  }

  /**
   * Get all animations for a skeleton type. Each animation is a separate GLB file.
   * @param skeleton_type The skeleton type to retrieve animations for
   * @returns Array of animations, empty array if the rig is unknown
   */
  static animations_for (skeleton_type: SkeletonType): RigAnimation[] {
    return this.by_skeleton_type(skeleton_type)?.animations ?? []
  }
}
