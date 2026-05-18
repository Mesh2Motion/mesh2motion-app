import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  GeneratedQuadrupedAnimator,
  type ProceduralQuadrupedMode,
  type ProceduralQuadrupedSettings
} from './retarget/procedural/GeneratedQuadrupedAnimator.ts'
import {
  GeneratedOctopusAnimator,
  type ProceduralOctopusSettings
} from './retarget/procedural/GeneratedOctopusAnimator.ts'

type LionKind = 'riganything' | 'merged' | 'anigen' | 'good' | 'octopus-conjure' | 'octopus-rig' | 'pegasus-conjure' | 'pegasus-rig' | 'brown-pegasus-mesh' | 'brown-pegasus-rig' | 'brown-pegasus-fused' | 'brown-pegasus-horse-rig' | 'kangaroo-conjure' | 'kangaroo-rig' | 'elephant-conjure' | 'elephant-rig' | 'elephant-watertight' | 'elephant-flood3' | 'elephant-smallholes' | 'samoyed-conjure' | 'samoyed-rig' | 'samoyed-watertight' | 'samoyed-flood3' | 'samoyed-smallholes' | 'samoyed-user-ref' | 'samoyed-user-ref-rig'

interface BonePoint {
  name: string
  position: THREE.Vector3
  parent_name: string | null
}

interface SourceAnimationData {
  key: string
  label: string
  rig: string
  animations: string
}

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setClearColor(0x111318)
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.01, 100)
camera.position.set(0.65, 0.35, 1.25)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

scene.add(new THREE.HemisphereLight(0xffffff, 0x253041, 2.8))
const key_light = new THREE.DirectionalLight(0xffffff, 2.3)
key_light.position.set(2, 4, 3)
scene.add(key_light)

const loader = new GLTFLoader()
const draco_loader = new DRACOLoader()
draco_loader.setDecoderPath('/draco/')
loader.setDRACOLoader(draco_loader)
let current: THREE.Object3D | null = null
let skeleton_group: THREE.Group | null = null
let active_skinned_mesh: THREE.SkinnedMesh | null = null
let source_bones: BonePoint[] = []
let animation_clips: THREE.AnimationClip[] = []
let animation_mixer: THREE.AnimationMixer | null = null
let active_action: THREE.AnimationAction | null = null
let current_kind: LionKind = 'riganything'
let current_asset_label = 'RigAnything'
let custom_model_url: string | null = null
let active_source_key = ''
let active_source_label = 'Wolf source'
let auto_mappings: Map<string, string> = new Map()
let manual_mappings: Map<string, string> = new Map()
let mapping_scores: Map<string, number> = new Map()
let procedural_mode: 'none' | 'walk' | 'trot' | 'canter' | 'gallop' | 'hop' | 'idle' | 'head-turn' | 'octopus-squirt' = 'none'
let last_quadruped_motion_mode: ProceduralQuadrupedMode | null = null
let last_octopus_motion_mode: 'octopus-squirt' | null = null
let procedural_animator: GeneratedQuadrupedAnimator | null = null
let octopus_animator: GeneratedOctopusAnimator | null = null
let general_motion_time = 0
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let highlighted_object: THREE.Object3D | null = null
let selected_bone_name: string | null = null
let selected_bone: THREE.Bone | null = null
const highlight_material = new THREE.MeshBasicMaterial({ color: 0xff4d6d, depthTest: false })

const status = document.querySelector('#status') as HTMLDivElement
const skeleton_toggle = document.querySelector('#skeleton') as HTMLInputElement
const animation_select = document.querySelector('#animation-select') as HTMLSelectElement
const play_animation_button = document.querySelector('#play-animation') as HTMLButtonElement
const procedural_walk_button = document.querySelector('#procedural-walk') as HTMLButtonElement
const procedural_trot_button = document.querySelector('#procedural-trot') as HTMLButtonElement
const procedural_canter_button = document.querySelector('#procedural-canter') as HTMLButtonElement
const procedural_gallop_button = document.querySelector('#procedural-gallop') as HTMLButtonElement
const procedural_hop_button = document.querySelector('#procedural-hop') as HTMLButtonElement
const procedural_idle_button = document.querySelector('#procedural-idle') as HTMLButtonElement
const head_turn_button = document.querySelector('#head-turn') as HTMLButtonElement
const octopus_squirt_button = document.querySelector('#octopus-squirt') as HTMLButtonElement
const stop_animation_button = document.querySelector('#stop-animation') as HTMLButtonElement
const save_motion_button = document.querySelector('#save-motion') as HTMLButtonElement | null
const custom_model_input = document.querySelector('#custom-model-input') as HTMLInputElement | null
const animal_kingdom_select = document.querySelector('#animal-kingdom-select') as HTMLSelectElement | null
const swap_front_back_button = document.querySelector('#swap-front-back') as HTMLButtonElement
const reset_map_button = document.querySelector('#reset-map') as HTMLButtonElement
const mapping_table = document.querySelector('#mapping-table') as HTMLTableSectionElement
const mapping_source_header = document.querySelector('#mapping-source-header') as HTMLTableCellElement
const bone_tooltip = document.querySelector('#bone-tooltip') as HTMLDivElement
const chain_list = document.querySelector('#chain-list') as HTMLDivElement
const skeleton_adjust_panel = document.querySelector('#skeleton-adjust-panel') as HTMLDivElement | null
const selected_bone_label = document.querySelector('#selected-bone-label') as HTMLSpanElement | null
const bone_rx = document.querySelector('#bone-rx') as HTMLInputElement | null
const bone_ry = document.querySelector('#bone-ry') as HTMLInputElement | null
const bone_rz = document.querySelector('#bone-rz') as HTMLInputElement | null
const bone_px = document.querySelector('#bone-px') as HTMLInputElement | null
const bone_py = document.querySelector('#bone-py') as HTMLInputElement | null
const bone_pz = document.querySelector('#bone-pz') as HTMLInputElement | null
const reset_bone_button = document.querySelector('#reset-bone') as HTMLButtonElement | null
const proc_speed = document.querySelector('#proc-speed') as HTMLInputElement
const proc_stride = document.querySelector('#proc-stride') as HTMLInputElement
const proc_knee = document.querySelector('#proc-knee') as HTMLInputElement
const proc_lift = document.querySelector('#proc-lift') as HTMLInputElement
const proc_bob = document.querySelector('#proc-bob') as HTMLInputElement
const motion_focus = document.querySelector('#motion-focus') as HTMLSelectElement | null
const motion_jiggle_amount = document.querySelector('#motion-jiggle-amount') as HTMLInputElement | null
const motion_jiggle_frequency = document.querySelector('#motion-jiggle-frequency') as HTMLInputElement | null
const motion_sway = document.querySelector('#motion-sway') as HTMLInputElement | null
const motion_twist = document.querySelector('#motion-twist') as HTMLInputElement | null

