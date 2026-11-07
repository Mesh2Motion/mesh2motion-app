import { type AnimationAction, type AnimationClip, AnimationMixer, Object3D, type SkinnedMesh } from 'three'
import { AnimationPlayer } from '../lib/processes/animations-listing/AnimationPlayer.ts'

/**
 * Plays the composed animation on the preview model and keeps the
 * shared animation player controls (play/pause, scrubber) in sync.
 */
export class ComposerPreview {
  private readonly animation_player: AnimationPlayer = new AnimationPlayer()
  private animation_mixer: AnimationMixer = new AnimationMixer(new Object3D())
  private skinned_meshes: SkinnedMesh[] = []
  private current_clip: AnimationClip | null = null

  public set_skinned_meshes (skinned_meshes: SkinnedMesh[]): void {
    this.skinned_meshes = skinned_meshes
    if (this.current_clip !== null) {
      this.play_clip(this.current_clip)
    }
  }

  public play_clip (clip: AnimationClip): void {
    this.current_clip = clip

    // a new mixer clears the cached actions, so a rebuilt clip with the same name still updates
    this.animation_mixer.stopAllAction()
    this.animation_mixer = new AnimationMixer(new Object3D())

    const actions: AnimationAction[] = this.skinned_meshes.map((skinned_mesh: SkinnedMesh) => {
      this.reset_root_bone_position(skinned_mesh)
      const action: AnimationAction = this.animation_mixer.clipAction(clip, skinned_mesh)
      action.play()
      return action
    })

    if (actions.length > 0) {
      this.animation_player.set_animation(clip, actions)
    }
  }

  public frame_change (delta_time: number): void {
    this.animation_mixer.update(delta_time)
    this.animation_player.update(delta_time)
  }

  // not every clip has root bone keyframes, so clear any offset left over from the previous clip
  private reset_root_bone_position (skinned_mesh: SkinnedMesh): void {
    const root_bone = skinned_mesh.skeleton.bones[0]
    if (root_bone !== undefined) {
      root_bone.position.set(0, 0, 0)
      root_bone.updateMatrixWorld(true)
    }
  }
}
