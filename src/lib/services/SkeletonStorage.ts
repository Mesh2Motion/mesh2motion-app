import { type Object3D, type AnimationClip, Bone, Skeleton } from 'three'
import { BVHImporter } from '../processes/import/BVHImporter'

export interface StoredSkeletonInfo {
  id: string
  name: string
  bvhContent: string
  boneCount: number
  animationCount: number
  createdAt: number
}

export interface StoredSkeleton {
  id: string
  name: string
  armature: Object3D
  animations: AnimationClip[]
  skeleton: Skeleton
  createdAt: number
}

const STORAGE_KEY = 'mesh2motion_imported_skeletons'

/**
 * Persistent storage for imported skeletons using localStorage.
 * Stores raw BVH content and re-parses when needed.
 * This allows skeletons to persist across page navigations.
 */
export class SkeletonStorage {
  private static instance: SkeletonStorage
  private bvhImporter: BVHImporter = new BVHImporter()
  private skeletonCache: Map<string, StoredSkeleton> = new Map()

  private constructor () {
    // Load metadata from localStorage on initialization
    this.loadFromStorage()
  }

  public static getInstance (): SkeletonStorage {
    if (SkeletonStorage.instance === undefined) {
      SkeletonStorage.instance = new SkeletonStorage()
    }
    return SkeletonStorage.instance
  }

  /**
   * Store a skeleton with its animations from BVH content
   */
  public async storeSkeletonFromBVH (name: string, bvhContent: string): Promise<string> {
    const id = `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    // Parse the BVH to get metadata
    const result = await this.bvhImporter.parseBVHText(bvhContent)

    // Store metadata and BVH content in localStorage
    const skeletonInfo: StoredSkeletonInfo = {
      id,
      name,
      bvhContent,
      boneCount: result.skeleton.bones.length,
      animationCount: result.animations.length,
      createdAt: Date.now()
    }

    this.saveToStorage(skeletonInfo)

    // Cache the parsed skeleton
    this.skeletonCache.set(id, {
      id,
      name,
      armature: result.armature.clone(),
      animations: result.animations.map(anim => anim.clone()),
      skeleton: result.skeleton,
      createdAt: skeletonInfo.createdAt
    })

    console.log(`Stored skeleton "${name}" with id: ${id} (${result.skeleton.bones.length} bones, ${result.animations.length} animations)`)
    return id
  }

  /**
   * Get a stored skeleton by ID (re-parses from BVH if not cached)
   */
  public async getSkeleton (id: string): Promise<StoredSkeleton | undefined> {
    // Check cache first
    if (this.skeletonCache.has(id)) {
      return this.skeletonCache.get(id)
    }

    // If not in cache, load from localStorage and re-parse
    const info = this.getSkeletonInfo(id)
    if (!info) {
      return undefined
    }

    // Re-parse the BVH content
    try {
      const result = await this.bvhImporter.parseBVHText(info.bvhContent)
      const storedSkeleton: StoredSkeleton = {
        id: info.id,
        name: info.name,
        armature: result.armature.clone(),
        animations: result.animations.map(anim => anim.clone()),
        skeleton: result.skeleton,
        createdAt: info.createdAt
      }

      // Cache it for future use
      this.skeletonCache.set(id, storedSkeleton)
      return storedSkeleton
    } catch (error) {
      console.error('Error parsing stored BVH:', error)
      return undefined
    }
  }

  /**
   * Get skeleton metadata (without parsing)
   */
  public getSkeletonInfo (id: string): StoredSkeletonInfo | undefined {
    const stored = this.loadAllFromStorage()
    return stored.find(s => s.id === id)
  }

  /**
   * Get all stored skeletons metadata
   */
  public getAllSkeletonsInfo (): StoredSkeletonInfo[] {
    return this.loadAllFromStorage()
  }

  /**
   * Get all stored skeletons (full objects - async as they may need parsing)
   */
  public async getAllSkeletons (): Promise<StoredSkeleton[]> {
    const infos = this.loadAllFromStorage()
    const skeletons: StoredSkeleton[] = []

    for (const info of infos) {
      const skeleton = await this.getSkeleton(info.id)
      if (skeleton) {
        skeletons.push(skeleton)
      }
    }

    return skeletons
  }

  /**
   * Remove a stored skeleton
   */
  public removeSkeleton (id: string): boolean {
    // Remove from cache
    this.skeletonCache.delete(id)

    // Remove from localStorage
    const stored = this.loadAllFromStorage()
    const index = stored.findIndex(s => s.id === id)
    if (index !== -1) {
      stored.splice(index, 1)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
      return true
    }
    return false
  }

  /**
   * Check if any skeletons are stored
   */
  public hasSkeletons (): boolean {
    return this.loadAllFromStorage().length > 0
  }

  /**
   * Get the count of stored skeletons
   */
  public getSkeletonCount (): number {
    return this.loadAllFromStorage().length
  }

  /**
   * Clear all stored skeletons
   */
  public clearAll (): void {
    this.skeletonCache.clear()
    localStorage.removeItem(STORAGE_KEY)
  }

  /**
   * Load metadata from localStorage
   */
  private loadFromStorage (): void {
    // This just ensures the storage is initialized
    // Actual data is loaded on-demand
  }

  /**
   * Load all skeleton info from localStorage
   */
  private loadAllFromStorage (): StoredSkeletonInfo[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return JSON.parse(stored)
      }
    } catch (error) {
      console.error('Error loading skeletons from storage:', error)
    }
    return []
  }

  /**
   * Save skeleton info to localStorage
   */
  private saveToStorage (info: StoredSkeletonInfo): void {
    try {
      const stored = this.loadAllFromStorage()
      stored.push(info)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch (error) {
      console.error('Error saving skeleton to storage:', error)
      throw new Error('Failed to save skeleton. Storage may be full.')
    }
  }
}

// Export singleton instance
export const skeletonStorage = SkeletonStorage.getInstance()
