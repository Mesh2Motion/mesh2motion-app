import { type AnimationClip, type Object3D, type SkinnedMesh } from 'three'
import { BoneNamingStructure } from './DownloadSettings.ts'
import { MixamoMapper } from '../../../retarget/bone-automap/MixamoMapper.ts'

export class ExportBoneNamingService {
  public static apply_download_settings (
    skinned_meshes: SkinnedMesh[],
    animation_clips: AnimationClip[],
    bone_naming_structure: BoneNamingStructure
  ): () => void {
    if (bone_naming_structure !== BoneNamingStructure.Mixamo) {
      return () => {}
    }

    const renamed_bones = new Map<Object3D, string>()
    this.rename_bones_to_mixamo(skinned_meshes, renamed_bones)
    this.rename_animation_tracks_to_mixamo(animation_clips)

    return () => {
      renamed_bones.forEach((original_name, bone_object) => {
        bone_object.name = original_name
      })
    }
  }

  private static rename_bones_to_mixamo (skinned_meshes: SkinnedMesh[], renamed_bones: Map<Object3D, string>): void {
    skinned_meshes.forEach((skinned_mesh) => {
      skinned_mesh.traverse((scene_object) => {
        if (scene_object.type !== 'Bone') {
          return
        }

        const mixamo_name = MixamoMapper.map_source_bone_name_to_mixamo(scene_object.name)
        if (mixamo_name === undefined) {
          return
        }

        renamed_bones.set(scene_object, scene_object.name)
        scene_object.name = mixamo_name
      })
    })
  }

  private static rename_animation_tracks_to_mixamo (animation_clips: AnimationClip[]): void {
    animation_clips.forEach((clip) => {
      clip.tracks.forEach((track) => {
        track.name = this.rename_track_name_to_mixamo(track.name)
      })
    })
  }

  private static rename_track_name_to_mixamo (track_name: string): string {
    const first_dot = track_name.indexOf('.')
    if (first_dot > 0) {
      const node_path = track_name.slice(0, first_dot)
      const mapped_node_path = this.rename_node_path_to_mixamo(node_path)
      if (mapped_node_path !== node_path) {
        return `${mapped_node_path}${track_name.slice(first_dot)}`
      }
    }

    // handle PropertyBinding names like .bones[bone_name].quaternion
    return track_name.replace(/(\.bones\["?)([^\]"]+)("?\])/g, (match: string, prefix: string, bone_name: string, suffix: string) => {
      const mixamo_name = MixamoMapper.map_source_bone_name_to_mixamo(bone_name)
      if (mixamo_name === undefined) {
        return match
      }

      return `${prefix}${mixamo_name}${suffix}`
    })
  }

  private static rename_node_path_to_mixamo (node_path: string): string {
    const direct_mixamo_name = MixamoMapper.map_source_bone_name_to_mixamo(node_path)
    if (direct_mixamo_name !== undefined) {
      return direct_mixamo_name
    }

    const path_parts = node_path.split('/')
    const node_leaf_name = path_parts[path_parts.length - 1]
    const mapped_leaf_name = MixamoMapper.map_source_bone_name_to_mixamo(node_leaf_name)

    if (mapped_leaf_name === undefined) {
      return node_path
    }

    path_parts[path_parts.length - 1] = mapped_leaf_name
    return path_parts.join('/')
  }
}