import { Vector3, type Bone, type BufferGeometry, type Mesh } from 'three'
import { Generators } from '../../Generators'
import { Utility } from '../../Utilities.js'

export interface PaintedInfluence {
  bone_name: string
  weight: number
}

export type GeometryWeightOverrides = Map<number, PaintedInfluence[]>
export type ManualWeightOverrides = Map<number, GeometryWeightOverrides>
export type WeightPaintMode = 'add' | 'subtract'

/** One vertex touched by a brush, with the brush falloff at that vertex. */
export interface BrushVertex {
  vertex_index: number
  falloff: number
}

interface SkinBackup {
  indices: number[]
  weights: number[]
}

type BoneSide = 'left' | 'right' | null

interface MirrorData {
  center_x: number
  // vertex index -> mirrored vertex index
  map: Map<number, number>
}

interface UndoRecord {
  stroke_id: number
  overrides: ManualWeightOverrides
  // mesh -> vertex -> skin attributes before this stroke touched the vertex
  backups: Map<Mesh, Map<number, SkinBackup>>
}

/**
 * Stores per-vertex weight overrides made with the weight painting tool.
 *
 * Overrides are saved by geometry index and vertex index, matching the order of
 * StepLoadModel's geometry list. Bone influence is stored by name rather than
 * index, so adding/removing facial bones does not invalidate painted weights.
 *
 * Painted vertices fully replace the automatic weights for that vertex. The
 * rest of the mesh keeps its automatic weights.
 *
 * The same manager is used before binding (on the weight preview mesh) and in
 * the animation stage (on the final skinned meshes). It writes the new weights
 * into the mesh's skin attributes as well as storing the override, so a
 * skinned mesh deforms immediately while an animation is paused.
 */
export class WeightPaintManager {
  private overrides: ManualWeightOverrides = new Map()
  private undo_stack: UndoRecord[] = []
  private stroke_counter = 0
  private current_stroke_backups: Map<Mesh, Map<number, SkinBackup>> | null = null
  private readonly bone_colors = Generators.generate_deterministic_bone_colors(120)
  private readonly mirror_cache = new WeakMap<BufferGeometry, MirrorData | null>()

  /** Which side of the body a bone belongs to, based on common naming patterns. */
  public static bone_side (bone_name: string): BoneSide {
    const lower = bone_name.toLowerCase()
    if (lower.includes('left')) { return 'left' }
    if (lower.includes('right')) { return 'right' }
    if (/(^|[_.-])l$/.test(lower) || /^l[_.-]/.test(lower)) { return 'left' }
    if (/(^|[_.-])r$/.test(lower) || /^r[_.-]/.test(lower)) { return 'right' }
    return null
  }

  /** The bone on the opposite side with the same base name, e.g. upperarm_l -> upperarm_r. */
  public static find_mirror_bone_name (bone_name: string, bones: Bone[]): string | null {
    const source_side = WeightPaintManager.bone_side(bone_name)
    if (source_side === null) { return null }

    const base_name = Utility.calculate_bone_base_name(bone_name)
    const opposite_side = source_side === 'left' ? 'right' : 'left'
    const match = bones.find(bone =>
      bone.name !== bone_name &&
      Utility.calculate_bone_base_name(bone.name) === base_name &&
      WeightPaintManager.bone_side(bone.name) === opposite_side)
    return match?.name ?? null
  }

  /** Read-only view used by the skinning step when building the final meshes. */
  public overrides_for_skin (): ManualWeightOverrides {
    return this.overrides
  }

  public has_overrides (): boolean {
    for (const geometry_overrides of this.overrides.values()) {
      if (geometry_overrides.size > 0) { return true }
    }
    return false
  }

  public painted_vertex_count (): number {
    let count = 0
    for (const geometry_overrides of this.overrides.values()) {
      count += geometry_overrides.size
    }
    return count
  }

  public is_vertex_painted (geometry_index: number, vertex_index: number): boolean {
    return this.overrides.get(geometry_index)?.has(vertex_index) === true
  }

  public can_undo (): boolean {
    return this.undo_stack.length > 0
  }

  /** Monotonic marker that survives the undo-history size cap. */
  public undo_stack_marker (): number {
    return this.stroke_counter
  }

  public can_undo_since (marker: number): boolean {
    const latest = this.undo_stack[this.undo_stack.length - 1]
    return latest !== undefined && latest.stroke_id > marker
  }