type GeneralMotionFocus = 'all' | 'body' | 'head' | 'tail' | 'legs' | 'tentacles' | 'tips' | 'left' | 'right'

interface GeneralMotionSettings {
  focus: GeneralMotionFocus
  jiggle_amount: number
  jiggle_frequency: number
  sway: number
  twist: number
}
function button_or_undefined (selector: string): HTMLButtonElement | undefined {
  return (document.querySelector(selector) as HTMLButtonElement | null) ?? undefined
}

const buttons: Partial<Record<LionKind, HTMLButtonElement>> = {
  riganything: button_or_undefined('#riganything'),
  merged: button_or_undefined('#merged-rig'),
  anigen: button_or_undefined('#anigen'),
  good: button_or_undefined('#good-mesh'),
  'octopus-conjure': button_or_undefined('#octopus-conjure'),
  'octopus-rig': button_or_undefined('#octopus-rig'),
  'pegasus-conjure': button_or_undefined('#pegasus-conjure'),
  'pegasus-rig': button_or_undefined('#pegasus-rig'),
  'brown-pegasus-mesh': button_or_undefined('#brown-pegasus-mesh'),
  'brown-pegasus-rig': button_or_undefined('#brown-pegasus-rig'),
  'brown-pegasus-fused': button_or_undefined('#brown-pegasus-fused'),
  'brown-pegasus-horse-rig': button_or_undefined('#brown-pegasus-horse-rig'),
  'kangaroo-conjure': button_or_undefined('#kangaroo-conjure'),
  'kangaroo-rig': button_or_undefined('#kangaroo-rig'),
  'elephant-conjure': button_or_undefined('#elephant-conjure'),
  'elephant-rig': button_or_undefined('#elephant-rig'),
  'elephant-watertight': button_or_undefined('#elephant-watertight'),
  'elephant-flood3': button_or_undefined('#elephant-flood3'),
  'elephant-smallholes': button_or_undefined('#elephant-smallholes'),
  'samoyed-conjure': button_or_undefined('#samoyed-conjure'),
  'samoyed-rig': button_or_undefined('#samoyed-rig'),
  'samoyed-watertight': button_or_undefined('#samoyed-watertight'),
  'samoyed-flood3': button_or_undefined('#samoyed-flood3'),
  'samoyed-smallholes': button_or_undefined('#samoyed-smallholes'),
  'samoyed-user-ref': button_or_undefined('#samoyed-user-ref'),
  'samoyed-user-ref-rig': button_or_undefined('#samoyed-user-ref-rig')
}

const files: Record<LionKind, string> = {
  riganything: '/lion-riganything.glb',
  merged: '/lion-riganything-goodmesh.glb',
  anigen: '/lion-anigen.glb',
  good: '/lion-good-lod.glb',
  'octopus-conjure': '/octopus-conjure.glb',
  'octopus-rig': '/octopus-riganything.glb',
  'pegasus-conjure': '/white-pegasus-conjure.glb',
  'pegasus-rig': '/white-pegasus-riganything.glb',
  'brown-pegasus-mesh': '/brown-pegasus-mesh.glb',
  'brown-pegasus-rig': '/brown-pegasus-riganything.glb',
  'brown-pegasus-fused': '/brown-pegasus-fused.glb',
  'brown-pegasus-horse-rig': '/brown-pegasus-horse-rig.glb',
  'kangaroo-conjure': '/kangaroo-conjure.glb',
  'kangaroo-rig': '/kangaroo-riganything.glb',
  'elephant-conjure': '/elephant-conjure.glb',
  'elephant-rig': '/elephant-riganything.glb',
  'elephant-watertight': '/elephant-watertight-morph3.glb',
  'elephant-flood3': '/elephant-flood3.glb',
  'elephant-smallholes': '/elephant-smallholes.glb',
  'samoyed-conjure': '/samoyed-conjure.glb',
  'samoyed-rig': '/samoyed-riganything.glb',
  'samoyed-watertight': '/samoyed-watertight-morph3.glb',
  'samoyed-flood3': '/samoyed-flood3.glb',
  'samoyed-smallholes': '/samoyed-smallholes.glb',
  'samoyed-user-ref': '/samoyed-user-ref.glb',
  'samoyed-user-ref-rig': '/samoyed-user-ref-rig.glb'
}

const labels: Record<LionKind, string> = {
  riganything: 'RigAnything',
  merged: 'Merged rig',
  anigen: 'AniGen',
  good: 'Good mesh',
  'octopus-conjure': 'Octopus mesh',
  'octopus-rig': 'Octopus rig',
  'pegasus-conjure': 'Pegasus mesh',
  'pegasus-rig': 'Pegasus rig',
  'brown-pegasus-mesh': 'Brown Pegasus mesh',
  'brown-pegasus-rig': 'Brown Pegasus rig',
  'brown-pegasus-fused': 'Brown Pegasus fused',
  'brown-pegasus-horse-rig': 'Pegasus horse rig',
  'kangaroo-conjure': 'Kangaroo mesh',
  'kangaroo-rig': 'Kangaroo rig',
  'elephant-conjure': 'Elephant mesh',
  'elephant-rig': 'Elephant rig',
  'elephant-watertight': 'Elephant watertight',
  'elephant-flood3': 'Elephant flood x3',
  'elephant-smallholes': 'Elephant small holes',
  'samoyed-conjure': 'Samoyed mesh',
  'samoyed-rig': 'Samoyed rig',
  'samoyed-watertight': 'Samoyed watertight',
  'samoyed-flood3': 'Samoyed flood x3',
  'samoyed-smallholes': 'Samoyed small holes',
  'samoyed-user-ref': 'Samoyed user ref',
  'samoyed-user-ref-rig': 'Samoyed user ref rig'
}

