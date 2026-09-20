import { Scene, type AnimationClip, type Object3D, type SkinnedMesh } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import { AnimationRetargetService } from '../AnimationRetargetService'
import { AnimationUtility } from '../../lib/processes/animations-listing/AnimationUtility'
import { type AnimationExportSelection } from '../../lib/processes/animations-listing/interfaces/AnimationExportSelection'
import { type DownloadSettings, ExportContents, ExportFormat, type FbxExportPreset } from '../../lib/processes/export-to-file/DownloadSettings'
import { ExportBoneNamingService } from '../../lib/processes/export-to-file/ExportBoneNamingService'
import { ExportHierarchyService } from '../../lib/processes/export-to-file/ExportHierarchyService'
import { ExportAnimationCleanupService } from '../../lib/processes/export-to-file/ExportAnimationCleanupService'
import { GlbSkinCleanupService } from '../../lib/processes/export-to-file/GlbSkinCleanupService'
import { GlbTexturePassthroughService, type TexturePassthroughPlan } from '../../lib/processes/export-to-file/GlbTexturePassthroughService'
import { FbxTextureCompatibilityService } from '../../lib/processes/export-to-file/FbxTextureCompatibilityService'

export class StepExportRetargetedAnimations extends EventTarget {
  public animation_clips_to_export: AnimationClip[] = []
  private readonly fbx_exporter: FBXExporter = new FBXExporter()

  public set_animation_clips_to_export (all_animations_clips: AnimationClip[], export_selections: AnimationExportSelection[]): void {
    this.animation_clips_to_export = []
    export_selections.forEach((selection) => {
      const source_clip: AnimationClip | undefined = all_animations_clips[selection.animation_index]
      if (source_clip === undefined) {
        return
      }

      if (selection.mirror_export_mode === 'none') {
        this.animation_clips_to_export.push(source_clip.clone())
        return
      }

      if (selection.mirror_export_mode === 'mirrored') {
        this.animation_clips_to_export.push(AnimationUtility.create_mirrored_clip(source_clip))
        return
      }

      // Export both normal and mirrored variants.
      this.animation_clips_to_export.push(source_clip.clone())
      this.animation_clips_to_export.push(AnimationUtility.create_mirrored_clip(source_clip))
    })
  }

  public async export (filename = 'exported_model', download_settings: DownloadSettings): Promise<void> {
    if (this.animation_clips_to_export.length === 0) {
      console.log('ERROR: No animation clips added to export')
      throw new Error('No animation clips added to export')
    }

    // Retarget all animation clips before export
    const retargeted_clips: AnimationClip[] = this.animation_clips_to_export.map((clip) => {
      const retargeted_clip = AnimationRetargetService.getInstance().retarget_animation_clip(clip)
      retargeted_clip.name = retargeted_clip.name.replace(/\s+/g, '_')
      return retargeted_clip
    })
    console.log('Retargeted animation clips:', retargeted_clips)

    const target_skinned_meshes: SkinnedMesh[] = AnimationRetargetService.getInstance().get_target_skinned_meshes()
    await this.export_with_settings(target_skinned_meshes, retargeted_clips, filename, download_settings)
  }

  public async export_with_settings (
    skinned_meshes: SkinnedMesh[],
    animations_to_export: AnimationClip[],
    file_name: string,
    download_settings: DownloadSettings
  ): Promise<void> {
    const export_scene = new Scene()

    const restore_bone_names = ExportBoneNamingService.apply_download_settings(
      skinned_meshes,
      animations_to_export,
      download_settings.bone_naming_structure()
    )

    const skeleton_only = download_settings.export_contents() === ExportContents.Skeleton
    const objects_to_export: Object3D[] = ExportHierarchyService.collect_objects_to_export(skinned_meshes, skeleton_only)

    // The base animation data can contain tracks for joints the target skeleton does not
    // have, and keyframe times can contain float32 duplicates that glTF validators reject.
    // This runs after bone renaming so the track names match the final bone names.
    ExportAnimationCleanupService.clean_clips_for_export(animations_to_export, objects_to_export)

    const original_parents = new Map<Object3D, Object3D | null>()

    objects_to_export.forEach((object_to_export) => {
      original_parents.set(object_to_export, object_to_export.parent)
      export_scene.add(object_to_export)
    })

    try {
      await this.export_scene(
        export_scene,
        animations_to_export,
        file_name,
        download_settings.export_format(),
        download_settings.fbx_export_preset()
      )
    } finally {
      objects_to_export.forEach((exported_object) => {
        const original_parent = original_parents.get(exported_object)
        if (original_parent != null) {
          original_parent.add(exported_object)
        } else {
          export_scene.remove(exported_object)
        }
      })

      restore_bone_names()
    }
  }

