// Original code from
// https://github.com/mrdoob/three.js/blob/master/src/helpers/SkeletonHelper.js
// and ideas from
// https://discourse.threejs.org/t/extend-skeletonhelper-to-accommodate-fat-lines-perhaps-with-linesegments2/59436/2

import { Color, Matrix4, Vector3, Points, PointsMaterial, BufferGeometry, Float32BufferAttribute, TextureLoader, LineSegments, LineBasicMaterial, type Bone, type ColorRepresentation } from 'three'
import { BoneCategory, BoneClassifier } from './solvers/BoneClassifier'
import { Utility } from './Utilities'

const _vector = /*@__PURE__*/ new Vector3()
const _boneMatrix = /*@__PURE__*/ new Matrix4()
const _matrixWorldInv = /*@__PURE__*/ new Matrix4()

interface CustomSkeletonHelperOptions {
  color?: ColorRepresentation
  jointColor?: ColorRepresentation
}

const bone_category_colors: Record<BoneCategory, number> = {
  [BoneCategory.Torso]: 0xff9f1c,
  [BoneCategory.Limb]: 0x3a86ff,
  [BoneCategory.Extremity]: 0x8338ec,
  [BoneCategory.Other]: 0xadb5bd
}

class CustomSkeletonHelper extends LineSegments {
  private readonly joint_points: Points
  private readonly small_joint_points: Points
  private readonly jointTexture = new TextureLoader().load('/images/skeleton-joint-point.png')
  private hide_right_side_joints: boolean = false
  private hidden_chain_root_names: Set<string> = new Set()

  constructor (object: any, options: CustomSkeletonHelperOptions = {}) {
    const bones = getBoneList(object)
    const geometry = new BufferGeometry()

    const vertices = []
    const colors = []
    const color = new Color(options.color || 0x0000ff) // Default color blue
    const joint_color = new Color(options.jointColor ?? 0x0000ff) // Default joint color blue

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
      size: 30, // Size of the joint circles on skeleton
      color: options.jointColor !== undefined ? joint_color : 0xffffff,
      depthTest: false,
      sizeAttenuation: false, // Disable size attenuation to keep size constant in screen space
      map: this.jointTexture,
      transparent: true, // Enable transparency for the circular texture
      opacity: 0.8,
      vertexColors: options.jointColor === undefined
    })

    const pointPositions = new Float32BufferAttribute(bones.length * 3, 3)
    pointsGeometry.setAttribute('position', pointPositions)

    const smallPointsGeometry = new BufferGeometry()
    const smallPointsMaterial = new PointsMaterial({
      size: 10, // smaller circles for detailed finger joints
      color: options.jointColor !== undefined ? joint_color : 0xffffff,
      depthTest: false,
      sizeAttenuation: false,
      map: this.jointTexture,
      transparent: true,
      opacity: 0.8,
      vertexColors: options.jointColor === undefined
    })

    const smallPointPositions = new Float32BufferAttribute(bones.length * 3, 3)
    smallPointsGeometry.setAttribute('position', smallPointPositions)

    // use bone category to color joints to help with seeing a bunch of them
    if (options.jointColor === undefined) {
      const bone_classifier = new BoneClassifier(bones as Bone[])
      const point_colors: number[] = []

      bones.forEach((bone, idx) => {
        const bone_category = bone_classifier.get_category(idx)
        const category_color = new Color(bone_category_colors[bone_category])
        point_colors.push(category_color.r, category_color.g, category_color.b)
      })

      const point_color_attribute = new Float32BufferAttribute(point_colors, 3)
      pointsGeometry.setAttribute('color', point_color_attribute)
      smallPointsGeometry.setAttribute('color', point_color_attribute.clone())
    }

    this.joint_points = new Points(pointsGeometry, pointsMaterial)
    this.small_joint_points = new Points(smallPointsGeometry, smallPointsMaterial)
    this.add(this.joint_points)
    this.add(this.small_joint_points)
  }

  updateMatrixWorld (force: boolean): void {
    const bones = this.bones
    const pointPositions = this.joint_points.geometry.getAttribute('position')
    const smallPointPositions = this.small_joint_points.geometry.getAttribute('position')

    const geometry = this.geometry
    const positions = geometry.getAttribute('position')

    _matrixWorldInv.copy(this.root.matrixWorld).invert()

    let lineIndex = 0
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i]
      _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld)
      _vector.setFromMatrixPosition(_boneMatrix)

      const is_hidden_by_chain = this.is_bone_hidden_by_chain(bone)

      if ((this.hide_right_side_joints && is_right_side_bone(bone)) || is_hidden_by_chain) {
        pointPositions.setXYZ(i, Number.NaN, Number.NaN, Number.NaN)
        smallPointPositions.setXYZ(i, Number.NaN, Number.NaN, Number.NaN)
      } else if (is_small_joint_bone(bone)) {
        pointPositions.setXYZ(i, Number.NaN, Number.NaN, Number.NaN)
        smallPointPositions.setXYZ(i, _vector.x, _vector.y, _vector.z)
      } else {
        pointPositions.setXYZ(i, _vector.x, _vector.y, _vector.z) // Update point position
        smallPointPositions.setXYZ(i, Number.NaN, Number.NaN, Number.NaN)
      }

      if (bone.parent && bone.parent.isBone) {
        const parent_bone = bone.parent as Bone
        const hide_line =
          (this.hide_right_side_joints && (is_right_side_bone(parent_bone) || is_right_side_bone(bone))) ||
          is_hidden_by_chain ||
          this.is_bone_hidden_by_chain(parent_bone)

        if (hide_line) {
          positions.setXYZ(lineIndex * 2, Number.NaN, Number.NaN, Number.NaN)
          positions.setXYZ(lineIndex * 2 + 1, Number.NaN, Number.NaN, Number.NaN)
        } else {
          _boneMatrix.multiplyMatrices(_matrixWorldInv, parent_bone.matrixWorld)
          _vector.setFromMatrixPosition(_boneMatrix)
          positions.setXYZ(lineIndex * 2, _vector.x, _vector.y, _vector.z)

          _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld)
          _vector.setFromMatrixPosition(_boneMatrix)
          positions.setXYZ(lineIndex * 2 + 1, _vector.x, _vector.y, _vector.z)
        }

        lineIndex++
      }
    }

    pointPositions.needsUpdate = true
    smallPointPositions.needsUpdate = true
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
    this.small_joint_points.geometry.dispose()
    this.small_joint_points.material.dispose()
  }

  public show(): void {
    this.visible = true
  }

  public hide(): void {
    this.visible = false
  }

  public setJointsVisible (visible: boolean): void {
    this.joint_points.visible = visible
    this.small_joint_points.visible = visible
  }

  public setHideRightSideJoints (value: boolean): void {
    this.hide_right_side_joints = value
  }

  public setHiddenChainRoots (chain_root_names: string[]): void {
    this.hidden_chain_root_names = new Set(chain_root_names)
  }

  private is_bone_hidden_by_chain (bone: Bone): boolean {
    return this.hidden_chain_root_names.has(Utility.chain_root_bone_from_bone(bone).name)
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

function is_small_joint_bone (bone: Bone): boolean {
  const normalized_bone_name = bone.name.toLowerCase()
  return /(thumb|index|middle|ring|pinky|finger)/.test(normalized_bone_name)
}

export { CustomSkeletonHelper }
