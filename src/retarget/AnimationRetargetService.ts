import { AnimationClip, Euler, type Object3D, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack, type Scene, type Group, type SkinnedMesh } from 'three'
import { RetargetUtils } from './RetargetUtils.ts'
import { TargetBoneMappingType } from './steps/StepBoneMapping.ts'

/**
 * Parsed animation track name containing bone name and property type
 */
export interface TrackNameParts {
  bone_name: string
  property: string
}

/**
 * AnimationRetargetService - Shared service for retargeting animations from one skeleton to another
 * Used by both RetargetAnimationPreview and RetargetAnimationListing
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class AnimationRetargetService {
  /**
   * Retarget an animation clip using bone mappings
   * @param source_clip - The original animation clip from the source skeleton
   * @param bone_mappings - Map of target bone name -> source bone name
   * @param target_mapping_type - The type of target skeleton mapping (for applying corrections)
   * @param source_armature - The source skeleton armature (for bone rotation corrections)
   * @param target_skeleton_data - The target skeleton data (for bone rotation corrections)
   * @param target_skinned_meshes - The target skinned meshes (for finding bones)
   * @returns A new animation clip retargeted for the target skeleton
   */
  static retarget_animation_clip (
    source_clip: AnimationClip,
    bone_mappings: Map<string, string>,
    target_mapping_type: TargetBoneMappingType,
    source_armature: Group | null = null,
    target_skeleton_data: Scene | null = null,
    target_skinned_meshes: SkinnedMesh[] = []
  ): AnimationClip {
    const new_tracks: any[] = [] // store new retargeted tracks

    // Process each track in the source animation
    source_clip.tracks.forEach((track) => {
      // Parse the track name to get the bone name and property
      // Track names are typically in format: "boneName.property" or ".bones[boneName].property"
      const track_parts: TrackNameParts | null = this.parse_track_name_for_metadata(track.name)
      if (track_parts === null) {
        return
      }

      // Check if this bone is mapped to any target bones
      const target_bone_names = this.reverse_bone_mapping(bone_mappings).get(track_parts.bone_name)
      if (target_bone_names === undefined || target_bone_names.length === 0) {
        return // Skip unmapped bones
      }

      // Create a track for each target bone this source bone maps to. Will mostly just rename
      // a bone with the mapping
      target_bone_names.forEach((target_bone_name) => {
        const new_track_name = RetargetUtils.create_track_name(target_bone_name, track_parts.property)

        if (track_parts.property === 'quaternion') {
          const new_track = new QuaternionKeyframeTrack(new_track_name, track.times.slice(), track.values.slice())
          new_tracks.push(new_track)
        } else if (track_parts.property === 'position' || track_parts.property === 'scale') {
          const new_track = new VectorKeyframeTrack(new_track_name, track.times.slice(), track.values.slice())
          new_tracks.push(new_track)
        } else {
          console.warn('This track contains unsupported property for retargeting:', track_parts.property)
        }
      })
    })

    // Create the retargeted animation clip
    const retargeted_clip = new AnimationClip(`${source_clip.name}`, source_clip.duration, new_tracks)

    // Apply Mixamo-specific corrections if needed
    if (target_mapping_type === TargetBoneMappingType.Mixamo) {
      this.apply_bone_rotation_correction(
        retargeted_clip,
        bone_mappings,
        source_armature,
        target_skeleton_data,
        target_skinned_meshes
      )
    }

    console.log(`Retargeted animation: ${source_clip.name} (${new_tracks.length} tracks)`)
    return retargeted_clip
  }

  /**
   * Create a reverse mapping: source bone name -> array of target bone names
   */
  private static reverse_bone_mapping (bone_mappings: Map<string, string>): Map<string, string[]> {
    const reverse_mappings = new Map<string, string[]>()
    bone_mappings.forEach((source_bone_name, target_bone_name) => {
      if (!reverse_mappings.has(source_bone_name)) {
        reverse_mappings.set(source_bone_name, [])
      }
      const target_list = reverse_mappings.get(source_bone_name)
      if (target_list !== undefined) {
        target_list.push(target_bone_name)
      }
    })
    return reverse_mappings
  }

  /**
   * Apply bone rotation correction for fixing bone roll delta between target and source skeleton
   */
  private static apply_bone_rotation_correction (
    animation_clip: AnimationClip,
    bone_mappings: Map<string, string>,
    source_armature: Group | null,
    target_skeleton_data: Scene | null,
    target_skinned_meshes: SkinnedMesh[]
  ): void {
    bone_mappings.forEach((source_bone_name, target_bone_name) => {
      const delta = this.calculate_bone_rotation_delta(
        source_bone_name,
        target_bone_name,
        source_armature,
        target_skeleton_data,
        target_skinned_meshes
      )

      if (delta !== null) {
        const delta_euler = new Euler().setFromQuaternion(delta)

        this.rotate_bone_for_retargeting(animation_clip, [target_bone_name], delta_euler)
      } else {
        console.log(`Warning: delta is NULL when fixing bone roll. Skipping correction for bone: ${target_bone_name}`)
      }
    })

    console.log('Applied Mixamo-specific corrections to retargeted animation (dynamically calculated)', animation_clip)
  }

  /**
   * Calculate the bone roll delta between source and target bones in bind pose
   * Bone roll is the rotation around the bone's primary axis (Y-axis in Three.js)
   * @param source_bone_name - Name of the bone in the source skeleton
   * @param target_bone_name - Name of the bone in the target skeleton
   * @param source_armature - The source skeleton armature
   * @param target_skeleton_data - The target skeleton data
   * @param target_skinned_meshes - The target skinned meshes
   * @returns The rotation difference as a quaternion (Y-axis only), or null if bones not found
   */
  private static calculate_bone_rotation_delta (
    source_bone_name: string,
    target_bone_name: string,
    source_armature: Group | null,
    target_skeleton_data: Scene | null,
    target_skinned_meshes: SkinnedMesh[]
  ): Quaternion | null {
    if (source_armature === null || target_skeleton_data === null) {
      console.warn('Cannot calculate rotation delta: missing skeleton data')
      return null
    }

    // Find source bone and target bone with normalized matching
    const source_bone = this.find_bone_by_name(source_armature, [], source_bone_name)
    const target_bone = this.find_bone_by_name(target_skeleton_data, target_skinned_meshes, target_bone_name)

    if (source_bone === null || target_bone === null) {
      const source_label = source_bone === null ? 'null' : source_bone.name
      const target_label = target_bone === null ? 'null' : target_bone.name
      console.debug(`Cannot calculate rotation delta: bone not found (source: ${source_bone_name}=${source_label}, target: ${target_bone_name}=${target_label})`)
      return null
    }

    // Local-space bind pose quaternions
    const source_quat = new Quaternion().copy(source_bone.quaternion)
    const target_quat = new Quaternion().copy(target_bone.quaternion)

    // Relative local delta (target -> source)
    const full_delta_quat = target_quat.clone().invert().multiply(source_quat)

    // Extract only the twist around local Y (bone roll) via swing–twist decomposition
    const axis_y = new Vector3(0, 1, 0)
    const v = new Vector3(full_delta_quat.x, full_delta_quat.y, full_delta_quat.z)
    const proj = axis_y.clone().multiplyScalar(v.dot(axis_y))
    const twist_y = new Quaternion(proj.x, proj.y, proj.z, full_delta_quat.w).normalize()

    return twist_y
  }

  /**
   * Apply rotations to specific bones to correct them and normalize them for Mesh2Motion animations
   */
  private static rotate_bone_for_retargeting (
    animation_clip: AnimationClip,
    bone_match_pattern: string[],
    rotate_obj: Euler
  ): void {
    // Find all shoulder quaternion tracks (e.g., mixamorigLeftShoulder.quaternion)
    const tracks_to_change = animation_clip.tracks.filter(track =>
      bone_match_pattern.some(pattern => track.name.toLowerCase().includes(pattern.toLowerCase())) && track.name.includes('quaternion')
    ) as Array<{ name: string, times: Float32Array | number[], values: Float32Array | number[] }>

    if (tracks_to_change.length === 0) return

    // Object axis rotation amount. Final value is quaternion
    const rotation_amount: Quaternion = new Quaternion().setFromEuler(rotate_obj)

    for (const track of tracks_to_change) {
      const name_info = this.parse_track_name_for_metadata(track.name)
      if (name_info === null) continue

      const values = track.values
      for (let i = 0; i < values.length; i += 4) {
        const original_quat: Quaternion = new Quaternion(
          values[i], // x
          values[i + 1], // y
          values[i + 2], // z
          values[i + 3] // w
        )

        // apply local-space correction
        original_quat.multiply(rotation_amount)

        values[i] = original_quat.x
        values[i + 1] = original_quat.y
        values[i + 2] = original_quat.z
        values[i + 3] = original_quat.w
      }
    }
  }

  /**
   * Find a bone by name in the skeleton hierarchy
   */
  private static find_bone_by_name (
    root: Object3D,
    skinned_meshes: SkinnedMesh[],
    bone_name: string
  ): Object3D | null {
    let found_bone: Object3D | null = null

    root.traverse((child) => {
      if (found_bone !== null) return
      if (child.name === bone_name) {
        found_bone = child
      }
    })

    if (found_bone !== null) return found_bone

    skinned_meshes.forEach((mesh) => {
      if (found_bone !== null) return
      const match = mesh.skeleton?.bones.find((bone) => bone.name === bone_name)
      if (match !== undefined) {
        found_bone = match
      }
    })

    return found_bone
  }

  /**
   * Parse a track name to extract bone name and property (e.g., "quaternion", "position", "scale")
   * Handles various formats like "boneName.property" or ".bones[boneName].property"
   */
  private static parse_track_name_for_metadata (track_name: string): TrackNameParts | null {
    // Try format: "boneName.property"
    const simple_match = track_name.match(/^([^.]+)\.(.+)$/)
    if (simple_match !== null) {
      return {
        bone_name: simple_match[1],
        property: simple_match[2]
      }
    }

    // Try format: ".bones[boneName].property"
    const bones_match = track_name.match(/\.bones\[([^\]]+)\]\.(.+)$/)
    if (bones_match !== null) {
      return {
        bone_name: bones_match[1],
        property: bones_match[2]
      }
    }

    return null
  }
}
