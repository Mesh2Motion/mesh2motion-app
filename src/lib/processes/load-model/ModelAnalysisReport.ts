import { Box3, SRGBColorSpace, Vector3, type BufferGeometry, type Material, type Mesh, type MeshPhongMaterial, type MeshStandardMaterial, type Object3D, type Texture } from 'three'
import { ModalDialog } from '../../ModalDialog.ts'
import { MODEL_HEIGHT_LIMIT } from './ModelCleanupUtility.ts'

/**
 * Materials arrive as whatever type the file's loader picked, so read them
 * through one shape that covers the properties we report on and treat anything
 * the material does not have as absent.
 */
type InspectableMaterial = Material & Partial<MeshStandardMaterial & MeshPhongMaterial>

/** Texture slots worth listing, in the order they show up in the report. */
const TEXTURE_SLOTS: Array<[keyof InspectableMaterial, string]> = [
  ['map', 'color'],
  ['emissiveMap', 'emissive'],
  ['normalMap', 'normal'],
  ['bumpMap', 'bump'],
  ['roughnessMap', 'roughness'],
  ['metalnessMap', 'metalness'],
  ['specularMap', 'specular'],
  ['aoMap', 'ambient occlusion'],
  ['alphaMap', 'alpha'],
  ['displacementMap', 'displacement']
]

/**
 * What one material on one mesh looked like at import time. Emissive gets its
 * own fields because it is the property most likely to come in wrong from an
 * FBX and then follow the model all the way out to a GLB export.
 */
export interface MaterialInfo {
  name: string
  type: string
  color_hex: string | null
  emissive_hex: string | null
  emissive_intensity: number
  /**
   * Brightest channel of the emissive color on its own. A GLB export writes the
   * color straight into emissiveFactor whenever this is above zero, so this is
   * the number that decides whether the exported model glows.
   */
  emissive_strength: number
  /**
   * Whether emissive intensity survives an export. Only MeshStandardMaterial
   * carries it, through the KHR_materials_emissive_strength extension. FBX files
   * usually load as MeshPhongMaterial, where the intensity dims the model in the
   * viewport but is dropped on export, leaving the full emissive color behind.
   */
  exports_emissive_intensity: boolean
  specular_hex: string | null
  metalness: number | null
  roughness: number | null
  shininess: number | null
  opacity: number
  transparent: boolean
  vertex_colors: boolean
  side: string
  texture_slots: string[]
}

/**
 * Snapshot of a single mesh-bearing object, taken at a point in time so later
 * processing steps cannot change the numbers we are reporting on.
 */
export interface AnalyzedObject {
  name: string
  type: string
  parent_name: string
  depth: number
  position: Vector3
  rotation_degrees: Vector3
  scale: Vector3
  world_scale: Vector3
  world_size: Vector3
  // parent objects between this mesh and the scene root that carry their own transform
  transformed_ancestors: string[]
  vertex_count: number
  triangle_count: number
  materials: MaterialInfo[]
  has_uvs: boolean
  has_normals: boolean
  has_skin_weights: boolean
  warnings: string[]
}

/** Everything we can say about one scene graph at one moment. */
export interface SceneSnapshot {
  objects: AnalyzedObject[]
  type_counts: Record<string, number>
  mesh_count: number
  skinned_mesh_count: number
  vertex_count: number
  triangle_count: number
  world_size: Vector3
  world_min: Vector3
  world_max: Vector3
}

/**
 * Before/after pair for one import. `imported` is what came out of the file
 * loader and `processed` is the mesh data the rest of the app actually works
 * with, which makes it possible to see what import processing changed.
 */
export interface ModelImportAnalysis {
  source_name: string
  imported: SceneSnapshot
  processed: SceneSnapshot
}

/** A warning message plus the objects it applies to, for grouped display. */
interface GroupedWarning {
  message: string
  object_names: string[]
}

/**
 * Builds a human readable report of what a model file contained and what the
 * import turned it into. Purely diagnostic - nothing here mutates model data
 * beyond lazily computing geometry bounding boxes.
 */
export class ModelAnalysisReport {
  // object transforms this far from identity are treated as intentional
  private static readonly TRANSFORM_EPSILON = 0.0001