const animal_kingdom_sources: Record<string, SourceAnimationData> = {
  alpaca: { key: 'alpaca', label: 'Alpaca source', rig: '/rigs/rig-alpaca.glb', animations: '/animations/alpaca-animations.glb' },
  bird: { key: 'bird', label: 'Bird source', rig: '/rigs/rig-bird.glb', animations: '/animations/bird-animations.glb' },
  bull: { key: 'bull', label: 'Bull source', rig: '/rigs/rig-bull.glb', animations: '/animations/bull-animations.glb' },
  cow: { key: 'cow', label: 'Cow source', rig: '/rigs/rig-cow.glb', animations: '/animations/cow-animations.glb' },
  deer: { key: 'deer', label: 'Deer source', rig: '/rigs/rig-deer.glb', animations: '/animations/deer-animations.glb' },
  donkey: { key: 'donkey', label: 'Donkey source', rig: '/rigs/rig-donkey.glb', animations: '/animations/donkey-animations.glb' },
  dragon: { key: 'dragon', label: 'Dragon source', rig: '/rigs/rig-dragon.glb', animations: '/animations/dragon-animations.glb' },
  fox: { key: 'fox', label: 'Fox source', rig: '/rigs/rig-fox.glb', animations: '/animations/fox-animations.glb' },
  foxq: { key: 'foxq', label: 'Fox quadruped source', rig: '/rigs/rig-foxq.glb', animations: '/animations/foxq-animations.glb' },
  horseq: { key: 'horseq', label: 'Horse source', rig: '/rigs/rig-horseq.glb', animations: '/animations/horseq-animations.glb' },
  horsewhite: { key: 'horsewhite', label: 'White horse source', rig: '/rigs/rig-horsewhite.glb', animations: '/animations/horsewhite-animations.glb' },
  husky: { key: 'husky', label: 'Husky source', rig: '/rigs/rig-husky.glb', animations: '/animations/husky-animations.glb' },
  kaiju: { key: 'kaiju', label: 'Kaiju source', rig: '/rigs/rig-kaiju.glb', animations: '/animations/kaiju-animations.glb' },
  shark: { key: 'shark', label: 'Shark source', rig: '/rigs/rig-shark.glb', animations: '/animations/shark-animations.glb' },
  shibainu: { key: 'shibainu', label: 'Shiba Inu source', rig: '/rigs/rig-shibainu.glb', animations: '/animations/shibainu-animations.glb' },
  snake: { key: 'snake', label: 'Snake source', rig: '/rigs/rig-snake.glb', animations: '/animations/snake-animations.glb' },
  spider: { key: 'spider', label: 'Spider source', rig: '/rigs/rig-spider.glb', animations: '/animations/spider-animations.glb' },
  stag: { key: 'stag', label: 'Stag source', rig: '/rigs/rig-stag.glb', animations: '/animations/stag-animations.glb' },
  wolf: { key: 'wolf', label: 'Wolf source', rig: '/rigs/rig-wolf.glb', animations: '/animations/wolf-animations.glb' }
}

const source_data_by_kind: Partial<Record<LionKind, SourceAnimationData>> = {
  'brown-pegasus-horse-rig': {
    key: 'horseq',
    label: 'Horse source',
    rig: '/rigs/rig-horseq.glb',
    animations: '/animations/horseq-animations.glb'
  }
}

const default_source_data = {
  key: 'wolf',
  label: 'Wolf source',
  rig: '/rigs/rig-wolf.glb',
  animations: '/animations/wolf-animations.glb'
}

function source_data_for_kind (kind: LionKind): SourceAnimationData {
  return source_data_by_kind[kind] ?? default_source_data
}

function fit_camera (object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z) * 1.25

  controls.target.copy(center)
  camera.position.copy(center).add(new THREE.Vector3(radius, radius * 0.42, radius * 1.65))
  camera.near = Math.max(radius / 100, 0.001)
  camera.far = radius * 100
  camera.updateProjectionMatrix()
}

function is_source_mapping_bone (bone_name: string): boolean {
  const name = bone_name.toLowerCase()
  return name !== 'root' &&
    !name.startsWith('ik') &&
    !name.includes('poletarget') &&
    !name.startsWith('pole') &&
    !/^ff[blr]{0,2}$/.test(name) &&
    !name.startsWith('ear') &&
    !name.startsWith('tail')
}

function normalized_bone_points (points: BonePoint[]): BonePoint[] {
  const min = new THREE.Vector3(
    Math.min(...points.map(point => point.position.x)),
    Math.min(...points.map(point => point.position.y)),
    Math.min(...points.map(point => point.position.z))
  )
  const max = new THREE.Vector3(
    Math.max(...points.map(point => point.position.x)),
    Math.max(...points.map(point => point.position.y)),
    Math.max(...points.map(point => point.position.z))
  )
  const size = max.clone().sub(min)
  size.x = Math.max(size.x, 0.0001)
  size.y = Math.max(size.y, 0.0001)
  size.z = Math.max(size.z, 0.0001)

  return points.map(point => ({
    name: point.name,
    position: point.position.clone().sub(min).divide(size),
    parent_name: point.parent_name
  }))
}

function weighted_distance (a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt((dx * dx * 0.75) + (dy * dy * 1.15) + (dz * dz * 1.25))
}

function hierarchy_penalty (
  source: BonePoint,
  mapped_parent_name: string | null,
  source_by_name: Map<string, BonePoint>
): number {
  if (mapped_parent_name === null) return 0
  if (source.name === mapped_parent_name) return 0.04
  if (source.parent_name === mapped_parent_name) return -0.08

  const parent = source_by_name.get(source.parent_name ?? '')
  if (parent?.parent_name === mapped_parent_name) return -0.03
  if (parent?.name === mapped_parent_name) return -0.03

  return 0.08
}

function mapped_parent_source_name (
  target: BonePoint,
  target_by_name: Map<string, BonePoint>,
  mappings: Map<string, string>
): string | null {
  let parent_name = target.parent_name
  while (parent_name !== null) {
    const mapped_parent_name = mappings.get(parent_name)
    if (mapped_parent_name !== undefined) return mapped_parent_name
    parent_name = target_by_name.get(parent_name)?.parent_name ?? null
  }
  return null
}

function build_target_to_source_mapping (target_bones: THREE.Bone[]): Map<string, string> {
  const target_points = target_bones.map((bone) => {
    const position = new THREE.Vector3()
    bone.getWorldPosition(position)
    return { name: bone.name, position, parent_name: bone.parent instanceof THREE.Bone ? bone.parent.name : null }
  })
  const normalized_sources = normalized_bone_points(source_bones)
  const normalized_targets = normalized_bone_points(target_points)
  const source_by_name = new Map(normalized_sources.map(source => [source.name, source]))
  const target_by_name = new Map(normalized_targets.map(target => [target.name, target]))
  const mappings = new Map<string, string>()
  mapping_scores = new Map<string, number>()

  for (const target of normalized_targets) {
    if (source_by_name.has(target.name)) {
      mappings.set(target.name, target.name)
      mapping_scores.set(target.name, 0)
      continue
    }

    let best_source = normalized_sources[0]
    let best_score = Number.POSITIVE_INFINITY
    const mapped_parent_name = mapped_parent_source_name(target, target_by_name, mappings)

    for (const source of normalized_sources) {
      const distance = weighted_distance(source.position, target.position)
      const score = distance + hierarchy_penalty(source, mapped_parent_name, source_by_name)
      if (score < best_score) {
        best_source = source
        best_score = score
      }
    }

    mappings.set(target.name, best_source.name)
    mapping_scores.set(target.name, best_score)
  }

  return mappings
}

function current_target_to_source_mapping (): Map<string, string> {
  const merged = new Map(auto_mappings)
  manual_mappings.forEach((source_name, target_name) => {
    merged.set(target_name, source_name)
  })
  return merged
}

