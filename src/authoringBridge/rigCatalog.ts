/**
 * M2M-028A — publish the CURRENT live Three.js skeleton through authoring-bridge/v1.
 *
 * No synthetic catalog is ever returned. If the application has no loaded rig,
 * the caller receives RIG_UNAVAILABLE. Fox and Horse are supported by the same
 * path; Human is the first demonstrated rig.
 */

import { type Skeleton } from 'three'
import { read_live_rig, is_supported_rig, type RigBoneCatalog } from '../animation-document/liveRigAdapter'
import type { RigCatalogResult } from './types'

/** Duck-typed view of Mesh2MotionEngine (same precedent as EngineControlHost). */
export interface AuthoringEngine {
  active_skinned_meshes? (): Array<{ skeleton: Skeleton }>
  edit_skeleton_step?: { skeleton? (): Skeleton }
  load_skeleton_step?: { skeleton_type? (): string }
}

export function live_skeleton_from_engine (engine: AuthoringEngine): Skeleton | null {
  const meshes = engine.active_skinned_meshes?.() ?? []
  for (const mesh of meshes) {
    if (mesh?.skeleton?.bones?.length > 0) return mesh.skeleton
  }
  const helper = engine.edit_skeleton_step?.skeleton?.()
  if (helper !== undefined && helper !== null && helper.bones.length > 0) return helper
  return null
}

export function live_rig_identifier (engine: AuthoringEngine): string | null {
  const identifier = engine.load_skeleton_step?.skeleton_type?.()
  return typeof identifier === 'string' && identifier.length > 0 ? identifier : null
}

/**
 * Read and publish the live skeleton. Throws RIG_UNAVAILABLE / RIG_MISMATCH as
 * plain error messages so the dispatcher can map them to bridge error codes.
 */
export function publish_live_rig_catalog (engine: AuthoringEngine, expected_fingerprint?: string): RigCatalogResult {
  const identifier = live_rig_identifier(engine)
  if (identifier === null) throw new Error('RIG_UNAVAILABLE')
  if (!is_supported_rig(identifier)) throw new Error(`RIG_UNAVAILABLE: unsupported rig ${identifier}`)
  const skeleton = live_skeleton_from_engine(engine)
  if (skeleton === null) throw new Error('RIG_UNAVAILABLE')
  const catalog: RigBoneCatalog = read_live_rig(skeleton, identifier)
  if (expected_fingerprint !== undefined && catalog.rig.fingerprint !== expected_fingerprint) {
    throw new Error('RIG_MISMATCH')
  }
  return {
    rig: { ...catalog.rig },
    bones: catalog.bones.map((bone) => ({
      id: bone.id,
      display_name: bone.display_name,
      index: bone.index,
      parent_id: bone.parent_id,
      local_position: [...bone.local_position],
      local_quaternion: [...bone.local_quaternion],
      local_scale: [...bone.local_scale]
    }))
  }
}
