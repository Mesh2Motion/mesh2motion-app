import {
  CylinderGeometry,
  CanvasTexture,
  Color,
  Euler,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  Quaternion,
  Raycaster,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4
} from 'three'
import type { Camera, WebGLRenderer } from 'three'

/**
 * A special type of helper that visualizes the camera's transformation
 * in a small viewport area as an axes helper. Such a helper is often wanted
 * in 3D modeling tools or scene editors like the [three.js editor]{@link https://threejs.org/editor}.
 *
 * The helper allows to click on the X, Y and Z axes which animates the camera
 * so it looks along the selected axis.
 *
 * @augments Object3D
 * @three_import import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
 */
interface ViewHelperOptions {
  labelX?: string
  labelY?: string
  labelZ?: string
  font?: string
  color?: string
  radius?: number
}

export class CustomViewHelper extends Object3D {
  public is_view_helper: boolean
  public center: Vector3

  private animating: boolean = false
  private readonly options: ViewHelperOptions = {}
  private readonly interactiveObjects: Sprite[] = []
  private readonly raycaster = new Raycaster()
  private readonly mouse = new Vector2()
  private readonly dummy = new Object3D()
  private readonly orthoCamera = new OrthographicCamera(-2, 2, 2, -2, 0, 4)
  private readonly geometry: CylinderGeometry
  private readonly xAxis: Mesh
  private readonly yAxis: Mesh
  private readonly zAxis: Mesh
  private readonly posXAxisHelper: Sprite
  private readonly posYAxisHelper: Sprite
  private readonly posZAxisHelper: Sprite
  private readonly negXAxisHelper: Sprite
  private readonly negYAxisHelper: Sprite
  private readonly negZAxisHelper: Sprite
  private readonly point: Vector3 = new Vector3()
  private readonly dim: number = 256
  private readonly turnRate: number = 2 * Math.PI
  private readonly targetPosition: Vector3 = new Vector3()
  private readonly targetQuaternion: Quaternion = new Quaternion()
  private readonly q1: Quaternion = new Quaternion()
  private readonly q2: Quaternion = new Quaternion()
  private readonly viewport: Vector4 = new Vector4()
  private radius: number = 0
  private readonly camera: Camera
  private readonly domElement: HTMLElement

  constructor (camera: Camera, domElement: HTMLElement) {
    super()
    this.is_view_helper = true
    this.animating = false
    this.center = new Vector3()
    this.camera = camera
    this.domElement = domElement

    const color1 = new Color('#ff4466')
    const color2 = new Color('#88ff44')
    const color3 = new Color('#4488ff')
    const color4 = new Color('#000000')

    this.orthoCamera.position.set(0, 0, 2)
    this.geometry = new CylinderGeometry(0.04, 0.04, 0.8, 5).rotateZ(-Math.PI / 2).translate(0.4, 0, 0)
    this.xAxis = new Mesh(this.geometry, this.getAxisMaterial(color1))
    this.yAxis = new Mesh(this.geometry, this.getAxisMaterial(color2))
    this.zAxis = new Mesh(this.geometry, this.getAxisMaterial(color3))
    this.yAxis.rotation.z = Math.PI / 2
    this.zAxis.rotation.y = -Math.PI / 2
    this.add(this.xAxis)
    this.add(this.zAxis)
    this.add(this.yAxis)
    const spriteMaterial1 = this.getSpriteMaterial(color1)
    const spriteMaterial2 = this.getSpriteMaterial(color2)
    const spriteMaterial3 = this.getSpriteMaterial(color3)
    const spriteMaterial4 = this.getSpriteMaterial(color4)
    this.posXAxisHelper = new Sprite(spriteMaterial1)
    this.posYAxisHelper = new Sprite(spriteMaterial2)
    this.posZAxisHelper = new Sprite(spriteMaterial3)
    this.negXAxisHelper = new Sprite(spriteMaterial4)
    this.negYAxisHelper = new Sprite(spriteMaterial4)
    this.negZAxisHelper = new Sprite(spriteMaterial4)
    this.posXAxisHelper.position.x = 1
    this.posYAxisHelper.position.y = 1
    this.posZAxisHelper.position.z = 1
    this.negXAxisHelper.position.x = -1
    this.negYAxisHelper.position.y = -1
    this.negZAxisHelper.position.z = -1
    this.negXAxisHelper.material.opacity = 0.2
    this.negYAxisHelper.material.opacity = 0.2
    this.negZAxisHelper.material.opacity = 0.2;
    (this.posXAxisHelper.userData as any).type = 'posX';
    (this.posYAxisHelper.userData as any).type = 'posY';
    (this.posZAxisHelper.userData as any).type = 'posZ';
    (this.negXAxisHelper.userData as any).type = 'negX';
    (this.negYAxisHelper.userData as any).type = 'negY';
    (this.negZAxisHelper.userData as any).type = 'negZ'
    this.add(this.posXAxisHelper)
    this.add(this.posYAxisHelper)
    this.add(this.posZAxisHelper)
    this.add(this.negXAxisHelper)
    this.add(this.negYAxisHelper)
    this.add(this.negZAxisHelper)
    this.interactiveObjects.push(this.posXAxisHelper, this.posYAxisHelper, this.posZAxisHelper, this.negXAxisHelper, this.negYAxisHelper, this.negZAxisHelper)
  }

