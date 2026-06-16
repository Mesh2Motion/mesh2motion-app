/**
 * CustomTransformControls.ts
 *
 * Fork of three/examples/jsm/controls/TransformControls.js
 * Changes:
 *   Has a lot more options to customize the size and shape of the gizmo parts
 *   - arrow base radius and height
 *   - arm length and cylinder radius
 *   - picker cylinder radius and height
 *   - picker torus tube radius
 *   - picker sphere radius
 *   - picker box size
 */

import {
  BoxGeometry,
  BufferGeometry,
  Camera,
  Controls,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'

// ─── Options interface ────────────────────────────────────────────────────────

export interface CustomTransformControlsOptions {
  /** Length of each axis arm. Default: 0.25 (stock three.js: 0.5) */
  armLength?: number
  /** Base radius of the arrow cone tip. Default: 0.035 (stock: 0.04) */
  arrowBaseRadius?: number
  /** Height of the arrow cone tip. Default: 0.065 (stock: 0.1) */
  arrowHeight?: number
  /** Radius of invisible picker cylinders along each axis arm. Default: 0.1 (stock: 0.2) */
  pickerCylinderRadius?: number
  /** Height of invisible picker cylinders along each axis arm. Default: 0.35 (stock: 0.6) */
  pickerCylinderHeight?: number
  /** Tube radius of invisible torus pickers for rotation rings. Default: 0.05 (stock: 0.1) */
  pickerTorusTube?: number
  /** Radius of invisible sphere picker for free-rotate. Default: 0.15 (stock: 0.25) */
  pickerSphereRadius?: number
  /** Side length of invisible box pickers for plane handles. Default: 0.13 (stock: 0.2) */
  pickerBox?: number
  /** Radius of the arm shaft cylinder. Default: 0.012 (stock three.js: 0.0075) */
  armCylinderRadius?: number
  /** Size and offset of the visible plane handle squares (XY/YZ/XZ). Default: 0.1 (stock three.js: 0.15) */
  planeSize?: number
}

// ─── Shared module-level helpers ──────────────────────────────────────────────

const _raycaster = new Raycaster()

const _tempVector = new Vector3()
const _tempVector2 = new Vector3()
const _tempQuaternion = new Quaternion()
const _unit: Record<string, Vector3> = {
  X: new Vector3(1, 0, 0),
  Y: new Vector3(0, 1, 0),
  Z: new Vector3(0, 0, 1),
}

const _changeEvent = { type: 'change' }
const _mouseDownEvent: { type: string; mode: string | null } = { type: 'mouseDown', mode: null }
const _mouseUpEvent: { type: string; mode: string | null } = { type: 'mouseUp', mode: null }
const _objectChangeEvent = { type: 'objectChange' }

// ─── Main class ───────────────────────────────────────────────────────────────

class CustomTransformControls extends Controls<Record<string, unknown>> {

  declare camera: Camera
  // object is declared as Object3D in base Controls but is set to undefined via defineProperty
  declare object: Object3D
  declare enabled: boolean
  declare axis: string | null
  declare mode: string
  declare translationSnap: number | null
  declare rotationSnap: number | null
  declare scaleSnap: number | null
  declare space: string
  declare size: number
  declare dragging: boolean
  declare showX: boolean
  declare showY: boolean
  declare showZ: boolean
  declare minX: number
  declare maxX: number
  declare minY: number
  declare maxY: number
  declare minZ: number
  declare maxZ: number

  declare worldPosition: Vector3
  declare worldPositionStart: Vector3
  declare worldQuaternion: Quaternion
  declare worldQuaternionStart: Quaternion
  declare cameraPosition: Vector3
  declare cameraQuaternion: Quaternion
  declare pointStart: Vector3
  declare pointEnd: Vector3
  declare rotationAxis: Vector3
  declare rotationAngle: number
  declare eye: Vector3

  _root: CustomTransformControlsRoot
  _gizmo: CustomTransformControlsGizmo
  _plane: CustomTransformControlsPlane

  _offset: Vector3
  _startNorm: Vector3
  _endNorm: Vector3
  _cameraScale: Vector3
  _parentPosition: Vector3
  _parentQuaternion: Quaternion
  _parentQuaternionInv: Quaternion
  _parentScale: Vector3
  _worldScaleStart: Vector3
  _worldQuaternionInv: Quaternion
  _worldScale: Vector3
  _positionStart: Vector3
  _quaternionStart: Quaternion
  _scaleStart: Vector3

  _getPointer: (event: PointerEvent) => { x: number; y: number; button: number }
  _onPointerDown: (event: PointerEvent) => void
  _onPointerHover: (event: PointerEvent) => void
  _onPointerMove: (event: PointerEvent) => void
  _onPointerUp: (event: PointerEvent) => void

  constructor (camera: Camera, domElement: HTMLElement | null = null, options: CustomTransformControlsOptions = {}) {

    super(null as unknown as Object3D, domElement)

    const root = new CustomTransformControlsRoot(this)
    this._root = root

    const gizmo = new CustomTransformControlsGizmo(options)
    this._gizmo = gizmo
    root.add(gizmo)

    const plane = new CustomTransformControlsPlane()
    this._plane = plane
    root.add(plane)

    const scope = this as any

    function defineProperty (propName: string, defaultValue: unknown): void {

      let propValue = defaultValue

      Object.defineProperty(scope, propName, {
        get: function () {
          return propValue !== undefined ? propValue : defaultValue
        },
        set: function (value: unknown) {
          if (propValue !== value) {
            propValue = value
            ;(plane as any)[propName] = value
            ;(gizmo as any)[propName] = value
            scope.dispatchEvent({ type: propName + '-changed', value })
            scope.dispatchEvent(_changeEvent)
          }
        },
      })

      scope[propName] = defaultValue
      ;(plane as any)[propName] = defaultValue
      ;(gizmo as any)[propName] = defaultValue

    }

    defineProperty('camera', camera)
    defineProperty('object', undefined)
    defineProperty('enabled', true)
    defineProperty('axis', null)
    defineProperty('mode', 'translate')
    defineProperty('translationSnap', null)
    defineProperty('rotationSnap', null)
    defineProperty('scaleSnap', null)
    defineProperty('space', 'world')
    defineProperty('size', 1)
    defineProperty('dragging', false)
    defineProperty('showX', true)
    defineProperty('showY', true)
    defineProperty('showZ', true)
    defineProperty('minX', -Infinity)
    defineProperty('maxX', Infinity)
    defineProperty('minY', -Infinity)
    defineProperty('maxY', Infinity)
    defineProperty('minZ', -Infinity)
    defineProperty('maxZ', Infinity)

    const worldPosition = new Vector3()
    const worldPositionStart = new Vector3()
    const worldQuaternion = new Quaternion()
    const worldQuaternionStart = new Quaternion()
    const cameraPosition = new Vector3()
    const cameraQuaternion = new Quaternion()
    const pointStart = new Vector3()
    const pointEnd = new Vector3()
    const rotationAxis = new Vector3()
    const rotationAngle = 0
    const eye = new Vector3()

    defineProperty('worldPosition', worldPosition)
    defineProperty('worldPositionStart', worldPositionStart)
    defineProperty('worldQuaternion', worldQuaternion)
    defineProperty('worldQuaternionStart', worldQuaternionStart)
    defineProperty('cameraPosition', cameraPosition)
    defineProperty('cameraQuaternion', cameraQuaternion)
    defineProperty('pointStart', pointStart)
    defineProperty('pointEnd', pointEnd)
    defineProperty('rotationAxis', rotationAxis)
    defineProperty('rotationAngle', rotationAngle)
    defineProperty('eye', eye)

    this._offset = new Vector3()
    this._startNorm = new Vector3()
    this._endNorm = new Vector3()
    this._cameraScale = new Vector3()
    this._parentPosition = new Vector3()
    this._parentQuaternion = new Quaternion()
    this._parentQuaternionInv = new Quaternion()
    this._parentScale = new Vector3()
    this._worldScaleStart = new Vector3()
    this._worldQuaternionInv = new Quaternion()
    this._worldScale = new Vector3()
    this._positionStart = new Vector3()
    this._quaternionStart = new Quaternion()
    this._scaleStart = new Vector3()

    this._getPointer = getPointer.bind(this)
    this._onPointerDown = onPointerDown.bind(this)
    this._onPointerHover = onPointerHover.bind(this)
    this._onPointerMove = onPointerMove.bind(this)
    this._onPointerUp = onPointerUp.bind(this)

    if (domElement !== null) {
      this.connect(domElement)
    }

  }

  connect (element: HTMLElement): void {

    super.connect(element)
    const el = this.domElement as HTMLElement
    el.addEventListener('pointerdown', this._onPointerDown)
    el.addEventListener('pointermove', this._onPointerHover)
    el.addEventListener('pointerup', this._onPointerUp)
    el.style.touchAction = 'none'

  }

  disconnect (): void {

    const el = this.domElement as HTMLElement
    el.removeEventListener('pointerdown', this._onPointerDown)
    el.removeEventListener('pointermove', this._onPointerHover)
    el.removeEventListener('pointermove', this._onPointerMove)
    el.removeEventListener('pointerup', this._onPointerUp)
    el.style.touchAction = 'auto'

  }

  getHelper (): CustomTransformControlsRoot {
    return this._root
  }

  pointerHover (pointer: { x: number; y: number } | null): void {

    if (this.object === undefined || this.dragging === true) return
    if (pointer !== null) _raycaster.setFromCamera(pointer as any, this.camera)

    const intersect = intersectObjectWithRay((this._gizmo as any).picker[this.mode], _raycaster)

    if (intersect) {
      this.axis = (intersect as any).object.name
    } else {
      this.axis = null
    }

  }

  pointerDown (pointer: { x: number; y: number; button: number } | null): void {

    if (this.object === undefined || this.dragging === true || (pointer != null && pointer.button !== 0)) return

    if (this.axis !== null) {

      if (pointer !== null) _raycaster.setFromCamera(pointer as any, this.camera)

      const planeIntersect = intersectObjectWithRay(this._plane, _raycaster, true)

      if (planeIntersect) {

        this.object.updateMatrixWorld()
        this.object.parent!.updateMatrixWorld()

        this._positionStart.copy(this.object.position)
        this._quaternionStart.copy(this.object.quaternion)
        this._scaleStart.copy(this.object.scale)

        this.object.matrixWorld.decompose(this.worldPositionStart, this.worldQuaternionStart, this._worldScaleStart)

        this.pointStart.copy((planeIntersect as any).point).sub(this.worldPositionStart)

      }

      this.dragging = true
      _mouseDownEvent.mode = this.mode
      ;(this as any).dispatchEvent(_mouseDownEvent as any)

    }

  }

  pointerMove (pointer: { x: number; y: number; button: number } | null): void {

    const axis = this.axis
    const mode = this.mode
    const object = this.object
    let space = this.space

    if (mode === 'scale') {
      space = 'local'
    } else if (axis === 'E' || axis === 'XYZE' || axis === 'XYZ') {
      space = 'world'
    }

    if (object === undefined || axis === null || this.dragging === false || (pointer !== null && pointer.button !== -1)) return

    if (pointer !== null) _raycaster.setFromCamera(pointer as any, this.camera)

    const planeIntersect = intersectObjectWithRay(this._plane, _raycaster, true)
    if (!planeIntersect) return

    this.pointEnd.copy((planeIntersect as any).point).sub(this.worldPositionStart)

    if (mode === 'translate') {

      this._offset.copy(this.pointEnd).sub(this.pointStart)

      if (space === 'local' && axis !== 'XYZ') {
        this._offset.applyQuaternion(this._worldQuaternionInv)
      }

      if (axis.indexOf('X') === -1) this._offset.x = 0
      if (axis.indexOf('Y') === -1) this._offset.y = 0
      if (axis.indexOf('Z') === -1) this._offset.z = 0

      if (space === 'local' && axis !== 'XYZ') {
        this._offset.applyQuaternion(this._quaternionStart).divide(this._parentScale)
      } else {
        this._offset.applyQuaternion(this._parentQuaternionInv).divide(this._parentScale)
      }

      object.position.copy(this._offset).add(this._positionStart)

      if (this.translationSnap) {

        if (space === 'local') {

          object.position.applyQuaternion(_tempQuaternion.copy(this._quaternionStart).invert())

          if (axis.search('X') !== -1) object.position.x = Math.round(object.position.x / this.translationSnap) * this.translationSnap
          if (axis.search('Y') !== -1) object.position.y = Math.round(object.position.y / this.translationSnap) * this.translationSnap
          if (axis.search('Z') !== -1) object.position.z = Math.round(object.position.z / this.translationSnap) * this.translationSnap

          object.position.applyQuaternion(this._quaternionStart)

        }

        if (space === 'world') {

          if (object.parent) object.position.add(_tempVector.setFromMatrixPosition(object.parent.matrixWorld))

          if (axis.search('X') !== -1) object.position.x = Math.round(object.position.x / this.translationSnap) * this.translationSnap
          if (axis.search('Y') !== -1) object.position.y = Math.round(object.position.y / this.translationSnap) * this.translationSnap
          if (axis.search('Z') !== -1) object.position.z = Math.round(object.position.z / this.translationSnap) * this.translationSnap

          if (object.parent) object.position.sub(_tempVector.setFromMatrixPosition(object.parent.matrixWorld))

        }

      }

      object.position.x = Math.max(this.minX, Math.min(this.maxX, object.position.x))
      object.position.y = Math.max(this.minY, Math.min(this.maxY, object.position.y))
      object.position.z = Math.max(this.minZ, Math.min(this.maxZ, object.position.z))

    } else if (mode === 'scale') {

      if (axis.search('XYZ') !== -1) {

        let d = this.pointEnd.length() / this.pointStart.length()
        if (this.pointEnd.dot(this.pointStart) < 0) d *= -1
        _tempVector2.set(d, d, d)

      } else {

        _tempVector.copy(this.pointStart)
        _tempVector2.copy(this.pointEnd)
        _tempVector.applyQuaternion(this._worldQuaternionInv)
        _tempVector2.applyQuaternion(this._worldQuaternionInv)
        _tempVector2.divide(_tempVector)

        if (axis.search('X') === -1) _tempVector2.x = 1
        if (axis.search('Y') === -1) _tempVector2.y = 1
        if (axis.search('Z') === -1) _tempVector2.z = 1

      }

      object.scale.copy(this._scaleStart).multiply(_tempVector2)

      if (this.scaleSnap) {

        if (axis.search('X') !== -1) object.scale.x = Math.round(object.scale.x / this.scaleSnap) * this.scaleSnap || this.scaleSnap
        if (axis.search('Y') !== -1) object.scale.y = Math.round(object.scale.y / this.scaleSnap) * this.scaleSnap || this.scaleSnap
        if (axis.search('Z') !== -1) object.scale.z = Math.round(object.scale.z / this.scaleSnap) * this.scaleSnap || this.scaleSnap

      }

    } else if (mode === 'rotate') {

      this._offset.copy(this.pointEnd).sub(this.pointStart)

      const ROTATION_SPEED = 20 / this.worldPosition.distanceTo(_tempVector.setFromMatrixPosition(this.camera.matrixWorld))

      let _inPlaneRotation = false

      if (axis === 'XYZE') {

        this.rotationAxis.copy(this._offset).cross(this.eye).normalize()
        this.rotationAngle = this._offset.dot(_tempVector.copy(this.rotationAxis).cross(this.eye)) * ROTATION_SPEED

      } else if (axis === 'X' || axis === 'Y' || axis === 'Z') {

        this.rotationAxis.copy(_unit[axis])
        _tempVector.copy(_unit[axis])

        if (space === 'local') _tempVector.applyQuaternion(this.worldQuaternion)

        _tempVector.cross(this.eye)

        if (_tempVector.length() === 0) {
          _inPlaneRotation = true
        } else {
          this.rotationAngle = this._offset.dot(_tempVector.normalize()) * ROTATION_SPEED
        }

      }

      if (axis === 'E' || _inPlaneRotation) {

        this.rotationAxis.copy(this.eye)
        this.rotationAngle = this.pointEnd.angleTo(this.pointStart)

        this._startNorm.copy(this.pointStart).normalize()
        this._endNorm.copy(this.pointEnd).normalize()

        this.rotationAngle *= (this._endNorm.cross(this._startNorm).dot(this.eye) < 0 ? 1 : -1)

      }

      if (this.rotationSnap) this.rotationAngle = Math.round(this.rotationAngle / this.rotationSnap) * this.rotationSnap

      if (space === 'local' && axis !== 'E' && axis !== 'XYZE') {

        object.quaternion.copy(this._quaternionStart)
        object.quaternion.multiply(_tempQuaternion.setFromAxisAngle(this.rotationAxis, this.rotationAngle)).normalize()

      } else {

        this.rotationAxis.applyQuaternion(this._parentQuaternionInv)
        object.quaternion.copy(_tempQuaternion.setFromAxisAngle(this.rotationAxis, this.rotationAngle))
        object.quaternion.multiply(this._quaternionStart).normalize()

      }

    }

    ;(this as any).dispatchEvent(_changeEvent as any)
    ;(this as any).dispatchEvent(_objectChangeEvent as any)

  }

  pointerUp (pointer: { button: number } | null): void {

    if (pointer !== null && pointer.button !== 0) return

    if (this.dragging && this.axis !== null) {
      _mouseUpEvent.mode = this.mode
      ;(this as any).dispatchEvent(_mouseUpEvent as any)
    }

    this.dragging = false
    this.axis = null

  }

  dispose (): void {

    this.disconnect()
    this._root.dispose()

  }

  attach (object: Object3D): this {

    this.object = object
    this._root.visible = true
    return this

  }

  detach (): this {

    ;(this as any).object = undefined
    this.axis = null
    this._root.visible = false
    return this

  }

  reset (): void {

    if (!this.enabled) return

    if (this.dragging) {

      this.object!.position.copy(this._positionStart)
      this.object!.quaternion.copy(this._quaternionStart)
      this.object!.scale.copy(this._scaleStart)

      ;(this as any).dispatchEvent(_changeEvent as any)
      ;(this as any).dispatchEvent(_objectChangeEvent as any)

      this.pointStart.copy(this.pointEnd)

    }

  }

  getRaycaster (): Raycaster {
    return _raycaster
  }

  getMode (): string {
    return this.mode
  }

  setMode (mode: string): void {
    this.mode = mode
  }

  setTranslationSnap (translationSnap: number | null): void {
    this.translationSnap = translationSnap
  }

  setRotationSnap (rotationSnap: number | null): void {
    this.rotationSnap = rotationSnap
  }

  setScaleSnap (scaleSnap: number | null): void {
    this.scaleSnap = scaleSnap
  }

  setSize (size: number): void {
    this.size = size
  }

  setSpace (space: string): void {
    this.space = space
  }

  setColors (xAxis: unknown, yAxis: unknown, zAxis: unknown, active: unknown): void {

    const materialLib = (this._gizmo as any).materialLib

    materialLib.xAxis.color.set(xAxis)
    materialLib.yAxis.color.set(yAxis)
    materialLib.zAxis.color.set(zAxis)
    materialLib.active.color.set(active)
    materialLib.xAxisTransparent.color.set(xAxis)
    materialLib.yAxisTransparent.color.set(yAxis)
    materialLib.zAxisTransparent.color.set(zAxis)
    materialLib.activeTransparent.color.set(active)

    if (materialLib.xAxis._color) materialLib.xAxis._color.set(xAxis)
    if (materialLib.yAxis._color) materialLib.yAxis._color.set(yAxis)
    if (materialLib.zAxis._color) materialLib.zAxis._color.set(zAxis)
    if (materialLib.active._color) materialLib.active._color.set(active)
    if (materialLib.xAxisTransparent._color) materialLib.xAxisTransparent._color.set(xAxis)
    if (materialLib.yAxisTransparent._color) materialLib.yAxisTransparent._color.set(yAxis)
    if (materialLib.zAxisTransparent._color) materialLib.zAxisTransparent._color.set(zAxis)
    if (materialLib.activeTransparent._color) materialLib.activeTransparent._color.set(active)

  }

}

// ─── Pointer event helpers ────────────────────────────────────────────────────

function getPointer (this: CustomTransformControls, event: PointerEvent) {

  const el = this.domElement as HTMLElement
  if (el.ownerDocument.pointerLockElement) {
    return { x: 0, y: 0, button: event.button }
  }

  const rect = el.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    button: event.button,
  }

}

