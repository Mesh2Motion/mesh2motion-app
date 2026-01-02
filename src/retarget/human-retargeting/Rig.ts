// Setup a standard definition of what a Humanoid is. The rig
// allows to work with different skeletons with various joint
// naming convention. This makes it easier to build a system

import { type Joint } from './Joint'
import { Pose } from './Pose'
import { RigItem } from './RigItem'
import Vec3 from './Vec3'

import type * as THREE from 'three'

// that speaks a single language of whats what.
export class Rig {
  public readonly skel: THREE.Skeleton

  /**
   * The T-Pose of the rig, representing the default pose of the skeleton
   * Initially set by passing in the base skeleton data
   */
  public readonly tpose: Pose
  public readonly chains: Record<string, RigItem[]> = {}
  public scalar: number = 1.0

  constructor (skel: THREE.Skeleton) {
    this.skel = skel
    this.tpose = new Pose(skel)
    // this.tpose.debug();
  }

  fromConfig (cfg = {}): this {
    for (const [k, v] of Object.entries(cfg)) {
      // Get joint names for this chain
      const chain_names: string[] = v.names as string[]
      if (chain_names.length === 0) {
        console.log('Error - Rig.fromConfig : No joint names for chain ', k)
        continue
      }

      switch (k) {
        case 'pelvis' :
          this.buildItem(k, chain_names, new Vec3(0, 0, 1), new Vec3(0, 1, 0))
          this.buildRigScalar(k)
          break
        case 'spine' :
          this.buildItem(k, chain_names, new Vec3(0, 1, 0), new Vec3(0, 0, 1))
          break
        case 'head' :
          this.buildItem(k, chain_names, new Vec3(0, 0, 1), new Vec3(0, 1, 0))
          break
        case 'armL' :
          this.buildItem(k, chain_names, new Vec3(1, 0, 0), new Vec3(0, 0, -1))
          break
        case 'armR' :
          this.buildItem(k, chain_names, new Vec3(-1, 0, 0), new Vec3(0, 0, -1))
          break
        case 'legL' :
          this.buildItem(k, chain_names, new Vec3(0, 0, 1), new Vec3(0, -1, 0))
          break
        case 'legR' :
          this.buildItem(k, chain_names, new Vec3(0, 0, 1), new Vec3(0, -1, 0))
          break
      }
    }
    return this
  }

  // k = chain key like 'pelvis', 'armL', etc
  buildItem (k: string, names: string[], swing: Vec3, twist: Vec3): this {
    const rig_items: RigItem[] = []
    let j

    for (const n of names) {
      j = this.tpose.getJoint(n)
      if (j === null) {
        console.log('Error - Rig.buildLimb : Joint name not found in tpose, ', n)
        continue
      }

      rig_items.push(new RigItem().fromJoint(j, swing, twist))
    }

    this.chains[k] = rig_items
    return this
  }

  // This will only be used for the pelvis chain
  // it helps with calculations with hips where characters might have different heights
  private buildRigScalar (chain_key: string): this {
    const ch: RigItem[] = this.chains[chain_key]
    const j: Joint = this.tpose.joints[ch[0].idx]
    this.scalar = j.world.pos[1]
    return this
  }

  // debugSkelVectors (): void {
  //   // const bAry = this.skel.bones;
  //   const tran = new Transform()
  //   const v = new Vec3()

  //   for (const [chName, ch] of Object.entries(this.chains)) {
  //     for (const itm of ch) {
  //       getWorld(this.skel, itm.idx, tran)
  //       Debug.pnt.add(tran.pos, 0xffff00, 0.8)

  //       v.fromQuat(tran.rot, itm.swing).norm().scale(0.1).add(tran.pos)
  //       Debug.ln.add(tran.pos, v, 0xffff00)

  //       v.fromQuat(tran.rot, itm.twist).norm().scale(0.1).add(tran.pos)
  //       Debug.ln.add(tran.pos, v, 0xff00ff)
  //     }
  //   }
  // }

  // debugTPoseVectors (): void {
  //   // const bAry = this.skel.bones;
  //   const tran: Transform = new Transform()
  //   const v = new Vec3()

  //   for (const [chName, ch] of Object.entries(this.chains)) {
  //     for (const itm of ch) {
  //       this.tpose.getWorld(itm.idx, tran)
  //       // Debug.pnt.add(tran.pos, 0xffff00, 0.8)

  //       v.fromQuat(tran.rot, itm.swing).norm().scale(0.1).add(tran.pos)
  //       // Debug.ln.add(tran.pos, v, 0xffff00)

  //       v.fromQuat(tran.rot, itm.twist).norm().scale(0.1).add(tran.pos)
  //       // Debug.ln.add(tran.pos, v, 0xff00ff)
  //     }
  //   }
  // }
}
