// Original code from
// https://github.com/mrdoob/three.js/blob/master/src/helpers/SkeletonHelper.js
// and ideas from
// https://discourse.threejs.org/t/extend-skeletonhelper-to-accommodate-fat-lines-perhaps-with-linesegments2/59436/2

import { Color, Matrix4, Vector3, Points, PointsMaterial, BufferGeometry, Float32BufferAttribute, TextureLoader, LineSegments, LineBasicMaterial, type Bone } from 'three'

const _vector = /*@__PURE__*/ new Vector3()
const _boneMatrix = /*@__PURE__*/ new Matrix4()
const _matrixWorldInv = /*@__PURE__*/ new Matrix4()

class CustomSkeletonHelper extends LineSegments {
  private readonly joint_points: Points
  private readonly jointTexture = new TextureLoader().load('/images/skeleton-joint-point.png')
  private hide_right_side_joints: boolean = false

  constructor (object: any, options = {}) {
    const bones = getBoneList(object)
    const geometry = new BufferGeometry()

    const vertices = []
    const colors = []
    const color = new Color(options.color || 0x0000ff) // Default color blue
    const joint_color = new Color(options.jointColor || 0x0000ff) // Default joint color blue

    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i]

      if (bone.parent && bone.parent.isBone) {
        vertices.push(0, 0, 0) // Start
        vertices.push(0, 0, 0) // End
        colors.push(color.r, color.g, color.b)
        colors.push(color.r, color.g, color.b)
      }
    }

    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))

    const material = new LineBasicMaterial({
      vertexColors: true,
      depthTest: false,
      depthWrite: false,
      transparent: true
    })

    super(geometry, material)

    this.isSkeletonHelper = true
    this.type = 'CustomSkeletonHelper'

    this.root = object
    this.bones = bones

    this.matrix = object.matrixWorld
    this.matrixAutoUpdate = false

    // Add points for joints
    const pointsGeometry = new BufferGeometry()
    const pointsMaterial = new PointsMaterial({
      size: 25, // Size of the joint circles on skeleton
      color: joint_color,
      depthTest: false,
      sizeAttenuation: false, // Disable size attenuation to keep size constant in screen space
      map: this.jointTexture,
      transparent: true, // Enable transparency for the circular texture
      opacity: 0.3
    })

    const pointPositions = new Float32BufferAttribute(bones.length * 3, 3)
    pointsGeometry.setAttribute('position', pointPositions)

    this.joint_points = new Points(pointsGeometry, pointsMaterial)
    this.add(this.joint_points)
  }

  updateMatrixWorld (force: boolean): void {
    const bones = this.bones
    const pointPositions = this.joint_points.geometry.getAttribute('position')

    const geometry = this.geometry
    const positions = geometry.getAttribute('position')

    _matrixWorldInv.copy(this.root.matrixWorld).invert()

    let lineIndex = 0
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i]
      _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld)
      _vector.setFromMatrixPosition(_boneMatrix)

      if (this.hide_right_side_joints && is_right_side_bone(bone)) {
        pointPositions.setXYZ(i, Number.NaN, Number.NaN, Number.NaN)
      } else {
        pointPositions.setXYZ(i, _vector.x, _vector.y, _vector.z) // Update point position
      }

      if (bone.parent && bone.parent.isBone) {
        _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.parent.matrixWorld)
        _vector.setFromMatrixPosition(_boneMatrix)
        positions.setXYZ(lineIndex * 2, _vector.x, _vector.y, _vector.z)

        _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld)
        _vector.setFromMatrixPosition(_boneMatrix)
        positions.setXYZ(lineIndex * 2 + 1, _vector.x, _vector.y, _vector.z)
        lineIndex++
      }
    }

    pointPositions.needsUpdate = true
    positions.needsUpdate = true

    // Update bounding box and bounding sphere
    // otherwise the skeleton will be hidden when root bone on ground is off camera
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()

    super.updateMatrixWorld(force)
  }

  dispose (): void {
    this.geometry.dispose()
    this.material.dispose()
    this.joint_points.geometry.dispose()
    this.joint_points.material.dispose()
  }

  public show(): void {
    this.visible = true
  }

  public hide(): void {
    this.visible = false
  }

  public setJointsVisible (visible: boolean): void {
    this.joint_points.visible = visible
  }

  public setHideRightSideJoints (value: boolean): void {
    this.hide_right_side_joints = value
  }
}

function getBoneList (object: any): any[] {
  const boneList: any[] = []

  if (object.isBone === true) {
    boneList.push(object)
  }

  for (let i = 0; i < object.children.length; i++) {
    boneList.push.apply(boneList, getBoneList(object.children[i]))
  }

  return boneList
}

function is_right_side_bone (bone: Bone): boolean {
  const normalized_bone_name = bone.name.toLowerCase()

  return /(^right_|^r_|_right$|_r$|\.right$|\.r$|-right$|-r$)/.test(normalized_bone_name)
}

export { CustomSkeletonHelper }
