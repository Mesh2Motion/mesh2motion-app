import { Euler, Group, Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { SkeletonType } from '../../../enums/SkeletonType.ts'
import { asset_path, props_manifest, type ManifestProp } from '../../../AssetManifest.ts'
import { type PropId } from './PropId.ts'
import { PropSide } from './PropSide.ts'

export interface PropMountOffset {
  // meters for a rig at skeleton scale 1.0, along the hand bone toward the fingers
  along_hand: number
  // meters for a rig at skeleton scale 1.0, along world down in the bind pose
  below_palm: number
  // applied after the prop's +Y is aligned with the grip axis (world forward)
  rotation: Euler
}

export interface PropDefinition {
  id: PropId
  display_name: string
  category: string // group shown in the prop picker, e.g. 'Swords'
  asset_path: string // relative to the static root
  preview_path: string // relative to the static root
  model_offset_y: number
  default_mount_offsets: Record<PropSide, PropMountOffset>
  rig_mount_offsets: Partial<Record<SkeletonType, Record<PropSide, PropMountOffset>>>
}

/**
 * App-specific settings for a prop. The model and preview files come from the props manifest.
 * Props in the manifest without settings are still shown, using their manifest name.
 */
interface PropSettings {
  display_name: string
  category?: string // overrides the group from category_names
  model_offset_y?: number
}

// picker group for each props manifest category
const category_names: Record<string, string> = {
  spear: 'Polearms',
  halberd: 'Polearms',
  staff: 'Staves',
  arrow: 'Ranged',
  bow: 'Ranged',
  axe: 'Axes',
  dagger: 'Daggers',
  fistweapon: 'Fist Weapons',
  hammer: 'Hammers',
  shield: 'Shields',
  sword: 'Swords',
  wand: 'Wands',
  guns: 'Guns'
}

// keyed by prop name in the props manifest. Props are shown in this order, then any others in manifest order
const prop_settings: Record<string, PropSettings> = {
  spear_A: { display_name: 'Spear' },
  halberd: { display_name: 'Halberd' },
  staff_A: { display_name: 'Wooden Quarterstaff' },
  staff_B: { display_name: 'Crystal-Topped Staff' },
  arrow_A: { display_name: 'Arrow' },
  arrow_B: { display_name: 'Home made Arrow' },
  bow_A: { display_name: 'Wooden Recurve Bow' },
  bow_A_withString: { display_name: 'Wooden Recurve Bow with Bowstring' },
  bow_B: { display_name: 'Ornate Recurve Bow' },
  bow_B_withString: { display_name: 'Ornate Recurve Bow with Bowstring' },
  axe_A: { display_name: 'Battle Axe' },
  axe_B: { display_name: 'Large Battle Axe' },
  axe_C: { display_name: 'Broad-Headed Battle Axe' },
  dagger_A: { display_name: 'Double-Edged Dagger' },
  dagger_B: { display_name: 'Sai' },
  Knife_1: { display_name: 'Combat Knife', category: 'Daggers' },
  Knife_2: { display_name: 'Hunting Knife', category: 'Daggers' },
  fistweapon_A: { display_name: 'Brass Knuckles' },
  fistweapon_B: { display_name: 'Tekko-Kagi (Hand Claws)' },
  hammer_A: { display_name: 'Sledgehammer' },
  hammer_B: { display_name: 'Spiked War Hammer' },
  hammer_C: { display_name: 'Wooden Spiked Bat' },
  shield_A: { display_name: 'Round Shield' },
  shield_B: { display_name: 'Heater Shield' },
  shield_C: { display_name: 'Kite Shield' },
  sword_A: { display_name: 'Cartoon Sword' },
  sword_B: { display_name: 'Short Sword' },
  sword_C: { display_name: 'Katana' },
  sword_D: { display_name: 'Rapier' },
  sword_E: { display_name: 'Greatsword' },
  wand_A: { display_name: 'Crystal Wand' },
  Pistol: { display_name: 'Pistol' },
  Revolver: { display_name: 'Revolver' },
  Revolver_Small: { display_name: 'Snub-Nose Revolver' },
  SMG: { display_name: 'Submachine Gun' },
  AK: { display_name: 'Assault Rifle' },
  Shotgun: { display_name: 'Shotgun' },
  Sniper: { display_name: 'Sniper Rifle' },
  Sniper_2: { display_name: 'Heavy Sniper Rifle' },
  GrenadeLauncher: { display_name: 'Grenade Launcher' },
  RocketLauncher: { display_name: 'Rocket Launcher' },
  ShortCannon: { display_name: 'Hand Cannon' },
  Shovel: { display_name: 'Shovel', category: 'Tools' },
  Sickle: { display_name: 'Sickle', category: 'Tools' }
}

// 'fistweapon_A_stacked' -> 'Fistweapon A Stacked'
function display_name_from_manifest_name (name: string): string {
  return name.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

function create_definition (manifest_prop: ManifestProp): PropDefinition {
  const settings: PropSettings | undefined = prop_settings[manifest_prop.name]
  return {
    id: manifest_prop.name,
    display_name: settings?.display_name ?? display_name_from_manifest_name(manifest_prop.name),
    category: settings?.category ?? category_names[manifest_prop.category] ?? display_name_from_manifest_name(manifest_prop.category),
    asset_path: asset_path(manifest_prop.file),
    preview_path: asset_path(manifest_prop.preview.file),
    model_offset_y: settings?.model_offset_y ?? 0,
    default_mount_offsets: {
      [PropSide.Left]: { along_hand: 0.09, below_palm: 0.035, rotation: new Euler() },
      [PropSide.Right]: { along_hand: 0.09, below_palm: 0.035, rotation: new Euler() }
    },
    rig_mount_offsets: {}
  }
}

function create_definitions (): PropDefinition[] {
  const configured_names = Object.keys(prop_settings)
  for (const name of configured_names) {
    if (!props_manifest.props.some(prop => prop.name === name)) {
      console.warn(`PropCatalog: prop '${name}' is not in the props manifest`)
    }
  }

  // configured props first in their configured order, then any others in manifest order
  const sorted = [...props_manifest.props].sort((a, b) => {
    const a_index = configured_names.indexOf(a.name)
    const b_index = configured_names.indexOf(b.name)
    return (a_index === -1 ? Infinity : a_index) - (b_index === -1 ? Infinity : b_index)
  })

  return sorted.map(create_definition)
}

export class PropCatalog {
  public static readonly supported_skeleton_types: SkeletonType[] = [SkeletonType.Human, SkeletonType.Kaiju]

  private static readonly loader: GLTFLoader = new GLTFLoader()
  private static readonly model_cache = new Map<string, Promise<Group>>()

  private static readonly definitions: PropDefinition[] = create_definitions()

  public static all (): PropDefinition[] {
    return this.definitions
  }

  public static find (id: PropId): PropDefinition | undefined {
    return this.definitions.find((definition) => definition.id === id)
  }

  public static async create_object (definition: PropDefinition): Promise<Object3D> {
    const model = (await this.load_model(definition.asset_path)).clone(true)
    model.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry = child.geometry.clone()
        child.material = Array.isArray(child.material)
          ? child.material.map((material) => material.clone())
          : child.material.clone()
      }
    })

    const prop_object = new Group()
    model.position.y += definition.model_offset_y
    prop_object.add(model)
    return prop_object
  }

  public static is_supported_skeleton (skeleton_type: SkeletonType): boolean {
    return this.supported_skeleton_types.includes(skeleton_type)
  }

  public static mount_offset (definition: PropDefinition, skeleton_type: SkeletonType, side: PropSide): PropMountOffset {
    return definition.rig_mount_offsets[skeleton_type]?.[side] ?? definition.default_mount_offsets[side]
  }

  private static async load_model (asset_path: string): Promise<Group> {
    let model_promise = this.model_cache.get(asset_path)
    if (model_promise === undefined) {
      model_promise = this.loader.loadAsync(asset_path)
        .then((gltf) => gltf.scene)
        .catch((error: unknown) => {
          this.model_cache.delete(asset_path)
          throw error
        })
      this.model_cache.set(asset_path, model_promise)
    }

    return await model_promise
  }
}
