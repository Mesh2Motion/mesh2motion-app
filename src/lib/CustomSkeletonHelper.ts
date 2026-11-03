// Original code from
// https://github.com/mrdoob/three.js/blob/master/src/helpers/SkeletonHelper.js
// and ideas from
// https://discourse.threejs.org/t/extend-skeletonhelper-to-accommodate-fat-lines-perhaps-with-linesegments2/59436/2

import { Color, Matrix4, Quaternion, Vector3, Points, PointsMaterial, BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, TextureLoader, InstancedMesh, MeshBasicMaterial, FrontSide, DynamicDrawUsage, type Bone, type Camera, type ColorRepresentation, type Material, type Texture } from 'three'
import { BoneCategory, BoneClassifier } from './solvers/BoneClassifier'
import { create_octahedral_bone_geometry } from './geometry/OctahedralBoneGeometry'

const _vector = /*@__PURE__*/ new Vector3()
const _boneMatrix = /*@__PURE__*/ new Matrix4()
const _matrixWorldInv = /*@__PURE__*/ new Matrix4()
const _head = /*@__PURE__*/ new Vector3()
const _tail = /*@__PURE__*/ new Vector3()
const _direction = /*@__PURE__*/ new Vector3()
const _scale = /*@__PURE__*/ new Vector3()
const _quaternion = /*@__PURE__*/ new Quaternion()
const _instance_matrix = /*@__PURE__*/ new Matrix4()
const _view_matrix = /*@__PURE__*/ new Matrix4()

// the octahedral template geometry is built pointing up the +y axis
const _bone_up = /*@__PURE__*/ new Vector3(0, 1, 0)

// bones shorter than this are treated as having no shape at all, which also
// keeps Vector3.normalize() from producing NaN on a zero length direction
const MINIMUM_BONE_LENGTH = 1e-6

interface CustomSkeletonHelperOptions {
  color?: ColorRepresentation
  jointColor?: ColorRepresentation
  thickness_ratio?: number
  opacity?: number
  // joints are only meaningful where the skeleton can be edited, so displays
  // that are read only (the load skeleton preview) turn them off up front
  showJoints?: boolean
}

const bone_category_colors: Record<BoneCategory, number> = {
  [BoneCategory.Torso]: 0x0E9747,
  [BoneCategory.Limb]: 0x3a86ff,
  [BoneCategory.Extremity]: 0x8338ec,
  // the root drives the whole rig instead of deforming a body part, so it reads
  // as neutral rather than sharing the red that flags an unrecognized bone
  [BoneCategory.Root]: 0xFFFFFF,
  [BoneCategory.Other]: 0xff0000
}

// shared across every helper instance. Loading this per instance meant a fresh
// HTTP request and a fresh GPU texture on every skeleton rebuild
let shared_joint_texture: Texture | undefined

function get_joint_texture (): Texture {
  shared_joint_texture ??= new TextureLoader().load('/images/skeleton-joint-point.png')
  return shared_joint_texture
}

// bone opacity is a user setting that applies to every skeleton on screen.
// Helpers get rebuilt often, so the value lives here and new helpers pick it up
let shared_bone_opacity = 0.4
const live_helpers = new Set<CustomSkeletonHelper>()

class CustomSkeletonHelper extends InstancedMesh {
  // kept for parity with three's own SkeletonHelper, which callers duck type against
  public readonly isSkeletonHelper: boolean = true
  public readonly type: string = 'CustomSkeletonHelper'
  public readonly root: any
  public readonly bones: any[]

  private readonly joint_points: Points
  private hide_right_side_joints: boolean = false
  private is_disposed: boolean = false

  // one octahedron instance per bone that has a bone for a parent. The shape
  // spans from the parent's joint (head) to the bone's own joint (tip)
  private readonly segment_bone_indices: number[]
  private readonly segment_heads: Float32Array
  private readonly segment_tails: Float32Array

  // instances are written back to front so the nearest bone paints last. The
  // material has depthTest off, so draw order is the only thing separating
  // them, and it is also the order alpha blending has to happen in
  private readonly segment_depths: Float32Array
  private readonly segment_draw_order: number[]

  // bone category colors, in segment order. Undefined when a flat color was
  // supplied, in which case the material color covers every bone
  private readonly segment_colors: Float32Array | undefined

  private readonly thickness_ratio: number

  // an explicit opacity option opts this helper out of the shared setting
  private readonly follows_shared_opacity: boolean

  private _joint_color: Color = new Color(0x0F89B9) // Default joint color blue

  public static set_bone_opacity (opacity: number): void {
    shared_bone_opacity = opacity
    for (const helper of live_helpers) {
      if (helper.follows_shared_opacity) {
        (helper.material as MeshBasicMaterial).opacity = opacity
      }
    }
  }

  public static get_bone_opacity (): number {
    return shared_bone_opacity
  }