  // rotation this far from zero (in degrees) is treated as intentional
  private static readonly ROTATION_EPSILON_DEGREES = 0.01

  // emissive brightness above this is enough to visibly wash a model out
  private static readonly EMISSIVE_EPSILON = 0.01

  /**
   * Walk a scene and record everything worth reporting on.
   * @param scene_object root of the scene graph to inspect
   */
  public static snapshot_scene (scene_object: Object3D): SceneSnapshot {
    // world matrices drive the world scale/size numbers below
    scene_object.updateMatrixWorld(true)

    const objects: AnalyzedObject[] = []
    const type_counts: Record<string, number> = {}
    const scene_box: Box3 = new Box3()

    let vertex_count = 0
    let triangle_count = 0
    let mesh_count = 0
    let skinned_mesh_count = 0

    scene_object.traverse((child: Object3D) => {
      // the root itself isn't part of the file's contents listing
      if (child !== scene_object) {
        type_counts[child.type] = (type_counts[child.type] ?? 0) + 1
      }

      if (child.type !== 'Mesh' && child.type !== 'SkinnedMesh') {
        return
      }

      const analyzed: AnalyzedObject = this.analyze_mesh(child as Mesh, scene_object)
      objects.push(analyzed)

      vertex_count += analyzed.vertex_count
      triangle_count += analyzed.triangle_count
      if (child.type === 'SkinnedMesh') {
        skinned_mesh_count++
      } else {
        mesh_count++
      }

      const mesh_box: Box3 = this.world_box_for_mesh(child as Mesh)
      if (!mesh_box.isEmpty()) {
        scene_box.union(mesh_box)
      }
    })

    return {
      objects,
      type_counts,
      mesh_count,
      skinned_mesh_count,
      vertex_count,
      triangle_count,
      world_size: scene_box.isEmpty() ? new Vector3() : scene_box.getSize(new Vector3()),
      world_min: scene_box.isEmpty() ? new Vector3() : scene_box.min.clone(),
      world_max: scene_box.isEmpty() ? new Vector3() : scene_box.max.clone()
    }
  }

  private static analyze_mesh (mesh: Mesh, scene_root: Object3D): AnalyzedObject {
    const geometry: BufferGeometry = mesh.geometry
    const position_attribute = geometry.getAttribute('position')
    const world_box: Box3 = this.world_box_for_mesh(mesh)

    const analyzed: AnalyzedObject = {
      name: mesh.name === '' ? '(unnamed)' : mesh.name,
      type: mesh.type,
      parent_name: this.parent_label(mesh, scene_root),
      depth: this.depth_in_scene(mesh, scene_root),
      position: mesh.position.clone(),
      rotation_degrees: new Vector3(
        this.radians_to_degrees(mesh.rotation.x),
        this.radians_to_degrees(mesh.rotation.y),
        this.radians_to_degrees(mesh.rotation.z)
      ),
      scale: mesh.scale.clone(),
      world_scale: mesh.getWorldScale(new Vector3()),
      world_size: world_box.isEmpty() ? new Vector3() : world_box.getSize(new Vector3()),
      transformed_ancestors: this.find_transformed_ancestors(mesh, scene_root),
      vertex_count: position_attribute === undefined ? 0 : position_attribute.count,
      triangle_count: this.count_triangles(geometry),
      materials: this.analyze_materials(mesh.material),
      has_uvs: geometry.getAttribute('uv') !== undefined,
      has_normals: geometry.getAttribute('normal') !== undefined,
      has_skin_weights: geometry.getAttribute('skinWeight') !== undefined,
      warnings: []
    }

    analyzed.warnings = this.collect_object_warnings(analyzed)
    return analyzed
  }

  /**
   * Bounding box of just this mesh's own geometry in world space. Deliberately
   * not Box3.setFromObject, which would fold in child meshes as well.
   */
  private static world_box_for_mesh (mesh: Mesh): Box3 {
    const box: Box3 = new Box3()
    const geometry: BufferGeometry = mesh.geometry

    if (geometry.getAttribute('position') === undefined) {
      return box
    }

    if (geometry.boundingBox === null) {
      geometry.computeBoundingBox()
    }

    if (geometry.boundingBox !== null) {
      box.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld)
    }