function swapped_front_back_source_name (source_name: string): string {
  if (source_name.includes('Front')) return source_name.replace('Front', 'Back')
  if (source_name.includes('Back')) return source_name.replace('Back', 'Front')
  return source_name
}

function swap_front_back_mappings (): void {
  const current_mappings = current_target_to_source_mapping()
  manual_mappings = new Map()

  current_mappings.forEach((source_name, target_name) => {
    manual_mappings.set(target_name, swapped_front_back_source_name(source_name))
  })

  populate_mapping_table()
  status.textContent = 'Swapped front/back leg mappings'
}

function populate_mapping_table (): void {
  mapping_table.innerHTML = ''
  if (active_skinned_mesh === null) return

  const mappings = current_target_to_source_mapping()
  const source_names = source_bones.map(source => source.name).sort()
  mapping_source_header.textContent = active_source_label

  active_skinned_mesh.skeleton.bones.forEach((bone) => {
    const row = document.createElement('tr')
    const target_cell = document.createElement('td')
    const source_cell = document.createElement('td')
    const score_cell = document.createElement('td')
    const source_select = document.createElement('select')

    row.dataset.boneName = bone.name
    target_cell.textContent = bone.name
    source_names.forEach((source_name) => {
      const option = document.createElement('option')
      option.value = source_name
      option.textContent = source_name
      source_select.appendChild(option)
    })

    source_select.value = mappings.get(bone.name) ?? source_names[0]
    source_select.addEventListener('change', () => {
      manual_mappings.set(bone.name, source_select.value)
      status.textContent = `Mapped ${bone.name} to ${source_select.value}`
      if (selected_bone_name === bone.name) {
        show_bone_label(bone.name, null)
      }
    })

    score_cell.textContent = (mapping_scores.get(bone.name) ?? 0).toFixed(2)
    source_cell.appendChild(source_select)
    row.append(target_cell, source_cell, score_cell)
    mapping_table.appendChild(row)
  })
}

function populate_chain_debug (): void {
  chain_list.innerHTML = ''
  const chain_debug = octopus_animator?.debug_chains() ?? procedural_animator?.debug_chains() ?? []

  chain_debug.forEach((chain) => {
    const item = document.createElement('div')
    item.className = 'chain-item'
    const title = document.createElement('strong')
    title.textContent = `${chain.type}: ${chain.label}`
    const body = document.createElement('span')
    body.textContent = chain.bones.join(' -> ')
    item.append(title, body)
    chain_list.appendChild(item)
  })
}

function mapped_source_for_bone (bone_name: string): string {
  return current_target_to_source_mapping().get(bone_name) ?? 'unmapped'
}

function show_bone_label (bone_name: string, event: PointerEvent | null): void {
  const source_name = mapped_source_for_bone(bone_name)
  bone_tooltip.style.display = 'block'
  bone_tooltip.textContent = `${bone_name} -> ${source_name}`

  if (event !== null) {
    bone_tooltip.style.left = `${event.clientX + 12}px`
    bone_tooltip.style.top = `${event.clientY + 12}px`
  }

  mapping_table.querySelectorAll('tr').forEach((row) => {
    const element = row as HTMLTableRowElement
    element.style.background = element.dataset.boneName === bone_name
      ? 'rgba(255, 209, 102, 0.16)'
      : ''
  })
}

function selected_bone_rest_snapshot (): { position: THREE.Vector3, rotation: THREE.Euler } | null {
  if (selected_bone === null) return null
  return {
    position: selected_bone.position.clone(),
    rotation: selected_bone.rotation.clone()
  }
}

let selected_bone_original: { position: THREE.Vector3, rotation: THREE.Euler } | null = null

function set_selected_bone (bone_name: string | null): void {
  selected_bone_name = bone_name
  selected_bone = null
  selected_bone_original = null

  if (bone_name !== null && active_skinned_mesh !== null) {
    selected_bone = active_skinned_mesh.skeleton.bones.find(bone => bone.name === bone_name) ?? null
    selected_bone_original = selected_bone_rest_snapshot()
  }

  if (skeleton_adjust_panel !== null) {
    skeleton_adjust_panel.hidden = selected_bone === null
  }
  if (selected_bone === null || selected_bone_label === null) return

  selected_bone_label.textContent = selected_bone.name
  sync_bone_controls_from_selected()
}

function sync_bone_controls_from_selected (): void {
  if (
    selected_bone === null ||
    bone_rx === null ||
    bone_ry === null ||
    bone_rz === null ||
    bone_px === null ||
    bone_py === null ||
    bone_pz === null
  ) return

  bone_rx.value = THREE.MathUtils.radToDeg(selected_bone.rotation.x).toFixed(1)
  bone_ry.value = THREE.MathUtils.radToDeg(selected_bone.rotation.y).toFixed(1)
  bone_rz.value = THREE.MathUtils.radToDeg(selected_bone.rotation.z).toFixed(1)
  bone_px.value = selected_bone.position.x.toFixed(3)
  bone_py.value = selected_bone.position.y.toFixed(3)
  bone_pz.value = selected_bone.position.z.toFixed(3)
}

function commit_bone_adjustment (): void {
  if (
    selected_bone === null ||
    bone_rx === null ||
    bone_ry === null ||
    bone_rz === null ||
    bone_px === null ||
    bone_py === null ||
    bone_pz === null
  ) return

  selected_bone.rotation.set(
    THREE.MathUtils.degToRad(Number(bone_rx.value)),
    THREE.MathUtils.degToRad(Number(bone_ry.value)),
    THREE.MathUtils.degToRad(Number(bone_rz.value))
  )
  selected_bone.position.set(
    Number(bone_px.value),
    Number(bone_py.value),
    Number(bone_pz.value)
  )
  selected_bone.updateMatrixWorld(true)
  procedural_animator?.recapture_rest_pose()
  octopus_animator?.recapture_rest_pose()
  status.textContent = `Adjusted ${selected_bone.name}`
}

function reset_selected_bone_adjustment (): void {
  if (selected_bone === null || selected_bone_original === null) return

  selected_bone.position.copy(selected_bone_original.position)
  selected_bone.rotation.copy(selected_bone_original.rotation)
  selected_bone.updateMatrixWorld(true)
  sync_bone_controls_from_selected()
  procedural_animator?.recapture_rest_pose()
  octopus_animator?.recapture_rest_pose()
  status.textContent = `Reset ${selected_bone.name}`
}

function clear_bone_label (): void {
  if (selected_bone_name !== null) return
  bone_tooltip.style.display = 'none'
  mapping_table.querySelectorAll('tr').forEach((row) => {
    ;(row as HTMLTableRowElement).style.background = ''
  })
}

function set_pointer_from_event (event: PointerEvent): void {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
}

