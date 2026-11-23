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
  /** M2M-028A addendum: unregister the callback when the session is disposed. */
  remove_frame_listener? (listener: (delta_time: number) => void): void
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
  private readonly frame_listener: (delta_time: number) => void
  private mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private actions: AnimationAction[] = []
  private active: boolean = false
  private current_clip: AnimationClip | null = null
  private disposed: boolean = false

  constructor (host: PreviewHost) {
    this.host = host
    this.frame_listener = (delta_time: number): void => {
      if (this.active) this.mixer.update(delta_time)
    }
    host.add_frame_listener(this.frame_listener)
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

  /** Release the mixer and unregister the per-frame callback. */
  dispose (): void {
    if (this.disposed) return
    this.stop()
    this.disposed = true
    this.host.remove_frame_listener?.(this.frame_listener)
    this.mixer.stopAllAction()
    this.actions = []
    this.current_clip = null
  }
}
