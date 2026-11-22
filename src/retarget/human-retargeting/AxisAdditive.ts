import Transform from './Transform'
import Vec3 from './Vec3'
import Quat from './Quat'
import type { Rig } from './Rig'
import type { Pose } from './Pose'

/** Minimal retargeting context required by this additive rotation. */
interface AxisAdditiveContext {
  tarRig: Rig
  pose: Pose
}

/**
 * Apply rotation to the first joint in a chain by using one of the inverse
 * directions as the rotational axis.
 */
export class AxisAdditive {
  private readonly chainName: string
  private readonly onAxis: string
  private readonly angle: number

  constructor (chName: string, axis: string = 'y', rad: number = 0) {
    this.chainName = chName
    this.onAxis = axis
    this.angle = rad
  }

  apply (rt: AxisAdditiveContext): void {
    if (this.angle === 0) {
      return
    }

    const chain = rt.tarRig.chains[this.chainName]
    if (chain === undefined || chain.length === 0) {
      console.warn('AxisAdditive.apply - missing chain', this.chainName)
      return
    }
    const item = chain[0]
    const parent_transform = rt.pose.getWorld(item.pidx)
    const current_transform = new Transform().fromMul(parent_transform, rt.pose.joints[item.idx].local)

    const axis = new Vec3()
    switch (this.onAxis) {
      case 'y':
        axis.fromQuat(current_transform.rot, item.twist)
        break
      default:
        console.log('ERROR : AxisAdditive - Axis not implemented', this.onAxis)
        return
    }

    const rotation = new Quat()
      .fromAxisAngle(axis, this.angle)
      .mul(current_transform.rot)
      .pmulInvert(parent_transform.rot)

    rt.pose.setRot(item.idx, rotation)
  }
}
