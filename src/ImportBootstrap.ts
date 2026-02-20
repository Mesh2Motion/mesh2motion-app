import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BVHImporter } from './lib/processes/import/BVHImporter'
import { skeletonStorage } from './lib/services/SkeletonStorage'
import { add_preview_skeleton_from_bvh, remove_preview_skeleton } from './lib/processes/load-skeleton/PreviewSkeletonManager'
import { ThemeManager } from './lib/ThemeManager'
import tippy from 'tippy.js'
import 'tippy.js/dist/tippy.css'
import './environment.js'

class ImportBootstrap {
  private readonly camera = this.createCamera()
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  private controls: OrbitControls | undefined
  private readonly scene = new THREE.Scene()
  private readonly bvhImporter = new BVHImporter()
  private readonly themeManager = new ThemeManager()
  private currentPreviewArmature: THREE.Object3D | null = null

  constructor () {
    this.setupEnvironment()
    this.addEventListeners()
    this.setupTooltips()
    this.injectBuildVersion()
    this.animate()
    this.updateStoredSkeletonsList()
  }

  private createCamera (): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.set(0, 1.7, 5)
    return camera
  }

  private setupEnvironment (): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 2.0
    document.body.appendChild(this.renderer.domElement)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 0.9, 0)
    this.controls.minDistance = 0.5
    this.controls.maxDistance = 30
    this.controls.update()

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(5, 10, 7)
    directionalLight.castShadow = true
    this.scene.add(directionalLight)

    // Add grid
    const gridHelper = new THREE.GridHelper(20, 20, 0x4f6f6f, 0x2d4353)
    this.scene.add(gridHelper)

    // Handle window resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(window.innerWidth, window.innerHeight)
    })
  }

  private addEventListeners (): void {
    // Theme changes
    this.themeManager.addEventListener('theme-changed', () => {
      this.updateGridColor()
    })

    // BVH file upload
    const fileInput = document.getElementById('import-bvh-upload') as HTMLInputElement
    fileInput?.addEventListener('change', async (event) => {
      const files = (event.target as HTMLInputElement).files
      if (files && files.length > 0) {
        await this.handleBVHImport(files[0])
      }
    })

    // Attribution link
    document.getElementById('attribution-link')?.addEventListener('click', (event) => {
      event.preventDefault()
      this.showContributorsDialog()
    })

    // Theme toggle buttons
    document.querySelectorAll('#theme-toggle').forEach(button => {
      button.addEventListener('click', () => {
        this.themeManager.toggle_theme()
      })
    })
  }

  private async handleBVHImport (file: File): Promise<void> {
    try {
      console.log('Importing BVH file:', file.name)

      // Read file content as text
      const bvhContent = await this.readFileAsText(file)

      // Parse to preview
      const result = await this.bvhImporter.importFromFile(file)

      if (!result) {
        console.error('Failed to import BVH')
        return
      }

      // Remove previous preview
      if (this.currentPreviewArmature) {
        remove_preview_skeleton(this.scene)
      }

      // Store the skeleton with BVH content for persistence
      const skeletonName = file.name.replace(/\.bvh$/i, '')
      await skeletonStorage.storeSkeletonFromBVH(skeletonName, bvhContent)

      // Show preview
      this.currentPreviewArmature = result.armature.clone()
      await add_preview_skeleton_from_bvh(this.scene, this.currentPreviewArmature)

      // Update UI
      const nameElement = document.getElementById('imported-skeleton-name')
      if (nameElement) {
        nameElement.textContent = skeletonName
      }

      const infoElement = document.getElementById('imported-skeleton-info')
      if (infoElement) {
        infoElement.style.display = 'block'
      }

      // Update stored skeletons list
      this.updateStoredSkeletonsList()

      console.log('BVH imported successfully:', {
        name: skeletonName,
        boneCount: result.skeleton.bones.length,
        animationCount: result.animations.length
      })

    } catch (error) {
      console.error('Error importing BVH:', error)
      alert('Failed to import BVH file. Please ensure it is a valid BVH format.')
    }
  }

  private updateStoredSkeletonsList (): void {
    const listElement = document.getElementById('stored-skeletons-list')
    if (!listElement) return

    const skeletons = skeletonStorage.getAllSkeletonsInfo()

    if (skeletons.length === 0) {
      listElement.innerHTML = '<p style="color: var(--muted-text-color); font-style: italic;">No imported skeletons yet.</p>'
      return
    }

    listElement.innerHTML = skeletons.map(skeleton => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: var(--secondary-bg-color); margin-bottom: 0.5rem; border-radius: 4px;">
        <span style="font-weight: 500;">${skeleton.name}</span>
        <span style="font-size: 0.8rem; color: var(--muted-text-color);">${skeleton.animationCount} animation${skeleton.animationCount !== 1 ? 's' : ''}</span>
      </div>
    `).join('')
  }

  private readFileAsText (file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = event.target?.result as string
        if (text) {
          resolve(text)
        } else {
          reject(new Error('Failed to read file'))
        }
      }
      reader.onerror = () => reject(new Error('File read error'))
      reader.readAsText(file)
    })
  }

  private updateGridColor (): void {
    // Remove old grid
    const oldGrid = this.scene.getObjectByName('GridHelper')
    if (oldGrid) {
      this.scene.remove(oldGrid)
    }

    // Add new grid with appropriate color
    const isLight = this.themeManager.get_current_theme() === 'light'
    const gridColor = isLight ? 0xcccccc : 0x4f6f6f
    const gridHelper = new THREE.GridHelper(20, 20, gridColor, isLight ? 0xecf0f1 : 0x2d4353)
    gridHelper.name = 'GridHelper'
    this.scene.add(gridHelper)
  }

  private setupTooltips (): void {
    tippy('[data-tippy-content]', { theme: 'mesh2motion' })
  }

  private injectBuildVersion (): void {
    const buildVersionElement = document.getElementById('build-version')
    const commitSha = (window as unknown as { CLOUDFLARE_COMMIT_SHA?: string }).CLOUDFLARE_COMMIT_SHA
    const branch = (window as unknown as { CLOUDFLARE_BRANCH?: string }).CLOUDFLARE_BRANCH
    if (buildVersionElement && commitSha) {
      buildVersionElement.textContent = `git:${commitSha.slice(0, 9)}-${branch ?? 'unknown'}`
    }
  }

  private showContributorsDialog (): void {
    // Simple alert for now - could be a proper modal
    alert('Contributors: Mesh2Motion Team')
  }

  private animate (): void {
    requestAnimationFrame(() => this.animate())
    this.controls?.update()
    this.renderer.render(this.scene, this.camera)
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new ImportBootstrap()
})