function onPointerHover (this: CustomTransformControls, event: PointerEvent) {

  if (!this.enabled) return

  switch (event.pointerType) {
    case 'mouse':
    case 'pen':
      this.pointerHover(this._getPointer(event))
      break
  }

}

function onPointerDown (this: CustomTransformControls, event: PointerEvent) {

  if (!this.enabled) return

  if (!document.pointerLockElement) {
    ;(this.domElement as HTMLElement).setPointerCapture(event.pointerId)
  }

  ;(this.domElement as HTMLElement).addEventListener('pointermove', this._onPointerMove)
  this.pointerHover(this._getPointer(event))
  this.pointerDown(this._getPointer(event))

}

function onPointerMove (this: CustomTransformControls, event: PointerEvent) {

  if (!this.enabled) return
  this.pointerMove(this._getPointer(event))

}

function onPointerUp (this: CustomTransformControls, event: PointerEvent) {

  if (!this.enabled) return
  ;(this.domElement as HTMLElement).releasePointerCapture(event.pointerId)
  ;(this.domElement as HTMLElement).removeEventListener('pointermove', this._onPointerMove)
  this.pointerUp(this._getPointer(event))

}

function intersectObjectWithRay (object: Object3D, raycaster: Raycaster, includeInvisible?: boolean) {

  const allIntersections = raycaster.intersectObject(object, true)

  for (let i = 0; i < allIntersections.length; i++) {
    if (allIntersections[i].object.visible || includeInvisible) {
      return allIntersections[i]
    }
  }

  return false

}