function set_highlighted_object (object: THREE.Object3D | null): void {
  if (highlighted_object !== null && highlighted_object.userData.originalMaterial !== undefined) {
    ;(highlighted_object as THREE.Mesh).material = highlighted_object.userData.originalMaterial as THREE.Material
  }

  highlighted_object = object

  if (highlighted_object !== null && highlighted_object instanceof THREE.Mesh) {
    highlighted_object.userData.originalMaterial = highlighted_object.material
    highlighted_object.material = highlight_material
  }
}

function pick_bone_from_pointer (event: PointerEvent): string | null {
  if (skeleton_group === null) return null

  set_pointer_from_event(event)
  raycaster.setFromCamera(pointer, camera)
  raycaster.params.Line.threshold = 0.03
  const intersections = raycaster.intersectObjects(skeleton_group.children, false)

  if (intersections.length === 0) {
    set_highlighted_object(null)
    return null
  }

  const object = intersections[0].object
  set_highlighted_object(object)

  if (object instanceof THREE.Mesh) {
    const bone = object.userData.bone as THREE.Bone | undefined
    return bone?.name ?? null
  }

  if (object instanceof THREE.Line) {
    const bone = object.userData.start as THREE.Bone | undefined
    return bone?.name ?? null
  }

  return null
}

function retarget_clip_to_active_animal (source_clip: THREE.AnimationClip): THREE.AnimationClip | null {
  if (active_skinned_mesh === null) return null

  const target_to_source = current_target_to_source_mapping()
  const source_to_targets = new Map<string, string[]>()

  target_to_source.forEach((source_name, target_name) => {
    const targets = source_to_targets.get(source_name) ?? []
    targets.push(target_name)
    source_to_targets.set(source_name, targets)
  })

  const tracks: THREE.KeyframeTrack[] = []
  source_clip.tracks.forEach((track) => {
    const match = track.name.match(/^(.+)\.(position|quaternion|scale)$/)
    if (match === null) return

    const source_name = match[1]
    const property = match[2]
    if (property === 'scale') return

    const target_names = source_to_targets.get(source_name)
    if (target_names === undefined) return

    target_names.forEach((target_name) => {
      const track_name = `${target_name}.${property}`
      const times = Float32Array.from(track.times as ArrayLike<number>)
      const values = Float32Array.from(track.values as ArrayLike<number>)
      if (property === 'quaternion') {
        tracks.push(new THREE.QuaternionKeyframeTrack(track_name, times, values))
      } else if (property === 'position') {
        tracks.push(new THREE.VectorKeyframeTrack(track_name, times, values))
      }
    })
  })

  return new THREE.AnimationClip(`${source_clip.name} on ${current_asset_label}`, source_clip.duration, tracks)
}

function create_skeleton_overlay (skinned_mesh: THREE.SkinnedMesh): THREE.Group {
  const group = new THREE.Group()
  const line_material = new THREE.LineBasicMaterial({
    color: 0x29d3ff,
    transparent: true,
    opacity: 0.95,
    depthTest: false
  })
  const joint_material = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    depthTest: false
  })
  const joint_geometry = new THREE.SphereGeometry(0.018, 10, 10)

  skinned_mesh.skeleton.bones.forEach((bone) => {
    const parent = bone.parent
    if (parent instanceof THREE.Bone) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3()
      ])
      const line = new THREE.Line(geometry, line_material)
      line.userData.start = bone
      line.userData.end = parent
      line.renderOrder = 999
      group.add(line)
    }

    const joint = new THREE.Mesh(joint_geometry, joint_material)
    joint.userData.bone = bone
    joint.renderOrder = 1000
    group.add(joint)
  })

  return group
}

function procedural_settings (): ProceduralQuadrupedSettings {
  return {
    speed: Number(proc_speed.value),
    stride: Number(proc_stride.value),
    knee: Number(proc_knee.value),
    lift: Number(proc_lift.value),
    body_bob: Number(proc_bob.value)
  }
}

function general_motion_settings (): GeneralMotionSettings {
  const focus = motion_focus?.value
  return {
    focus: (
      focus === 'body' ||
      focus === 'head' ||
      focus === 'tail' ||
      focus === 'legs' ||
      focus === 'tentacles' ||
      focus === 'tips' ||
      focus === 'left' ||
      focus === 'right'
    ) ? focus : 'all',
    jiggle_amount: Number(motion_jiggle_amount?.value ?? 0),
    jiggle_frequency: Number(motion_jiggle_frequency?.value ?? 1),
    sway: Number(motion_sway?.value ?? 0),
    twist: Number(motion_twist?.value ?? 0)
  }
}

function octopus_settings (): ProceduralOctopusSettings {
  const base_settings = procedural_settings()
  const general_settings = general_motion_settings()
  const focus = general_settings.focus
  return {
    ...base_settings,
    jiggle_amount: general_settings.jiggle_amount,
    jiggle_frequency: general_settings.jiggle_frequency,
    jiggle_focus: (
      focus === 'body' ||
      focus === 'tentacles' ||
      focus === 'tips' ||
      focus === 'left' ||
      focus === 'right'
    ) ? focus : 'all'
  }
}

function should_apply_general_motion (
  bone: THREE.Bone,
  focus: GeneralMotionFocus,
  position: THREE.Vector3,
  box: THREE.Box3,
  leaves: Set<THREE.Bone>
): boolean {
  if (focus === 'all') return true
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const nx = size.x > 0 ? (position.x - box.min.x) / size.x : 0.5
  const ny = size.y > 0 ? (position.y - box.min.y) / size.y : 0.5
  const nz = size.z > 0 ? (position.z - box.min.z) / size.z : 0.5
  const radial = Math.hypot(
    size.x > 0 ? (position.x - center.x) / size.x : 0,
    size.z > 0 ? (position.z - center.z) / size.z : 0
  )

  if (focus === 'left') return position.x >= center.x
  if (focus === 'right') return position.x < center.x
  if (focus === 'tips') return leaves.has(bone)
  if (focus === 'legs') return ny < 0.52
  if (focus === 'head') return nz > 0.68 && ny > 0.34
  if (focus === 'tail') return nz < 0.24
  if (focus === 'body') return ny > 0.28 && nz > 0.22 && nz < 0.78 && radial < 0.34
  if (focus === 'tentacles') return radial > 0.22 || leaves.has(bone)
  return true
}

