import { type Scene, type SkinnedMesh } from 'three'
import { BoneAutoMapper } from '../bone-automap/BoneAutoMapper.ts'
import { MixamoMapper } from '../bone-automap/MixamoMapper.ts'
import { RigifyMapper } from '../bone-automap/RigifyMapper.ts'
import { AnimationRetargetService } from '../AnimationRetargetService.ts'
import { Mesh2MotionMapper } from '../bone-automap/Mesh2MotionMapper.ts'

// when we are auto-mapping, keep track of what rig type we matched target against
export enum TargetBoneMappingType {
  Mixamo = 'mixamo',
  Rigify = 'rigify',
  Mesh2Motion = 'mesh2motion',
  Custom = 'custom', // trying to figure out bone mappings with bone name analysis
  None = 'none'
  // TODO: Add more types later
}

export class StepBoneMapping extends EventTarget {
  // DOM references
  private source_bones_list: HTMLDivElement | null = null
  private source_bones_filter: HTMLInputElement | null = null
  private target_bones_list: HTMLDivElement | null = null
  private target_bones_filter: HTMLInputElement | null = null
  private clear_mappings_button: HTMLButtonElement | null = null
  private auto_map_button: HTMLButtonElement | null = null
  private view_bone_tree_button: HTMLButtonElement | null = null
  private source_bone_count: HTMLSpanElement | null = null
  private target_bone_count: HTMLSpanElement | null = null
  private auto_bone_map_match_display: HTMLSpanElement | null = null

  // Bone mapping: target bone name (uploaded mesh) -> source bone name (Mesh2Motion skeleton)
  // private bone_mapping = new Map<string, string>()

  // Track if event listeners have been added
  private has_added_event_listeners: boolean = false

  public begin (): void {
    // Get DOM references
    this.source_bones_list = document.getElementById('source-bones-list') as HTMLDivElement
    this.source_bones_filter = document.getElementById('source-bones-filter') as HTMLInputElement
    this.target_bones_list = document.getElementById('target-bones-list') as HTMLDivElement
    this.target_bones_filter = document.getElementById('target-bones-filter') as HTMLInputElement
    this.clear_mappings_button = document.getElementById('clear-mappings-button') as HTMLButtonElement
    this.auto_map_button = document.getElementById('auto-map-button') as HTMLButtonElement
    this.view_bone_tree_button = document.getElementById('view-bone-tree-button') as HTMLButtonElement

    // if we get a match, show what type of match we got on the UI for feedback
    this.auto_bone_map_match_display = document.getElementById('auto-bone-map-match') as HTMLSpanElement

    // for display only on the bones list for reference
    this.source_bone_count = document.getElementById('source-bone-count') as HTMLSpanElement
    this.target_bone_count = document.getElementById('target-bone-count') as HTMLSpanElement

    this.add_event_listeners()

    // Populate the lists
    this.update_bone_lists()
    this.update_clear_button_visibility()
    this.update_auto_map_button_visibility()
    this.update_view_bone_tree_button_visibility()
  }

  private add_event_listeners (): void {
    if (!this.has_added_event_listeners) {
      // Add event listener for clear mappings button
      this.clear_mappings_button?.addEventListener('click', () => {
        this.clear_all_bone_mappings()
        console.log('All bone mappings cleared')
      })

      // Add event listener for auto-map button
      this.auto_map_button?.addEventListener('click', () => {
        this.auto_map_bones()
      })

      // Filter source bones as user types
      this.source_bones_filter?.addEventListener('input', () => {
        this.update_source_bones_list()
      })

      // Filter target bones as user types
      this.target_bones_filter?.addEventListener('input', () => {
        this.update_target_bones_list()
      })

      this.has_added_event_listeners = true
    }
  }

  public source_armature_updated (): void {
    this.update_source_bones_list()
    this.update_auto_map_button_visibility()
  }

  public target_armature_updated (): void {
    this.update_target_bones_list()
    this.update_auto_map_button_visibility()
    this.update_view_bone_tree_button_visibility()
  }

