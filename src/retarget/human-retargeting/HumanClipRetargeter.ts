import { AnimationClip, type QuaternionKeyframeTrack, type VectorKeyframeTrack } from 'three'
import { Retargeter } from './Retargeter'
import { type Rig } from './Rig'

export interface HumanClipRetargetOptions {
  // name for the baked clip. Defaults to the source clip name
  clip_name?: string
  // corrective X-axis rotation (degrees) applied to the whole target rig. See Retargeter.set_root_correction_x
  root_correction_x_degrees?: number
  // 30 fps for input animations is usually sufficient for now
  fps?: number
}

/**
 * Bakes a swing-twist retarget of one clip from a source rig onto a target rig.
 *
 * Has no idea which side is the Mesh2Motion rig. The retarget page drives other rigs
 * with Mesh2Motion animations, and the main app's animation import drives the
 * Mesh2Motion rig with animations authored on other rigs (Mixamo, etc). Both build
 * their own rigs and hand them in here.
 */
export class HumanClipRetargeter {
  /**
   * @param source_clip - animation authored on the source rig
   * @param source_rig - rig the clip's tracks bind to. Must be at rest when the Rig was built
   * @param target_rig - rig to bake onto. Its skeleton gets posed while baking, so it
   *                     should be a detached working copy, not a skeleton in the scene
   * @returns a new clip with tracks named after the target rig's bones
   */
  public static retarget (
    source_clip: AnimationClip,
    source_rig: Rig,
    target_rig: Rig,
    options: HumanClipRetargetOptions = {}
  ): AnimationClip {
    const retargeter: Retargeter = new Retargeter(source_rig, target_rig, source_clip)

    // apply any global rig correction (fixes tilted rigs that have no root bone,
    // only a pelvis bone at the top of the hierarchy)
    retargeter.set_root_correction_x(options.root_correction_x_degrees ?? 0)

    // TODO: experiment with the additives later with T-pose correction
    // retargeter.additives.push(
    //     (Ref.addAxis  = new AxisAdditive( 'armL', 'y', 0 * Math.PI / 180 )),
    //     (Ref.addTwist = new ChainTwistAdditive( 'armR', 0 * Math.PI / 180 )),
    // );

    // Initialize the retargeter with a small delta
    retargeter.update(0.001)

    // Bake the retargeted animation into keyframe tracks
    const retargeted_tracks: Array<QuaternionKeyframeTrack | VectorKeyframeTrack> =
      retargeter.bake_animation_to_tracks(options.fps ?? 30)

    return new AnimationClip(
      options.clip_name ?? source_clip.name,
      source_clip.duration,
      retargeted_tracks
    )
  }
}
