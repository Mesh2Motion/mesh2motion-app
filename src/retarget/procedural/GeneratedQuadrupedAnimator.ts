import * as THREE from 'three'

export interface ProceduralQuadrupedSettings {
  speed: number
  stride: number
  knee: number
  lift: number
  body_bob: number
}

interface LegChain {
  bones: THREE.Bone[]
  side: 'left' | 'right'
  end: 'front' | 'back'
  phase: number
}

type QuadrupedGait = 'walk' | 'trot' | 'canter' | 'gallop'
export type ProceduralQuadrupedMode = QuadrupedGait | 'hop' | 'idle' | 'head-turn'

export interface ProceduralChainDebugInfo {
  type: 'leg' | 'head' | 'tail'
  label: string
  bones: string[]
}

export class GeneratedQuadrupedAnimator {
  private readonly skinned_mesh: THREE.SkinnedMesh
  private readonly rest_quaternions: Map<string, THREE.Quaternion> = new Map()
  private readonly rest_world_quaternions: Map<string, THREE.Quaternion> = new Map()
  private readonly rest_positions: Map<string, THREE.Vector3> = new Map()
  private leg_chains: LegChain[] = []
  private head_chain: THREE.Bone[] = []
  private tail_chain: THREE.Bone[] = []
  private time = 0

  constructor (skinned_mesh: THREE.SkinnedMesh) {
    this.skinned_mesh = skinned_mesh
    this.capture_rest_pose()
    this.leg_chains = this.detect_leg_chains()
    this.head_chain = this.detect_head_chain()
    this.tail_chain = this.detect_tail_chain()
  }

  public leg_chain_count (): number {
    return this.leg_chains.length
  }