  public has_source_skeleton (): boolean {
    // if the source armature is an empty Group, we consider it as not having a skeleton
    if (AnimationRetargetService.getInstance().get_source_armature()?.children.length === 0) {
      return false
    }

    return true
  }

  public has_target_skeleton (): boolean {
    // if the target armature has no children, we consider it as not having a skeleton
    if (AnimationRetargetService.getInstance().get_target_armature()?.children.length === 0) {
      return false
    }

    return true
  }

  public has_both_skeletons (): boolean {
    return this.has_source_skeleton() && this.has_target_skeleton()
  }

  // Getters
  public get_target_skeleton_data (): Scene | null {
    return AnimationRetargetService.getInstance().get_target_armature()
  }

  // Extract bone names from source skeleton (Mesh2Motion skeleton)
  public get_source_bone_names (): string[] {
    if (AnimationRetargetService.getInstance().get_source_armature() === null) {
      return []
    }

    const bone_names: string[] = []
    AnimationRetargetService.getInstance().get_source_armature()?.traverse((child) => {
      if (child.type === 'Bone') {
        bone_names.push(child.name)
      }
    })

    return bone_names.sort()
  }

  // Extract bone names from target skeleton (uploaded mesh)
  public get_target_bone_names (): string[] {
    const target_armature: SkinnedMesh[] = AnimationRetargetService.getInstance().get_target_skinned_meshes()

    // when we first load the page, the target skinned mesh will be empty.
    // this is expeted, so just return an empty list
    if (target_armature.length === 0) {
      return []
    }

    // Keep unique bone names only
    // It is common that multiple SkinnedMesh share the same skeleton, so bones may be duplicated
    // we only need unique names for mapping. The Mixamo default model rig is a good example of this.
    const bone_names_set = new Set<string>()

    // Target skeleton data contains SkinnedMesh objects with skeleton property
    // Use Set to avoid duplicates when multiple SkinnedMesh share the same skeleton
    target_armature.forEach((skinned_mesh) => {
      skinned_mesh.skeleton.bones.forEach((bone) => {
        bone_names_set.add(bone.name)
      })
    })

    return Array.from(bone_names_set).sort()
  }

  // Update UI with current bone lists
  public update_bone_lists (): void {
    this.update_source_bones_list()
    this.update_target_bones_list()
  }

  private update_source_bones_list (): void {
    if (this.source_bones_list === null) return

    const source_bone_names = this.get_source_bone_names()

    // Update bone count display
    if (this.source_bone_count !== null) {
      this.source_bone_count.textContent = `${source_bone_names.length}`
    }

    if (source_bone_names.length === 0) {
      this.source_bones_list.innerHTML = '<em>No source skeleton loaded</em>'
      return
    }

    this.source_bones_list.innerHTML = ''

    const source_filter_value = this.source_bones_filter?.value.trim().toLowerCase() ?? ''
    const filtered_source_bone_names = source_filter_value === ''
      ? source_bone_names
      : source_bone_names.filter((bone_name) => bone_name.toLowerCase().includes(source_filter_value))

    if (filtered_source_bone_names.length === 0) {
      this.source_bones_list.innerHTML = '<em>No matching source bones</em>'
      return
    }

    filtered_source_bone_names.forEach((name) => {
      const bone_item = document.createElement('div')
      bone_item.textContent = name
      bone_item.className = 'bone-item bone-item-source'

      // Make the bone draggable (source bones from Mesh2Motion skeleton)
      bone_item.draggable = true
      bone_item.dataset.boneName = name

      // Add drag event listeners
      bone_item.addEventListener('dragstart', this.handle_drag_start.bind(this))
      bone_item.addEventListener('dragend', this.handle_drag_end.bind(this))

      this.source_bones_list?.appendChild(bone_item)
    })
  }

