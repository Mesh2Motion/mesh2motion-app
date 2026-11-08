import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, type Bone, type Skeleton } from 'three'
import { FacialSkeleton } from '../edit-skeleton/FacialSkeleton.ts'
import { AnimationUtility } from './AnimationUtility.ts'
import type { TransformedAnimationClipPair } from './interfaces/TransformedAnimationClipPair.ts'

/** One keyframe of local-space rotation, in radians. Missing axes default to zero. */
interface RotationKey {
  time: number
  x?: number
  y?: number
  z?: number
}

interface FaceClipDefinition {
  name: string
  duration: number
  // keyed by face bone name
  tracks: Record<string, RotationKey[]>
}

/**
 * Facial animation clips built from the starter face rig's bones. They are generated
 * at runtime rather than shipped in the asset library because the face bones only
 * exist when the user adds the facial skeleton in the edit skeleton step.
 */
export class FacialAnimations {
  static has_face_bones (skeleton: Skeleton): boolean {
    return FacialSkeleton.bones(skeleton).length > 0
  }

  static create_clip_pairs (skeleton: Skeleton): TransformedAnimationClipPair[] {
    const bones = new Map(FacialSkeleton.bones(skeleton).map(bone => [bone.name, bone]))
    if (bones.size === 0) { return [] }

    return FacialAnimations.clip_definitions().flatMap((definition) => {
      const tracks = Object.entries(definition.tracks).flatMap(([bone_name, keys]) => {
        const bone = bones.get(bone_name)
        return bone === undefined ? [] : [FacialAnimations.create_track(bone, keys)]
      })
      if (tracks.length === 0) { return [] }

      const clip = new AnimationClip(definition.name, definition.duration, tracks)
      return [{
        original_animation_clip: AnimationUtility.deep_clone_animation_clip(clip),
        display_animation_clip: clip,
        metadata: { source_type: 'generated' as const, tags: ['facial'] }
      }]
    })
  }