  /** Call once at the start of a brush stroke so undo rolls back the whole stroke. */
  public begin_stroke (): void {
    const backups = new Map<Mesh, Map<number, SkinBackup>>()
    this.current_stroke_backups = backups
    this.stroke_counter++
    this.undo_stack.push({
      stroke_id: this.stroke_counter,
      overrides: this.clone_overrides(this.overrides),
      backups
    })
    if (this.undo_stack.length > 20) {
      this.undo_stack.shift()
    }
  }

  public undo (): boolean {
    const previous = this.undo_stack.pop()
    if (previous === undefined) { return false }
    this.overrides = previous.overrides
    this.restore_skin_backups(previous.backups)
    return true
  }

  /**
   * Undoes every stroke made after the marker. Used by the animation stage so
   * clearing only removes paint applied there, not weights painted before bind.
   */
  public clear_strokes_since (marker: number): boolean {
    let changed = false
    while (this.can_undo_since(marker)) {
      if (!this.undo()) { break }
      changed = true
    }
    return changed
  }

  public clear (): void {
    this.overrides.clear()
    this.undo_stack = []
    this.current_stroke_backups = null
  }

  /**
   * Applies a brush dab to a set of vertices.
   * @param mirror_enabled when true, the opposite side of the mesh is painted
   * with the matching mirror bone (upperarm_l -> upperarm_r). Center-line bones
   * are mirrored onto themselves so both sides stay symmetric.
   * @returns how many vertices actually changed
   */
  public paint_vertices (
    mesh: Mesh,
    geometry_index: number,
    vertices: BrushVertex[],
    bone_name: string,
    bones: Bone[],
    strength: number,
    mode: WeightPaintMode,
    mirror_enabled: boolean = false
  ): number {
    if (vertices.length === 0) { return 0 }

    let geometry_overrides = this.overrides.get(geometry_index)
    if (geometry_overrides === undefined) {
      geometry_overrides = new Map()
      this.overrides.set(geometry_index, geometry_overrides)
    }

    const mirror_data = mirror_enabled ? this.mirror_data(mesh) : null
    if (mirror_data === null) {
      return this.apply_brush(mesh, geometry_overrides, vertices, bone_name, bones, strength, mode)
    }

    const side = WeightPaintManager.bone_side(bone_name)
    if (side === null) {
      // Center-line bone: paint the union of the brush and its mirror once.
      const combined = new Map<number, number>()
      for (const vertex of vertices) {
        combined.set(vertex.vertex_index,
          Math.max(combined.get(vertex.vertex_index) ?? 0, vertex.falloff))
        const mirrored_index = mirror_data.map.get(vertex.vertex_index)
        if (mirrored_index !== undefined) {
          combined.set(mirrored_index, Math.max(combined.get(mirrored_index) ?? 0, vertex.falloff))
        }
      }
      const combined_vertices: BrushVertex[] = [...combined].map(([vertex_index, falloff]) =>
        ({ vertex_index, falloff }))
      return this.apply_brush(mesh, geometry_overrides, combined_vertices, bone_name, bones, strength, mode)
    }

    // Side bone: direct-paint only the matching side and mirror the other side
    // with the counterpart bone.
    const positions = mesh.geometry.attributes.position
    const direct_vertices = vertices.filter((vertex) => {
      const x = positions.getX(vertex.vertex_index) - mirror_data.center_x
      return side === 'left' ? x > 0 : x < 0
    })
    if (direct_vertices.length === 0) { return 0 }

    const mirrored_falloffs = new Map<number, number>()
    for (const vertex of direct_vertices) {
      const mirrored_index = mirror_data.map.get(vertex.vertex_index)
      if (mirrored_index !== undefined) {
        mirrored_falloffs.set(mirrored_index,
          Math.max(mirrored_falloffs.get(mirrored_index) ?? 0, vertex.falloff))
      }
    }
    const mirrored_vertices: BrushVertex[] = [...mirrored_falloffs].map(([vertex_index, falloff]) =>
      ({ vertex_index, falloff }))
    const mirror_bone_name = WeightPaintManager.find_mirror_bone_name(bone_name, bones) ?? bone_name

    let painted_count = this.apply_brush(mesh, geometry_overrides, direct_vertices, bone_name, bones, strength, mode)
    if (mirrored_vertices.length > 0) {
      painted_count += this.apply_brush(mesh, geometry_overrides, mirrored_vertices, mirror_bone_name, bones, strength, mode)
    }
    return painted_count
  }

