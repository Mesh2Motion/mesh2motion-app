import * as THREE from 'three'
import type { ProceduralQuadrupedSettings } from './GeneratedQuadrupedAnimator.ts'

export type OctopusJiggleFocus = 'all' | 'body' | 'tentacles' | 'tips' | 'left' | 'right'

export interface ProceduralOctopusSettings extends ProceduralQuadrupedSettings {
  jiggle_amount: number
  jiggle_frequency: number
  jiggle_focus: OctopusJiggleFocus
}

interface TentacleChain {
  bones: THREE.Bone[]
  phase: number
  side_sign: number
  reach: number
}

export interface OctopusChainDebugInfo {
  type: 'tentacle' | 'body'
  label: string
  bones: string[]
}

export class GeneratedOctopusAnimator {
  private readonly skinned_mesh: THREE.SkinnedMesh
  private readonly rest_quaternions: Map<string, THREE.Quaternion> = new Map()
  private readonly rest_positions: Map<string, THREE.Vector3> = new Map()
  private tentacle_chains: TentacleChain[] = []
  private body_bones: THREE.Bone[] = []
  private time = 0

  constructor (skinned_mesh: THREE.SkinnedMesh) {
    this.skinned_mesh = skinned_mesh
    this.capture_rest_pose()
    this.tentacle_chains = this.detect_tentacle_chains()
    const tentacle_bones = new Set(this.tentacle_chains.flatMap(chain => chain.bones.map(bone => bone.uuid)))
    this.body_bones = this.skinned_mesh.skeleton.bones.filter(bone => !tentacle_bones.has(bone.uuid)).slice(0, 4)
  }

  public tentacle_chain_count (): number {
    return this.tentacle_chains.length
  }

  public debug_chains (): OctopusChainDebugInfo[] {
    return [
      ...this.tentacle_chains.map((chain, index) => ({
        type: 'tentacle' as const,
        label: `tentacle ${index + 1}`,
        bones: chain.bones.map(bone => bone.name)
      })),
      {
        type: 'body' as const,
        label: 'body',
        bones: this.body_bones.map(bone => bone.name)
      }
    ].filter(chain => chain.bones.length > 0)
  }

  public reset (): void {
    this.time = 0
    this.restore_rest_pose()
  }

  public recapture_rest_pose (): void {
    this.capture_rest_pose()
  }

  public update_idle (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.time += delta_time
    this.restore_rest_pose()
    const speed = Math.PI * 2 * settings.speed * 0.35
    const amount = Math.max(settings.stride, 0.12) * 0.32

    this.tentacle_chains.forEach((chain) => {
      this.apply_tentacle_wave(chain, speed, amount, settings.lift * 0.22, 0.72)
    })

    this.apply_body_drift(speed, settings.body_bob * 0.8, 0.04)
  }

  public update_swim (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.time += delta_time
    this.restore_rest_pose()
    const speed = Math.PI * 2 * settings.speed
    const amount = Math.max(settings.stride, 0.14) * 0.62

    this.tentacle_chains.forEach((chain) => {
      this.apply_tentacle_wave(chain, speed, amount, settings.lift * 0.55, 1.18)
    })

    this.apply_body_drift(speed, settings.body_bob * 1.6, 0.1)
  }

  public update_squirt_away (delta_time: number, settings: ProceduralOctopusSettings): void {
    this.time += delta_time
    this.restore_rest_pose()
    const speed = Math.PI * 2 * settings.speed * 0.82
    const cycle = this.time * speed
    const inhale = (Math.sin(cycle) + 1) * 0.5
    const jet = Math.max(0, Math.sin(cycle + Math.PI * 0.35))
    const contraction = jet * jet
    const amount = Math.max(settings.stride, 0.16) * 0.85

    this.tentacle_chains.forEach((chain) => {
      this.apply_tentacles_together(chain, cycle, amount, settings.lift, contraction)
    })

    this.apply_jet_body_motion(cycle, inhale, contraction, settings.body_bob, amount)
    this.apply_extra_jiggle(cycle, settings)
  }

