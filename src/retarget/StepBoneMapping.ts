import { type Group, type Object3D, type Object3DEventMap, type Scene, type SkinnedMesh } from 'three'
import { SkeletonType } from '../lib/enums/SkeletonType.ts'
import { BoneAutoMapper } from './BoneAutoMapper.ts'

export class StepBoneMapping extends EventTarget {
  private readonly _main_scene: Scene
  private target_skeleton_data: Group<Object3DEventMap> | null = null
  private source_armature: Object3D | null = null
  private source_skeleton_type: SkeletonType = SkeletonType.None

  // DOM references
  private source_bones_list: HTMLDivElement | null = null
  private target_bones_list: HTMLDivElement | null = null
  private clear_mappings_button: HTMLButtonElement | null = null
  private auto_map_button: HTMLButtonElement | null = null
  private source_bone_count: HTMLSpanElement | null = null
  private target_bone_count: HTMLSpanElement | null = null

  // Bone mapping: target bone name (uploaded mesh) -> source bone name (Mesh2Motion skeleton)
  private bone_mapping: Map<string, string> = new Map()

  // Track if event listeners have been added
  private added_event_listeners: boolean = false

  constructor (main_scene: Scene) {
    super()
    this._main_scene = main_scene // might not need this, but keeping for now
  }

  public begin (): void {
    // Get DOM references
    this.source_bones_list = document.getElementById('source-bones-list') as HTMLDivElement
    this.target_bones_list = document.getElementById('target-bones-list') as HTMLDivElement
    this.clear_mappings_button = document.getElementById('clear-mappings-button') as HTMLButtonElement
    this.auto_map_button = document.getElementById('auto-map-button') as HTMLButtonElement

    // for display only on the bones list for reference
    this.source_bone_count = document.getElementById('source-bone-count') as HTMLSpanElement
    this.target_bone_count = document.getElementById('target-bone-count') as HTMLSpanElement

    // Add event listener for clear mappings button
    this.clear_mappings_button?.addEventListener('click', () => {
      this.clear_all_bone_mappings()
      console.log('All bone mappings cleared')
    })

    // Add event listener for auto-map button
    this.auto_map_button?.addEventListener('click', () => {
      this.auto_map_bones()
    })

    // Populate the lists
    this.update_bone_lists()
    this.update_clear_button_visibility()
    this.update_auto_map_button_visibility()
  }

  public set_source_skeleton_data (armature: Object3D, skeleton_type: SkeletonType): void {
    this.source_armature = armature
    this.source_skeleton_type = skeleton_type
    console.log('Source skeleton data set in bone mapping:', this.source_armature, 'Type:', this.source_skeleton_type)
    this.update_source_bones_list()
    this.update_auto_map_button_visibility()
  }

  public set_target_skeleton_data (skeleton_data: Group<Object3DEventMap>): void {
    this.target_skeleton_data = skeleton_data
    console.log('Target skeleton data set in bone mapping:', this.target_skeleton_data)
    this.update_target_bones_list()
    this.update_auto_map_button_visibility()
  }

  public has_source_skeleton (): boolean {
    return this.source_armature !== null
  }

  public has_target_skeleton (): boolean {
    return this.target_skeleton_data !== null
  }

  public has_both_skeletons (): boolean {
    return this.has_source_skeleton() && this.has_target_skeleton()
  }

  // Getters
  public get_source_armature (): Object3D | null {
    return this.source_armature
  }

  public get_target_skeleton_data (): Group<Object3DEventMap> | null {
    return this.target_skeleton_data
  }

  public get_source_skeleton_type (): SkeletonType {
    return this.source_skeleton_type
  }

  // Extract bone names from source skeleton (Mesh2Motion skeleton)
  public get_source_bone_names (): string[] {
    if (this.source_armature === null) {
      return []
    }

    const bone_names: string[] = []
    this.source_armature.traverse((child) => {
      if (child.type === 'Bone') {
        bone_names.push(child.name)
      }
    })

    return bone_names
  }