  public debug_chains (): ProceduralChainDebugInfo[] {
    return [
      ...this.leg_chains.map(chain => ({
        type: 'leg' as const,
        label: `${chain.side} ${chain.end}`,
        bones: chain.bones.map(bone => bone.name)
      })),
      {
        type: 'head' as const,
        label: 'head',
        bones: this.head_chain.map(bone => bone.name)
      },
      {
        type: 'tail' as const,
        label: 'tail',
        bones: this.tail_chain.map(bone => bone.name)
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

  public update_walk (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.update_quadruped_gait(delta_time, settings, 'walk')
  }

  public update_trot (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.update_quadruped_gait(delta_time, settings, 'trot')
  }

  public update_canter (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.update_quadruped_gait(delta_time, settings, 'canter')
  }

  public update_gallop (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.update_quadruped_gait(delta_time, settings, 'gallop')
  }

  private update_quadruped_gait (
    delta_time: number,
    settings: ProceduralQuadrupedSettings,
    gait: QuadrupedGait
  ): void {
    this.time += delta_time
    this.restore_rest_pose()
    const gait_speed = gait === 'walk'
      ? 0.72
      : gait === 'trot'
        ? 1.05
        : gait === 'canter'
          ? 1.28
          : 1.62
    const stride_scale = gait === 'walk'
      ? 0.58
      : gait === 'trot'
        ? 0.82
        : gait === 'canter'
          ? 1.02
          : 1.25
    const lift_scale = gait === 'walk'
      ? 0.45
      : gait === 'trot'
        ? 0.72
        : gait === 'canter'
          ? 0.92
          : 1.16
    const speed = Math.PI * 2 * settings.speed * gait_speed

    this.leg_chains.forEach((chain) => {
      const side_sign = chain.side === 'left' ? 1 : -1
      const cycle = this.time * speed + this.phase_for_gait(chain, gait)
      const swing = Math.sin(cycle)
      const lift = Math.max(0, Math.cos(cycle))
      const [hip, upper, lower, foot] = chain.bones

      if (hip !== undefined) {
        this.apply_rest_quaternion_with_euler(
          hip,
          new THREE.Euler(swing * settings.stride * stride_scale * 0.55, 0, side_sign * 0.04)
        )
      }

      if (upper !== undefined) {
        this.apply_rest_quaternion_with_euler(
          upper,
          new THREE.Euler(swing * settings.stride * stride_scale, 0, 0)
        )
      }

      if (lower !== undefined) {
        this.apply_rest_quaternion_with_euler(
          lower,
          new THREE.Euler((-swing * settings.stride * stride_scale * 0.45) + (lift * settings.knee * lift_scale), 0, 0)
        )
      }

      if (foot !== undefined) {
        this.apply_rest_quaternion_with_euler(
          foot,
          new THREE.Euler(lift * settings.lift * lift_scale, 0, 0)
        )
      }
    })

    const bob_scale = gait === 'walk' ? 0.65 : gait === 'trot' ? 1 : gait === 'canter' ? 1.35 : 1.8
    const pitch = gait === 'walk'
      ? Math.sin(this.time * speed) * 0.025
      : gait === 'trot'
        ? Math.sin(this.time * speed * 2) * 0.035
        : gait === 'canter'
          ? Math.sin(this.time * speed) * 0.065
          : Math.sin(this.time * speed) * 0.09
    const root = this.skinned_mesh.skeleton.bones[0]
    this.apply_root_bob(Math.sin(this.time * speed * 2) * settings.body_bob * bob_scale)
    this.apply_rest_quaternion_with_euler(root, new THREE.Euler(pitch, 0, 0))
    this.apply_head_motion(Math.sin(this.time * speed * 0.5) * 0.05, Math.sin(this.time * speed * 0.35) * 0.04)
    this.apply_tail_motion(speed, settings.stride * (gait === 'gallop' ? 0.55 : 0.35))
  }

  private phase_for_gait (chain: LegChain, gait: QuadrupedGait): number {
    const is_left = chain.side === 'left'
    const is_front = chain.end === 'front'

    if (gait === 'walk') {
      if (!is_left && !is_front) return 0
      if (!is_left && is_front) return Math.PI * 0.5
      if (is_left && !is_front) return Math.PI
      return Math.PI * 1.5
    }

    if (gait === 'trot') {
      return (is_left && is_front) || (!is_left && !is_front) ? 0 : Math.PI
    }

    if (gait === 'canter') {
      if (!is_front) return is_left ? 0 : Math.PI * 0.25
      return is_left ? Math.PI * 0.72 : Math.PI * 1.05
    }

    if (!is_front) return is_left ? 0 : Math.PI * 0.18
    return is_left ? Math.PI * 0.5 : Math.PI * 0.68
  }

  public update_hop (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.time += delta_time
    this.restore_rest_pose()
    const speed = Math.PI * 2 * settings.speed
    const cycle = this.time * speed
    const sine = Math.sin(cycle)
    const crouch = Math.max(0, -sine)
    const airborne = Math.max(0, sine)
    const launch = Math.max(0, Math.sin(cycle - Math.PI * 0.18))

    this.leg_chains.forEach((chain) => {
      const [hip, upper, lower, foot] = chain.bones
      const side_sign = chain.side === 'left' ? 1 : -1
      const is_rear = chain.end === 'back'

      if (is_rear) {
        if (hip !== undefined) {
          this.apply_rest_quaternion_with_euler(
            hip,
            new THREE.Euler(
              (-crouch * settings.stride * 0.45) + (airborne * settings.stride * 0.2),
              0,
              side_sign * 0.03
            )
          )
        }
        if (upper !== undefined) {
          this.apply_rest_quaternion_with_euler(
            upper,
            new THREE.Euler((-crouch * settings.stride * 0.85) + (launch * settings.stride * 0.55), 0, 0)
          )
        }
        if (lower !== undefined) {
          this.apply_rest_quaternion_with_euler(
            lower,
            new THREE.Euler((crouch * settings.knee * 1.35) - (launch * settings.knee * 0.55), 0, 0)
          )
        }
        if (foot !== undefined) {
          this.apply_rest_quaternion_with_euler(
            foot,
            new THREE.Euler((-crouch * settings.lift * 0.75) + (airborne * settings.lift * 0.35), 0, 0)
          )
        }
      } else {
        const tuck = 0.35 + airborne * 0.65
        if (hip !== undefined) {
          this.apply_rest_quaternion_with_euler(hip, new THREE.Euler(tuck * settings.stride * 0.35, 0, side_sign * 0.05))
        }
        if (upper !== undefined) {
          this.apply_rest_quaternion_with_euler(upper, new THREE.Euler(tuck * settings.stride * 0.45, 0, 0))
        }
        if (lower !== undefined) {
          this.apply_rest_quaternion_with_euler(lower, new THREE.Euler(tuck * settings.knee * 0.45, 0, 0))
        }
      }
    })

    this.apply_root_bob((airborne * settings.body_bob * 7.5) - (crouch * settings.body_bob * 2.2))
    this.apply_body_forward_lean(-0.34 - (crouch * 0.12) + (airborne * 0.06))
    this.apply_head_motion((-0.1 - airborne * 0.025) + (crouch * 0.04), Math.sin(cycle * 0.35) * 0.015)
    this.apply_tail_counterbalance(settings.stride * 0.8, airborne, crouch)
  }

  public update_idle (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.time += delta_time
    this.restore_rest_pose()
    const breath = Math.sin(this.time * Math.PI * 2 * settings.speed * 0.35)
    const tiny_shift = Math.sin(this.time * Math.PI * 2 * settings.speed * 0.2)

    this.apply_root_bob(breath * settings.body_bob * 0.45)

    this.apply_head_motion(breath * 0.025, tiny_shift * 0.025)
    this.apply_tail_idle(breath * 0.04, tiny_shift * 0.05)
  }

  public update_head_turn (delta_time: number, settings: ProceduralQuadrupedSettings): void {
    this.time += delta_time
    this.restore_rest_pose()
    const yaw = Math.sin(this.time * Math.PI * 2 * settings.speed * 0.35) * 0.42
    const pitch = Math.sin(this.time * Math.PI * 2 * settings.speed * 0.18) * 0.04
    this.apply_head_world_turn(pitch, yaw)
  }

  public bake_walk_clip (
    name: string,
    duration: number,
    fps: number,
    settings: ProceduralQuadrupedSettings
  ): THREE.AnimationClip {
    return this.bake_clip(name, duration, fps, settings, 'walk')
  }

  public bake_idle_clip (
    name: string,
    duration: number,
    fps: number,
    settings: ProceduralQuadrupedSettings
  ): THREE.AnimationClip {
    return this.bake_clip(name, duration, fps, settings, 'idle')
  }

  public bake_motion_clip (
    name: string,
    duration: number,
    fps: number,
    settings: ProceduralQuadrupedSettings,
    mode: ProceduralQuadrupedMode
  ): THREE.AnimationClip {
    return this.bake_clip(name, duration, fps, settings, mode)
  }

  private bake_clip (
    name: string,
    duration: number,
    fps: number,
    settings: ProceduralQuadrupedSettings,
    mode: ProceduralQuadrupedMode
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
        const delta = 1 / fps
        if (mode === 'walk') this.update_walk(delta, settings)
        else if (mode === 'trot') this.update_trot(delta, settings)
        else if (mode === 'canter') this.update_canter(delta, settings)
        else if (mode === 'gallop') this.update_gallop(delta, settings)
        else if (mode === 'hop') this.update_hop(delta, settings)
        else if (mode === 'idle') this.update_idle(delta, settings)
        else this.update_head_turn(delta, settings)
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
    this.rest_world_quaternions.clear()
    this.rest_positions.clear()
    this.skinned_mesh.skeleton.bones.forEach(bone => bone.updateMatrixWorld(true))
    this.skinned_mesh.skeleton.bones.forEach((bone) => {
      this.rest_quaternions.set(bone.uuid, bone.quaternion.clone())
      this.rest_world_quaternions.set(bone.uuid, bone.getWorldQuaternion(new THREE.Quaternion()))
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

  private apply_rest_quaternion_with_euler (bone: THREE.Bone, euler: THREE.Euler): void {
    const rest_quaternion = this.rest_quaternions.get(bone.uuid)
    if (rest_quaternion === undefined) return

    bone.quaternion.copy(rest_quaternion).multiply(new THREE.Quaternion().setFromEuler(euler))
  }

  private apply_root_bob (amount: number): void {
    const root = this.skinned_mesh.skeleton.bones[0]
    const root_rest_position = this.rest_positions.get(root.uuid)
    if (root_rest_position !== undefined) {
      root.position.copy(root_rest_position)
      root.position.y += amount
    }
  }

  private apply_head_motion (pitch: number, yaw: number): void {
    this.head_chain.forEach((bone, index) => {
      const falloff = 1 / Math.max(index + 1, 1)
      this.apply_rest_quaternion_with_euler(
        bone,
        new THREE.Euler(pitch * falloff, yaw * falloff, 0)
      )
    })
  }

  private apply_head_world_turn (pitch: number, yaw: number): void {
    const pivot = this.head_chain[0]
    if (pivot === undefined) return

    const yaw_delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    const pitch_delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
    this.apply_rest_world_delta(pivot, yaw_delta.multiply(pitch_delta))
  }

  private apply_rest_world_delta (bone: THREE.Bone, world_delta: THREE.Quaternion): void {
    const rest_world_quaternion = this.rest_world_quaternions.get(bone.uuid)
    if (rest_world_quaternion === undefined) return

    const desired_world_quaternion = world_delta.clone().multiply(rest_world_quaternion)
    const parent_world_quaternion = new THREE.Quaternion()
    if (bone.parent !== null) {
      bone.parent.updateMatrixWorld(true)
      bone.parent.getWorldQuaternion(parent_world_quaternion)
    }

    bone.quaternion.copy(parent_world_quaternion.invert().multiply(desired_world_quaternion))
  }

  private apply_tail_motion (speed: number, amount: number): void {
    this.tail_chain.forEach((bone, index) => {
      const phase = this.time * speed + index * 0.55
      this.apply_rest_quaternion_with_euler(
        bone,
        new THREE.Euler(0, Math.sin(phase) * amount, Math.cos(phase) * amount * 0.35)
      )
    })
  }

  private apply_tail_idle (yaw: number, roll: number): void {
    this.tail_chain.forEach((bone, index) => {
      const phase_offset = index * 0.4
      this.apply_rest_quaternion_with_euler(
        bone,
        new THREE.Euler(0, Math.sin(this.time + phase_offset) * yaw, Math.cos(this.time + phase_offset) * roll)
      )
    })
  }

  private apply_body_forward_lean (pitch: number): void {
    const root = this.skinned_mesh.skeleton.bones[0]
    this.apply_rest_quaternion_with_euler(root, new THREE.Euler(pitch, 0, 0))
  }

  private apply_tail_counterbalance (amount: number, airborne: number, crouch: number): void {
    this.tail_chain.forEach((bone, index) => {
      const falloff = 1 - (index / Math.max(this.tail_chain.length, 1)) * 0.55
      this.apply_rest_quaternion_with_euler(
        bone,
        new THREE.Euler(
          (0.75 * amount + airborne * amount * 0.18 - crouch * amount * 0.08) * falloff,
          0,
          0
        )
      )
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

  private detect_leg_chains (): LegChain[] {
    this.skinned_mesh.updateMatrixWorld(true)
    const bones = this.skinned_mesh.skeleton.bones
    const world_positions = new Map<THREE.Bone, THREE.Vector3>()
    bones.forEach((bone) => {
      world_positions.set(bone, bone.getWorldPosition(new THREE.Vector3()))
    })

    const ys = Array.from(world_positions.values()).map(position => position.y)
    const min_y = Math.min(...ys)
    const max_y = Math.max(...ys)
    const height = Math.max(max_y - min_y, 0.0001)
    const leaves = bones.filter(bone => this.bone_children(bone).length === 0)

    const candidates = leaves
      .map((leaf) => {
        const chain = this.chain_to_root(leaf)
        const root_position = world_positions.get(chain[0]) ?? new THREE.Vector3()
        const leaf_position = world_positions.get(leaf) ?? new THREE.Vector3()
        return {
          chain,
          leaf_position,
          drop: root_position.y - leaf_position.y,
          low_score: (leaf_position.y - min_y) / height
        }
      })
      .filter(candidate => candidate.chain.length >= 3 && candidate.drop > height * 0.22 && candidate.low_score < 0.45)
      .sort((a, b) => {
        if (a.low_score !== b.low_score) return a.low_score - b.low_score
        return b.drop - a.drop
      })

    const selected: typeof candidates = []
    for (const candidate of candidates) {
      const too_close = selected.some(existing =>
        existing.leaf_position.distanceTo(candidate.leaf_position) < height * 0.18
      )
      if (!too_close) selected.push(candidate)
      if (selected.length === 4) break
    }

    const fallback = selected.length >= 4
      ? selected
      : candidates.slice(0, 4)

    if (fallback.length === 0) return []

    const z_values = fallback.map(candidate => candidate.leaf_position.z)
    const z_mid = z_values.reduce((sum, z) => sum + z, 0) / z_values.length

    return fallback.map((candidate) => {
      const side = candidate.leaf_position.x >= 0 ? 'left' : 'right'
      const end = candidate.leaf_position.z >= z_mid ? 'front' : 'back'
      const diagonal_phase = (side === 'left' && end === 'front') || (side === 'right' && end === 'back')
        ? 0
        : Math.PI

      return {
        bones: candidate.chain.slice(-4),
        side,
        end,
        phase: diagonal_phase
      }
    })
  }

  private detect_head_chain (): THREE.Bone[] {
    const bones = this.skinned_mesh.skeleton.bones
    const world_positions = this.world_positions()
    const leg_bone_names = new Set(this.leg_chains.flatMap(chain => chain.bones.map(bone => bone.name)))
    const candidates = bones
      .filter(bone => !leg_bone_names.has(bone.name))
      .map((bone) => {
        const position = world_positions.get(bone) ?? new THREE.Vector3()
        return { bone, position }
      })
      .sort((a, b) => b.position.z - a.position.z)

    const head_tip = candidates[0]?.bone
    if (head_tip === undefined) return []

    return this.chain_to_root(head_tip)
      .filter(bone => !leg_bone_names.has(bone.name))
      .slice(-4)
  }

  private detect_tail_chain (): THREE.Bone[] {
    const bones = this.skinned_mesh.skeleton.bones
    const world_positions = this.world_positions()
    const leg_bone_names = new Set(this.leg_chains.flatMap(chain => chain.bones.map(bone => bone.name)))
    const head_bone_names = new Set(this.head_chain.map(bone => bone.name))
    const leaves = bones.filter(bone => this.bone_children(bone).length === 0)
    const candidates = leaves
      .filter(bone => !leg_bone_names.has(bone.name) && !head_bone_names.has(bone.name))
      .map((bone) => {
        const position = world_positions.get(bone) ?? new THREE.Vector3()
        return { bone, position }
      })
      .sort((a, b) => a.position.z - b.position.z)

    const tail_tip = candidates[0]?.bone
    if (tail_tip === undefined) return []

    return this.chain_to_root(tail_tip)
      .filter(bone => !leg_bone_names.has(bone.name) && !head_bone_names.has(bone.name))
      .slice(-6)
  }

  private world_positions (): Map<THREE.Bone, THREE.Vector3> {
    this.skinned_mesh.updateMatrixWorld(true)
    const world_positions = new Map<THREE.Bone, THREE.Vector3>()
    this.skinned_mesh.skeleton.bones.forEach((bone) => {
      world_positions.set(bone, bone.getWorldPosition(new THREE.Vector3()))
    })
    return world_positions
  }
}
