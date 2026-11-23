/**
 * M2M-031 — application-owned persistence for authored/imported clips.
 *
 * Authored AnimationDocuments survive page reloads so they can be inspected and
 * played in the Explore tab. Bundled manifest animations are never written here;
 * only documents explicitly committed or imported by the user/MCP are stored.
 */

import { Vector3, type Skeleton, type SkinnedMesh, type Scene, type WebGLRenderer } from 'three'
import { AUTHORED_TAG } from '../authoringBridge/applicationOwner'
import type { StepAnimationsListing } from '../lib/processes/animations-listing/StepAnimationsListing'
import type { TransformedAnimationClipPair } from '../lib/processes/animations-listing/interfaces/TransformedAnimationClipPair'
import { check_rig_compatibility, draft_document_to_clip } from './liveRigAdapter'
import { OffscreenCapture } from '../authoringObservation/capture'
import { compute_framing, create_observation_camera, project_joint } from '../authoringObservation/cameraGeometry'
import { apply_evaluated_pose, evaluate_document_at_time } from '../authoringObservation/poseEvaluation'
import type { AnimationDocument } from './types'

const STORAGE_KEY = 'm2m.authored-animations.v1'
const MAX_CLIPS = 20
const MAX_BYTES = 4 * 1024 * 1024
export const AUTHORED_ID_TAG_PREFIX = 'authored-id:'

export interface StoredAuthoredDocument {
  id: string
  document: AnimationDocument
  source_name: string | null
  saved_at: number
  /** Small PNG data URLs rendered from the live rig for the catalog poster/flipbook. */
  preview_frames?: string[]
}

const restored_ids = new Set<string>()
/** Maps a library entry id to its generated preview frames. */
const preview_frames_by_entry = new Map<string, string[]>()

export function get_authored_preview_frames (entry_id: string): readonly string[] | null {
  return preview_frames_by_entry.get(entry_id) ?? null
}

/** Register generated preview frames for a library entry (used by restore and tests). */
export function set_authored_preview_frames (entry_id: string, frames: readonly string[]): void {
  preview_frames_by_entry.set(entry_id, [...frames])
}

function is_stored (value: unknown): value is StoredAuthoredDocument {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<StoredAuthoredDocument>
  return typeof entry.id === 'string' && typeof entry.document === 'object' && entry.document !== null
}

/** Read persisted authored documents, dropping malformed entries. */
export function load_authored_documents (): StoredAuthoredDocument[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(is_stored) : []
  } catch {
    return []
  }
}

function write (entries: StoredAuthoredDocument[]): void {
  const serialized = JSON.stringify(entries.slice(0, MAX_CLIPS))
  if (serialized.length > MAX_BYTES) return
  window.localStorage.setItem(STORAGE_KEY, serialized)
}

