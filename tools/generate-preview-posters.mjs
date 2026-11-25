#!/usr/bin/env node
/* global console, process */
/**
 * M2M-023A — offline preview poster generation.
 *
 * Extracts a representative early frame from every bundled animation MP4 into a
 * small WebP poster next to the video. Run manually before packaging:
 *
 *   node tools/generate-preview-posters.mjs
 *
 * This never runs at application startup. Existing fresh posters are skipped so
 * the pipeline is idempotent. Requires ffmpeg on PATH; no npm dependencies.
 */
import { readdir, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'static', 'animpreviews')
const POSTER_EXT = '.webp'

async function * mp4_files (dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield * mp4_files(full)
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) yield full
  }
}

async function main () {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('ffmpeg is required to generate preview posters')
  }

  let generated = 0
  let skipped = 0
  let failed = 0

  for await (const video of mp4_files(root)) {
    const poster = video.slice(0, -4) + POSTER_EXT
    try {
      const [video_stat, poster_stat] = await Promise.all([
        stat(video),
        stat(poster).catch(() => null)
      ])
      if (poster_stat !== null && poster_stat.mtimeMs >= video_stat.mtimeMs) {
        skipped++
        continue
      }
      const result = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', video,
        '-vf', 'select=eq(n\\,2),scale=100:120:force_original_aspect_ratio=decrease,pad=100:120:(ow-iw)/2:(oh-ih)/2',
        '-frames:v', '1', '-q:v', '70', '-y', poster
      ], { stdio: 'pipe' })
      if (result.status !== 0) {
        failed++
        console.error('FAILED', relative(root, video), result.stderr?.toString().trim() ?? '')
        continue
      }
      generated++
    } catch (error) {
      failed++
      console.error('ERROR', relative(root, video), String(error))
    }
  }

  console.log(`preview posters: ${generated} generated, ${skipped} up to date, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

await main()