  private apply_brush (
    mesh: Mesh,
    geometry_overrides: GeometryWeightOverrides,
    vertices: BrushVertex[],
    bone_name: string,
    bones: Bone[],
    strength: number,
    mode: WeightPaintMode
  ): number {
    let painted_count = 0
    for (const brush_vertex of vertices) {
      const current = this.current_influences(mesh, geometry_overrides, brush_vertex.vertex_index, bones)
      const current_weight = current.get(bone_name) ?? 0
      const amount = Math.min(1, Math.max(0, strength * brush_vertex.falloff))
      const target_weight = mode === 'add'
        ? current_weight + (1 - current_weight) * amount
        : current_weight * (1 - amount)

      const updated = this.renormalize(current, bone_name, target_weight, bones)
      this.record_stroke_backup(mesh, brush_vertex.vertex_index)
      geometry_overrides.set(brush_vertex.vertex_index, updated)
      this.write_skin_influences(mesh, brush_vertex.vertex_index, updated, bones)
      this.recolor_vertex(mesh, brush_vertex.vertex_index, updated, bones)
      painted_count++
    }

    if (painted_count > 0) {
      this.mark_skin_attributes_dirty(mesh)
    }
    const color_attribute = mesh.geometry.attributes.color
    if (color_attribute !== undefined) {
      color_attribute.needsUpdate = true
    }
    return painted_count
  }

  /**
   * Finds matching vertices across the model's X symmetry plane. Built lazily
   * and cached per geometry; only used when mirror painting is enabled.
   */
  private mirror_data (mesh: Mesh): MirrorData | null {
    const geometry = mesh.geometry
    if (this.mirror_cache.has(geometry)) {
      return this.mirror_cache.get(geometry) ?? null
    }
    const data = this.build_mirror_data(geometry)
    this.mirror_cache.set(geometry, data)
    return data
  }

  private build_mirror_data (geometry: BufferGeometry): MirrorData | null {
    const positions = geometry.attributes.position
    if (positions === undefined || positions.count === 0) { return null }

    geometry.computeBoundingBox()
    const box = geometry.boundingBox
    if (box === null) { return null }

    const center_x = (box.min.x + box.max.x) / 2
    const size = box.getSize(new Vector3())
    const tolerance = Math.max(size.length() * 0.0015, 1e-6)
    const cell = tolerance
    const key = (x: number, y: number, z: number): string =>
      `${Math.round(x / cell)}|${Math.round(y / cell)}|${Math.round(z / cell)}`

    const buckets = new Map<string, number[]>()
    for (let i = 0; i < positions.count; i++) {
      const bucket_key = key(positions.getX(i), positions.getY(i), positions.getZ(i))
      const bucket = buckets.get(bucket_key)
      if (bucket === undefined) {
        buckets.set(bucket_key, [i])
      } else {
        bucket.push(i)
      }
    }

    const map = new Map<number, number>()
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i)
      if (Math.abs(x - center_x) <= tolerance) { continue } // center line maps to itself
      const y = positions.getY(i)
      const z = positions.getZ(i)
      const mirrored_x = 2 * center_x - x
      const source_side = Math.sign(x - center_x)