  /**
   * Compose the animated rotation on top of the bone's rest rotation, so a face rig
   * that was rotated while fitting the model keeps that fitted pose.
   */
  private static create_track (bone: Bone, keys: RotationKey[]): QuaternionKeyframeTrack {
    const times = new Float32Array(keys.map(key => key.time))
    const values = new Float32Array(keys.length * 4)
    const euler = new Euler()
    const delta = new Quaternion()
    const rotation = new Quaternion()

    keys.forEach((key, index) => {
      euler.set(key.x ?? 0, key.y ?? 0, key.z ?? 0)
      delta.setFromEuler(euler)
      rotation.copy(bone.quaternion).multiply(delta)
      rotation.toArray(values, index * 4)
    })

    return new QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values)
  }

  private static clip_definitions (): FaceClipDefinition[] {
    return [
      {
        name: 'Facial Idle',
        duration: 3.0,
        tracks: {
          face_jaw: keyed([[0, 0], [1.5, 0.05], [3.0, 0]], 'x'),
          face_chin: keyed([[0, 0], [1.5, 0.02], [3.0, 0]], 'x'),
          face_lip_lower: keyed([[0, 0], [1.5, 0.015], [3.0, 0]], 'x'),
          face_lip_upper: keyed([[0, 0], [1.0, -0.015], [2.0, 0], [3.0, 0]], 'x'),
          face_eye_L: keyed([[0, 0], [1.0, 0.14], [2.0, -0.08], [3.0, 0]], 'y'),
          face_eye_R: keyed([[0, 0], [1.0, 0.14], [2.0, -0.08], [3.0, 0]], 'y'),
          face_brow_L: keyed([[0, 0], [1.5, -0.05], [3.0, 0]], 'x'),
          face_brow_R: keyed([[0, 0], [1.5, -0.05], [3.0, 0]], 'x'),
          face_cheek_L: keyed([[0, 0], [1.5, 0.03], [3.0, 0]], 'z'),
          face_cheek_R: keyed([[0, 0], [1.5, -0.03], [3.0, 0]], 'z'),
          face_mouth_L: keyed([[0, 0], [1.5, 0.025], [3.0, 0]], 'z'),
          face_mouth_R: keyed([[0, 0], [1.5, -0.025], [3.0, 0]], 'z')
        }
      },
      {
        name: 'Facial Talk',
        duration: 2.4,
        tracks: {
          face_jaw: keyed([[0, 0], [0.18, 0.32], [0.36, 0.06], [0.6, 0.38], [0.82, 0.05], [1.05, 0.25], [1.25, 0.02], [1.55, 0.3], [1.8, 0.04], [2.05, 0.22], [2.4, 0]], 'x'),
          face_chin: keyed([[0, 0], [0.18, 0.05], [0.6, 0.06], [1.05, 0.03], [1.55, 0.05], [2.05, 0.03], [2.4, 0]], 'x'),
          face_lip_lower: keyed([[0, 0], [0.18, 0.05], [0.36, 0], [0.6, 0.06], [0.82, 0], [1.05, 0.04], [1.25, 0], [1.55, 0.05], [1.8, 0], [2.05, 0.03], [2.4, 0]], 'x'),
          face_lip_upper: keyed([[0, 0], [0.18, -0.03], [0.36, 0], [0.6, -0.04], [0.82, 0], [1.05, -0.02], [1.25, 0], [1.55, -0.03], [1.8, 0], [2.05, -0.02], [2.4, 0]], 'x'),
          face_mouth_L: keyed([[0, 0], [0.18, 0.04], [0.36, 0.01], [0.6, 0.05], [0.82, 0.01], [1.05, 0.03], [1.25, 0.01], [1.55, 0.04], [1.8, 0.01], [2.05, 0.02], [2.4, 0]], 'z'),
          face_mouth_R: keyed([[0, 0], [0.18, -0.04], [0.36, -0.01], [0.6, -0.05], [0.82, -0.01], [1.05, -0.03], [1.25, -0.01], [1.55, -0.04], [1.8, -0.01], [2.05, -0.02], [2.4, 0]], 'z'),
          face_cheek_L: keyed([[0, 0], [0.18, 0.04], [0.36, 0.01], [0.6, 0.05], [0.82, 0.01], [1.05, 0.03], [1.25, 0.01], [1.55, 0.04], [1.8, 0.01], [2.05, 0.02], [2.4, 0]], 'z'),
          face_cheek_R: keyed([[0, 0], [0.18, -0.04], [0.36, -0.01], [0.6, -0.05], [0.82, -0.01], [1.05, -0.03], [1.25, -0.01], [1.55, -0.04], [1.8, -0.01], [2.05, -0.02], [2.4, 0]], 'z'),
          face_brow_L: keyed([[0, 0], [0.18, -0.04], [0.36, 0], [0.6, -0.06], [0.82, 0], [1.05, -0.03], [1.25, 0], [1.55, -0.05], [1.8, 0], [2.05, -0.02], [2.4, 0]], 'x'),
          face_brow_R: keyed([[0, 0], [0.18, -0.04], [0.36, 0], [0.6, -0.06], [0.82, 0], [1.05, -0.03], [1.25, 0], [1.55, -0.05], [1.8, 0], [2.05, -0.02], [2.4, 0]], 'x'),
          face_eye_L: keyed([[0, 0], [0.36, 0.06], [0.82, -0.04], [1.05, 0.05], [1.55, -0.06], [2.05, 0.03], [2.4, 0]], 'y'),
          face_eye_R: keyed([[0, 0], [0.36, 0.06], [0.82, -0.04], [1.05, 0.05], [1.55, -0.06], [2.05, 0.03], [2.4, 0]], 'y')
        }
      },
      {
        name: 'Facial Surprise',
        duration: 1.0,
        tracks: {
          face_jaw: keyed([[0, 0], [0.15, 0.45], [0.6, 0.38], [1.0, 0]], 'x'),
          face_chin: keyed([[0, 0], [0.15, 0.08], [0.6, 0.06], [1.0, 0]], 'x'),
          face_lip_upper: keyed([[0, 0], [0.15, -0.06], [0.6, -0.05], [1.0, 0]], 'x'),
          face_lip_lower: keyed([[0, 0], [0.15, 0.05], [0.6, 0.04], [1.0, 0]], 'x'),
          face_brow_L: keyed([[0, 0], [0.15, -0.35], [0.6, -0.28], [1.0, 0]], 'x'),
          face_brow_R: keyed([[0, 0], [0.15, -0.35], [0.6, -0.28], [1.0, 0]], 'x'),
          face_cheek_L: keyed([[0, 0], [0.15, 0.08], [0.6, 0.06], [1.0, 0]], 'z'),
          face_cheek_R: keyed([[0, 0], [0.15, -0.08], [0.6, -0.06], [1.0, 0]], 'z'),
          face_mouth_L: keyed([[0, 0], [0.15, 0.08], [0.6, 0.06], [1.0, 0]], 'z'),
          face_mouth_R: keyed([[0, 0], [0.15, -0.08], [0.6, -0.06], [1.0, 0]], 'z')
        }
      },
      {
        name: 'Facial Look Around',
        duration: 3.0,
        tracks: {
          face_eye_L: keyed([[0, 0], [0.5, 0.35], [1.2, 0.35], [1.8, -0.3], [2.5, -0.3], [3.0, 0]], 'y'),
          face_eye_R: keyed([[0, 0], [0.5, 0.35], [1.2, 0.35], [1.8, -0.3], [2.5, -0.3], [3.0, 0]], 'y'),
          face_brow_L: keyed([[0, 0], [0.5, -0.06], [1.2, 0], [1.8, -0.04], [2.5, 0], [3.0, 0]], 'x'),
          face_brow_R: keyed([[0, 0], [0.5, -0.06], [1.2, 0], [1.8, -0.04], [2.5, 0], [3.0, 0]], 'x'),
          face_cheek_L: keyed([[0, 0], [0.5, 0.03], [1.2, 0], [1.8, 0.02], [2.5, 0], [3.0, 0]], 'z'),
          face_cheek_R: keyed([[0, 0], [0.5, -0.03], [1.2, 0], [1.8, -0.02], [2.5, 0], [3.0, 0]], 'z'),
          face_jaw: keyed([[0, 0], [1.5, 0.04], [3.0, 0]], 'x')
        }
      },
      {
        name: 'Facial Jaw Test',
        duration: 1.6,
        tracks: {
          face_jaw: keyed([[0, 0], [0.4, 0.45], [0.8, 0.45], [1.2, 0.05], [1.6, 0]], 'x')
        }
      },
      {
        name: 'Facial Smile',
        duration: 1.6,
        tracks: {
          face_cheek_L: keyed([[0, 0], [0.5, 0.16], [1.1, 0.12], [1.6, 0]], 'z'),
          face_cheek_R: keyed([[0, 0], [0.5, -0.16], [1.1, -0.12], [1.6, 0]], 'z'),
          face_mouth_L: keyed([[0, 0], [0.5, 0.22], [1.1, 0.16], [1.6, 0]], 'z'),
          face_mouth_R: keyed([[0, 0], [0.5, -0.22], [1.1, -0.16], [1.6, 0]], 'z'),
          face_lip_upper: keyed([[0, 0], [0.5, -0.05], [1.1, -0.03], [1.6, 0]], 'x'),
          face_lip_lower: keyed([[0, 0], [0.5, 0.04], [1.1, 0.02], [1.6, 0]], 'x'),
          face_brow_L: keyed([[0, 0], [0.5, -0.08], [1.1, -0.05], [1.6, 0]], 'x'),
          face_brow_R: keyed([[0, 0], [0.5, -0.08], [1.1, -0.05], [1.6, 0]], 'x'),
          face_jaw: keyed([[0, 0], [0.5, 0.03], [1.6, 0]], 'x')
        }
      }
    ]
  }
}

function keyed (values: Array<[number, number]>, axis: 'x' | 'y' | 'z'): RotationKey[] {
  return values.map(([time, value]) => ({ time, [axis]: value }))
}