  private update_target_bones_list (): void {
    if (this.target_bones_list === null) return

    const target_bone_names = this.get_target_bone_names()

    // Update bone count display
    if (this.target_bone_count !== null) {
      this.target_bone_count.textContent = `${target_bone_names.length}`
    }

    if (target_bone_names.length === 0) {
      this.target_bones_list.innerHTML = '<em>No target skeleton loaded</em>'
      return
    }

    this.target_bones_list.innerHTML = ''

    const target_filter_value = this.target_bones_filter?.value.trim().toLowerCase() ?? ''
    const filtered_target_bone_names = target_filter_value === ''
      ? target_bone_names
      : target_bone_names.filter((bone_name) => bone_name.toLowerCase().includes(target_filter_value))

    if (filtered_target_bone_names.length === 0) {
      this.target_bones_list.innerHTML = '<em>No matching target bones</em>'
      return
    }

    const bone_mappings: Map<string, string> = AnimationRetargetService.getInstance().get_bone_mappings()
    filtered_target_bone_names.forEach((name) => {
      const bone_item = document.createElement('div')
      bone_item.className = 'bone-item bone-item-target'
      bone_item.dataset.targetBoneName = name

      const mapped_source_bone = bone_mappings.get(name)
      if (mapped_source_bone !== undefined) {
        const source_name_span = document.createElement('span')
        source_name_span.textContent = mapped_source_bone
        source_name_span.className = 'mapping-source-name'

        const target_name_span = document.createElement('span')
        target_name_span.textContent = name

        bone_item.appendChild(source_name_span)
        bone_item.appendChild(target_name_span)

        const remove_button = document.createElement('button')
        remove_button.textContent = '✕'
        remove_button.className = 'remove-mapping-button secondary-button'
        remove_button.title = 'Remove this mapping'
        remove_button.addEventListener('click', (event) => {
          event.stopPropagation()
          this.clear_bone_mapping(name)
        })
        bone_item.appendChild(remove_button)
      } else {
        bone_item.textContent = name
      }

      bone_item.addEventListener('dragover', this.handle_drag_over.bind(this))
      bone_item.addEventListener('dragleave', this.handle_drag_leave.bind(this))
      bone_item.addEventListener('drop', this.handle_drop.bind(this))

      this.target_bones_list?.appendChild(bone_item)
    })
  }

  // Drag and drop event handlers
  private handle_drag_start (event: DragEvent): void {
    const target = event.currentTarget as HTMLElement
    const bone_name = target.dataset.boneName

    if (bone_name !== undefined && event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData('text/plain', bone_name)
      target.classList.add('dragging')
    }
  }

  private handle_drag_end (event: DragEvent): void {
    const target = event.currentTarget as HTMLElement
    target.classList.remove('dragging')
  }

