import { type Bone } from 'three'

export default class BoneCalculationData
{
  public name: string = ''
  public bone_object: Bone
  public has_child_bone: boolean = false
  assigned_vertices: number[] = []

  constructor (bone: Bone) {
    this.name = bone.name || ''
    this.bone_object = bone
    this.has_child_bone = bone.children.length > 0
  }
}