function apply_general_motion_layer (time: number): void {
  if (active_skinned_mesh === null) return

  const settings = general_motion_settings()
  if (settings.jiggle_amount <= 0 && settings.sway <= 0 && settings.twist <= 0) return

  active_skinned_mesh.updateMatrixWorld(true)
  const bones = active_skinned_mesh.skeleton.bones
  const leaves = new Set(bones.filter(bone => !bone.children.some(child => child instanceof THREE.Bone)))
  const positions = new Map<THREE.Bone, THREE.Vector3>()
  const box = new THREE.Box3()
  bones.forEach((bone) => {
    const position = bone.getWorldPosition(new THREE.Vector3())
    positions.set(bone, position)
    box.expandByPoint(position)
  })

  const speed = Math.PI * 2 * Math.max(settings.jiggle_frequency, 0.1)
  bones.forEach((bone, index) => {
    const position = positions.get(bone)
    if (position === undefined || !should_apply_general_motion(bone, settings.focus, position, box, leaves)) return

    const phase = time * speed + index * 0.73
    const jiggle = Math.sin(phase) * settings.jiggle_amount * 0.24
    const sway = Math.sin(time * speed * 0.42 + index * 0.25) * settings.sway * 0.22
    const twist = Math.cos(time * speed * 0.57 + index * 0.31) * settings.twist * 0.22
    bone.quaternion.multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        jiggle + sway,
        Math.cos(phase * 1.17) * settings.jiggle_amount * 0.18,
        twist
      ))
    )
  })
}

function is_quadruped_procedural_mode (mode: typeof procedural_mode): mode is ProceduralQuadrupedMode {
  return mode === 'walk' ||
    mode === 'trot' ||
    mode === 'canter' ||
    mode === 'gallop' ||
    mode === 'hop' ||
    mode === 'idle' ||
    mode === 'head-turn'
}

function motion_duration_for_mode (mode: ProceduralQuadrupedMode): number {
  if (mode === 'idle' || mode === 'head-turn') return 3
  return 2
}

function download_blob (blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}