  private handle_drag_over (event: DragEvent): void {
    event.preventDefault() // Allow drop
    const target = event.currentTarget as HTMLElement

    // Visual feedback for drop zone
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'copy'
    }
    target.classList.add('drag-over')
  }

  private handle_drag_leave (event: DragEvent): void {
    const target = event.currentTarget as HTMLElement
    target.classList.remove('drag-over')
  }

  private handle_drop (event: DragEvent): void {
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    target.classList.remove('drag-over')

    if (event.dataTransfer !== null) {
      const source_bone_name = event.dataTransfer.getData('text/plain')
      const target_bone_name = target.dataset.targetBoneName

      if (source_bone_name !== '' && target_bone_name !== undefined) {
        // Manual drag/drop means we are using custom mappings, not an auto-map preset.
        AnimationRetargetService.getInstance().set_target_mapping_type(TargetBoneMappingType.Custom)

        // Update the mapping
        // this.bone_mapping.set(target_bone_name, source_bone_name)
        AnimationRetargetService.getInstance().get_bone_mappings().set(target_bone_name, source_bone_name)

        console.log(`Mapped: ${target_bone_name} <- ${source_bone_name}`)

        // Update the UI to show the mapping
        this.update_target_bones_list()
        this.update_clear_button_visibility()

        // Dispatch event to notify about mapping state change
        this.dispatchEvent(new CustomEvent('bone-mappings-changed'))
      }
    }
  }

  // Check if there are any bone mappings
  public has_bone_mappings (): boolean {
    return AnimationRetargetService.getInstance().get_bone_mappings().size > 0
  }

  // Update visibility of clear mappings button
  private update_clear_button_visibility (): void {
    if (this.clear_mappings_button === null) return

    this.clear_mappings_button.style.display = this.has_bone_mappings() ? 'block' : 'none'
  }

  // Show what type of auto-mapping match we got on the UI
  private update_bone_match_type_display (): void {
    if (this.auto_bone_map_match_display === null) return

    const mapping_type: TargetBoneMappingType = AnimationRetargetService.getInstance().get_target_mapping_type()

    if (mapping_type === TargetBoneMappingType.Mixamo) {
      this.auto_bone_map_match_display.style.display = 'inline'
      this.auto_bone_map_match_display.textContent = '✨ Mixamo'
    } else if (mapping_type === TargetBoneMappingType.Rigify) {
      this.auto_bone_map_match_display.style.display = 'inline'
      this.auto_bone_map_match_display.textContent = '✨ Rigify'
    } else if (mapping_type === TargetBoneMappingType.Mesh2Motion) {
      this.auto_bone_map_match_display.style.display = 'inline'
      this.auto_bone_map_match_display.textContent = '✨ Mesh2Motion'
    } else {
      this.auto_bone_map_match_display.style.display = 'none'
    }
  }

  // Update visibility of auto-map button
  private update_auto_map_button_visibility (): void {
    if (this.auto_map_button === null) return
    this.auto_map_button.style.display = this.has_both_skeletons() ? 'block' : 'none'
  }

  private update_view_bone_tree_button_visibility (): void {
    if (this.view_bone_tree_button === null) return
    this.view_bone_tree_button.style.display = this.has_target_skeleton() ? 'inline-flex' : 'none'
  }

  // Clear a specific mapping
  public clear_bone_mapping (target_bone_name: string): void {
    // this.bone_mapping.delete(target_bone_name)
    const retarget_service = AnimationRetargetService.getInstance()
    retarget_service.get_bone_mappings().delete(target_bone_name)

    this.update_target_bones_list()
    this.update_clear_button_visibility()
    this.update_bone_match_type_display()
    this.dispatchEvent(new CustomEvent('bone-mappings-changed'))
  }

  // Clear all mappings
  public clear_all_bone_mappings (): void {
    // this.bone_mapping.clear()
    const retarget_service = AnimationRetargetService.getInstance()
    retarget_service.clear_bone_mappings()
    retarget_service.reset_target_mapping_type()

    this.update_target_bones_list()
    this.update_clear_button_visibility()
    this.update_bone_match_type_display()
    this.dispatchEvent(new CustomEvent('bone-mappings-changed'))
  }

  // Auto-map bones using string matching
  public auto_map_bones (): void {
    this.clear_all_bone_mappings() // Clear existing mappings first

    // Check if we have both source and target skeletons
    if (!this.has_both_skeletons()) {
      console.warn('Cannot auto-map: both source and target skeletons are required')
      return
    }

    const retarget_service: AnimationRetargetService = AnimationRetargetService.getInstance()

    // see if target bones follow a known template
    const target_bone_names = this.get_target_bone_names()
    if (MixamoMapper.is_target_valid_skeleton(target_bone_names)) {
      retarget_service.set_target_mapping_type(TargetBoneMappingType.Mixamo)
    } else if (RigifyMapper.is_target_valid_skeleton(target_bone_names)) {
      retarget_service.set_target_mapping_type(TargetBoneMappingType.Rigify)
    } else if (Mesh2MotionMapper.is_source_bones_same_as_target(
      this.get_source_bone_names(),
      this.get_target_bone_names()
    )) {
      retarget_service.set_target_mapping_type(TargetBoneMappingType.Mesh2Motion)
    } else {
      retarget_service.set_target_mapping_type(TargetBoneMappingType.Custom)
    }

    // Use BoneAutoMapper to generate mappings
    const auto_mappings = BoneAutoMapper.auto_map_bones()

    // Apply the auto-generated mappings
    retarget_service.set_bone_mappings(auto_mappings)
    console.log(`Auto-mapped ${auto_mappings.size} bones:`, auto_mappings)

    // Update UI
    this.update_target_bones_list()
    this.update_clear_button_visibility()
    this.update_bone_match_type_display()
    this.dispatchEvent(new CustomEvent('bone-mappings-changed'))
  }
}