// ─── Reusable utility variables ───────────────────────────────────────────────

const _tempEuler = new Euler()
const _alignVector = new Vector3(0, 1, 0)
const _zeroVector = new Vector3(0, 0, 0)
const _lookAtMatrix = new Matrix4()
const _tempQuaternion2 = new Quaternion()
const _identityQuaternion = new Quaternion()
const _dirVector = new Vector3()
const _tempMatrix = new Matrix4()

const _unitX = new Vector3(1, 0, 0)
const _unitY = new Vector3(0, 1, 0)
const _unitZ = new Vector3(0, 0, 1)

const _v1 = new Vector3()
const _v2 = new Vector3()
const _v3 = new Vector3()

// ─── Root ─────────────────────────────────────────────────────────────────────

class CustomTransformControlsRoot extends Object3D {

  isTransformControlsRoot: boolean
  controls: CustomTransformControls

  constructor (controls: CustomTransformControls) {

    super()
    this.isTransformControlsRoot = true
    this.controls = controls
    this.visible = false

  }

  updateMatrixWorld (force?: boolean): void {

    const controls = this.controls

    if (controls.object !== undefined) {

      controls.object.updateMatrixWorld()

      if (controls.object.parent === null) {
        console.error('CustomTransformControls: The attached 3D object must be a part of the scene graph.')
      } else {
        controls.object.parent.matrixWorld.decompose(
          (controls as any)._parentPosition,
          (controls as any)._parentQuaternion,
          (controls as any)._parentScale
        )
      }

      controls.object.matrixWorld.decompose(
        controls.worldPosition,
        controls.worldQuaternion,
        (controls as any)._worldScale
      )

      ;(controls as any)._parentQuaternionInv.copy((controls as any)._parentQuaternion).invert()
      ;(controls as any)._worldQuaternionInv.copy(controls.worldQuaternion).invert()

    }

    controls.camera.updateMatrixWorld()
    controls.camera.matrixWorld.decompose(
      controls.cameraPosition,
      controls.cameraQuaternion,
      (controls as any)._cameraScale
    )

    if ((controls.camera as any).isOrthographicCamera) {
      controls.camera.getWorldDirection(controls.eye).negate()
    } else {
      controls.eye.copy(controls.cameraPosition).sub(controls.worldPosition).normalize()
    }

    super.updateMatrixWorld(force)

  }

