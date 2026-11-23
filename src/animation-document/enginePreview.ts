/**
 * M2M-025B — engine integration adapter for draft previews.
 *
 * This is the ONLY bridge to the real application. It uses the engine's
 * existing public frame-listener and active-skinned-mesh APIs and deliberately
 * avoids StepAnimationsListing.play_animation() / AnimationPlayer.set_animation(),
 * which own the user's current animation selection.
 *
 * No existing UI, CSS, preview scheduler or poster code is modified here.
 */

import type { SkinnedMesh } from 'three'
import { DraftPreviewSession, type PreviewHost } from './preview'

/** Duck-typed view of Mesh2MotionEngine (mirrors EngineControlHost precedent). */
export interface PreviewEngine {
  active_skinned_meshes (): SkinnedMesh[]
  add_frame_listener (listener: (delta_time: number) => void): void
  get_animation_player? (): { pause (): void, play (): void }
}

/**
 * Create a preview session bound to a live engine.
 *
 * Pausing/resuming regular playback is delegated to the engine's own player so
 * application state ownership stays with the app: we never touch the selected
 * animation id or the animation library.
 */
export function create_engine_preview (engine: PreviewEngine): DraftPreviewSession {
  const host: PreviewHost = {
    active_skinned_meshes: () => engine.active_skinned_meshes(),
    add_frame_listener: (listener) => engine.add_frame_listener(listener),
    pause_regular_playback: () => engine.get_animation_player?.().pause(),
    resume_regular_playback: () => engine.get_animation_player?.().play()
  }
  return new DraftPreviewSession(host)
}