  constructor (object: any, options: CustomSkeletonHelperOptions = {}) {
    const bones = getBoneList(object)
    const segment_bone_indices: number[] = []
    for (let i = 0; i < bones.length; i++) {
      if (bones[i].parent && bones[i].parent.isBone) {
        segment_bone_indices.push(i)
      }
    }

    // without an explicit color, the bone shapes fall back to the bone category
    // colors. The joints are deliberately left a single neutral color: the bones
    // already carry the category, and repeating it on the joints made both
    // harder to pick out
    const use_category_bone_colors = options.color === undefined
    const bone_classifier = use_category_bone_colors
      ? new BoneClassifier(bones as Bone[])
      : undefined

    const material = new MeshBasicMaterial({
      // white lets the per instance category color through untouched. A supplied
      // color instead applies to every bone, and skips instance colors entirely
      color: use_category_bone_colors ? 0xffffff : options.color,
      vertexColors: true, // the template geometry bakes flat shading into its colors
      side: FrontSide, // culling backfaces makes each convex bone shape self-occlude correctly
      transparent: true, // also load bearing: keeps the helper in the transparent pass, which
      // renders after the opaque model, so the skeleton still draws over the mesh
      opacity: options.opacity ?? shared_bone_opacity,
      depthTest: false,
      depthWrite: false
    })

    // InstancedMesh needs a count of at least 1 to allocate its buffers
    super(create_octahedral_bone_geometry(), material, Math.max(segment_bone_indices.length, 1))
    this.count = segment_bone_indices.length
    this.instanceMatrix.setUsage(DynamicDrawUsage)

    this.follows_shared_opacity = options.opacity === undefined
    live_helpers.add(this)

    if(options.jointColor) {
      this._joint_color = new Color(options.jointColor)
    }

    this.root = object
    this.bones = bones

    this.matrix = object.matrixWorld
    this.matrixAutoUpdate = false

    // the helper is positioned entirely from bone matrices, so its own bounds
    // never reflect where it actually is. Culling it by them hid the skeleton
    // whenever the root bone on the ground went off camera
    this.frustumCulled = false

    this.thickness_ratio = options.thickness_ratio ?? 0.1

    this.segment_bone_indices = segment_bone_indices
    this.segment_heads = new Float32Array(segment_bone_indices.length * 3)
    this.segment_tails = new Float32Array(segment_bone_indices.length * 3)
    this.segment_depths = new Float32Array(segment_bone_indices.length)
    this.segment_draw_order = segment_bone_indices.map((_, index) => index)

    if (bone_classifier !== undefined) {
      // a segment runs from its parent's joint up to its own, so the shape is
      // really the body of the parent bone, and it takes the parent's category.
      // Coloring by its own bone instead labeled the forearm as a hand and the
      // neck as a head, since each bone's joint sits at the segment's far tip
      const segment_colors = new Float32Array(segment_bone_indices.length * 3)
      const bone_index_by_object = new Map<any, number>()
      bones.forEach((bone, index) => bone_index_by_object.set(bone, index))

      segment_bone_indices.forEach((bone_index, segment) => {
        // a root bone has no parent to borrow a category from, so it falls back
        // to its own. Same fallback covers a parent outside this bone list
        const parent = bones[bone_index].parent
        const parent_index = parent === null ? undefined : bone_index_by_object.get(parent)
        const bone_category = bone_classifier.get_category(parent_index ?? bone_index)
        const category_color = new Color(bone_category_colors[bone_category])
        category_color.toArray(segment_colors, segment * 3)
      })

      this.segment_colors = segment_colors

      // instance colors are rewritten every frame because the depth sort keeps
      // moving each segment to a different instance slot
      this.instanceColor = new InstancedBufferAttribute(new Float32Array(this.instanceMatrix.count * 3), 3)
      this.instanceColor.setUsage(DynamicDrawUsage)
    }

    // Add points for joints
    const pointsGeometry = new BufferGeometry()
    const pointsMaterial = new PointsMaterial({
      size: 30, // Size of the joint circles on skeleton
      color: this._joint_color,
      depthTest: false,
      sizeAttenuation: false, // Disable size attenuation to keep size constant in screen space
      map: get_joint_texture(),
      transparent: true, // Enable transparency for the circular texture
      opacity: 0.8,
      //vertexColors: true
    })

    const pointPositions = new Float32BufferAttribute(bones.length * 3, 3)
    pointsGeometry.setAttribute('position', pointPositions)

    this.joint_points = new Points(pointsGeometry, pointsMaterial)
    this.joint_points.frustumCulled = false
    this.joint_points.visible = options.showJoints ?? true
    this.add(this.joint_points)

    // the bone shapes have to be sorted by camera distance, and onBeforeRender
    // is where the camera for the current pass is available
    this.onBeforeRender = (_renderer, _scene, camera) => {
      this.update_bone_instances(camera)
    }
  }