  public bake_squirt_away_clip (
    name: string,
    duration: number,
    fps: number,
    settings: ProceduralOctopusSettings
  ): THREE.AnimationClip {
    const bones = this.skinned_mesh.skeleton.bones
    const times: number[] = []
    const quaternion_values = new Map<string, number[]>()
    const position_values = new Map<string, number[]>()
    const frame_count = Math.max(2, Math.ceil(duration * fps))

    bones.forEach((bone) => {
      quaternion_values.set(bone.name, [])
      position_values.set(bone.name, [])
    })

    this.reset()
    for (let frame = 0; frame <= frame_count; frame++) {
      const t = frame / fps
      times.push(Math.min(t, duration))

      if (frame > 0) {
        this.update_squirt_away(1 / fps, settings)
      }

      bones.forEach((bone) => {
        quaternion_values.get(bone.name)?.push(bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w)
        position_values.get(bone.name)?.push(bone.position.x, bone.position.y, bone.position.z)
      })
    }

    const tracks: THREE.KeyframeTrack[] = []
    bones.forEach((bone) => {
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${bone.name}.quaternion`,
        times,
        quaternion_values.get(bone.name) ?? []
      ))
      tracks.push(new THREE.VectorKeyframeTrack(
        `${bone.name}.position`,
        times,
        position_values.get(bone.name) ?? []
      ))
    })

    this.restore_rest_pose()
    return new THREE.AnimationClip(name, duration, tracks)
  }

  private capture_rest_pose (): void {
    this.rest_quaternions.clear()
    this.rest_positions.clear()
    this.skinned_mesh.skeleton.bones.forEach(bone => bone.updateMatrixWorld(true))
    this.skinned_mesh.skeleton.bones.forEach((bone) => {
      this.rest_quaternions.set(bone.uuid, bone.quaternion.clone())
      this.rest_positions.set(bone.uuid, bone.position.clone())
    })
  }

  private restore_rest_pose (): void {
    this.skinned_mesh.skeleton.bones.forEach((bone) => {
      const rest_quaternion = this.rest_quaternions.get(bone.uuid)
      const rest_position = this.rest_positions.get(bone.uuid)
      if (rest_quaternion !== undefined) bone.quaternion.copy(rest_quaternion)
      if (rest_position !== undefined) bone.position.copy(rest_position)
    })
    this.skinned_mesh.skeleton.bones.forEach(bone => bone.updateMatrixWorld(true))
  }

  private apply_tentacle_wave (
    chain: TentacleChain,
    speed: number,
    amount: number,
    lift: number,
    wavelength: number
  ): void {
    chain.bones.forEach((bone, index) => {
      const rest_quaternion = this.rest_quaternions.get(bone.uuid)
      if (rest_quaternion === undefined) return

      const progress = index / Math.max(chain.bones.length - 1, 1)
      const falloff = 0.25 + progress * 0.9
      const phase = this.time * speed - progress * Math.PI * wavelength + chain.phase
      const curl = Math.sin(phase) * amount * falloff
      const lateral = Math.cos(phase * 0.82) * amount * 0.45 * falloff * chain.side_sign
      const lift_wave = Math.sin(phase + Math.PI * 0.5) * lift * falloff

      bone.quaternion.copy(rest_quaternion).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          curl,
          lateral,
          lift_wave
        ))
      )
    })
  }

  private apply_body_drift (speed: number, bob: number, turn: number): void {
    const root = this.skinned_mesh.skeleton.bones[0]
    const root_rest_position = this.rest_positions.get(root.uuid)
    const root_rest_quaternion = this.rest_quaternions.get(root.uuid)
    if (root_rest_position !== undefined) {
      root.position.copy(root_rest_position)
      root.position.y += Math.sin(this.time * speed * 0.5) * bob
    }
    if (root_rest_quaternion !== undefined) {
      root.quaternion.copy(root_rest_quaternion).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          Math.sin(this.time * speed * 0.31) * turn,
          Math.sin(this.time * speed * 0.23) * turn * 0.8,
          Math.cos(this.time * speed * 0.29) * turn
        ))
      )
    }
  }

  private apply_tentacles_together (
    chain: TentacleChain,
    cycle: number,
    amount: number,
    lift: number,
    contraction: number
  ): void {
    chain.bones.forEach((bone, index) => {
      const rest_quaternion = this.rest_quaternions.get(bone.uuid)
      if (rest_quaternion === undefined) return

      const progress = index / Math.max(chain.bones.length - 1, 1)
      const tip_bias = 0.35 + progress * 0.95
      const trailing_wave = Math.sin(cycle - progress * Math.PI * 1.25 + chain.phase * 0.15)
      const gather = contraction * amount * tip_bias
      const curl = (-gather * 0.9) + trailing_wave * amount * 0.16 * tip_bias
      const inward = -chain.side_sign * gather * 0.62
      const tucked_lift = -Math.abs(gather) * Math.max(lift, 0.2) * 0.28

      bone.quaternion.copy(rest_quaternion).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          curl,
          inward,
          tucked_lift
        ))
      )
    })
  }

  private apply_jet_body_motion (
    cycle: number,
    inhale: number,
    contraction: number,
    bob: number,
    amount: number
  ): void {
    const root = this.skinned_mesh.skeleton.bones[0]
    const root_rest_position = this.rest_positions.get(root.uuid)
    const root_rest_quaternion = this.rest_quaternions.get(root.uuid)

    if (root_rest_position !== undefined) {
      root.position.copy(root_rest_position)
      root.position.y += Math.sin(cycle * 0.5) * bob * 0.8
      root.position.z -= contraction * amount * 0.12
    }

    if (root_rest_quaternion !== undefined) {
      root.quaternion.copy(root_rest_quaternion).multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(
          Math.sin(cycle * 0.5) * 0.035,
          Math.sin(cycle * 0.25) * 0.035,
          (inhale - 0.5) * 0.08
        ))
      )
    }
  }

  private apply_extra_jiggle (cycle: number, settings: ProceduralOctopusSettings): void {
    if (settings.jiggle_amount <= 0) return

    const speed = Math.max(settings.jiggle_frequency, 0.1)
    const amount = settings.jiggle_amount

    if (settings.jiggle_focus === 'all' || settings.jiggle_focus === 'body') {
      this.body_bones.forEach((bone, index) => {
        const phase = cycle * speed + index * 0.9
        bone.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(
            Math.sin(phase) * amount * 0.24,
            Math.cos(phase * 0.73) * amount * 0.18,
            Math.sin(phase * 1.17) * amount * 0.16
          ))
        )
      })
    }

    if (settings.jiggle_focus === 'body') return

    this.tentacle_chains.forEach((chain) => {
      if (settings.jiggle_focus === 'left' && chain.side_sign < 0) return
      if (settings.jiggle_focus === 'right' && chain.side_sign > 0) return

      chain.bones.forEach((bone, index) => {
        const progress = index / Math.max(chain.bones.length - 1, 1)
        const focus_scale = settings.jiggle_focus === 'tips'
          ? Math.max(0, (progress - 0.48) / 0.52)
          : 0.35 + progress * 0.65
        if (focus_scale <= 0) return

        const phase = cycle * speed + chain.phase + index * 0.82
        const pulse = Math.sin(phase) * amount * focus_scale
        bone.quaternion.multiply(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(
            pulse * 0.36,
            Math.cos(phase * 1.21) * amount * focus_scale * 0.28 * chain.side_sign,
            Math.sin(phase * 0.68) * amount * focus_scale * 0.2
          ))
        )
      })
    })
  }

  private bone_children (bone: THREE.Bone): THREE.Bone[] {
    return bone.children.filter((child): child is THREE.Bone => child instanceof THREE.Bone)
  }

  private chain_to_root (bone: THREE.Bone): THREE.Bone[] {
    const chain: THREE.Bone[] = []
    let current: THREE.Object3D | null = bone

    while (current instanceof THREE.Bone) {
      chain.unshift(current)
      current = current.parent
    }

    return chain
  }

  private detect_tentacle_chains (): TentacleChain[] {
    this.skinned_mesh.updateMatrixWorld(true)
    const bones = this.skinned_mesh.skeleton.bones
    const root = bones[0]
    const root_position = root.getWorldPosition(new THREE.Vector3())
    const leaves = bones.filter(bone => this.bone_children(bone).length === 0)

    const candidates = leaves
      .map((leaf) => {
        const leaf_position = leaf.getWorldPosition(new THREE.Vector3())
        const chain = this.chain_to_root(leaf)
        return {
          chain,
          leaf_position,
          reach: leaf_position.distanceTo(root_position)
        }
      })
      .filter(candidate => candidate.chain.length >= 5)
      .sort((a, b) => b.reach - a.reach)

    const selected: typeof candidates = []
    for (const candidate of candidates) {
      const too_close = selected.some(existing =>
        existing.leaf_position.distanceTo(candidate.leaf_position) < Math.max(existing.reach, candidate.reach) * 0.22
      )
      if (!too_close) selected.push(candidate)
      if (selected.length === 8) break
    }

    return selected
      .sort((a, b) => Math.atan2(a.leaf_position.z, a.leaf_position.x) - Math.atan2(b.leaf_position.z, b.leaf_position.x))
      .map((candidate, index, all) => {
        const angle = Math.atan2(candidate.leaf_position.z - root_position.z, candidate.leaf_position.x - root_position.x)
        return {
          bones: candidate.chain.slice(1),
          phase: (index / Math.max(all.length, 1)) * Math.PI * 2,
          side_sign: Math.cos(angle) >= 0 ? 1 : -1,
          reach: candidate.reach
        }
      })
  }
}