      let best_index = -1
      let best_distance = tolerance * tolerance
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = buckets.get(key(mirrored_x + dx * cell, y + dy * cell, z + dz * cell))
            if (bucket === undefined) { continue }
            for (const candidate of bucket) {
              if (candidate === i) { continue }
              if (Math.sign(positions.getX(candidate) - center_x) === source_side) { continue }
              const ddx = positions.getX(candidate) - mirrored_x
              const ddy = positions.getY(candidate) - y
              const ddz = positions.getZ(candidate) - z
              const distance = ddx * ddx + ddy * ddy + ddz * ddz
              if (distance < best_distance) {
                best_distance = distance
                best_index = candidate
              }
            }
          }
        }
      }
      if (best_index >= 0) {
        map.set(i, best_index)
      }
    }

    return { center_x, map }
  }

  /**
   * Writes painted overrides into a geometry's skin arrays. Vertices that were
   * not painted, or whose bones no longer exist, keep the automatic weights.
   */
  public static apply_overrides (
    overrides: ManualWeightOverrides,
    geometry_index: number,
    bones: Bone[],
    skin_indices: number[],
    skin_weights: number[]
  ): void {
    const geometry_overrides = overrides.get(geometry_index)
    if (geometry_overrides === undefined) { return }

    const bone_index_by_name = new Map<string, number>()
    bones.forEach((bone, index) => bone_index_by_name.set(bone.name, index))

    for (const [vertex_index, influences] of geometry_overrides) {
      const resolved = influences
        .map(influence => ({
          bone_index: bone_index_by_name.get(influence.bone_name),
          weight: influence.weight
        }))
        .filter((influence): influence is { bone_index: number, weight: number } =>
          influence.bone_index !== undefined && influence.weight > 0)
      if (resolved.length === 0) { continue }

      const total = resolved.reduce((sum, influence) => sum + influence.weight, 0)
      const offset = vertex_index * 4
      for (let slot = 0; slot < 4; slot++) {
        const influence = resolved[slot]
        if (influence === undefined) {
          skin_indices[offset + slot] = 0
          skin_weights[offset + slot] = 0
          continue
        }
        skin_indices[offset + slot] = influence.bone_index
        skin_weights[offset + slot] = total > 0 ? influence.weight / total : 0
      }
    }
  }

  private current_influences (
    mesh: Mesh,
    geometry_overrides: GeometryWeightOverrides,
    vertex_index: number,
    bones: Bone[]
  ): Map<string, number> {
    const existing = geometry_overrides.get(vertex_index)
    if (existing !== undefined) {
      return new Map(existing.map(influence => [influence.bone_name, influence.weight]))
    }

    const influences = new Map<string, number>()
    const skin_indices = mesh.geometry.attributes.skinIndex
    const skin_weights = mesh.geometry.attributes.skinWeight
    if (skin_indices === undefined || skin_weights === undefined) {
      return influences
    }

    for (let slot = 0; slot < 4; slot++) {
      const weight = skin_weights.array[vertex_index * 4 + slot] as number
      if (weight <= 0) { continue }
      const bone_index = skin_indices.array[vertex_index * 4 + slot] as number
      const bone_name = bones[bone_index]?.name
      if (bone_name === undefined) { continue }
      influences.set(bone_name, (influences.get(bone_name) ?? 0) + weight)
    }
    return influences
  }

  /** Writes resolved influences back into the mesh's skin attributes. */
  private write_skin_influences (
    mesh: Mesh,
    vertex_index: number,
    influences: PaintedInfluence[],
    bones: Bone[]
  ): void {
    const skin_indices = mesh.geometry.attributes.skinIndex
    const skin_weights = mesh.geometry.attributes.skinWeight
    if (skin_indices === undefined || skin_weights === undefined) { return }

    const bone_index_by_name = new Map<string, number>()
    bones.forEach((bone, index) => bone_index_by_name.set(bone.name, index))

    const resolved = influences
      .map(influence => ({
        bone_index: bone_index_by_name.get(influence.bone_name),
        weight: influence.weight
      }))
      .filter((influence): influence is { bone_index: number, weight: number } =>
        influence.bone_index !== undefined && influence.weight > 0)

    const total = resolved.reduce((sum, influence) => sum + influence.weight, 0)
    const offset = vertex_index * 4
    for (let slot = 0; slot < 4; slot++) {
      const influence = resolved[slot]
      if (influence === undefined) {
        skin_indices.array[offset + slot] = 0
        skin_weights.array[offset + slot] = 0
        continue
      }
      skin_indices.array[offset + slot] = influence.bone_index
      skin_weights.array[offset + slot] = total > 0 ? influence.weight / total : 0
    }
  }

  private record_stroke_backup (mesh: Mesh, vertex_index: number): void {
    if (this.current_stroke_backups === null) { return }

    let mesh_backups = this.current_stroke_backups.get(mesh)
    if (mesh_backups === undefined) {
      mesh_backups = new Map()
      this.current_stroke_backups.set(mesh, mesh_backups)
    }
    if (mesh_backups.has(vertex_index)) { return }

    const skin_indices = mesh.geometry.attributes.skinIndex
    const skin_weights = mesh.geometry.attributes.skinWeight
    const backup: SkinBackup = { indices: [0, 0, 0, 0], weights: [0, 0, 0, 0] }
    if (skin_indices !== undefined && skin_weights !== undefined) {
      for (let slot = 0; slot < 4; slot++) {
        backup.indices[slot] = skin_indices.array[vertex_index * 4 + slot] as number
        backup.weights[slot] = skin_weights.array[vertex_index * 4 + slot] as number
      }
    }
    mesh_backups.set(vertex_index, backup)
  }

  private restore_skin_backups (backups: Map<Mesh, Map<number, SkinBackup>>): void {
    for (const [mesh, mesh_backups] of backups) {
      const skin_indices = mesh.geometry.attributes.skinIndex
      const skin_weights = mesh.geometry.attributes.skinWeight
      if (skin_indices === undefined || skin_weights === undefined) { continue }

      for (const [vertex_index, backup] of mesh_backups) {
        for (let slot = 0; slot < 4; slot++) {
          skin_indices.array[vertex_index * 4 + slot] = backup.indices[slot]
          skin_weights.array[vertex_index * 4 + slot] = backup.weights[slot]
        }
      }
      this.mark_skin_attributes_dirty(mesh)
    }
  }

  private mark_skin_attributes_dirty (mesh: Mesh): void {
    const skin_indices = mesh.geometry.attributes.skinIndex
    const skin_weights = mesh.geometry.attributes.skinWeight
    if (skin_indices !== undefined) { skin_indices.needsUpdate = true }
    if (skin_weights !== undefined) { skin_weights.needsUpdate = true }
  }

  /**
   * Gives the painted bone the requested weight and redistributes the rest
   * across its existing influences. If nothing else influences the vertex, the
   * freed weight goes to the bone's parent (e.g. erasing jaw weight on the nose
   * hands it to the head instead of leaving a hole).
   */
  private renormalize (
    current: Map<string, number>,
    bone_name: string,
    target_weight: number,
    bones: Bone[]
  ): PaintedInfluence[] {
    const target = Math.min(1, Math.max(0, target_weight))
    if (target >= 1 - 1e-6) {
      return [{ bone_name, weight: 1 }]
    }

    const others = [...current.entries()]
      .filter(([name, weight]) => name !== bone_name && weight > 0)
    let other_sum = others.reduce((sum, [, weight]) => sum + weight, 0)

    if (other_sum <= 0) {
      const fallback = this.fallback_bone_name(bone_name, bones)
      if (fallback !== null) {
        others.push([fallback, 1])
        other_sum = 1
      } else if (target <= 1e-6) {
        return []
      }
    }

    const influences: PaintedInfluence[] = []
    if (target > 1e-6) {
      influences.push({ bone_name, weight: target })
    }
    const remaining = 1 - target
    if (other_sum > 0) {
      for (const [name, weight] of others) {
        influences.push({ bone_name: name, weight: (weight / other_sum) * remaining })
      }
    }

    return influences
      .filter(influence => influence.weight > 1e-6)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
  }

  private fallback_bone_name (bone_name: string, bones: Bone[]): string | null {
    const bone = bones.find(candidate => candidate.name === bone_name)
    if (bone !== undefined) {
      const parent = bone.parent
      if (parent !== null && bones.includes(parent as Bone) && parent.name !== 'root') {
        return parent.name
      }
    }

    const head = bones.find(candidate => /^(DEF[-_.])?head$/i.test(candidate.name))
    if (head !== undefined && head.name !== bone_name) { return head.name }

    const fallback = bones.find(candidate => candidate.name !== 'root' && candidate.name !== bone_name)
    return fallback?.name ?? null
  }

  /** Colors a painted vertex by its strongest bone, matching the weight preview colors. */
  private recolor_vertex (mesh: Mesh, vertex_index: number, influences: PaintedInfluence[], bones: Bone[]): void {
    const color_attribute = mesh.geometry.attributes.color
    if (color_attribute === undefined || influences.length === 0) { return }

    const primary_bone_index = bones.findIndex(bone => bone.name === influences[0].bone_name)
    const color = this.bone_colors[primary_bone_index] ?? new Vector3(1, 1, 1)
    color_attribute.setXYZ(vertex_index, color.x, color.y, color.z)
  }

  private clone_overrides (overrides: ManualWeightOverrides): ManualWeightOverrides {
    const copy: ManualWeightOverrides = new Map()
    for (const [geometry_index, geometry_overrides] of overrides) {
      const geometry_copy: GeometryWeightOverrides = new Map()
      for (const [vertex_index, influences] of geometry_overrides) {
        geometry_copy.set(vertex_index, influences.map(influence => ({ ...influence })))
      }
      copy.set(geometry_index, geometry_copy)
    }
    return copy
  }
}