/** Persist one authored document. Returns its stable authored id. */
export function save_authored_document (
  document: AnimationDocument,
  source_name: string | null = null
): string {
  const id = `authored-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const entries = load_authored_documents()
  entries.push({ id, document, source_name, saved_at: Date.now() })
  write(entries.slice(-MAX_CLIPS))
  return id
}

/** Avoid duplicate persistence when commit/undo re-applies the same revision. */
export function save_authored_document_once (
  document: AnimationDocument,
  source_name: string | null = null
): string | null {
  const duplicate = load_authored_documents().some((entry) =>
    entry.document.clip.name === document.clip.name &&
    entry.document.revision === document.revision &&
    entry.document.channels.length === document.channels.length)
  return duplicate ? null : save_authored_document(document, source_name)
}

export function delete_authored_document (id: string): boolean {
  const entries = load_authored_documents()
  const remaining = entries.filter((entry) => entry.id !== id)
  if (remaining.length === entries.length) return false
  write(remaining)
  restored_ids.delete(id)
  return true
}

/** Bundled manifest entries are protected; only generated custom entries may be deleted. */
export function can_delete_animation (entry: {
  id: string
  file?: string
  metadata?: { source_type?: string, tags?: readonly string[] }
}): boolean {
  return entry.metadata?.source_type === 'custom-import' &&
    entry.file === undefined &&
    entry.id.startsWith('custom-import-')
}

export function authored_id_from_tags (tags: readonly string[] | undefined): string | null {
  const tag = tags?.find((item) => item.startsWith(AUTHORED_ID_TAG_PREFIX))
  return tag === undefined ? null : tag.slice(AUTHORED_ID_TAG_PREFIX.length)
}

function to_base64 (bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * Render a small front-view flipbook from the authored pose. Uses the same
 * offscreen capture path as MCP observations and never touches the visible camera.
 */
export function generate_authored_preview (
  document: AnimationDocument,
  skeleton: Skeleton,
  renderer: WebGLRenderer,
  scene: Scene,
  meshes: readonly SkinnedMesh[],
  frame_count = 8
): string[] {
  const capture = new OffscreenCapture({ renderer, scene, active_skinned_meshes: () => meshes })
  const frames: string[] = []
  try {
    for (let index = 0; index < frame_count; index++) {
      const ratio = frame_count > 1 ? index / (frame_count - 1) : 0
      const time = ratio * document.clip.duration_seconds
      const pose = apply_evaluated_pose(skeleton, evaluate_document_at_time(document, time))
      try {
        const framing = compute_framing(skeleton, 128, 128)
        if (framing === null) continue
        const camera = create_observation_camera({
          view: 'front', framing, width: 128, height: 128, projection: 'orthographic'
        })
        const encoded = capture.render(camera, 128, 128, 'image/png', 0.8, null)
        frames.push(`data:${encoded.mime};base64,${to_base64(encoded.bytes)}`)
      } finally {
        pose.restore()
      }
    }
  } catch (error) {
    console.warn('[M2M-031] authored preview generation failed:', error instanceof Error ? error.message : String(error))
  } finally {
    capture.dispose()
  }
  return frames
}

/**
 * 2D-canvas fallback: a real projected-skeleton flipbook of the evaluated pose.
 * Used when WebGL readback is unavailable, so authored tiles always have a preview.
 */
export function generate_skeleton_preview (
  document: AnimationDocument,
  skeleton: Skeleton,
  frame_count = 8
): string[] {
  const frames: string[] = []
  const size = 128
  for (let index = 0; index < frame_count; index++) {
    const ratio = frame_count > 1 ? index / (frame_count - 1) : 0
    const pose = apply_evaluated_pose(skeleton,
      evaluate_document_at_time(document, ratio * document.clip.duration_seconds))
    try {
      const framing = compute_framing(skeleton, size, size)
      if (framing === null) continue
      const camera = create_observation_camera({ view: 'front', framing, width: size, height: size, projection: 'orthographic' })
      const canvas = window.document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const context = canvas.getContext('2d')
      if (context === null) continue
      context.clearRect(0, 0, size, size)
      const points = skeleton.bones.map((bone) => {
        const world = bone.getWorldPosition(new Vector3())
        const projected = project_joint(world, camera, 'none')
        return { x: projected.u * size, y: projected.v * size, parent: bone.parent }
      })
      context.strokeStyle = '#4fc3f7'
      context.lineWidth = 2
      for (const point of points) {
        if (point.parent === null || !skeleton.bones.includes(point.parent as typeof skeleton.bones[number])) continue
        const parent_world = (point.parent as typeof skeleton.bones[number]).getWorldPosition(new Vector3())
        const parent_projected = project_joint(parent_world, camera, 'none')
        context.beginPath()
        context.moveTo(parent_projected.u * size, parent_projected.v * size)
        context.lineTo(point.x, point.y)
        context.stroke()
      }
      context.fillStyle = '#ffd166'
      for (const point of points) {
        context.beginPath()
        context.arc(point.x, point.y, 2.5, 0, Math.PI * 2)
        context.fill()
      }
      frames.push(canvas.toDataURL('image/png'))
    } catch {
      // skip an unprojectable frame
    } finally {
      pose.restore()
    }
  }
  return frames
}

/**
 * Rehydrate persisted documents into an engine's application-owned library.
 * Mismatched rigs are skipped, never remapped by bone name.
 */
export function restore_authored_documents (
  listing: StepAnimationsListing,
  skeleton: Skeleton,
  rig_identifier: string,
  renderer?: WebGLRenderer,
  scene?: Scene,
  meshes?: readonly SkinnedMesh[]
): number {
  let restored = 0
  for (const stored of load_authored_documents()) {
    if (restored_ids.has(stored.id)) continue
    const document = stored.document
    if (document.rig.identifier !== rig_identifier) continue
    if (!check_rig_compatibility(document, skeleton).compatible) continue
    try {
      const clip = draft_document_to_clip(document, skeleton)
      const pair: TransformedAnimationClipPair = {
        original_animation_clip: clip,
        display_animation_clip: clip.clone(),
        metadata: {
          source_type: 'custom-import',
          tags: [
            AUTHORED_TAG,
            `rig:${rig_identifier}`,
            `revision:${document.revision}`,
            `${AUTHORED_ID_TAG_PREFIX}${stored.id}`,
            ...(stored.source_name === null ? [] : [`source:${stored.source_name}`])
          ]
        }
      }
      const entry = listing.add_authored_animation(pair)
      if (renderer !== undefined && scene !== undefined && meshes !== undefined) {
        const rendered = (stored.preview_frames?.length ?? 0) > 0
          ? stored.preview_frames!
          : generate_authored_preview(document, skeleton, renderer, scene, meshes)
        const frames = rendered.length > 0 ? rendered : generate_skeleton_preview(document, skeleton)
        if (frames.length > 0) {
          // Register with the catalog first: a localStorage quota failure must
          // never prevent the tile from showing its generated poster/flipbook.
          preview_frames_by_entry.set(entry.id, frames)
          if (stored.preview_frames === undefined) {
            try {
              const entries = load_authored_documents()
              const index = entries.findIndex((item) => item.id === stored.id)
              if (index >= 0) {
                entries[index] = { ...stored, preview_frames: frames }
                write(entries)
              }
            } catch {
              // Preview still works for this session; persistence is best-effort.
            }
          }
        }
      }
      restored_ids.add(stored.id)
      restored++
    } catch {
      // A document that cannot be converted against this rig is skipped.
    }
  }
  return restored
}