  dispose (): void {

    this.traverse(function (child) {
      if ((child as any).geometry) (child as any).geometry.dispose()
      if ((child as any).material) (child as any).material.dispose()
    })

  }

}

// ─── Gizmo ────────────────────────────────────────────────────────────────────

class CustomTransformControlsGizmo extends Object3D {

  isTransformControlsGizmo: boolean
  materialLib: Record<string, any>
  gizmo: Record<string, Object3D>
  picker: Record<string, Object3D>
  helper: Record<string, Object3D>

  constructor (options: CustomTransformControlsOptions = {}) {

    super()

    this.isTransformControlsGizmo = true
    ;(this as any).type = 'TransformControlsGizmo'

    // ── Resolve options with defaults ─────────────────────────────────────────
    const arm       = options.armLength            ?? 0.25  // stock three.js: 0.5
    const armHalf   = arm / 2
    const pickerOff = arm * 0.6
    const arrowR    = options.arrowBaseRadius       ?? 0.035 // stock three.js: 0.04
    const arrowH    = options.arrowHeight           ?? 0.065 // stock three.js: 0.1
    const pickCylR  = options.pickerCylinderRadius  ?? 0.1   // stock three.js: 0.2
    const pickCylH  = options.pickerCylinderHeight  ?? 0.35  // stock three.js: 0.6
    const pickTorus = options.pickerTorusTube       ?? 0.05  // stock three.js: 0.1
    const pickSph   = options.pickerSphereRadius    ?? 0.15  // stock three.js: 0.25
    const pickBox   = options.pickerBox             ?? 0.13  // stock three.js: 0.2
    const armCylR   = options.armCylinderRadius     ?? 0.012 // stock three.js: 0.0075
    const planeSize = options.planeSize             ?? 0.1   // stock three.js: 0.15

    const gizmoMaterial = new MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      transparent: true,
    })

    const gizmoLineMaterial = new LineBasicMaterial({
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      transparent: true,
    })

    const matInvisible = gizmoMaterial.clone()
    matInvisible.opacity = 0.15

    const matHelper = gizmoLineMaterial.clone()
    matHelper.opacity = 0.5

    const matRed = gizmoMaterial.clone()
    matRed.color.setHex(0xff0000)

    const matGreen = gizmoMaterial.clone()
    matGreen.color.setHex(0x00ff00)

    const matBlue = gizmoMaterial.clone()
    matBlue.color.setHex(0x0000ff)

    const matRedTransparent = gizmoMaterial.clone()
    matRedTransparent.color.setHex(0xff0000)
    matRedTransparent.opacity = 0.5

    const matGreenTransparent = gizmoMaterial.clone()
    matGreenTransparent.color.setHex(0x00ff00)
    matGreenTransparent.opacity = 0.5

    const matBlueTransparent = gizmoMaterial.clone()
    matBlueTransparent.color.setHex(0x0000ff)
    matBlueTransparent.opacity = 0.5

    const matWhiteTransparent = gizmoMaterial.clone()
    matWhiteTransparent.opacity = 0.25

    const matYellowTransparent = gizmoMaterial.clone()
    matYellowTransparent.color.setHex(0xffff00)
    matYellowTransparent.opacity = 0.25

    const matYellow = gizmoMaterial.clone()
    matYellow.color.setHex(0xffff00)

    const matGray = gizmoMaterial.clone()
    matGray.color.setHex(0x787878)

    this.materialLib = {
      xAxis: matRed,
      yAxis: matGreen,
      zAxis: matBlue,
      active: matYellow,
      xAxisTransparent: matRedTransparent,
      yAxisTransparent: matGreenTransparent,
      zAxisTransparent: matBlueTransparent,
      activeTransparent: matYellowTransparent,
    }

    // ── Reusable geometry ─────────────────────────────────────────────────────

    const arrowGeometry = new CylinderGeometry(0, arrowR, arrowH, 12)
    arrowGeometry.translate(0, arrowH / 2, 0)

    const scaleHandleGeometry = new BoxGeometry(0.08, 0.08, 0.08)
    scaleHandleGeometry.translate(0, 0.04, 0)

    const lineGeometry = new BufferGeometry()
    lineGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3))

    // ── Arm shaft geometry ────────────────────────────────────────────────────
    const lineGeometry2 = new CylinderGeometry(armCylR, armCylR, arm, 3)
    lineGeometry2.translate(0, armHalf, 0)

    function CircleGeometry (radius: number, arc: number): TorusGeometry {
      const geometry = new TorusGeometry(radius, 0.0075, 3, 64, arc * Math.PI * 2)
      geometry.rotateY(Math.PI / 2)
      geometry.rotateX(Math.PI / 2)
      return geometry
    }

    function TranslateHelperGeometry (): BufferGeometry {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 1, 1], 3))
      return geometry
    }

    // ── Gizmo definitions ─────────────────────────────────────────────────────

    const gizmoTranslate: Record<string, any[][]> = {
      X: [
        [new Mesh(arrowGeometry, matRed), [arm, 0, 0], [0, 0, -Math.PI / 2]],
        [new Mesh(arrowGeometry, matRed), [-arm, 0, 0], [0, 0, Math.PI / 2]],
        [new Mesh(lineGeometry2, matRed), [0, 0, 0], [0, 0, -Math.PI / 2]],
      ],
      Y: [
        [new Mesh(arrowGeometry, matGreen), [0, arm, 0]],
        [new Mesh(arrowGeometry, matGreen), [0, -arm, 0], [Math.PI, 0, 0]],
        [new Mesh(lineGeometry2, matGreen)],
      ],
      Z: [
        [new Mesh(arrowGeometry, matBlue), [0, 0, arm], [Math.PI / 2, 0, 0]],
        [new Mesh(arrowGeometry, matBlue), [0, 0, -arm], [-Math.PI / 2, 0, 0]],
        [new Mesh(lineGeometry2, matBlue), null, [Math.PI / 2, 0, 0]],
      ],
      XYZ: [[new Mesh(new OctahedronGeometry(0.1, 0), matWhiteTransparent), [0, 0, 0]]],
      XY: [[new Mesh(new BoxGeometry(planeSize, planeSize, 0.01), matBlueTransparent), [planeSize, planeSize, 0]]],
      YZ: [[new Mesh(new BoxGeometry(planeSize, planeSize, 0.01), matRedTransparent), [0, planeSize, planeSize], [0, Math.PI / 2, 0]]],
      XZ: [[new Mesh(new BoxGeometry(planeSize, planeSize, 0.01), matGreenTransparent), [planeSize, 0, planeSize], [-Math.PI / 2, 0, 0]]],
    }

    const pickerTranslate: Record<string, any[][]> = {
      X: [
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [pickerOff, 0, 0], [0, 0, -Math.PI / 2]],
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [-pickerOff, 0, 0], [0, 0, Math.PI / 2]],
      ],
      Y: [
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [0, pickerOff, 0]],
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [0, -pickerOff, 0], [0, 0, Math.PI]],
      ],
      Z: [
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [0, 0, pickerOff], [Math.PI / 2, 0, 0]],
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [0, 0, -pickerOff], [-Math.PI / 2, 0, 0]],
      ],
      XYZ: [[new Mesh(new OctahedronGeometry(pickSph, 0), matInvisible)]],
      XY: [[new Mesh(new BoxGeometry(pickBox, pickBox, 0.01), matInvisible), [planeSize, planeSize, 0]]],
      YZ: [[new Mesh(new BoxGeometry(pickBox, pickBox, 0.01), matInvisible), [0, planeSize, planeSize], [0, Math.PI / 2, 0]]],
      XZ: [[new Mesh(new BoxGeometry(pickBox, pickBox, 0.01), matInvisible), [planeSize, 0, planeSize], [-Math.PI / 2, 0, 0]]],
    }

    const helperTranslate: Record<string, any[][]> = {
      START: [[new Mesh(new OctahedronGeometry(0.01, 2), matHelper), null, null, null, 'helper']],
      END: [[new Mesh(new OctahedronGeometry(0.01, 2), matHelper), null, null, null, 'helper']],
      DELTA: [[new Line(TranslateHelperGeometry(), matHelper), null, null, null, 'helper']],
      X: [[new Line(lineGeometry, matHelper), [-1e3, 0, 0], null, [1e6, 1, 1], 'helper']],
      Y: [[new Line(lineGeometry, matHelper), [0, -1e3, 0], [0, 0, Math.PI / 2], [1e6, 1, 1], 'helper']],
      Z: [[new Line(lineGeometry, matHelper), [0, 0, -1e3], [0, -Math.PI / 2, 0], [1e6, 1, 1], 'helper']],
    }

    const gizmoRotate: Record<string, any[][]> = {
      XYZE: [[new Mesh(CircleGeometry(0.5, 1), matGray), null, [0, Math.PI / 2, 0]]],
      X: [[new Mesh(CircleGeometry(0.5, 0.5), matRed)]],
      Y: [[new Mesh(CircleGeometry(0.5, 0.5), matGreen), null, [0, 0, -Math.PI / 2]]],
      Z: [[new Mesh(CircleGeometry(0.5, 0.5), matBlue), null, [0, Math.PI / 2, 0]]],
      E: [[new Mesh(CircleGeometry(0.75, 1), matYellowTransparent), null, [0, Math.PI / 2, 0]]],
    }

    const helperRotate: Record<string, any[][]> = {
      AXIS: [[new Line(lineGeometry, matHelper), [-1e3, 0, 0], null, [1e6, 1, 1], 'helper']],
    }

    const pickerRotate: Record<string, any[][]> = {
      XYZE: [[new Mesh(new SphereGeometry(pickSph, 10, 8), matInvisible)]],
      X: [[new Mesh(new TorusGeometry(0.5, pickTorus, 4, 24), matInvisible), [0, 0, 0], [0, -Math.PI / 2, -Math.PI / 2]]],
      Y: [[new Mesh(new TorusGeometry(0.5, pickTorus, 4, 24), matInvisible), [0, 0, 0], [Math.PI / 2, 0, 0]]],
      Z: [[new Mesh(new TorusGeometry(0.5, pickTorus, 4, 24), matInvisible), [0, 0, 0], [0, 0, -Math.PI / 2]]],
      E: [[new Mesh(new TorusGeometry(0.75, pickTorus, 2, 24), matInvisible)]],
    }

    const gizmoScale: Record<string, any[][]> = {
      X: [
        [new Mesh(scaleHandleGeometry, matRed), [arm, 0, 0], [0, 0, -Math.PI / 2]],
        [new Mesh(lineGeometry2, matRed), [0, 0, 0], [0, 0, -Math.PI / 2]],
        [new Mesh(scaleHandleGeometry, matRed), [-arm, 0, 0], [0, 0, Math.PI / 2]],
      ],
      Y: [
        [new Mesh(scaleHandleGeometry, matGreen), [0, arm, 0]],
        [new Mesh(lineGeometry2, matGreen)],
        [new Mesh(scaleHandleGeometry, matGreen), [0, -arm, 0], [0, 0, Math.PI]],
      ],
      Z: [
        [new Mesh(scaleHandleGeometry, matBlue), [0, 0, arm], [Math.PI / 2, 0, 0]],
        [new Mesh(lineGeometry2, matBlue), [0, 0, 0], [Math.PI / 2, 0, 0]],
        [new Mesh(scaleHandleGeometry, matBlue), [0, 0, -arm], [-Math.PI / 2, 0, 0]],
      ],
      XY: [[new Mesh(new BoxGeometry(planeSize, planeSize, 0.01), matBlueTransparent), [planeSize, planeSize, 0]]],
      YZ: [[new Mesh(new BoxGeometry(planeSize, planeSize, 0.01), matRedTransparent), [0, planeSize, planeSize], [0, Math.PI / 2, 0]]],
      XZ: [[new Mesh(new BoxGeometry(planeSize, planeSize, 0.01), matGreenTransparent), [planeSize, 0, planeSize], [-Math.PI / 2, 0, 0]]],
      XYZ: [[new Mesh(new BoxGeometry(0.1, 0.1, 0.1), matWhiteTransparent)]],
    }

    const pickerScale: Record<string, any[][]> = {
      X: [
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [pickerOff, 0, 0], [0, 0, -Math.PI / 2]],
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [-pickerOff, 0, 0], [0, 0, Math.PI / 2]],
      ],
      Y: [
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [0, pickerOff, 0]],
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [0, -pickerOff, 0], [0, 0, Math.PI]],
      ],
      Z: [
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [0, 0, pickerOff], [Math.PI / 2, 0, 0]],
        [new Mesh(new CylinderGeometry(pickCylR, 0, pickCylH, 4), matInvisible), [0, 0, -pickerOff], [-Math.PI / 2, 0, 0]],
      ],
      XY: [[new Mesh(new BoxGeometry(pickBox, pickBox, 0.01), matInvisible), [planeSize, planeSize, 0]]],
      YZ: [[new Mesh(new BoxGeometry(pickBox, pickBox, 0.01), matInvisible), [0, planeSize, planeSize], [0, Math.PI / 2, 0]]],
      XZ: [[new Mesh(new BoxGeometry(pickBox, pickBox, 0.01), matInvisible), [planeSize, 0, planeSize], [-Math.PI / 2, 0, 0]]],
      XYZ: [[new Mesh(new BoxGeometry(pickBox, pickBox, pickBox), matInvisible), [0, 0, 0]]],
    }

    const helperScale: Record<string, any[][]> = {
      X: [[new Line(lineGeometry, matHelper), [-1e3, 0, 0], null, [1e6, 1, 1], 'helper']],
      Y: [[new Line(lineGeometry, matHelper), [0, -1e3, 0], [0, 0, Math.PI / 2], [1e6, 1, 1], 'helper']],
      Z: [[new Line(lineGeometry, matHelper), [0, 0, -1e3], [0, -Math.PI / 2, 0], [1e6, 1, 1], 'helper']],
    }

    function setupGizmo (gizmoMap: Record<string, any[][]>): Object3D {

      const gizmo = new Object3D()

      for (const name in gizmoMap) {

        for (let i = gizmoMap[name].length; i--;) {

          const object = gizmoMap[name][i][0].clone()
          const position = gizmoMap[name][i][1]
          const rotation = gizmoMap[name][i][2]
          const scale = gizmoMap[name][i][3]
          const tag = gizmoMap[name][i][4]

          object.name = name
          object.tag = tag

          if (position) object.position.set(position[0], position[1], position[2])
          if (rotation) object.rotation.set(rotation[0], rotation[1], rotation[2])
          if (scale) object.scale.set(scale[0], scale[1], scale[2])

          object.updateMatrix()

          const tempGeometry = object.geometry.clone()
          tempGeometry.applyMatrix4(object.matrix)
          object.geometry = tempGeometry
          object.renderOrder = Infinity

          object.position.set(0, 0, 0)
          object.rotation.set(0, 0, 0)
          object.scale.set(1, 1, 1)

          gizmo.add(object)

        }

      }

      return gizmo

    }

    this.gizmo = {}
    this.picker = {}
    this.helper = {}

    this.add((this.gizmo['translate'] = setupGizmo(gizmoTranslate)))
    this.add((this.gizmo['rotate'] = setupGizmo(gizmoRotate)))
    this.add((this.gizmo['scale'] = setupGizmo(gizmoScale)))
    this.add((this.picker['translate'] = setupGizmo(pickerTranslate)))
    this.add((this.picker['rotate'] = setupGizmo(pickerRotate)))
    this.add((this.picker['scale'] = setupGizmo(pickerScale)))
    this.add((this.helper['translate'] = setupGizmo(helperTranslate)))
    this.add((this.helper['rotate'] = setupGizmo(helperRotate)))
    this.add((this.helper['scale'] = setupGizmo(helperScale)))

    this.picker['translate'].visible = false
    this.picker['rotate'].visible = false
    this.picker['scale'].visible = false

  }

  updateMatrixWorld (force?: boolean): void {

    const self = this as any
    const space = self.mode === 'scale' ? 'local' : self.space

    const quaternion = space === 'local' ? self.worldQuaternion : _identityQuaternion

    this.gizmo['translate'].visible = self.mode === 'translate'
    this.gizmo['rotate'].visible = self.mode === 'rotate'
    this.gizmo['scale'].visible = self.mode === 'scale'

    this.helper['translate'].visible = self.mode === 'translate'
    this.helper['rotate'].visible = self.mode === 'rotate'
    this.helper['scale'].visible = self.mode === 'scale'

    let handles: any[] = []
    handles = handles.concat(this.picker[self.mode].children)
    handles = handles.concat(this.gizmo[self.mode].children)
    handles = handles.concat(this.helper[self.mode].children)

    for (let i = 0; i < handles.length; i++) {

      const handle = handles[i]

      handle.visible = true
      handle.rotation.set(0, 0, 0)
      handle.position.copy(self.worldPosition)

      let factor: number

      if ((self.camera as any).isOrthographicCamera) {
        factor = ((self.camera as any).top - (self.camera as any).bottom) / (self.camera as any).zoom
      } else {
        factor =
          self.worldPosition.distanceTo(self.cameraPosition) *
          Math.min((1.9 * Math.tan((Math.PI * (self.camera as any).fov) / 360)) / (self.camera as any).zoom, 7)
      }

      handle.scale.set(1, 1, 1).multiplyScalar((factor * self.size) / 4)

      if (handle.tag === 'helper') {

        handle.visible = false

        if (handle.name === 'AXIS') {

          handle.visible = !!self.axis

          if (self.axis === 'X') {
            _tempQuaternion.setFromEuler(_tempEuler.set(0, 0, 0))
            handle.quaternion.copy(quaternion).multiply(_tempQuaternion)
            if (Math.abs(_alignVector.copy(_unitX).applyQuaternion(quaternion).dot(self.eye)) > 0.9) handle.visible = false
          }

          if (self.axis === 'Y') {
            _tempQuaternion.setFromEuler(_tempEuler.set(0, 0, Math.PI / 2))
            handle.quaternion.copy(quaternion).multiply(_tempQuaternion)
            if (Math.abs(_alignVector.copy(_unitY).applyQuaternion(quaternion).dot(self.eye)) > 0.9) handle.visible = false
          }

          if (self.axis === 'Z') {
            _tempQuaternion.setFromEuler(_tempEuler.set(0, Math.PI / 2, 0))
            handle.quaternion.copy(quaternion).multiply(_tempQuaternion)
            if (Math.abs(_alignVector.copy(_unitZ).applyQuaternion(quaternion).dot(self.eye)) > 0.9) handle.visible = false
          }

          if (self.axis === 'XYZE') {
            _tempQuaternion.setFromEuler(_tempEuler.set(0, Math.PI / 2, 0))
            _alignVector.copy(self.rotationAxis)
            handle.quaternion.setFromRotationMatrix(_lookAtMatrix.lookAt(_zeroVector, _alignVector, _unitY))
            handle.quaternion.multiply(_tempQuaternion)
            handle.visible = self.dragging
          }

          if (self.axis === 'E') handle.visible = false

        } else if (handle.name === 'START') {

          handle.position.copy(self.worldPositionStart)
          handle.visible = self.dragging

        } else if (handle.name === 'END') {

          handle.position.copy(self.worldPosition)
          handle.visible = self.dragging

        } else if (handle.name === 'DELTA') {

          handle.position.copy(self.worldPositionStart)
          handle.quaternion.copy(self.worldQuaternionStart)
          _tempVector
            .set(1e-10, 1e-10, 1e-10)
            .add(self.worldPositionStart)
            .sub(self.worldPosition)
            .multiplyScalar(-1)
          _tempVector.applyQuaternion(self.worldQuaternionStart.clone().invert())
          handle.scale.copy(_tempVector)
          handle.visible = self.dragging

        } else {

          handle.quaternion.copy(quaternion)
          handle.position.copy(self.dragging ? self.worldPositionStart : self.worldPosition)

          if (self.axis) handle.visible = self.axis.search(handle.name) !== -1

        }

        continue

      }

      handle.quaternion.copy(quaternion)

      if (self.mode === 'translate' || self.mode === 'scale') {

        const AXIS_HIDE_THRESHOLD = 0.99
        const PLANE_HIDE_THRESHOLD = 0.2

        if (handle.name === 'X') {
          if (Math.abs(_alignVector.copy(_unitX).applyQuaternion(quaternion).dot(self.eye)) > AXIS_HIDE_THRESHOLD) {
            handle.scale.set(1e-10, 1e-10, 1e-10)
            handle.visible = false
          }
        }

        if (handle.name === 'Y') {
          if (Math.abs(_alignVector.copy(_unitY).applyQuaternion(quaternion).dot(self.eye)) > AXIS_HIDE_THRESHOLD) {
            handle.scale.set(1e-10, 1e-10, 1e-10)
            handle.visible = false
          }
        }

        if (handle.name === 'Z') {
          if (Math.abs(_alignVector.copy(_unitZ).applyQuaternion(quaternion).dot(self.eye)) > AXIS_HIDE_THRESHOLD) {
            handle.scale.set(1e-10, 1e-10, 1e-10)
            handle.visible = false
          }
        }

        if (handle.name === 'XY') {
          if (Math.abs(_alignVector.copy(_unitZ).applyQuaternion(quaternion).dot(self.eye)) < PLANE_HIDE_THRESHOLD) {
            handle.scale.set(1e-10, 1e-10, 1e-10)
            handle.visible = false
          }
        }

        if (handle.name === 'YZ') {
          if (Math.abs(_alignVector.copy(_unitX).applyQuaternion(quaternion).dot(self.eye)) < PLANE_HIDE_THRESHOLD) {
            handle.scale.set(1e-10, 1e-10, 1e-10)
            handle.visible = false
          }
        }

        if (handle.name === 'XZ') {
          if (Math.abs(_alignVector.copy(_unitY).applyQuaternion(quaternion).dot(self.eye)) < PLANE_HIDE_THRESHOLD) {
            handle.scale.set(1e-10, 1e-10, 1e-10)
            handle.visible = false
          }
        }

      } else if (self.mode === 'rotate') {

        _tempQuaternion2.copy(quaternion)
        _alignVector.copy(self.eye).applyQuaternion(_tempQuaternion.copy(quaternion).invert())

        if (handle.name.search('E') !== -1) {
          handle.quaternion.setFromRotationMatrix(_lookAtMatrix.lookAt(self.eye, _zeroVector, _unitY))
        }

        if (handle.name === 'X') {
          _tempQuaternion.setFromAxisAngle(_unitX, Math.atan2(-_alignVector.y, _alignVector.z))
          _tempQuaternion.multiplyQuaternions(_tempQuaternion2, _tempQuaternion)
          handle.quaternion.copy(_tempQuaternion)
        }

        if (handle.name === 'Y') {
          _tempQuaternion.setFromAxisAngle(_unitY, Math.atan2(_alignVector.x, _alignVector.z))
          _tempQuaternion.multiplyQuaternions(_tempQuaternion2, _tempQuaternion)
          handle.quaternion.copy(_tempQuaternion)
        }

        if (handle.name === 'Z') {
          _tempQuaternion.setFromAxisAngle(_unitZ, Math.atan2(_alignVector.y, _alignVector.x))
          _tempQuaternion.multiplyQuaternions(_tempQuaternion2, _tempQuaternion)
          handle.quaternion.copy(_tempQuaternion)
        }

      }

      handle.visible = handle.visible && (handle.name.indexOf('X') === -1 || self.showX)
      handle.visible = handle.visible && (handle.name.indexOf('Y') === -1 || self.showY)
      handle.visible = handle.visible && (handle.name.indexOf('Z') === -1 || self.showZ)
      handle.visible =
        handle.visible && (handle.name.indexOf('E') === -1 || (self.showX && self.showY && self.showZ))

      handle.material._color = handle.material._color || handle.material.color.clone()
      handle.material._opacity = handle.material._opacity || handle.material.opacity

      handle.material.color.copy(handle.material._color)
      handle.material.opacity = handle.material._opacity

      if (self.enabled && self.axis) {

        if (handle.name === self.axis) {
          handle.material.color.copy(this.materialLib.active.color)
          handle.material.opacity = 1.0
        } else if (
          self.axis.split('').some(function (a: string) {
            return handle.name === a
          })
        ) {
          handle.material.color.copy(this.materialLib.active.color)
          handle.material.opacity = 1.0
        }

      }

    }

    super.updateMatrixWorld(force)

  }

}