  public async export_scene (
    exported_scene: Scene,
    animations_to_export: AnimationClip[],
    file_name: string,
    export_format: ExportFormat,
    fbx_export_preset: FbxExportPreset
  ): Promise<void> {
    if (export_format === ExportFormat.FBX) {
      await this.export_fbx(exported_scene, animations_to_export, file_name, fbx_export_preset)
      return
    }

    await this.export_glb(exported_scene, animations_to_export, file_name)
  }

  public async export_glb (exported_scene: Scene, animations_to_export: AnimationClip[], file_name: string): Promise<void> {
    // GLTFExporter re-encodes every texture through a 2D canvas, which is lossy.
    // Marking the textures here lets the original image bytes be put back afterwards.
    const texture_passthrough = GlbTexturePassthroughService.prepare_scene(exported_scene)

    try {
      await this.parse_and_save_glb(exported_scene, animations_to_export, file_name, texture_passthrough)
    } finally {
      texture_passthrough.restore()
    }
  }

  private async parse_and_save_glb (
    exported_scene: Scene,
    animations_to_export: AnimationClip[],
    file_name: string,
    texture_passthrough: TexturePassthroughPlan
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const gltf_exporter = new GLTFExporter()

      const export_options = {
        binary: true,
        onlyVisible: false,
        embedImages: true,
        animations: animations_to_export
      }

      gltf_exporter.parse(
        exported_scene,
        (result: ArrayBuffer | { [key: string]: unknown }) => {
          // Handle the result of the export
          if (result instanceof ArrayBuffer) {
            const cleaned_result = GlbSkinCleanupService.remove_skin_skeleton_properties(result)
            const original_textures_result = GlbTexturePassthroughService.apply_original_textures(
              cleaned_result, texture_passthrough.marked_textures)
            this.save_array_buffer(original_textures_result, `${file_name}.glb`)
            resolve() // Resolve the promise when the export is complete
          } else {
            console.log('ERROR: result is not an instance of ArrayBuffer')
            reject(new Error('Export result is not an ArrayBuffer'))
          }
        },
        (error: unknown) => {
          console.log('An error happened during parsing', error)
          reject(error) // Reject the promise if an error occurs
        },
        export_options
      )
    })
  }

  public async export_fbx (
    exported_scene: Scene,
    animations_to_export: AnimationClip[],
    file_name: string,
    fbx_export_preset: FbxExportPreset
  ): Promise<void> {
    exported_scene.animations = animations_to_export
    const texture_compatibility_session = new FbxTextureCompatibilityService(exported_scene)

    try {
      const result = await this.fbx_exporter.parseAsync(exported_scene, {
        preset: fbx_export_preset,
        includeAnimations: true,
        animations: animations_to_export,
        onlyVisible: false,
        embedTextures: true
      })

      this.save_uint8_array(result, `${file_name}.fbx`)
    } finally {
      texture_compatibility_session.restore()
      exported_scene.animations = []
    }
  }

  private save_file (blob: Blob, filename: string): void {
    const export_button_hidden_link: HTMLAnchorElement | null = document.querySelector('#download-hidden-link')
    if (export_button_hidden_link != null) {
      export_button_hidden_link.href = URL.createObjectURL(blob)
      export_button_hidden_link.download = filename
      export_button_hidden_link.click()
    } else {
      console.log('ERROR: dom_export_button_hidden_link is null')
    }
  }

  // used for GLB to turn content into a byte array for saving
  private save_array_buffer (buffer: ArrayBuffer, filename: string): void {
    this.save_file(new Blob([buffer], { type: 'application/octet-stream' }), filename)
  }

  private save_uint8_array (buffer: Uint8Array, filename: string): void {
    this.save_file(new Blob([buffer], { type: 'application/octet-stream' }), filename)
  }
}
