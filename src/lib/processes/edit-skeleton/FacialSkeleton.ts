import { Bone, Box3, Mesh, Skeleton, Vector3, type Object3D } from 'three'

/** An editable starter rig. Coordinates assume the model faces +Z, like the body template. */
export class FacialSkeleton {
  static head (skeleton: Skeleton): Bone | undefined {
    return skeleton.bones.find(bone => /^(DEF-)?head$/i.test(bone.name))
  }

  static bones (skeleton: Skeleton): Bone[] {
    return skeleton.bones.filter(bone => bone.userData.facialSkeleton === true)
  }

  /** Estimate the head region of the upright, floor-aligned human mesh. */
  static model_head_bounds (model: Object3D): Box3 {
    model.updateWorldMatrix(true, true)
    const body = new Box3().setFromObject(model, true)
    if (body.isEmpty()) { return body }
    const bottom = body.max.y - body.getSize(new Vector3()).y * 0.14
    const bounds = new Box3()
    const point = new Vector3()
    model.traverse(object => {
      if (!(object instanceof Mesh)) { return }
      const positions = object.geometry.getAttribute('position')
      if (positions === undefined) { return }
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
        if (point.y >= bottom) { bounds.expandByPoint(point) }
      }
    })
    return bounds
  }

  static add (skeleton: Skeleton, head_bounds?: Box3): boolean {
    const head = this.head(skeleton)
    if (head === undefined || this.bones(skeleton).length > 0) { return false }
    head.updateWorldMatrix(true, true)
    const origin = head.getWorldPosition(new Vector3())
    const neck = head.parent?.getWorldPosition(new Vector3())
    let height = Math.max(neck === undefined ? 0 : origin.distanceTo(neck) * 1.6, 0.12)
    if (head_bounds !== undefined && !head_bounds.isEmpty()) {
      head_bounds.getCenter(origin)
      height = head_bounds.getSize(new Vector3()).y
    }
    const add_joint = (name: string, x: number, y: number, z: number, parent: Bone = head): Bone => {
      const bone = new Bone()
      bone.name = name
      bone.userData.facialSkeleton = true
      parent.add(bone)
      parent.updateWorldMatrix(true, false)
      bone.position.copy(parent.worldToLocal(origin.clone().add(new Vector3(x, y, z).multiplyScalar(height))))
      bone.updateWorldMatrix(false, true)
      skeleton.bones.push(bone)
      return bone
    }
    const jaw = add_joint('face_jaw', 0, -0.18, 0.18)
    add_joint('face_chin', 0, -0.54, 0.34, jaw)
    add_joint('face_lip_lower', 0, -0.30, 0.43, jaw)
    add_joint('face_lip_upper', 0, -0.05, 0.44)
    for (const [side, sign] of [['L', 1], ['R', -1]] as const) {
      add_joint(`face_eye_${side}`, sign * 0.22, 0.24, 0.35)
      add_joint(`face_brow_${side}`, sign * 0.22, 0.39, 0.36)
      add_joint(`face_cheek_${side}`, sign * 0.32, 0.02, 0.35)
      add_joint(`face_mouth_${side}`, sign * 0.19, -0.13, 0.46)
    }
    skeleton.calculateInverses()
    return true
  }

  static remove (skeleton: Skeleton): void {
    const facial = new Set(this.bones(skeleton))
    for (const bone of facial) { bone.removeFromParent() }
    skeleton.bones = skeleton.bones.filter(bone => !facial.has(bone))
    skeleton.calculateInverses()
  }

  static bounds (skeleton: Skeleton): Box3 {
    const bounds = new Box3()
    for (const bone of this.bones(skeleton)) {
      bounds.expandByPoint(bone.getWorldPosition(new Vector3()))
    }
    return bounds
  }
}
