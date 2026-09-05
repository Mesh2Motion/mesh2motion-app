import { UI } from '../../UI.ts'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { FBXExporter } from '@comfyorg/fbx-exporter-three'
import { type AnimationClip, Scene, type SkinnedMesh, type Object3D } from 'three'
import { type DownloadSettings, ExportContents, ExportFormat, type FbxExportPreset } from './DownloadSettings.ts'
import { ExportBoneNamingService } from './ExportBoneNamingService.ts'
import { ExportHierarchyService } from './ExportHierarchyService.ts'
import { ExportAnimationCleanupService } from './ExportAnimationCleanupService.ts'
import { GlbSkinCleanupService } from './GlbSkinCleanupService.ts'
import { GlbTexturePassthroughService, type TexturePassthroughPlan } from './GlbTexturePassthroughService.ts'
import { AnimationUtility } from '../animations-listing/AnimationUtility.ts'
import { type AnimationExportSelection } from '../animations-listing/interfaces/AnimationExportSelection.ts'
import { FbxTextureCompatibilityService } from './FbxTextureCompatibilityService.ts'

// Note: EventTarget is a built-in interface and do not need to import it
export class StepExportToFile extends EventTarget {
  private readonly ui: UI = UI.getInstance()
  private animation_clips_to_export: AnimationClip[] = []
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

  public export (
    skinned_meshes: SkinnedMesh[], 
    filename: string = 'exported_model',
    download_settings: DownloadSettings): Promise<void> {

    if (this.animation_clips_to_export.length === 0) {
      console.log('ERROR: No animation clips added to export')
      return Promise.reject(new Error('No animation clips added to export'))
    }

    const export_scene = new Scene()

    const export_clips = this.animation_clips_to_export.map((clip) => {
      const cloned_clip = clip.clone()
      // Make action names consistent by replacing any whitespace with underscores
      cloned_clip.name = cloned_clip.name.replace(/\s+/g, '_')
      return cloned_clip
    })

    // Apply bone naming before re-parenting: the service traverses each skinned mesh to
    // find its bones, which are still children of the mesh at this point.
    const restore_bone_names = ExportBoneNamingService.apply_download_settings(
      skinned_meshes,
      export_clips,
      download_settings.bone_naming_structure()
    )

    // "Skeleton only" exports just the bone hierarchy (the root bone subtree that hangs off
    // each skinned mesh) instead of the full skinned mesh, which excludes the mesh geometry.
    // The animation clips still target the bone names, so the selected animations continue
    // to work against the exported skeleton.
    const skeleton_only = download_settings.export_contents() === ExportContents.Skeleton
    const objects_to_export: Object3D[] = ExportHierarchyService.collect_objects_to_export(skinned_meshes, skeleton_only)

    // The base animation data can contain tracks for joints the user removed (e.g. fingers),
    // and keyframe times can contain float32 duplicates that glTF validators reject.
    // This runs after bone renaming so the track names match the final bone names.
    ExportAnimationCleanupService.clean_clips_for_export(export_clips, objects_to_export)

    // When exporting to a file, we need to temporarily move the exported objects to a new
    // scene. An object can only be part of one scene at a time, so we must move it back to
    // its original parent after exporting. For a skeleton-only export, the root bone's
    // original parent is its skinned mesh.
    const original_parents = new Map<Object3D, Object3D | null>()

    objects_to_export.forEach((object_to_export) => {
      // Save the original parent
      original_parents.set(object_to_export, object_to_export.parent)
      export_scene.add(object_to_export)
    })

    console.log('SKINNED MESH DATA TO EXPORT:', skinned_meshes)
    console.log('animations to export', export_clips)

    return this.export_scene(
      export_scene,
      export_clips,
      filename,
      download_settings.export_format(),
      download_settings.fbx_export_preset()
    )
      .then(() => {
        // Move the exported objects back to their original parents
        objects_to_export.forEach((exported_object) => {
          const original_par = original_parents.get(exported_object)
          if (original_par != null) {
            original_par.add(exported_object)
          } else {
            // If there was no original parent, remove it from the scene
            export_scene.remove(exported_object)
            console.log('ERROR: No original parent found for exported object when exporting and re-parenting to original scene')
          }
        })

        restore_bone_names()
      })
      .catch((error) => {
        console.log('Error exporting file:', error)

        restore_bone_names()

        throw error
      })
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
        (result: ArrayBuffer) => {
          // Handle the result of the export
          if (result !== null) {
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
        (error: any) => {
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
    if (this.ui.dom_export_button_hidden_link != null) {
      this.ui.dom_export_button_hidden_link.href = URL.createObjectURL(blob)
      this.ui.dom_export_button_hidden_link.download = filename
      this.ui.dom_export_button_hidden_link.click()
    } else {
      console.log('ERROR: dom_export_button_hidden_link is null')
    }
  }

  // used for GLB to turn content into a byte array for saving
  private save_array_buffer (buffer: ArrayBuffer, filename: string): void {
    this.save_file(new Blob([buffer], { type: 'application/octet-stream' }), filename)
  }

  // used for FBX exporter to turn content into a byte array for saving
  private save_uint8_array (buffer: Uint8Array, filename: string): void {
    this.save_file(new Blob([buffer], { type: 'application/octet-stream' }), filename)
  }
}
