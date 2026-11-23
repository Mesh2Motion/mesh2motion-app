/**
 * Developer-only harness: renders the SIX internal MCP observation cameras.
 *
 * This page is intentionally NOT linked from the application navigation and adds
 * no controls to the normal UI. It exists so a pose can be visually verified
 * during authoring (e.g. headless Chromium screenshot) without adding any
 * user-facing camera panel.
 */
import {
  AmbientLight,
  DirectionalLight,
  Scene,
  SkinnedMesh,
  Vector3,
  WebGLRenderer
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RigConfig } from '../lib/RigConfig.ts'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { Utility } from '../lib/Utilities.ts'
import { apply_evaluated_pose, collect_joints, evaluate_document_at_time, pose_digest } from './poseEvaluation'
import { compute_framing, create_observation_camera, project_joint } from './cameraGeometry'
import { OffscreenCapture } from './capture'
import { OBSERVATION_VIEWS, type ObservationProjection } from './types'
import type { AnimationDocument } from '../animation-document/types'

const status = document.querySelector<HTMLElement>('#status')!
const views = document.querySelector<HTMLElement>('#views')!
const time_input = document.querySelector<HTMLInputElement>('#time')!
const time_label = document.querySelector<HTMLElement>('#timeLabel')!
const projection_input = document.querySelector<HTMLSelectElement>('#projection')!
const file_input = document.querySelector<HTMLInputElement>('#doc')!

let scene: Scene
const meshes: SkinnedMesh[] = []
let document_data: AnimationDocument | null = null
let capture: OffscreenCapture | null = null

function base64 (bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function load_rig (): Promise<void> {
  const rig = RigConfig.by_skeleton_type(SkeletonType.Human)
  if (rig === undefined) throw new Error('human rig missing from manifest')
  const variation = rig.model_variations.find((item) => item.name === 'base') ?? rig.model_variations[0]
  const gltf = await new GLTFLoader().loadAsync(`../${variation.model_file}`)
  gltf.scene.traverse((child) => { if (child instanceof SkinnedMesh) meshes.push(child) })
  if (meshes.length === 0) throw new Error('no skinned meshes')
  Utility.parent_root_bones_to_skinned_meshes(meshes)
  scene = new Scene()
  scene.add(new AmbientLight(0xffffff, 2.2))
  const light = new DirectionalLight(0xffffff, 2.4)
  light.position.set(3, 6, 5)
  scene.add(light)
  scene.add(...meshes)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  canvas.style.display = 'none'
  document.body.appendChild(canvas)
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(256, 256, false)
  capture = new OffscreenCapture({ renderer, scene, active_skinned_meshes: () => meshes })
  status.textContent = 'Rig loaded. Load an animation document.'
}

function set_document (value: AnimationDocument): void {
  document_data = value
  time_input.max = String(value.clip.duration_seconds)
  time_input.value = '0'
  render()
}

function render (): void {
  if (document_data === null || capture === null) return
  const timestamp = Number(time_input.value)
  time_label.textContent = `${timestamp.toFixed(2)} s`
  const evaluated = evaluate_document_at_time(document_data, timestamp)
  const source = {
    document: document_data,
    skeleton: meshes[0].skeleton,
    rig_identifier: document_data.rig.identifier,
    fingerprint: document_data.rig.fingerprint
  }
  const pose = apply_evaluated_pose(source.skeleton, evaluated)
  try {
    const framing = compute_framing(source.skeleton, 256, 256)
    if (framing === null) throw new Error('no pose bounds')
    const projection = projection_input.value as ObservationProjection
    const joints = collect_joints(source, evaluated)
    const digest = pose_digest(evaluated)
    status.textContent = `pose digest ${digest} · ${document_data.channels.length} tracks`
    views.replaceChildren()
    for (const view of OBSERVATION_VIEWS) {
      const camera = create_observation_camera({ view, framing, width: 256, height: 256, projection })
      const projected = joints.map((joint) => ({
        ...joint,
        projected: project_joint(
          new Vector3(...joint.world_position),
          camera, 'none'
        )
      }))
      const encoded = capture.render(camera, 256, 256, 'image/png', 0.85,
        { joints: projected, options: { skeleton: true, bone_labels: false } })
      const figure = document.createElement('figure')
      const image = document.createElement('img')
      image.src = `data:${encoded.mime};base64,${base64(encoded.bytes)}`
      image.alt = `${view} observation`
      const caption = document.createElement('figcaption')
      caption.textContent = view
      figure.appendChild(image)
      figure.appendChild(caption)
      views.appendChild(figure)
    }
  } finally {
    pose.restore()
  }
}

file_input.addEventListener('change', async () => {
  const file = file_input.files?.[0]
  if (file === undefined) return
  set_document(JSON.parse(await file.text()) as AnimationDocument)
})
time_input.addEventListener('input', render)
projection_input.addEventListener('change', render)

const doc_url = new URLSearchParams(location.search).get('doc')
void load_rig().then(async () => {
  if (doc_url !== null) {
    const response = await fetch(doc_url)
    set_document(await response.json() as AnimationDocument)
    const time_param = new URLSearchParams(location.search).get('time')
    if (time_param !== null) {
      time_input.value = time_param
      render()
    }
  }
}).catch((error: unknown) => {
  status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`
})

