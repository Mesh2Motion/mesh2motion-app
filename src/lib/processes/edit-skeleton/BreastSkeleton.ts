import { Bone, Box3, Mesh, Skeleton, Vector3, type Object3D } from 'three'

/**
 * An optional pair of breast joints for secondary motion. Coordinates assume
 * the model faces +Z, like the body template.
 */
export class BreastSkeleton {
  /** The chest joint the breast bones hang from: the neck's parent, or the highest spine bone. */
  static chest (skeleton: Skeleton): Bone | undefined {
    const neck = skeleton.bones.find(bone => /^(DEF[-_.])?neck([_.-]?\d+)?$/i.test(bone.name))
    if (neck?.parent instanceof Bone) { return neck.parent }

    const spine_bones = skeleton.bones.filter(bone => /spine|chest|torso/i.test(bone.name))
    return spine_bones.sort((a, b) =>
      b.getWorldPosition(new Vector3()).y - a.getWorldPosition(new Vector3()).y)[0]
  }

  static bones (skeleton: Skeleton): Bone[] {
    return skeleton.bones.filter(bone => bone.userData.breastSkeleton === true)
  }

  /**
   * Estimate the chest region of the upright, floor-aligned human mesh. Only
   * vertices near the chest joint and the centre line are used, so the arms do
   * not stretch the bounds sideways.
   */
  static model_chest_bounds (model: Object3D, chest: Bone): Box3 {
    model.updateWorldMatrix(true, true)
    const body = new Box3().setFromObject(model, true)
    if (body.isEmpty()) { return body }
    const body_height = body.getSize(new Vector3()).y
    const chest_position = chest.getWorldPosition(new Vector3())
    const half_band = body_height * 0.04
    const half_width = body_height * 0.075
    const bounds = new Box3()
    const point = new Vector3()
    model.traverse(object => {
      if (!(object instanceof Mesh)) { return }
      const positions = object.geometry.getAttribute('position')
      if (positions === undefined) { return }
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
        if (Math.abs(point.y - chest_position.y) > half_band) { continue }
        if (Math.abs(point.x - chest_position.x) > half_width) { continue }
        bounds.expandByPoint(point)
      }
    })
    return bounds
  }

  static add (skeleton: Skeleton, chest_bounds?: Box3): boolean {
    const chest = this.chest(skeleton)
    if (chest === undefined || this.bones(skeleton).length > 0) { return false }
    chest.updateWorldMatrix(true, true)
    const chest_position = chest.getWorldPosition(new Vector3())
    const origin = chest_position.clone()
    let x_offset: number
    if (chest_bounds !== undefined && !chest_bounds.isEmpty()) {
      const size = chest_bounds.getSize(new Vector3())
      chest_bounds.getCenter(origin)
      // Sit inside the breast volume instead of on the front surface, so the
      // joints pivot around the chest and not in front of it.
      origin.z = chest_bounds.max.z - size.z * 0.25
      x_offset = size.x * 0.275
    } else {
      const child = chest.children.find((candidate): candidate is Bone => candidate instanceof Bone)
      const length = child === undefined ? 0 : chest_position.distanceTo(child.getWorldPosition(new Vector3()))
      const offset = Math.max(length * 0.5, 0.02)
      x_offset = offset
      origin.z += offset
    }
    const add_joint = (name: string, x: number): Bone => {
      const bone = new Bone()
      bone.name = name
      bone.userData.breastSkeleton = true
      chest.add(bone)
      chest.updateWorldMatrix(true, false)
      bone.position.copy(chest.worldToLocal(origin.clone().add(new Vector3(x, 0, 0))))
      bone.updateWorldMatrix(false, true)
      skeleton.bones.push(bone)
      return bone
    }
    add_joint('breast_L', x_offset)
    add_joint('breast_R', -x_offset)
    skeleton.calculateInverses()
    return true
  }

  static remove (skeleton: Skeleton): void {
    const breast = new Set(this.bones(skeleton))
    for (const bone of breast) { bone.removeFromParent() }
    skeleton.bones = skeleton.bones.filter(bone => !breast.has(bone))
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