    return box
  }

  private static count_triangles (geometry: BufferGeometry): number {
    const index = geometry.getIndex()
    if (index !== null) {
      return Math.floor(index.count / 3)
    }

    const position_attribute = geometry.getAttribute('position')
    if (position_attribute === undefined) {
      return 0
    }

    return Math.floor(position_attribute.count / 3)
  }

  private static analyze_materials (material: Material | Material[]): MaterialInfo[] {
    if (Array.isArray(material)) {
      return material
        .filter((entry) => entry !== undefined && entry !== null)
        .map((entry) => this.analyze_material(entry))
    }

    if (material === undefined || material === null) {
      return []
    }

    return [this.analyze_material(material)]
  }

  /**
   * Pull the material properties that explain how a mesh ends up looking, both
   * in the viewport and after export. Anything the material type does not have
   * comes back as null rather than a made up default.
   */
  private static analyze_material (material: Material): MaterialInfo {
    const inspectable: InspectableMaterial = material as InspectableMaterial

    // three defaults emissiveIntensity to 1, but a material type without any
    // emissive support has neither property
    const emissive_intensity: number = inspectable.emissiveIntensity ?? 1
    const emissive_strength: number = inspectable.emissive === undefined
      ? 0
      : Math.max(inspectable.emissive.r, inspectable.emissive.g, inspectable.emissive.b)

    return {
      name: material.name,
      type: material.type,
      color_hex: inspectable.color === undefined ? null : `#${inspectable.color.getHexString(SRGBColorSpace)}`,
      emissive_hex: inspectable.emissive === undefined ? null : `#${inspectable.emissive.getHexString(SRGBColorSpace)}`,
      emissive_intensity,
      emissive_strength,
      exports_emissive_intensity: inspectable.isMeshStandardMaterial === true,
      specular_hex: inspectable.specular === undefined ? null : `#${inspectable.specular.getHexString(SRGBColorSpace)}`,
      metalness: inspectable.metalness ?? null,
      roughness: inspectable.roughness ?? null,
      shininess: inspectable.shininess ?? null,
      opacity: material.opacity,
      transparent: material.transparent,
      vertex_colors: material.vertexColors,
      side: this.describe_material_side(material.side),
      texture_slots: this.find_texture_slots(inspectable)
    }
  }

  /** Names of the texture slots this material actually has a texture in. */
  private static find_texture_slots (material: InspectableMaterial): string[] {
    return TEXTURE_SLOTS
      .filter(([property]) => {
        const texture: Texture | null | undefined = material[property] as Texture | null | undefined
        return texture !== undefined && texture !== null
      })
      .map(([, label]) => label)
  }

  private static describe_material_side (side: number): string {
    switch (side) {
      case 1: return 'back faces'
      case 2: return 'double sided'
      default: return 'front faces'
    }
  }

  /**
   * Transforms themselves are no longer a problem, since import bakes them into
   * the vertices. What is left are the transforms that stay visible in the result
   * either way, plus missing geometry data.
   */
  private static collect_object_warnings (analyzed: AnalyzedObject): string[] {
    const warnings: string[] = []

    if (!this.is_uniform_scale(analyzed.scale)) {
      warnings.push('Object scale is non-uniform (different per axis). The mesh is stretched on one axis, which carries through to the skinning.')
    }

    if (analyzed.scale.x < 0 || analyzed.scale.y < 0 || analyzed.scale.z < 0) {
      warnings.push('Object is mirrored (negative scale). Import applies the mirror and reverses the face winding to compensate, so double check this part looks right.')
    }

    if (analyzed.vertex_count === 0) {
      warnings.push('Mesh has no vertex data.')
    }

    if (!analyzed.has_normals) {
      warnings.push('Mesh has no normals, so it will shade incorrectly.')
    }

    if (!analyzed.has_uvs) {
      warnings.push('Mesh has no UV coordinates, so textures cannot be applied.')
    }

    if (analyzed.type === 'SkinnedMesh') {
      warnings.push('Mesh is already rigged. This workflow drops the existing skeleton - use "Use Your Rigged Model" to keep it.')
    }

    analyzed.materials.forEach((material) => {
      warnings.push(...this.collect_material_warnings(material))
    })

    return warnings
  }

  /**
   * Material problems that follow the model out to an export. The FBX loader
   * already drops emissive on the way in, since it cannot round trip, so what is
   * left here is a glow that a GLB or GLTF file asked for on purpose.
   */
  private static collect_material_warnings (material: MaterialInfo): string[] {
    const warnings: string[] = []
    const label: string = this.material_label(material)

    if (material.emissive_strength <= this.EMISSIVE_EPSILON) {
      return warnings
    }

    warnings.push(`${label} has an emissive (glow) color of ${material.emissive_hex ?? '-'}. A GLB export writes that color into emissiveFactor, so the model glows no matter how it is lit. Emissive should usually be black (#000000) unless the part is meant to light up.`)

    // the case that catches people out: the viewport dims the glow by the
    // intensity, the export does not, so the exported model comes back brighter
    // than what was on screen here
    if (!material.exports_emissive_intensity && Math.abs(material.emissive_intensity - 1) > this.EMISSIVE_EPSILON) {
      warnings.push(`${label} dims that glow with an emissive intensity of ${this.format_number(material.emissive_intensity)}, but only standard (PBR) materials can store intensity in a GLB. This one is a ${material.type}, so the export keeps the full emissive color and drops the intensity - the exported model will glow more than it does here.`)
    }

    return warnings
  }

  /** How a material is referred to in warning text. */
  private static material_label (material: MaterialInfo): string {
    return material.name === '' ? `Material (${material.type})` : `Material "${material.name}"`
  }

  /** Scene wide observations that no single object can tell us. */
  private static collect_scene_warnings (analysis: ModelImportAnalysis): string[] {
    const warnings: string[] = []
    const imported: SceneSnapshot = analysis.imported
    const processed: SceneSnapshot = analysis.processed

    if (imported.objects.length === 0) {
      warnings.push('No meshes were found in the file.')
      return warnings
    }

    const imported_size: Vector3 = imported.world_size
    const imported_height: number = imported_size.y

    if (imported_height >= MODEL_HEIGHT_LIMIT) {
      warnings.push(`Model came in at ${this.format_number(imported_height)} units tall, so import auto-scaled it to a workable size.`)
    }

    if (imported_size.z > imported_size.y * 1.25) {
      warnings.push('Model is deeper than it is tall, which usually means it is Z-up or lying down. Use the rotate buttons to stand it up.')
    }

    // baking transforms means the model keeps its authored placement, which is
    // correct but can leave it sitting away from the origin where the skeleton loads
    const offset_from_origin: number = Math.max(
      Math.abs(processed.world_min.x + processed.world_max.x) / 2,
      Math.abs(processed.world_min.z + processed.world_max.z) / 2
    )
    const model_height: number = Math.max(processed.world_size.y, 0.001)

    if (offset_from_origin > model_height) {
      warnings.push(`Model sits about ${this.format_number(offset_from_origin)} units away from the origin, which is where the skeleton loads. Use "Reset position" or the move gizmo to bring it back.`)
    }

    const imported_mesh_total: number = imported.mesh_count + imported.skinned_mesh_count
    if (processed.mesh_count !== imported_mesh_total) {
      warnings.push(`File contained ${imported_mesh_total} meshes but ${processed.mesh_count} made it through import.`)
    }

    return warnings
  }

  /**
   * Show the report in a dialog.
   * @param analysis report data, or null when nothing has been imported yet
   */
  public static show_dialog (analysis: ModelImportAnalysis | null): void {
    const content: string = analysis === null
      ? '<p>No model has been imported yet.</p>'
      : this.build_html(analysis)

    new ModalDialog('3D Model Import Analysis', content, { customClass: 'model-analysis-dialog' }).show()
  }

  public static build_html (analysis: ModelImportAnalysis): string {
    return `
      <div class="model-analysis">

        ${this.build_warnings_html(analysis)}

        ${this.build_mesh_table_html(analysis.imported)}

      </div>
    `
  }

  private static build_warnings_html (analysis: ModelImportAnalysis): string {
    const scene_warnings: string[] = this.collect_scene_warnings(analysis)
    const grouped_warnings: GroupedWarning[] = this.group_object_warnings(analysis.imported)

    if (scene_warnings.length === 0 && grouped_warnings.length === 0) {
      return '<p class="model-analysis-clean">Nothing unusual found. The model imported cleanly.</p>'
    }

    const scene_items: string = scene_warnings
      .map((message) => `<li>${this.escape_html(message)}</li>`)
      .join('')

    const object_items: string = grouped_warnings
      .map((warning) => `
        <li>
          ${this.escape_html(warning.message)}
          <span class="model-analysis-affected">${this.escape_html(warning.object_names.join(', '))}</span>
        </li>
      `)
      .join('')

    return `
      <h3>Things to check</h3>
      <ul class="model-analysis-warnings">${scene_items}${object_items}</ul>
    `
  }

  /** Collapse identical per-object warnings into one row listing the objects. */
  private static group_object_warnings (snapshot: SceneSnapshot): GroupedWarning[] {
    const grouped = new Map<string, GroupedWarning>()

    snapshot.objects.forEach((analyzed) => {
      analyzed.warnings.forEach((message) => {
        const existing: GroupedWarning | undefined = grouped.get(message)
        if (existing === undefined) {
          grouped.set(message, { message, object_names: [analyzed.name] })
        } else {
          existing.object_names.push(analyzed.name)
        }
      })
    })

    return Array.from(grouped.values())
  }

  private static build_summary_html (analysis: ModelImportAnalysis): string {
    const imported: SceneSnapshot = analysis.imported
    const processed: SceneSnapshot = analysis.processed

    const rows: string = [
      ['Meshes', String(imported.mesh_count), String(processed.mesh_count)],
      ['Rigged meshes', String(imported.skinned_mesh_count), String(processed.skinned_mesh_count)],
      ['Vertices', imported.vertex_count.toLocaleString(), processed.vertex_count.toLocaleString()],
      ['Triangles', imported.triangle_count.toLocaleString(), processed.triangle_count.toLocaleString()],
      ['Size (X x Y x Z)', this.format_vector(imported.world_size, ' x '), this.format_vector(processed.world_size, ' x ')],
      ['Lowest point (Y)', this.format_number(imported.world_min.y), this.format_number(processed.world_min.y)]
    ]
      .map(([label, imported_value, processed_value]) => `
        <tr>
          <th scope="row">${this.escape_html(label)}</th>
          <td>${this.escape_html(imported_value)}</td>
          <td>${this.escape_html(processed_value)}</td>
        </tr>
      `)
      .join('')

    return `
      <h3>Summary</h3>
      <div class="model-analysis-table-scroll">
        <table class="model-analysis-table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">In the file</th>
              <th scope="col">After import</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `
  }

  private static build_mesh_table_html (snapshot: SceneSnapshot): string {
    if (snapshot.objects.length === 0) {
      return ''
    }

    const cards: string = snapshot.objects
      .map((analyzed) => `
        <li class="model-analysis-object-card${analyzed.warnings.length > 0 ? ' model-analysis-object-card-flagged' : ''}">
            <span class="model-analysis-name">${this.escape_html(analyzed.name)}</span>
            <span class="model-analysis-parent">Parent: ${this.escape_html(this.describe_parentage(analyzed))}</span>
            ${this.build_mesh_properties_html(analyzed)}
            ${this.build_materials_html(analyzed)}
        </li>
      `)
      .join('')

    return `
      <h3>${snapshot.objects.length} mesh(es) in the file</h3>
      <p class="model-analysis-note">Transforms come directly from loaded file. For them to work in Mesh2Motion, they are "baked" into the vertices on import. Rotation is in degrees. World scale includes any scale inherited from parent objects.</p>
      <ul class="model-analysis-object-list">${cards}</ul>
    `
  }

  private static build_mesh_properties_html (analyzed: AnalyzedObject): string {
    const properties: Array<[string, string]> = [
      ['Type', analyzed.type],
      ['Position', this.format_vector(analyzed.position)],
      ['Rotation', this.format_vector(analyzed.rotation_degrees)],
      ['Scale', this.format_vector(analyzed.scale)],
      ['World scale', this.format_vector(analyzed.world_scale)],
      ['Size', this.format_vector(analyzed.world_size, ' x ')],
      ['Vertices', analyzed.vertex_count.toLocaleString()],
      ['Triangles', analyzed.triangle_count.toLocaleString()],
      ['UVs', analyzed.has_uvs ? 'yes' : 'no'],
      ['Normals', analyzed.has_normals ? 'yes' : 'no'],
      ['Skin weights', analyzed.has_skin_weights ? 'yes' : 'no']
    ]

    return this.build_property_list_html(properties)
  }

  /** One material block per material on the mesh, since a mesh can carry several. */
  private static build_materials_html (analyzed: AnalyzedObject): string {
    if (analyzed.materials.length === 0) {
      return '<p class="model-analysis-material-name">Material: none</p>'
    }

    const blocks: string = analyzed.materials
      .map((material) => `
        <li class="model-analysis-material">
          <span class="model-analysis-material-name">${this.escape_html(this.material_label(material))} - ${this.escape_html(material.type)}</span>
          ${this.build_property_list_html(this.material_properties(material))}
        </li>
      `)
      .join('')

    return `<ul class="model-analysis-material-list">${blocks}</ul>`
  }

  /**
   * Emissive gets three rows rather than one because the color, what the
   * viewport shows, and what an export writes are all different numbers.
   */
  private static material_properties (material: MaterialInfo): Array<[string, string]> {
    const properties: Array<[string, string]> = []

    if (material.color_hex !== null) {
      properties.push(['Base color', material.color_hex])
    }

    if (material.emissive_hex !== null) {
      properties.push(['Emissive color', material.emissive_hex])
      properties.push(['Emissive intensity', this.format_number(material.emissive_intensity)])
      properties.push(['Emissive in GLB export', this.describe_exported_emissive(material)])
    }

    if (material.metalness !== null) {
      properties.push(['Metalness', this.format_number(material.metalness)])
    }

    if (material.roughness !== null) {
      properties.push(['Roughness', this.format_number(material.roughness)])
    }

    if (material.shininess !== null) {
      properties.push(['Shininess', this.format_number(material.shininess)])
    }

    if (material.specular_hex !== null) {
      properties.push(['Specular color', material.specular_hex])
    }

    properties.push(['Opacity', this.format_number(material.opacity)])
    properties.push(['Transparent', material.transparent ? 'yes' : 'no'])
    properties.push(['Vertex colors', material.vertex_colors ? 'yes' : 'no'])
    properties.push(['Renders', material.side])
    properties.push([
      'Textures',
      material.texture_slots.length === 0 ? 'none' : material.texture_slots.join(', ')
    ])

    return properties
  }

  /** What a GLB export will actually do with this material's emissive settings. */
  private static describe_exported_emissive (material: MaterialInfo): string {
    if (material.emissive_strength <= this.EMISSIVE_EPSILON) {
      return 'none (black, no glow)'
    }

    if (material.exports_emissive_intensity) {
      return `${material.emissive_hex ?? '-'} at ${this.format_number(material.emissive_intensity)} intensity`
    }

    return `${material.emissive_hex ?? '-'} at full intensity (${material.type} cannot export intensity)`
  }

  private static build_property_list_html (properties: Array<[string, string]>): string {
    return `
      <ul class="model-analysis-object-properties-inline">
        ${properties
          .map(([label, value]) => `
            <li class="model-analysis-object-property-inline">
              <span class="model-analysis-object-property-label">${this.escape_html(label)}:</span>
              <span class="model-analysis-object-property-value">${this.escape_html(value)}</span>
            </li>
          `)
          .join('')}
      </ul>
    `
  }



  /**
   * One line describing where a mesh sits and whether anything above it is
   * contributing a transform, which is what makes the world scale column differ
   * from the plain scale column.
   */
  private static describe_parentage (analyzed: AnalyzedObject): string {
    if (analyzed.transformed_ancestors.length === 0) {
      return `in ${analyzed.parent_name}`
    }

    // the parent line already names it, so avoid saying the same thing twice
    if (analyzed.transformed_ancestors.length === 1 && analyzed.transformed_ancestors[0] === analyzed.parent_name) {
      return `in ${analyzed.parent_name} (transformed)`
    }

    return `in ${analyzed.parent_name}, transformed by ${analyzed.transformed_ancestors.join(', ')}`
  }

  private static parent_label (object_3d: Object3D, scene_root: Object3D): string {
    const parent: Object3D | null = object_3d.parent

    if (parent === null || parent === scene_root) {
      return 'scene root'
    }

    return parent.name === '' ? `(unnamed ${parent.type})` : parent.name
  }

  /**
   * Names of the parent objects a mesh inherits a transform from. Import flattens
   * the hierarchy, so a mesh can be positioned entirely by its parents and still
   * look perfectly fine on its own row of the report.
   */
  private static find_transformed_ancestors (object_3d: Object3D, scene_root: Object3D): string[] {
    const ancestors: string[] = []
    let current: Object3D | null = object_3d.parent

    while (current !== null && current !== scene_root) {
      const has_transform: boolean = !this.is_zero_vector(current.position) ||
        !this.is_unit_vector(current.scale) ||
        !this.is_zero_rotation(new Vector3(
          this.radians_to_degrees(current.rotation.x),
          this.radians_to_degrees(current.rotation.y),
          this.radians_to_degrees(current.rotation.z)
        ))

      if (has_transform) {
        ancestors.push(current.name === '' ? `(unnamed ${current.type})` : current.name)
      }

      current = current.parent
    }

    return ancestors
  }

  private static depth_in_scene (object_3d: Object3D, scene_root: Object3D): number {
    let depth = 0
    let current: Object3D | null = object_3d.parent

    while (current !== null && current !== scene_root) {
      depth++
      current = current.parent
    }

    return depth
  }

  private static is_zero_vector (vector: Vector3): boolean {
    return Math.abs(vector.x) < this.TRANSFORM_EPSILON &&
      Math.abs(vector.y) < this.TRANSFORM_EPSILON &&
      Math.abs(vector.z) < this.TRANSFORM_EPSILON
  }

  private static is_unit_vector (vector: Vector3): boolean {
    return Math.abs(vector.x - 1) < this.TRANSFORM_EPSILON &&
      Math.abs(vector.y - 1) < this.TRANSFORM_EPSILON &&
      Math.abs(vector.z - 1) < this.TRANSFORM_EPSILON
  }

  /**
   * Compares magnitudes so a straight mirror (-1, 1, 1) counts as uniform and
   * only gets reported once, by the negative scale check.
   */
  private static is_uniform_scale (vector: Vector3): boolean {
    return Math.abs(Math.abs(vector.x) - Math.abs(vector.y)) < this.TRANSFORM_EPSILON &&
      Math.abs(Math.abs(vector.y) - Math.abs(vector.z)) < this.TRANSFORM_EPSILON
  }

  private static is_zero_rotation (rotation_degrees: Vector3): boolean {
    return Math.abs(rotation_degrees.x) < this.ROTATION_EPSILON_DEGREES &&
      Math.abs(rotation_degrees.y) < this.ROTATION_EPSILON_DEGREES &&
      Math.abs(rotation_degrees.z) < this.ROTATION_EPSILON_DEGREES
  }

  private static radians_to_degrees (radians: number): number {
    return radians * 180 / Math.PI
  }

  private static format_vector (vector: Vector3, separator: string = ', '): string {
    return [vector.x, vector.y, vector.z].map((value) => this.format_number(value)).join(separator)
  }

  /**
   * Keep numbers short enough to scan while still showing tiny/huge values. A
   * scale of 0.0001 is exactly the kind of thing we want visible, so anything
   * that would round away to zero switches to exponent form instead. Only
   * floating point noise is reported as a flat zero.
   */
  public static format_number (value: number, digits: number = 3): string {
    if (!isFinite(value)) {
      return '-'
    }

    const magnitude: number = Math.abs(value)

    if (magnitude < 0.000001) {
      return '0'
    }

    if (magnitude >= 100000 || magnitude < 0.001) {
      return value.toExponential(2)
    }

    return String(Number(value.toFixed(digits)))
  }

  private static escape_html (value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
}