  updateMatrixWorld (force: boolean): void {
    const bones = this.bones
    const pointPositions = this.joint_points.geometry.getAttribute('position')

    _matrixWorldInv.copy(this.root.matrixWorld).invert()

    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i]
      _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld)
      _vector.setFromMatrixPosition(_boneMatrix)

      if (this.hide_right_side_joints && is_right_side_bone(bone)) {
        pointPositions.setXYZ(i, Number.NaN, Number.NaN, Number.NaN)
      } else {
        pointPositions.setXYZ(i, _vector.x, _vector.y, _vector.z) // Update point position
      }
    }

    // record where each bone shape starts and ends. Turning those into instance
    // matrices needs the camera, so that waits until onBeforeRender
    for (let segment = 0; segment < this.segment_bone_indices.length; segment++) {
      const bone = bones[this.segment_bone_indices[segment]]
      const offset = segment * 3

      _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.parent.matrixWorld)
      _vector.setFromMatrixPosition(_boneMatrix)
      this.segment_heads[offset] = _vector.x
      this.segment_heads[offset + 1] = _vector.y
      this.segment_heads[offset + 2] = _vector.z

      _boneMatrix.multiplyMatrices(_matrixWorldInv, bone.matrixWorld)
      _vector.setFromMatrixPosition(_boneMatrix)
      this.segment_tails[offset] = _vector.x
      this.segment_tails[offset + 1] = _vector.y
      this.segment_tails[offset + 2] = _vector.z
    }

    pointPositions.needsUpdate = true

    super.updateMatrixWorld(force)
  }

  /**
   * Turns the head/tail positions recorded in updateMatrixWorld into instance
   * matrices, written far to near so the painter's algorithm resolves overlap
   * between bones. That is exact here because each shape is convex and adjacent
   * bones meet tip to head rather than interpenetrating.
   */
  private update_bone_instances (camera: Camera): void {
    const segment_count = this.segment_bone_indices.length
    if (segment_count === 0) {
      return
    }

    _view_matrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld)

    for (let segment = 0; segment < segment_count; segment++) {
      const offset = segment * 3

      // view space depth of the shape's midpoint. The camera looks down -z, so
      // the more negative the value, the further away the bone is
      _vector.set(
        (this.segment_heads[offset] + this.segment_tails[offset]) * 0.5,
        (this.segment_heads[offset + 1] + this.segment_tails[offset + 1]) * 0.5,
        (this.segment_heads[offset + 2] + this.segment_tails[offset + 2]) * 0.5
      )
      this.segment_depths[segment] = _vector.applyMatrix4(_view_matrix).z
    }

    this.segment_draw_order.sort(this.compare_segment_depth)

    for (let slot = 0; slot < segment_count; slot++) {
      const segment = this.segment_draw_order[slot]
      const offset = segment * 3

      _head.set(this.segment_heads[offset], this.segment_heads[offset + 1], this.segment_heads[offset + 2])
      _tail.set(this.segment_tails[offset], this.segment_tails[offset + 1], this.segment_tails[offset + 2])

      const bone_length = _direction.subVectors(_tail, _head).length()

      if (bone_length < MINIMUM_BONE_LENGTH) {
        _quaternion.identity()
        _scale.set(0, 0, 0)
      } else {
        _quaternion.setFromUnitVectors(_bone_up, _direction.divideScalar(bone_length))
        const thickness = bone_length * this.thickness_ratio
        _scale.set(thickness, bone_length, thickness)
      }

      _instance_matrix.compose(_head, _quaternion, _scale)
      this.setMatrixAt(slot, _instance_matrix)

      // the color has to follow its segment into whichever slot the sort put it
      if (this.segment_colors !== undefined && this.instanceColor !== null) {
        this.instanceColor.setXYZ(
          slot,
          this.segment_colors[offset],
          this.segment_colors[offset + 1],
          this.segment_colors[offset + 2]
        )
      }
    }

    this.instanceMatrix.needsUpdate = true

    if (this.instanceColor !== null) {
      this.instanceColor.needsUpdate = true
    }
  }

  private readonly compare_segment_depth = (a: number, b: number): number => {
    return this.segment_depths[a] - this.segment_depths[b]
  }

  dispose (): this {
    if (this.is_disposed) {
      return this
    }
    this.is_disposed = true
    live_helpers.delete(this)

    this.geometry.dispose()
    ;(this.material as Material).dispose()
    this.joint_points.geometry.dispose()
    ;(this.joint_points.material as Material).dispose()

    // shared_joint_texture is intentionally left alone. It outlives any single
    // helper and gets reused by the next one

    // InstancedMesh.dispose() is what releases the instanceMatrix buffer
    super.dispose()
    return this
  }

  public show (): void {
    this.visible = true
  }

  public hide (): void {
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
