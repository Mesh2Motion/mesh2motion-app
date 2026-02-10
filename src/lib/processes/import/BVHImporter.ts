import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js'
import { type AnimationClip, type Skeleton, Object3D, Bone } from 'three'
import { ModalDialog } from '../../ModalDialog'

export interface BVHImportResult {
  skeleton: Skeleton
  armature: Object3D
  animations: AnimationClip[]
}

export class BVHImporter {
  private readonly loader: BVHLoader

  constructor () {
    this.loader = new BVHLoader()
  }

  public async importFromFile (file: File): Promise<BVHImportResult | null> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()

      reader.onload = (event) => {
        const text = event.target?.result as string
        if (!text) {
          new ModalDialog('Error reading BVH file', 'Failed to read file content.').show()
          reject(new Error('Failed to read file'))
          return
        }

        try {
          const result = this.parseBVHText(text)
          resolve(result)
        } catch (error) {
          console.error('Error parsing BVH:', error)
          new ModalDialog(
            'Error parsing BVH file',
            'The BVH file could not be parsed. Please ensure it is a valid BVH format.'
          ).show()
          reject(error)
        }
      }

      reader.onerror = () => {
        new ModalDialog('Error reading file', 'Failed to read the selected file.').show()
        reject(new Error('File read error'))
      }

      reader.readAsText(file)
    })
  }

  public parseBVHText (text: string): BVHImportResult {
    // Use Three.js BVHLoader to parse the BVH data
    const result = this.loader.parse(text)

    // The BVHLoader returns { clip: AnimationClip, skeleton: Skeleton }
    const skeleton = result.skeleton as Skeleton
    const animationClip = result.clip as AnimationClip

    // Create an armature Object3D that wraps the skeleton bones
    // This matches the structure expected by the rest of the application
    const armature = this.createArmatureFromSkeleton(skeleton)

    // Store animations
    const animations: AnimationClip[] = []
    if (animationClip) {
      // Rename the clip to the BVH file content or a default name
      animationClip.name = animationClip.name || 'Imported Animation'
      animations.push(animationClip)
    }

    return {
      skeleton,
      armature,
      animations
    }
  }

  private createArmatureFromSkeleton (skeleton: Skeleton): Object3D {
    // Create an armature container (similar to what GLTF returns)
    const armature = new Object3D()
    armature.name = 'BVH_Armature'

    // Find the root bone (the one with no parent in the skeleton)
    const rootBone = this.findRootBone(skeleton)

    if (rootBone) {
      // Add the root bone to the armature
      armature.add(rootBone)

      // Update the bone's world matrix
      rootBone.updateWorldMatrix(true, true)
    }

    return armature
  }

  private findRootBone (skeleton: Skeleton): Bone | null {
    const bones = skeleton.bones

    // Find the bone that doesn't have its parent in the skeleton bones array
    for (const bone of bones) {
      const parent = bone.parent
      if (parent == null || !bones.includes(parent as Bone)) {
        return bone
      }
    }

    // Fallback: return the first bone
    return bones[0] ?? null
  }
}
