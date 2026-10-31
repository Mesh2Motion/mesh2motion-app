import { type Euler, Matrix4, Mesh, Quaternion, type Bone, type Object3D, type Skeleton, type SkinnedMesh, Vector3 } from 'three'
import { SkeletonType } from '../../../enums/SkeletonType.ts'
import { PropCatalog } from './PropCatalog.ts'
import { PropSide } from './PropSide.ts'
import { NO_PROP, type PropId } from './PropId.ts'
import { type PropSelection } from './PropSelection.ts'
import { PropsPanel } from './PropsPanel.ts'
import { HandBoneResolver } from './HandBoneResolver.ts'
import { PROP_USER_DATA_KEY } from './PropsExportFilter.ts'

interface HandGripFrame {
  local_down: Vector3
  local_forward: Vector3
}

export function mount_quaternion (local_forward: Vector3, local_down: Vector3, rotation: Euler): Quaternion {
  const local_up = local_down.clone().negate()
  const local_right = new Vector3().crossVectors(local_forward, local_up)
  return new Quaternion()
    .setFromRotationMatrix(new Matrix4().makeBasis(local_right, local_forward, local_up))
    .multiply(new Quaternion().setFromEuler(rotation))
}

export function mount_scale (side: PropSide, size_factor: number): Vector3 {
  return new Vector3(side === PropSide.Left ? -size_factor : size_factor, size_factor, size_factor)
}

/**
 * Attaches the user's chosen props to the hand bones of the animated skinned meshes.
 * Props are children of the bones, so they follow every animation and are exported with the rig.
 */
export class PropsManager extends EventTarget {
  private readonly panel: PropsPanel = new PropsPanel()
  private selection: PropSelection = { left: NO_PROP, right: NO_PROP }
  private skeleton_type: SkeletonType = SkeletonType.None
  private skeleton_scale: number = 1.0
  private target_skinned_meshes: SkinnedMesh[] = []
  private attached_props: Object3D[] = []
  private readonly grip_frames = new Map<Bone, HandGripFrame>()
  private added_event_listeners: boolean = false
  private attachment_generation: number = 0

  public begin (skeleton_type: SkeletonType, skeleton_scale: number): void {
    this.panel.initialize()

    if (!this.added_event_listeners) {
      this.panel.addEventListener('props-selection-changed', (event: Event) => {
        this.selection = (event as CustomEvent<PropSelection>).detail
        this.refresh_attached_props()
      })
      this.added_event_listeners = true
    }

    this.skeleton_type = skeleton_type
    this.skeleton_scale = skeleton_scale

    const is_supported = PropCatalog.is_supported_skeleton(skeleton_type)
    if (!is_supported) {
      this.selection = { left: NO_PROP, right: NO_PROP }
      this.panel.set_selection(this.selection)
    }

    this.panel.set_visible(is_supported)
  }

  // meshes must still be in their rest pose here, since the grip frames are captured from it
  public attach_to_skinned_meshes (skinned_meshes: SkinnedMesh[]): void {
    this.target_skinned_meshes = skinned_meshes
    this.capture_grip_frames()
    this.refresh_attached_props()
  }

  /**
   * Must be called before the skinned meshes are disposed, since disposing them
   * would also dispose any prop still parented to their bones.
   */
  public detach_all (): void {
    this.attachment_generation++
    this.dispose_attached_props()
    this.grip_frames.clear()
    this.target_skinned_meshes = []
  }

  private capture_grip_frames (): void {
    this.grip_frames.clear()

    this.unique_skeletons().forEach((skeleton) => {
      Object.values(PropSide).forEach((side) => {
        const hand_bone = HandBoneResolver.resolve(skeleton, side)
        if (hand_bone !== null) {
          this.grip_frames.set(hand_bone, this.compute_grip_frame(hand_bone))
        }
      })
    })
  }

  // palms face down and the character faces +Z in the rest pose, so grip along world forward
  private compute_grip_frame (hand_bone: Bone): HandGripFrame {
    const world_to_local = hand_bone.getWorldQuaternion(new Quaternion()).invert()

    return {
      local_down: new Vector3(0, -1, 0).applyQuaternion(world_to_local),
      local_forward: new Vector3(0, 0, 1).applyQuaternion(world_to_local)
    }
  }

  private refresh_attached_props (): void {
    const generation = ++this.attachment_generation
    this.dispose_attached_props()

    if (!PropCatalog.is_supported_skeleton(this.skeleton_type)) {
      return
    }

    const skeletons = this.unique_skeletons()

    Object.values(PropSide).forEach((side) => {
      const prop_id = side === PropSide.Left ? this.selection.left : this.selection.right
      let found_hand_bone = false

      skeletons.forEach((skeleton) => {
        const hand_bone = HandBoneResolver.resolve(skeleton, side)
        if (hand_bone === null) {
          return
        }

        found_hand_bone = true
        void this.attach_prop(prop_id, side, hand_bone, generation)
      })

      this.panel.set_side_enabled(side, skeletons.length === 0 || found_hand_bone)
    })
  }

  private async attach_prop (prop_id: PropId, side: PropSide, hand_bone: Bone, generation: number): Promise<void> {
    const definition = PropCatalog.find(prop_id)
    if (definition === undefined) {
      return
    }

    let prop_object: Object3D
    try {
      prop_object = await PropCatalog.create_object(definition)
    } catch (error) {
      if (generation === this.attachment_generation) {
        console.error(`Failed to load prop model ${definition.asset_path}:`, error)
      }
      return
    }

    if (generation !== this.attachment_generation) {
      this.dispose_prop_object(prop_object)
      return
    }

    prop_object.name = `prop_${prop_id}_${side}`
    prop_object.userData[PROP_USER_DATA_KEY] = true

    // keep the prop the same world size no matter how the hand bone is scaled
    const hand_world_scale = hand_bone.getWorldScale(new Vector3())
    const size_factor = this.skeleton_scale / Math.max(hand_world_scale.x, 1e-6)

    const mount_offset = PropCatalog.mount_offset(definition, this.skeleton_type, side)

    const { local_down, local_forward } = this.grip_frames.get(hand_bone) ?? this.compute_grip_frame(hand_bone)

    prop_object.quaternion.copy(mount_quaternion(local_forward, local_down, mount_offset.rotation))

    prop_object.position
      .set(0, mount_offset.along_hand, 0)
      .addScaledVector(local_down, mount_offset.below_palm)
      .multiplyScalar(size_factor)

    prop_object.scale.copy(mount_scale(side, size_factor))

    hand_bone.add(prop_object)
    this.attached_props.push(prop_object)
  }

  private unique_skeletons (): Skeleton[] {
    return Array.from(new Set(this.target_skinned_meshes.map((mesh) => mesh.skeleton)))
  }

  private dispose_attached_props (): void {
    this.attached_props.forEach((prop_object) => {
      this.dispose_prop_object(prop_object)
    })

    this.attached_props = []
  }

  private dispose_prop_object (prop_object: Object3D): void {
    prop_object.removeFromParent()
    prop_object.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose()
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach((material) => { material.dispose() })
      }
    })
  }
}
