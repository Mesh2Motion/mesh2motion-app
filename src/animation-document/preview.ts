/**
 * M2M-025B — controlled in-memory preview of a draft AnimationClip.
 *
 * The draft is driven by its OWN AnimationMixer and never goes through
 * StepAnimationsListing.play_animation() or AnimationPlayer.set_animation(), so
 * the current animation selection in the application is not corrupted. The
 * application keeps ownership: it supplies the skinned meshes and may pause /
 * resume its regular playback around the preview.
 */

import { AnimationMixer, Object3D, type AnimationAction, type AnimationClip, type SkinnedMesh } from 'three'

export interface PreviewHost {
  /** Live skinned meshes to preview on. */
  active_skinned_meshes (): readonly SkinnedMesh[]
  /** Register the per-frame callback (engine's add_frame_listener). */
  add_frame_listener (listener: (delta_time: number) => void): void
  /** Optional application-owned hooks around a preview session. */
  pause_regular_playback? (): void
  resume_regular_playback? (): void
}

/**
 * A self-contained preview session. Multiple calls to show() replace the
 * draft clip, never the application's selected animation.
 */
export class DraftPreviewSession {
  private readonly host: PreviewHost
  private mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private actions: AnimationAction[] = []
  private active: boolean = false
  private current_clip: AnimationClip | null = null

  constructor (host: PreviewHost) {
    this.host = host
    // The engine has no remove_frame_listener; the callback self-gates on
    // `active`, so a stopped session is a no-op for the rest of the app life.
    host.add_frame_listener((delta_time: number) => {
      if (this.active) {
        this.mixer.update(delta_time)
      }
    })
  }

  /** Show a draft clip without touching application selection state. */
  show (clip: AnimationClip): void {
    this.stop()
    this.host.pause_regular_playback?.()
    this.mixer = new AnimationMixer(new Object3D())
    this.actions = this.host.active_skinned_meshes().map((skinned_mesh: SkinnedMesh) => {
      const action = this.mixer.clipAction(clip, skinned_mesh)
      action.reset().play()
      return action
    })
    this.current_clip = clip
    this.active = true
  }

  /** Stop the draft and restore whatever the application was doing. */
  stop (): void {
    if (!this.active) {
      return
    }
    this.mixer.stopAllAction()
    this.actions = []
    this.active = false
    this.host.resume_regular_playback?.()
  }

  is_active (): boolean {
    return this.active
  }

  previewed_clip_name (): string | null {
    return this.current_clip?.name ?? null
  }

  /** Advance the draft explicitly (useful for deterministic tests). */
  update (delta_time: number): void {
    if (this.active) {
      this.mixer.update(delta_time)
    }
  }
}