  // Extract bone names from target skeleton (uploaded mesh)
  public get_target_bone_names (): string[] {
    if (this.target_skeleton_data === null) {
      return []
    }

    const bone_names: string[] = []
    // Target skeleton data contains SkinnedMesh objects with skeleton property
    this.target_skeleton_data.traverse((child) => {
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

  // Update UI with current bone lists
  public update_bone_lists (): void {
    this.update_source_bones_list()
    this.update_target_bones_list()
  }

  private update_source_bones_list (): void {
    if (this.source_bones_list === null) return

    const bone_names = this.get_source_bone_names()
    
    // Update bone count display
    if (this.source_bone_count !== null) {
      this.source_bone_count.textContent = `(${bone_names.length})`
    }
    
    if (bone_names.length === 0) {
      this.source_bones_list.innerHTML = '<em>No source skeleton loaded</em>'
      return
    }

    this.source_bones_list.innerHTML = ''
    bone_names.forEach((name) => {
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

    const bone_names = this.get_target_bone_names()
    
    // Update bone count display
    if (this.target_bone_count !== null) {
      this.target_bone_count.textContent = `(${bone_names.length})`
    }
    
    if (bone_names.length === 0) {
      this.target_bones_list.innerHTML = '<em>No target skeleton loaded</em>'
      return
    }

    this.target_bones_list.innerHTML = ''
    bone_names.forEach((name) => {
      const bone_item = document.createElement('div')
      bone_item.className = 'bone-item bone-item-target'
      bone_item.dataset.targetBoneName = name
      
      // Check if this target bone has a mapping
      const mapped_source_bone = this.bone_mapping.get(name)
      if (mapped_source_bone !== undefined) {
       
        const source_name_span = document.createElement('span')
        source_name_span.textContent = mapped_source_bone
        source_name_span.className = 'mapping-source-name'
        
        const target_name_span = document.createElement('span')
        target_name_span.textContent = name
        
        bone_item.appendChild(source_name_span)
        bone_item.appendChild(target_name_span)
      } else {
        bone_item.textContent = name
      }
      
      // Make the bone a drop target (target bones from uploaded mesh)
      bone_item.addEventListener('dragover', this.handle_drag_over.bind(this))
      bone_item.addEventListener('dragleave', this.handle_drag_leave.bind(this))
      bone_item.addEventListener('drop', this.handle_drop.bind(this))
      
      this.target_bones_list?.appendChild(bone_item)
    })
  }

  // Drag and drop event handlers
  private handle_drag_start (event: DragEvent): void {
    const target = event.target as HTMLElement
    const bone_name = target.dataset.boneName
    
    if (bone_name !== undefined && event.dataTransfer !== null) {
      event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData('text/plain', bone_name)
      target.classList.add('dragging')
    }
  }

  private handle_drag_end (event: DragEvent): void {
    const target = event.target as HTMLElement
    target.classList.remove('dragging')
  }

  private handle_drag_over (event: DragEvent): void {
    event.preventDefault() // Allow drop
    const target = event.target as HTMLElement
    
    // Visual feedback for drop zone
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'copy'
    }
    target.classList.add('drag-over')
  }

  private handle_drag_leave (event: DragEvent): void {
    const target = event.target as HTMLElement
    target.classList.remove('drag-over')
  }

  private handle_drop (event: DragEvent): void {
    event.preventDefault()
    const target = event.target as HTMLElement
    target.classList.remove('drag-over')
    
    if (event.dataTransfer !== null) {
      const source_bone_name = event.dataTransfer.getData('text/plain')
      const target_bone_name = target.dataset.targetBoneName
      
      if (source_bone_name !== '' && target_bone_name !== undefined) {
        // Update the mapping
        this.bone_mapping.set(target_bone_name, source_bone_name)
        console.log(`Mapped: ${target_bone_name} <- ${source_bone_name}`)
        
        // Update the UI to show the mapping
        this.update_target_bones_list()
        this.update_clear_button_visibility()
        
        // Dispatch event to notify of mapping change
        this.dispatchEvent(new CustomEvent('bone-mapping-updated', {
          detail: {
            target_bone: target_bone_name,
            source_bone: source_bone_name
          }
        }))
        
        // Dispatch event to notify about mapping state change
        this.dispatchEvent(new CustomEvent('bone-mappings-changed'))
      }
    }
  }

  // Getter for the bone mapping
  public get_bone_mapping (): Map<string, string> {
    return new Map(this.bone_mapping)
  }

  // Check if there are any bone mappings
  public has_bone_mappings (): boolean {
    return this.bone_mapping.size > 0
  }

  // Update visibility of clear mappings button
  private update_clear_button_visibility (): void {
    if (this.clear_mappings_button === null) return

    this.clear_mappings_button.style.display = this.has_bone_mappings() ? 'block' : 'none'
  }

  // Update visibility of auto-map button
  private update_auto_map_button_visibility (): void {
    if (this.auto_map_button === null) return

    this.auto_map_button.style.display = this.has_both_skeletons() ? 'block' : 'none'
  }

  // Clear a specific mapping
  public clear_bone_mapping (target_bone_name: string): void {
    this.bone_mapping.delete(target_bone_name)
    this.update_target_bones_list()
    this.update_clear_button_visibility()
    this.dispatchEvent(new CustomEvent('bone-mappings-changed'))
  }

  // Clear all mappings
  public clear_all_bone_mappings (): void {
    this.bone_mapping.clear()
    this.update_target_bones_list()
    this.update_clear_button_visibility()
    this.dispatchEvent(new CustomEvent('bone-mappings-changed'))
  }

  // Auto-map bones using string matching
  public auto_map_bones (): void {
    // Clear existing mappings first
    this.bone_mapping.clear()

    // Check if we have both source and target skeletons
    if (!this.has_both_skeletons()) {
      console.warn('Cannot auto-map: both source and target skeletons are required')
      return
    }

    const source_bone_names = this.get_source_bone_names()
    const target_bone_names = this.get_target_bone_names()

    // Use BoneAutoMapper to generate mappings
    const auto_mappings = BoneAutoMapper.auto_map_bones(source_bone_names, target_bone_names)

    // Apply the auto-generated mappings
    this.bone_mapping = auto_mappings

    console.log(`Auto-mapped ${auto_mappings.size} bones:`, auto_mappings)

    // Update UI
    this.update_target_bones_list()
    this.update_clear_button_visibility()
    this.dispatchEvent(new CustomEvent('bone-mappings-changed'))
  }
}
