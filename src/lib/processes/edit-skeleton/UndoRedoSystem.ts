import { type Skeleton, type Bone } from 'three'
import { Utility } from '../../Utilities.ts'
import type BoneTransformState from '../../interfaces/BoneTransformState.ts'

/**
 * UndoRedoSystem
 * Manages undo/redo functionality for skeleton bone transformations
 * Stores states and allows reverting to previous states
 */
export class UndoRedoSystem extends EventTarget {
  private undo_stack: BoneTransformState[][] = []
  private redo_stack: BoneTransformState[][] = []
  private readonly max_history_size: number = 50
  private skeleton_ref: Skeleton | null = null

  constructor (max_history_size: number = 50) {
    super()
    this.max_history_size = max_history_size
  }

  /**
   * Set the skeleton reference that this undo/redo system will operate on
   */
  public set_skeleton (skeleton: Skeleton, keep_history: boolean = false): void {
    this.skeleton_ref = skeleton
    if (!keep_history) {
      this.clear_history()
    }
  }

  /**
   * Store the current state of all bones in the skeleton
   * This should be called before making any changes to bones
   */
  public store_current_state (): void {
    if (this.skeleton_ref === null) {
      console.warn('Cannot store undo state: skeleton reference is null')
      return
    }

    const current_state = Utility.store_bone_transforms(this.skeleton_ref)
    this.undo_stack.push(current_state)

    // If the stack exceeds the maximum size, remove the oldest state
    // so it is a rolling history
    if (this.undo_stack.length > this.max_history_size) {
      this.undo_stack.shift() // Remove the oldest state
    }

    // Clear redo stack when a new action is performed
    this.redo_stack = []

    this.dispatch_state_changed_event()
  }

  /**
   * Restore the previous state (undo)
   * Returns true if undo was successful, false if no undo available
   */
  public undo (): boolean {
    if (this.skeleton_ref === null) {
      console.warn('Cannot undo: skeleton reference is null')
      return false
    }

    if (this.undo_stack.length === 0) {
      console.log('No undo states available')
      return false
    }

    // Store current state in redo stack before undoing
    const current_state = Utility.store_bone_transforms(this.skeleton_ref)
    this.redo_stack.push(current_state)

    // Get and apply the previous state
    const previous_state = this.undo_stack.pop()
    if (previous_state === undefined) {
      console.warn('Failed to get previous state from undo stack')
      return false
    }
    Utility.restore_bone_transforms(this.skeleton_ref, previous_state)

    // Update world matrices for all bones
    this.skeleton_ref.bones.forEach((bone: Bone) => {
      bone.updateWorldMatrix(true, true)
    })

    this.dispatch_state_changed_event()
    return true
  }

  /**
   * Restore the next state (redo)
   * Returns true if redo was successful, false if no redo available
   */
  public redo (): boolean {
    if (this.skeleton_ref === null) {
      console.warn('Cannot redo: skeleton reference is null')
      return false
    }

    if (this.redo_stack.length === 0) {
      console.log('No redo states available')
      return false
    }

    // Store current state in undo stack before redoing
    const current_state = Utility.store_bone_transforms(this.skeleton_ref)
    this.undo_stack.push(current_state)

    // Get and apply the next state
    const next_state = this.redo_stack.pop()
    if (next_state === undefined) {
      console.warn('Failed to get next state from redo stack')
      return false
    }
    Utility.restore_bone_transforms(this.skeleton_ref, next_state)

    // Update world matrices for all bones
    this.skeleton_ref.bones.forEach((bone: Bone) => {
      bone.updateWorldMatrix(true, true)
    })

    this.dispatch_state_changed_event()
    return true
  }

  /**
   * Check if undo is available
   */
  public can_undo (): boolean {
    return this.undo_stack.length > 0
  }

  /**
   * Check if redo is available
   */
  public can_redo (): boolean {
    return this.redo_stack.length > 0
  }

  /**
   * Get the number of available undo states
   */
  public get_undo_count (): number {
    return this.undo_stack.length
  }

  /**
   * Get the number of available redo states
   */
  public get_redo_count (): number {
    return this.redo_stack.length
  }

  /**
   * Clear all undo/redo history
   */
  public clear_history (): void {
    this.undo_stack = []
    this.redo_stack = []
    this.dispatch_state_changed_event()
  }

  /**
   * Get a snapshot of the current bone transforms without storing it
   * Useful for comparison or external storage
   */
  public get_current_state_snapshot (): BoneTransformState[] | null {
    if (this.skeleton_ref === null) {
      return null
    }
    return Utility.store_bone_transforms(this.skeleton_ref)
  }

  /**
   * Restore a specific state snapshot
   * This adds the current state to undo history before applying the snapshot
   */
  public restore_state_snapshot (state_snapshot: BoneTransformState[]): void {
    if (this.skeleton_ref === null) {
      console.warn('Cannot restore state snapshot: skeleton reference is null')
      return
    }

    // Store current state before restoring snapshot
    this.store_current_state()

    // Apply the snapshot
    Utility.restore_bone_transforms(this.skeleton_ref, state_snapshot)

    // Update world matrices for all bones
    this.skeleton_ref.bones.forEach((bone: Bone) => {
      bone.updateWorldMatrix(true, true)
    })

    this.dispatch_state_changed_event()
  }

  /**
   * Dispatch a custom event when the undo/redo state changes
   * This allows UI elements to update their enabled/disabled state
   */
  private dispatch_state_changed_event (): void {
    const event = new CustomEvent('undoRedoStateChanged', {
      detail: {
        canUndo: this.can_undo(),
        canRedo: this.can_redo(),
        undoCount: this.get_undo_count(),
        redoCount: this.get_redo_count()
      }
    })
    this.dispatchEvent(event)
  }
}