async function save_current_motion (): Promise<void> {
  const mode_to_save = is_quadruped_procedural_mode(procedural_mode)
    ? procedural_mode
    : last_quadruped_motion_mode
  const octopus_mode_to_save = procedural_mode === 'octopus-squirt' || last_octopus_motion_mode === 'octopus-squirt'

  if (current === null) {
    status.textContent = 'Load an animal before saving'
    return
  }
  const current_root = current

  let motion_name: string
  let mode: ProceduralQuadrupedMode | 'octopus-squirt'

  if (procedural_animator !== null && mode_to_save !== null) {
    motion_name = `${current_asset_label} ${mode_to_save}`
    mode = mode_to_save
  } else if (octopus_animator !== null && octopus_mode_to_save) {
    motion_name = `${current_asset_label} squirt away`
    mode = 'octopus-squirt'
  } else {
    status.textContent = 'Choose a procedural motion before saving'
    return
  }

  const clip = bake_current_procedural_clip(
    motion_name,
    mode,
    mode === 'octopus-squirt' ? 2.5 : motion_duration_for_mode(mode),
    30
  )
  if (clip === null) {
    status.textContent = 'No skeleton to save'
    return
  }

  status.textContent = `Saving ${motion_name}...`
  const exporter = new GLTFExporter()
  const result = await new Promise<ArrayBuffer | object>((resolve, reject) => {
    exporter.parse(
      current_root,
      resolve,
      reject,
      {
        animations: [clip],
        binary: true
      }
    )
  })

  const safe_name = motion_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (result instanceof ArrayBuffer) {
    download_blob(new Blob([result], { type: 'model/gltf-binary' }), `${safe_name}.glb`)
  } else {
    download_blob(new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' }), `${safe_name}.gltf`)
  }
  status.textContent = `Saved ${motion_name}`
}

function update_procedural_mode_once (mode: ProceduralQuadrupedMode | 'octopus-squirt', delta_time: number): void {
  if (mode === 'walk') procedural_animator?.update_walk(delta_time, procedural_settings())
  else if (mode === 'trot') procedural_animator?.update_trot(delta_time, procedural_settings())
  else if (mode === 'canter') procedural_animator?.update_canter(delta_time, procedural_settings())
  else if (mode === 'gallop') procedural_animator?.update_gallop(delta_time, procedural_settings())
  else if (mode === 'hop') procedural_animator?.update_hop(delta_time, procedural_settings())
  else if (mode === 'idle') procedural_animator?.update_idle(delta_time, procedural_settings())
  else if (mode === 'head-turn') procedural_animator?.update_head_turn(delta_time, procedural_settings())
  else octopus_animator?.update_squirt_away(delta_time, octopus_settings())
}

function bake_current_procedural_clip (
  name: string,
  mode: ProceduralQuadrupedMode | 'octopus-squirt',
  duration: number,
  fps: number
): THREE.AnimationClip | null {
  if (active_skinned_mesh === null) return null

  const bones = active_skinned_mesh.skeleton.bones
  const times: number[] = []
  const quaternion_values = new Map<string, number[]>()
  const position_values = new Map<string, number[]>()
  const frame_count = Math.max(2, Math.ceil(duration * fps))

  bones.forEach((bone) => {
    quaternion_values.set(bone.name, [])
    position_values.set(bone.name, [])
  })

  procedural_animator?.reset()
  octopus_animator?.reset()
  for (let frame = 0; frame <= frame_count; frame++) {
    const t = Math.min(frame / fps, duration)
    times.push(t)

    if (frame > 0) update_procedural_mode_once(mode, 1 / fps)
    apply_general_motion_layer(t)

    bones.forEach((bone) => {
      quaternion_values.get(bone.name)?.push(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w)
      position_values.get(bone.name)?.push(bone.position.x, bone.position.y, bone.position.z)
    })
  }

  const tracks: THREE.KeyframeTrack[] = []
  bones.forEach((bone) => {
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${bone.name}.quaternion`,
      times,
      quaternion_values.get(bone.name) ?? []
    ))
    tracks.push(new THREE.VectorKeyframeTrack(
      `${bone.name}.position`,
      times,
      position_values.get(bone.name) ?? []
    ))
  })

  procedural_animator?.reset()
  octopus_animator?.reset()
  return new THREE.AnimationClip(name, duration, tracks)
}

function start_procedural_mode (mode: 'walk' | 'trot' | 'canter' | 'gallop' | 'hop' | 'idle' | 'head-turn' | 'octopus-squirt'): void {
  if (mode === 'octopus-squirt') {
    if (octopus_animator === null) return
  } else if (procedural_animator === null) {
    return
  }

  active_action?.stop()
  animation_mixer?.stopAllAction()
  active_action = null
  procedural_animator?.reset()
  octopus_animator?.reset()
  procedural_mode = mode
  if (is_quadruped_procedural_mode(mode)) {
    last_quadruped_motion_mode = mode
  } else if (mode === 'octopus-squirt') {
    last_octopus_motion_mode = mode
  }

  if (mode === 'walk') {
    status.textContent = `Procedural walk: ${procedural_animator?.leg_chain_count() ?? 0} leg chains`
  } else if (mode === 'trot') {
    status.textContent = `Procedural trot: ${procedural_animator?.leg_chain_count() ?? 0} leg chains`
  } else if (mode === 'canter') {
    status.textContent = `Procedural canter: ${procedural_animator?.leg_chain_count() ?? 0} leg chains`
  } else if (mode === 'gallop') {
    status.textContent = `Procedural gallop: ${procedural_animator?.leg_chain_count() ?? 0} leg chains`
  } else if (mode === 'hop') {
    status.textContent = `Procedural hop: ${procedural_animator?.leg_chain_count() ?? 0} leg chains`
  } else if (mode === 'idle') {
    status.textContent = 'Procedural idle'
  } else if (mode === 'octopus-squirt') {
    status.textContent = `Squirt away: ${octopus_animator?.tentacle_chain_count() ?? 0} tentacle chains`
  } else {
    status.textContent = 'Procedural head turn'
  }
}

function stop_all_animation (): void {
  procedural_mode = 'none'
  active_action?.stop()
  animation_mixer?.stopAllAction()
  active_action = null
  procedural_animator?.reset()
  octopus_animator?.reset()
  status.textContent = 'Animation stopped'
}

function update_skeleton_overlay (): void {
  if (skeleton_group === null) return

  skeleton_group.children.forEach((child) => {
    if (child instanceof THREE.Line) {
      const start = child.userData.start as THREE.Bone
      const end = child.userData.end as THREE.Bone
      const points = [
        start.getWorldPosition(new THREE.Vector3()),
        end.getWorldPosition(new THREE.Vector3())
      ]
      child.geometry.setFromPoints(points)
    } else if (child instanceof THREE.Mesh) {
      const bone = child.userData.bone as THREE.Bone
      child.position.copy(bone.getWorldPosition(new THREE.Vector3()))
    }
  })
}

async function load_source_animation_assets (source_data: SourceAnimationData): Promise<void> {
  if (active_source_key === source_data.key && animation_clips.length > 0) return

  active_source_key = source_data.key
  active_source_label = source_data.label
  const [rig_gltf, animations_gltf] = await Promise.all([
    loader.loadAsync(source_data.rig),
    loader.loadAsync(source_data.animations)
  ])

  rig_gltf.scene.updateMatrixWorld(true)
  source_bones = []
  rig_gltf.scene.traverse((child) => {
    if (child instanceof THREE.Bone && is_source_mapping_bone(child.name)) {
      const position = new THREE.Vector3()
      child.getWorldPosition(position)
      source_bones.push({
        name: child.name,
        position,
        parent_name: child.parent instanceof THREE.Bone ? child.parent.name : null
      })
    }
  })

  animation_clips = animations_gltf.animations
  animation_select.innerHTML = ''
  animation_clips.forEach((clip, index) => {
    const option = document.createElement('option')
    option.value = index.toString()
    option.textContent = clip.name
    animation_select.appendChild(option)
  })
}

async function load_source_animation_data (kind: LionKind): Promise<void> {
  await load_source_animation_assets(source_data_for_kind(kind))
}

function set_active_asset_button (kind: LionKind | null): void {
  Object.entries(buttons).forEach(([button_kind, button]) => {
    if (button === undefined) return
    button.classList.toggle('active', button_kind === kind)
  })
}

function prepare_for_asset_load (label: string): void {
  status.textContent = `Loading ${label}...`
  if (current !== null) scene.remove(current)
  if (skeleton_group !== null) scene.remove(skeleton_group)
  current = null
  skeleton_group = null
  active_skinned_mesh = null
  animation_mixer?.stopAllAction()
  animation_mixer = null
  active_action = null
  procedural_mode = 'none'
  last_quadruped_motion_mode = null
  last_octopus_motion_mode = null
  procedural_animator = null
  octopus_animator = null
  set_selected_bone(null)
  chain_list.innerHTML = ''
  mapping_table.innerHTML = ''
  auto_mappings = new Map()
  manual_mappings = new Map()
  mapping_scores = new Map()
}

function setup_loaded_gltf (gltf: { scene: THREE.Object3D, animations: THREE.AnimationClip[] }, label: string, is_octopus: boolean): void {
  current = gltf.scene
  current.traverse((child) => {
    if ((child as THREE.Mesh).isMesh === true) {
      child.frustumCulled = false
      const mesh = child as THREE.Mesh
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        material.side = THREE.DoubleSide
      })
    }
  })
  scene.add(current)

  const skinned_meshes: THREE.SkinnedMesh[] = []
  current.traverse((child) => {
    if ((child as THREE.SkinnedMesh).isSkinnedMesh === true) {
      skinned_meshes.push(child as THREE.SkinnedMesh)
    }
  })

  if (skinned_meshes.length > 0) {
    active_skinned_mesh = skinned_meshes[0]
    if (is_octopus) {
      octopus_animator = new GeneratedOctopusAnimator(active_skinned_mesh)
    } else {
      procedural_animator = new GeneratedQuadrupedAnimator(active_skinned_mesh)
    }
    populate_chain_debug()
    animation_mixer = new THREE.AnimationMixer(active_skinned_mesh)
    skeleton_group = create_skeleton_overlay(active_skinned_mesh)
    skeleton_group.visible = skeleton_toggle.checked
    scene.add(skeleton_group)
    auto_mappings = build_target_to_source_mapping(active_skinned_mesh.skeleton.bones)
    populate_mapping_table()
  }

  fit_camera(current)
  const bone_count = skinned_meshes[0]?.skeleton.bones.length ?? 0
  const rig_note = bone_count > 0 ? `${bone_count} bones` : 'visual mesh only'
  status.textContent = `${label}: ${rig_note}, ${gltf.animations.length} clips`
}

async function load_lion (kind: LionKind): Promise<void> {
  current_kind = kind
  current_asset_label = labels[kind]
  set_active_asset_button(kind)
  prepare_for_asset_load(current_asset_label)

  try {
    await load_source_animation_data(kind)
    const gltf = await loader.loadAsync(files[kind])
    setup_loaded_gltf(gltf, current_asset_label, kind === 'octopus-rig')
  } catch (error) {
    console.error(error)
    status.textContent = `Failed to load ${current_asset_label}`
  }
}

async function load_custom_animal (file: File): Promise<void> {
  if (custom_model_url !== null) URL.revokeObjectURL(custom_model_url)
  custom_model_url = URL.createObjectURL(file)
  current_asset_label = file.name.replace(/\.[^.]+$/, '')
  set_active_asset_button(null)
  prepare_for_asset_load(current_asset_label)

  try {
    await load_source_animation_assets(default_source_data)
    const gltf = await loader.loadAsync(custom_model_url)
    setup_loaded_gltf(gltf, current_asset_label, false)
  } catch (error) {
    console.error(error)
    status.textContent = `Failed to load ${current_asset_label}`
  }
}

async function load_animal_kingdom_asset (label: string, url: string, source_key: string): Promise<void> {
  current_asset_label = label
  set_active_asset_button(null)
  prepare_for_asset_load(current_asset_label)

  try {
    await load_source_animation_assets(animal_kingdom_sources[source_key] ?? default_source_data)
    const gltf = await loader.loadAsync(url)
    setup_loaded_gltf(gltf, current_asset_label, false)
  } catch (error) {
    console.error(error)
    status.textContent = `Failed to load ${current_asset_label}`
  }
}

skeleton_toggle.addEventListener('change', () => {
  if (skeleton_group !== null) skeleton_group.visible = skeleton_toggle.checked
})
function add_asset_button_listener (kind: LionKind): void {
  buttons[kind]?.addEventListener('click', () => { void load_lion(kind) })
}

;([
  'riganything',
  'merged',
  'anigen',
  'good',
  'octopus-conjure',
  'octopus-rig',
  'pegasus-conjure',
  'pegasus-rig',
  'brown-pegasus-mesh',
  'brown-pegasus-rig',
  'brown-pegasus-fused',
  'brown-pegasus-horse-rig',
  'kangaroo-conjure',
  'kangaroo-rig',
  'elephant-conjure',
  'elephant-rig',
  'elephant-watertight',
  'elephant-flood3',
  'elephant-smallholes',
  'samoyed-conjure',
  'samoyed-rig',
  'samoyed-watertight',
  'samoyed-flood3',
  'samoyed-smallholes',
  'samoyed-user-ref',
  'samoyed-user-ref-rig'
] as LionKind[]).forEach(add_asset_button_listener)
custom_model_input?.addEventListener('change', () => {
  const file = custom_model_input.files?.[0]
  if (file === undefined) return
  void load_custom_animal(file)
})
animal_kingdom_select?.addEventListener('change', () => {
  const option = animal_kingdom_select.selectedOptions[0]
  const url = option?.value ?? ''
  if (url === '') return
  const label = option.dataset.label ?? option.textContent ?? 'Animal'
  const source_key = option.dataset.source ?? 'wolf'
  void load_animal_kingdom_asset(label, url, source_key)
})
play_animation_button.addEventListener('click', () => {
  if (animation_mixer === null || active_skinned_mesh === null) return

  procedural_mode = 'none'
  procedural_animator?.reset()
  const clip = animation_clips[Number(animation_select.value)]
  const retargeted_clip = retarget_clip_to_active_animal(clip)
  if (retargeted_clip === null || retargeted_clip.tracks.length === 0) {
    status.textContent = 'No retargeted tracks for this clip'
    return
  }

  active_action?.stop()
  active_action = animation_mixer.clipAction(retargeted_clip)
  active_action.reset()
  active_action.setLoop(THREE.LoopOnce, 1)
  active_action.clampWhenFinished = true
  active_action.play()
  status.textContent = `Playing ${clip.name}: ${retargeted_clip.tracks.length} retargeted tracks`
})
stop_animation_button.addEventListener('click', () => {
  stop_all_animation()
})
save_motion_button?.addEventListener('click', () => {
  void save_current_motion()
})
procedural_walk_button.addEventListener('click', () => {
  start_procedural_mode('walk')
})
procedural_trot_button.addEventListener('click', () => {
  start_procedural_mode('trot')
})
procedural_canter_button.addEventListener('click', () => {
  start_procedural_mode('canter')
})
procedural_gallop_button.addEventListener('click', () => {
  start_procedural_mode('gallop')
})
procedural_hop_button.addEventListener('click', () => {
  start_procedural_mode('hop')
})
procedural_idle_button.addEventListener('click', () => {
  start_procedural_mode('idle')
})
head_turn_button.addEventListener('click', () => {
  start_procedural_mode('head-turn')
})
octopus_squirt_button.addEventListener('click', () => {
  start_procedural_mode('octopus-squirt')
})
swap_front_back_button.addEventListener('click', () => {
  swap_front_back_mappings()
})
reset_map_button.addEventListener('click', () => {
  manual_mappings.clear()
  if (active_skinned_mesh !== null) {
    auto_mappings = build_target_to_source_mapping(active_skinned_mesh.skeleton.bones)
    populate_mapping_table()
    status.textContent = 'Reset generated bone map'
  }
})

;[bone_rx, bone_ry, bone_rz, bone_px, bone_py, bone_pz].forEach((input) => {
  if (input === null) return
  input.addEventListener('input', () => {
    commit_bone_adjustment()
  })
})

reset_bone_button?.addEventListener('click', () => {
  reset_selected_bone_adjustment()
})

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
renderer.domElement.addEventListener('pointermove', (event) => {
  const bone_name = pick_bone_from_pointer(event)
  if (bone_name === null) {
    clear_bone_label()
    return
  }
  show_bone_label(bone_name, event)
})
renderer.domElement.addEventListener('pointerleave', () => {
  set_highlighted_object(null)
  clear_bone_label()
})
renderer.domElement.addEventListener('click', (event) => {
  const bone_name = pick_bone_from_pointer(event)
  set_selected_bone(bone_name)
  if (bone_name === null) {
    bone_tooltip.style.display = 'none'
    return
  }
  show_bone_label(bone_name, event)
})

function animate (): void {
  requestAnimationFrame(animate)
  const delta_time = 1 / 60
  general_motion_time += delta_time
  animation_mixer?.update(delta_time)
  if (procedural_mode === 'walk') {
    procedural_animator?.update_walk(delta_time, procedural_settings())
  } else if (procedural_mode === 'trot') {
    procedural_animator?.update_trot(delta_time, procedural_settings())
  } else if (procedural_mode === 'canter') {
    procedural_animator?.update_canter(delta_time, procedural_settings())
  } else if (procedural_mode === 'gallop') {
    procedural_animator?.update_gallop(delta_time, procedural_settings())
  } else if (procedural_mode === 'hop') {
    procedural_animator?.update_hop(delta_time, procedural_settings())
  } else if (procedural_mode === 'idle') {
    procedural_animator?.update_idle(delta_time, procedural_settings())
  } else if (procedural_mode === 'head-turn') {
    procedural_animator?.update_head_turn(delta_time, procedural_settings())
  } else if (procedural_mode === 'octopus-squirt') {
    octopus_animator?.update_squirt_away(delta_time, octopus_settings())
  }
  if (procedural_mode !== 'none') {
    apply_general_motion_layer(general_motion_time)
  }
  active_skinned_mesh?.skeleton.bones.forEach(bone => bone.updateMatrixWorld(true))
  update_skeleton_overlay()
  controls.update()
  renderer.render(scene, camera)
}

void load_lion(custom_model_input === null ? 'riganything' : 'kangaroo-rig')
  .catch((error) => {
    console.error(error)
    status.textContent = 'Failed to load source animation data'
  })
animate()
