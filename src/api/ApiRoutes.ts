import { RigConfig, type RigConfigEntry } from '../lib/RigConfig'
import { type ModelVariation } from '../lib/RigModelVariations'

/**
 * Read-only public API served by the Cloudflare worker under /api.
 * Data comes straight from RigConfig so the API always matches what the app uses.
 *
 * GET /api/rigs                        list of rigs
 * GET /api/rigs/:rig_id                a single rig
 * GET /api/rigs/:rig_id/variations     3D model variations for a rig
 */

export interface ApiResult {
  body: unknown
  status: number
}

export const API_PREFIX = '/api/'

export function handleApiRequest (url: URL): ApiResult {
  // e.g. '/api/rigs/human/variations' -> ['rigs', 'human', 'variations']
  const segments = url.pathname.slice(API_PREFIX.length).split('/').filter(s => s.length > 0)
  const [resource, rig_id, sub_resource] = segments

  if (resource !== 'rigs' || segments.length > 3) {
    return not_found('Unknown API route')
  }

  if (rig_id === undefined) {
    return { body: RigConfig.all.map(rig => rig_summary(rig, url.origin)), status: 200 }
  }

  const rig = RigConfig.by_key(rig_id)
  if (rig === undefined) {
    return not_found(`Unknown rig: ${rig_id}`)
  }

  if (sub_resource === undefined) {
    return { body: rig_summary(rig, url.origin), status: 200 }
  }

  if (sub_resource === 'variations') {
    const variations = rig.model_variations ?? []
    return { body: variations.map(variation => variation_summary(variation, url.origin)), status: 200 }
  }

  return not_found('Unknown API route')
}

function rig_summary (rig: RigConfigEntry, origin: string): Record<string, unknown> {
  return {
    id: rig.skeleton_type,
    display_name: rig.rig_display_name,
    model_url: asset_url(rig.model_file, origin),
    rig_url: asset_url(rig.rig_file, origin),
    skeleton_template_image_url: asset_url(rig.skeleton_template_image_url, origin),
    variation_count: rig.model_variations?.length ?? 0,
    variations_url: `${origin}${API_PREFIX}rigs/${rig.skeleton_type}/variations`
  }
}

function variation_summary (variation: ModelVariation, origin: string): Record<string, unknown> {
  return {
    // file name without extension, e.g. 'models-variation/human/zombie.glb' -> 'zombie'
    id: variation.model_file.split('/').pop()?.replace(/\.glb$/, ''),
    display_name: variation.display_name,
    model_url: asset_url(variation.model_file, origin),
    preview_image_url: asset_url(variation.preview_image, origin),
    license: variation.license,
    attribution: variation.attribution
  }
}

// config paths are relative to the static root, so they map directly onto the site origin
function asset_url (static_path: string, origin: string): string {
  return `${origin}/${encodeURI(static_path)}`
}

function not_found (message: string): ApiResult {
  return { body: { error: message }, status: 404 }
}
