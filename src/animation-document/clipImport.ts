/**
 * M2M-031 — explicit "From Existing Animation" track import.
 *
 * Copies tracks from a selected THREE.AnimationClip into NEW AnimationDocument
 * channels against the live rig. Nothing is reused implicitly: the caller must
 * choose a source clip, and unmatched tracks are reported instead of guessed.
 */

import { type AnimationClip, type KeyframeTrack } from 'three'
import { with_animation_channel } from './create'
import { normalize_quaternion } from './conventions'
import type { AnimationDocument, AnimationKeyframe, AnimationProperty } from './types'

export interface TrackImportReport {
  imported: number
  skipped: string[]
}

function property_of (track_name: string): { property: AnimationProperty, bone_name: string } | null {
  for (const property of ['quaternion', 'position', 'scale'] as const) {
    const suffix = `.${property}`
    if (track_name.endsWith(suffix)) {
      return { property, bone_name: track_name.slice(0, -suffix.length) }
    }
  }
  return null
}

function keyframes_from_track (track: KeyframeTrack, property: AnimationProperty, duration: number): AnimationKeyframe[] {
  const arity = property === 'quaternion' ? 4 : 3
  const by_time = new Map<number, number[]>()
  for (let index = 0; index < track.times.length; index++) {
    const time = Math.min(Math.max(track.times[index], 0), duration)
    const values = Array.from(track.values.slice(index * arity, index * arity + arity))
    if (values.length !== arity) continue
    // Step tracks hold duplicate times; validation requires strictly increasing
    // times, so the latest value at each time is the canonical one.
    by_time.set(Number(time.toFixed(6)), values)
  }
  return [...by_time.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, values]) => ({
      time_seconds: time,
      values: property === 'quaternion' ? normalize_quaternion(values) : values,
      interpolation: property === 'quaternion' ? 'slerp' : 'linear'
    }))
}

/**
 * Create a new document from the selected clip. The template must be an empty
 * live-rig document so bone identities and fingerprint come from the real rig.
 */
export function import_clip_as_document (
  clip: AnimationClip,
  template: AnimationDocument,
  source_name: string
): { document: AnimationDocument, report: TrackImportReport } {
  let document: AnimationDocument = {
    ...template,
    clip: { name: `${clip.name || source_name} (imported)`, duration_seconds: Math.max(clip.duration, 0.001) },
    channels: [],
    revision: 1
  }
  const report: TrackImportReport = { imported: 0, skipped: [] }
  for (const track of clip.tracks) {
    const parsed = property_of(track.name)
    if (parsed === null) {
      report.skipped.push(track.name)
      continue
    }
    const bone = document.bones.find((entry) =>
      entry.display_name === parsed.bone_name ||
      parsed.bone_name.endsWith(entry.display_name) ||
      parsed.bone_name.includes(`[${entry.display_name}]`))
    if (bone === undefined) {
      report.skipped.push(track.name)
      continue
    }
    document = with_animation_channel(document, {
      bone_id: bone.id,
      property: parsed.property,
      keyframes: keyframes_from_track(track, parsed.property, document.clip.duration_seconds)
    })
    report.imported++
  }
  return { document, report }
}