  public render = (renderer: WebGLRenderer): void => {
    this.quaternion.copy(this.camera.quaternion).invert()
    this.updateMatrixWorld()
    this.point.set(0, 0, 1)
    this.point.applyQuaternion(this.camera.quaternion)
    const x = this.domElement.offsetWidth - this.dim
    const y = (renderer as any).isWebGPURenderer ? this.domElement.offsetHeight - this.dim : 0
    renderer.clearDepth()
    renderer.getViewport(this.viewport)
    renderer.setViewport(x, y, this.dim, this.dim)
    renderer.render(this, this.orthoCamera)
    renderer.setViewport(this.viewport.x, this.viewport.y, this.viewport.z, this.viewport.w)
  }

  public is_animating (): boolean {
    return this.animating
  }

  public handleClick = (event: PointerEvent): boolean => {
    if (this.animating) {
      return false
    }

    const rect = this.domElement.getBoundingClientRect()
    const offsetX = rect.left + (this.domElement.offsetWidth - this.dim)
    const offsetY = rect.top + (this.domElement.offsetHeight - this.dim)
    this.mouse.x = ((event.clientX - offsetX) / (rect.right - offsetX)) * 2 - 1
    this.mouse.y = -((event.clientY - offsetY) / (rect.bottom - offsetY)) * 2 + 1
    this.raycaster.setFromCamera(this.mouse, this.orthoCamera)
    const intersects = this.raycaster.intersectObjects(this.interactiveObjects)
    if (intersects.length > 0) {
      const intersection = intersects[0]
      const object = intersection.object
      this.prepare_animation_data(object, this.center)
      this.animating = true
      return true
    } else {
      return false
    }
  }

  public set_labels = (labelX?: string, labelY?: string, labelZ?: string): void => {
    this.options.labelX = labelX
    this.options.labelY = labelY
    this.options.labelZ = labelZ
    this.updateLabels()
  }

  public setLabelStyle = (font?: string, color?: string, radius?: number): void => {
    this.options.font = font
    this.options.color = color
    this.options.radius = radius
    this.updateLabels()
  }

  public update = (delta: number): void => {
    const step = delta * this.turnRate
    this.q1.rotateTowards(this.q2, step)
    this.camera.position.set(0, 0, 1).applyQuaternion(this.q1).multiplyScalar(this.radius).add(this.center)
    this.camera.quaternion.rotateTowards(this.targetQuaternion, step)
    if (this.q1.angleTo(this.q2) === 0) {
      this.animating = false
    }
  }

