import { type Group, type Object3D, type Object3DEventMap, type Scene, type SkinnedMesh } from 'three'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'

export class StepBoneMapping extends EventTarget {
  private readonly _main_scene: Scene
  private source_skeleton_data: Group<Object3DEventMap> | null = null
  private target_armature: Object3D | null = null
  private target_skeleton_type: SkeletonType = SkeletonType.None

  // DOM references
  private bone_mapping_container: HTMLDivElement | null = null
  private source_bones_list: HTMLDivElement | null = null
  private target_bones_list: HTMLDivElement | null = null

  constructor (main_scene: Scene) {
    super()
    this._main_scene = main_scene // might not need this, but keeping for now
  }

  public begin (): void {
    // Get DOM references
    this.bone_mapping_container = document.getElementById('bone-mapping-container') as HTMLDivElement
    this.source_bones_list = document.getElementById('source-bones-list') as HTMLDivElement
    this.target_bones_list = document.getElementById('target-bones-list') as HTMLDivElement

    // Show the bone mapping UI
    this.show_bone_mapping_ui()

    // Populate the lists
    this.update_bone_lists()
  }

  public set_source_skeleton_data (skeleton_data: Group<Object3DEventMap>): void {
    this.source_skeleton_data = skeleton_data
    console.log('Source skeleton data set in bone mapping:', this.source_skeleton_data)
  }

  public set_target_skeleton_data (armature: Object3D, skeleton_type: SkeletonType): void {
    this.target_armature = armature
    this.target_skeleton_type = skeleton_type
    console.log('Target skeleton data set in bone mapping:', this.target_armature, 'Type:', this.target_skeleton_type)
  }

  public has_source_skeleton (): boolean {
    return this.source_skeleton_data !== null
  }

  public has_target_skeleton (): boolean {
    return this.target_armature !== null
  }

  public has_both_skeletons (): boolean {
    return this.has_source_skeleton() && this.has_target_skeleton()
  }

  // Getters
  public get_source_skeleton_data (): Group<Object3DEventMap> | null {
    return this.source_skeleton_data
  }

  public get_target_armature (): Object3D | null {
    return this.target_armature
  }

  public get_target_skeleton_type (): SkeletonType {
    return this.target_skeleton_type
  }

  // Extract bone names from source skeleton
  public get_source_bone_names (): string[] {
    if (this.source_skeleton_data === null) {
      return []
    }

    const bone_names: string[] = []
    // Source skeleton data contains SkinnedMesh objects with skeleton property
    this.source_skeleton_data.traverse((child) => {
      if (child.type === 'SkinnedMesh') {
        const skinned_mesh = child as SkinnedMesh
        const skeleton = skinned_mesh.skeleton
        skeleton.bones.forEach((bone) => {
          bone_names.push(bone.name)
        })
      }
    })

    return bone_names
  }

  // Extract bone names from target skeleton
  public get_target_bone_names (): string[] {
    if (this.target_armature === null) {
      return []
    }

    const bone_names: string[] = []
    this.target_armature.traverse((child) => {
      if (child.type === 'Bone') {
        bone_names.push(child.name)
      }
    })

    return bone_names
  }

  // Update UI with current bone lists
  public update_bone_lists (): void {
    this.update_source_bones_list()
    this.update_target_bones_list()
  }

  private update_source_bones_list (): void {
    if (this.source_bones_list === null) return

    const bone_names = this.get_source_bone_names()
    if (bone_names.length === 0) {
      this.source_bones_list.innerHTML = '<p style="color: #888;">No source skeleton loaded</p>'
      return
    }

    this.source_bones_list.innerHTML = ''
    bone_names.forEach((name) => {
      const bone_item = document.createElement('div')
      bone_item.textContent = name
      bone_item.style.padding = '0.5rem'
      bone_item.style.borderBottom = '1px solid #eee'
      this.source_bones_list?.appendChild(bone_item)
    })
  }

  private update_target_bones_list (): void {
    if (this.target_bones_list === null) return

    const bone_names = this.get_target_bone_names()
    if (bone_names.length === 0) {
      this.target_bones_list.innerHTML = '<p style="color: #888;">No target skeleton loaded</p>'
      return
    }

    this.target_bones_list.innerHTML = ''
    bone_names.forEach((name) => {
      const bone_item = document.createElement('div')
      bone_item.textContent = name
      bone_item.style.padding = '0.5rem'
      bone_item.style.borderBottom = '1px solid #eee'
      this.target_bones_list?.appendChild(bone_item)
    })
  }

  private show_bone_mapping_ui (): void {
    if (this.bone_mapping_container !== null) {
      this.bone_mapping_container.style.display = 'block'
    }
  }

  private hide_bone_mapping_ui (): void {
    if (this.bone_mapping_container !== null) {
      this.bone_mapping_container.style.display = 'none'
    }
  }
}