// ─── Plane ────────────────────────────────────────────────────────────────────

class CustomTransformControlsPlane extends Mesh {

  isTransformControlsPlane: boolean

  constructor () {

    super(
      new PlaneGeometry(100000, 100000, 2, 2),
      new MeshBasicMaterial({ visible: false, wireframe: true, side: DoubleSide, transparent: true, opacity: 0.1, toneMapped: false })
    )

    this.isTransformControlsPlane = true
    ;(this as any).type = 'TransformControlsPlane'

  }

  updateMatrixWorld (force?: boolean): void {

    let space = (this as any).space

    this.position.copy((this as any).worldPosition)

    if ((this as any).mode === 'scale') space = 'local'

    _v1.copy(_unitX).applyQuaternion(space === 'local' ? (this as any).worldQuaternion : _identityQuaternion)
    _v2.copy(_unitY).applyQuaternion(space === 'local' ? (this as any).worldQuaternion : _identityQuaternion)
    _v3.copy(_unitZ).applyQuaternion(space === 'local' ? (this as any).worldQuaternion : _identityQuaternion)

    _alignVector.copy(_v2)

    switch ((this as any).mode) {

      case 'translate':
      case 'scale':
        switch ((this as any).axis) {
          case 'X':
            _alignVector.copy((this as any).eye).cross(_v1)
            _dirVector.copy(_v1).cross(_alignVector)
            break
          case 'Y':
            _alignVector.copy((this as any).eye).cross(_v2)
            _dirVector.copy(_v2).cross(_alignVector)
            break
          case 'Z':
            _alignVector.copy((this as any).eye).cross(_v3)
            _dirVector.copy(_v3).cross(_alignVector)
            break
          case 'XY':
            _dirVector.copy(_v3)
            break
          case 'YZ':
            _dirVector.copy(_v1)
            break
          case 'XZ':
            _alignVector.copy(_v3)
            _dirVector.copy(_v2)
            break
          case 'XYZ':
          case 'E':
            _dirVector.set(0, 0, 0)
            break
        }
        break

      case 'rotate':
      default:
        _dirVector.set(0, 0, 0)

    }

    if (_dirVector.length() === 0) {
      this.quaternion.copy((this as any).cameraQuaternion)
    } else {
      _tempMatrix.lookAt(_tempVector.set(0, 0, 0), _dirVector, _alignVector)
      this.quaternion.setFromRotationMatrix(_tempMatrix)
    }

    super.updateMatrixWorld(force)

  }

}

export { CustomTransformControls, CustomTransformControlsGizmo, CustomTransformControlsPlane }