  public dispose = (): void => {
    this.geometry.dispose()
    this.xAxis.material.dispose()
    this.yAxis.material.dispose()
    this.zAxis.material.dispose()
    this.posXAxisHelper.material.map?.dispose()
    this.posYAxisHelper.material.map?.dispose()
    this.posZAxisHelper.material.map?.dispose()
    this.negXAxisHelper.material.map?.dispose()
    this.negYAxisHelper.material.map?.dispose()
    this.negZAxisHelper.material.map?.dispose()
    this.posXAxisHelper.material.dispose()
    this.posYAxisHelper.material.dispose()
    this.posZAxisHelper.material.dispose()
    this.negXAxisHelper.material.dispose()
    this.negYAxisHelper.material.dispose()
    this.negZAxisHelper.material.dispose()
  }

  private prepare_animation_data (object: Sprite, focusPoint: Vector3): void {
    switch ((object.userData as any).type) {
      case 'posX':
        this.targetPosition.set(1, 0, 0)
        this.targetQuaternion.setFromEuler(new Euler(0, Math.PI * 0.5, 0))
        break
      case 'posY':
        this.targetPosition.set(0, 1, 0)
        this.targetQuaternion.setFromEuler(new Euler(-Math.PI * 0.5, 0, 0))
        break
      case 'posZ':
        this.targetPosition.set(0, 0, 1)
        this.targetQuaternion.setFromEuler(new Euler())
        break
      case 'negX':
        this.targetPosition.set(-1, 0, 0)
        this.targetQuaternion.setFromEuler(new Euler(0, -Math.PI * 0.5, 0))
        break
      case 'negY':
        this.targetPosition.set(0, -1, 0)
        this.targetQuaternion.setFromEuler(new Euler(Math.PI * 0.5, 0, 0))
        break
      case 'negZ':
        this.targetPosition.set(0, 0, -1)
        this.targetQuaternion.setFromEuler(new Euler(0, Math.PI, 0))
        break
      default:
        console.error('ViewHelper: Invalid axis.')
    }
    this.radius = this.camera.position.distanceTo(focusPoint)
    this.targetPosition.multiplyScalar(this.radius).add(focusPoint)
    this.dummy.position.copy(focusPoint)
    this.dummy.lookAt(this.camera.position)
    this.q1.copy(this.dummy.quaternion)
    this.dummy.lookAt(this.targetPosition)
    this.q2.copy(this.dummy.quaternion)
  }

  private getAxisMaterial (new_color: Color): MeshBasicMaterial {
    return new MeshBasicMaterial({ color: new_color, toneMapped: false })
  }

  private getSpriteMaterial (color: Color, text?: string) {
    const { font = '24px Arial', color: labelColor = '#000000', radius = 14 } = this.options
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')!
    context.beginPath()
    context.arc(32, 32, radius, 0, 2 * Math.PI)
    context.closePath()
    context.fillStyle = color.getStyle()
    context.fill()
    if (text != null) {
      context.font = font
      context.textAlign = 'center'
      context.fillStyle = labelColor
      context.fillText(text, 32, 41)
    }
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    return new SpriteMaterial({ map: texture, toneMapped: false })
  }

  private updateLabels (): void {
    this.posXAxisHelper.material.map?.dispose()
    this.posYAxisHelper.material.map?.dispose()
    this.posZAxisHelper.material.map?.dispose()
    this.posXAxisHelper.material.dispose()
    this.posYAxisHelper.material.dispose()
    this.posZAxisHelper.material.dispose()
    this.posXAxisHelper.material = this.getSpriteMaterial(new Color('#ff4466'), this.options.labelX)
    this.posYAxisHelper.material = this.getSpriteMaterial(new Color('#88ff44'), this.options.labelY)
    this.posZAxisHelper.material = this.getSpriteMaterial(new Color('#4488ff'), this.options.labelZ)
  }
}
