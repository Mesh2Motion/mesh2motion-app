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
