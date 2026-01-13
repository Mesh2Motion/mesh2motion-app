import {
  PerspectiveCamera, DoubleSide, FrontSide, DirectionalLight, GridHelper,
  Bone, MeshBasicMaterial, Skeleton, AmbientLight, PlaneGeometry, Mesh,
  SphereGeometry, MeshPhongMaterial, AxesHelper,
  Vector3, BufferGeometry, type Object3D, type WebGLRenderer,
  Group, Line, LineBasicMaterial, BufferAttribute, Vector2
} from 'three'

import { Utility } from './Utilities'

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class Generators {
  static create_material (wireframe_value = true, color_hex = 0x00ff00): MeshPhongMaterial {
    const material = new MeshPhongMaterial({ color: color_hex, wireframe: wireframe_value })
    material.side = DoubleSide
    material.specular = 0.0
    material.shininess = 0.0
    return material
  }

  // put HTML with all the contributors
  static get_contributors_list (): string {
    // Return a list of contributors
    return `
    <span style="text-align: left;">
    <ul>
      <li>Scott Petrovic: Project Maintainer</li>
      <li>Quaternius: Base human model, rig, and animations. <a href="http://quaternius.com/" target="_blank" rel="noopener noreferrer">quaternius.com</a></li>
      <li>Sketchpunklab: Provided algorithm to help retarget human rigs for animations. <a target="_blank" href="https://x.com/SketchpunkLabs">See social media account</a></li>
      <li>Three.js Contributors: For the amazing Three.js library. <a href="https://threejs.org/" target="_blank" rel="noopener noreferrer">threejs.org</a></li>
    </ul>

      <hr/>
      <p>Check out the <a href="https://github.com/Mesh2Motion" target="_blank">project's guide</a> for instructions on contributing.
      </p>
      </span>
    `
  }

  static create_grid_helper (grid_color: number = 0x111155, floor_color: number = 0x4e4e7a): any[] {
    // create floor mesh and add to scene to help with shadows
    const grid_size: number = 180
    const divisions: number = 100
    const floor_geometry = new PlaneGeometry(grid_size, grid_size, divisions, divisions)
    const floor_material = new MeshPhongMaterial({
      color: floor_color,
      wireframe: false,
      transparent: true,
      opacity: 0.7,
      shininess: 0.0,
      specular: 0.0
    })
    floor_material.side = FrontSide // helps us see the mesh when we are below the character

    const floor_mesh = new Mesh(floor_geometry, floor_material)
    floor_mesh.name = 'Floor Mesh'
    floor_mesh.rotation.x = -Math.PI / 2
    floor_mesh.position.y = -0.01
    floor_mesh.receiveShadow = true
    floor_mesh.renderOrder = -1 // fix to help put the floor behind the skeleton helper

    // xyz axes helper display
    const axes_helper = new AxesHelper(0.3)
    axes_helper.name = 'Axes Helper'
    axes_helper.position.copy(new Vector3(0, 0.008, 0)) // offset a bit to avoid z-fighting

    // grid display on floor
    const grid_helper: GridHelper = new GridHelper(grid_size, divisions, grid_color, grid_color)

    return [grid_helper, floor_mesh, axes_helper]
  }


  static create_bone_hierarchy (): Bone {
    // offset root bone down to move entire bone structure
    const bone0 = new Bone()
    bone0.name = 'rootBone'

    const bone1 = new Bone()
    bone1.name = 'childBone'

    const bone2 = new Bone()
    bone2.name = 'grandchildBone'

    const bone3 = new Bone()
    bone3.name = 'greatGrandchildBone'

    bone0.add(bone1)
    bone1.add(bone2)
    bone2.add(bone3)

    // this is the local position...relative to the parent
    bone0.position.y = -0.8
    bone1.position.y = 0.5
    bone2.position.y = 0.5
    // bone2.position.x = 0.5; // temporarily to test cylinder
    bone3.position.y = 0.5

    return bone0
  }

  static create_skeleton (bone_hierarchy: Object3D): Skeleton {
    const bone_list = Utility.bone_list_from_hierarchy(bone_hierarchy)
    const skeleton = new Skeleton(bone_list)
    return skeleton
  }

  // create x markers at a location in space
  static create_x_markers (points: Vector3[], size = 0.1, color = 0xff0000, name = ''): Group {
    const group = new Group()
    group.name = `X markers: ${name}`

    const material = new LineBasicMaterial({
      color,
      depthTest: false
    })

    points.forEach(point => {
      // Create first diagonal line (\ direction)
      const geometry1 = new BufferGeometry().setFromPoints([
        new Vector3(point.x - size, point.y - size, point.z),
        new Vector3(point.x + size, point.y + size, point.z)
      ])
      const line1 = new Line(geometry1, material)

      // Create second diagonal line (/ direction)
      const geometry2 = new BufferGeometry().setFromPoints([
        new Vector3(point.x - size, point.y + size, point.z),
        new Vector3(point.x + size, point.y - size, point.z)
      ])
      const line2 = new Line(geometry2, material)

      group.add(line1)
      group.add(line2)
    })

    return group
  }

  static create_spheres_for_points (points: Vector3[], color = 0x00ffff, name = ''): Group {
    const debug_sphere_size: number = 0.006
    const group = new Group()
    group.name = `Point display: ${name}`

    const sphere_geometry = new SphereGeometry(debug_sphere_size, 10, 10)
    const sphere_material = new MeshBasicMaterial({ color, depthTest: false })

    points.forEach(point => {
      const sphere = new Mesh(sphere_geometry, sphere_material)
      sphere.position.copy(point) // Position the sphere at the point
      group.add(sphere)
    })

    return group
}

  static create_test_plane_mesh (size: number = 0.08, color: number = 0x0000ff): Mesh {
    const plane_width = size
    const plane_height = size
    const plane_width_segments = 2
    const plane_height_segments = 2
    const plane_geometry = new PlaneGeometry(plane_width, plane_height, plane_width_segments, plane_height_segments)
    const plane_material: MeshBasicMaterial = Generators.create_material(false, color)
    const mesh_object = new Mesh(plane_geometry, plane_material)
    mesh_object.name = 'Plane Intersection Mesh'
    return mesh_object
  }

  static create_default_lights (light_strength: number): Array<DirectionalLight | AmbientLight> {
    const shadow_map_size: number = 1024
    const light_1 = new DirectionalLight(0x777777, light_strength)
    light_1.castShadow = true
    light_1.shadow.mapSize = new Vector2(shadow_map_size, shadow_map_size) // decreases moire effect on mesh

    light_1.position.set(-2, 2, 2)
    const light_2 = new AmbientLight(0xffffff, 1.2)

    // backfill light
    const backfill_light = new DirectionalLight(0x777777, light_strength * 0.5)
    backfill_light.castShadow = false // one shadow is enough
    backfill_light.position.set(2, 2, -2)

    const result = [light_1, light_2, backfill_light]
    return result
  }

  static create_camera (): PerspectiveCamera {
    const field_of_view = 15 // in millimeters. Lower makes the camera more isometric
    const camera = new PerspectiveCamera(field_of_view, window.innerWidth / window.innerHeight, 0.1, 10000)
    camera.position.z = 10
    camera.position.y = 5
    camera.position.x = 5
    return camera
  }

  static create_equidistant_spheres_around_circle (sphere_count = 6, color = 0x00ff00, distance = 0.3) {
    const plane_points: Mesh[] = []
    const plane_point_geometry = new SphereGeometry(0.03, 12, 12)
    const plane_point_material: MeshBasicMaterial = Generators.create_material(true, color)

    for (let i = 0; i < sphere_count; i++) {
      // have the points go around the plane in an even circle increments
      const angle = (i / sphere_count) * (Math.PI * 2)
      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance
      const z = 0
      const point_mesh: Mesh = new Mesh(plane_point_geometry, plane_point_material)
      point_mesh.position.set(x, y, z)
      plane_points.push(point_mesh)
    }

    return plane_points
  }

  static create_window_resize_listener (renderer: WebGLRenderer, camera: PerspectiveCamera): void {
    // there was a bit of horizontal and vertical scrollbars
    // I tried doing overflow: none, but that wasn't working for some reason
    const contraction_size = 2

    window.addEventListener('resize', () => {
      renderer.setSize(window.innerWidth-contraction_size, window.innerHeight-contraction_size)
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix() // update camera
    })
  }

  static create_bone_plane_mesh (bone_start: Bone, bone_end: Bone, rays_to_cast: number): Mesh {
    // create plane mesh to do the ray casting
    // we also want to offset it it half the bone distance up the bone
    // for a better approximation with what counts
    const plane_mesh: Mesh = Generators.create_test_plane_mesh(0.02)

    plane_mesh.position.copy(Utility.world_position_from_object(bone_start))

    plane_mesh.lookAt(Utility.world_position_from_object(bone_end))
    plane_mesh.translateZ(Utility.distance_between_objects(bone_start, bone_end)*0.5)

    // create 4 reference points around the plane that will be used for raycasting
    const plane_point_geometry = new SphereGeometry(0.002, 3, 3)
    const plane_point_material: MeshBasicMaterial = Generators.create_material(true, 0x00ffff)

    for (let i = 0; i < rays_to_cast; i++) {
      // have the points go around the plane in an even circle increments
      const distance: number = 0.005 // set radial distance from origin close to help with close vertices
      const angle: number = (i/rays_to_cast) * (Math.PI*2)
      const x = Math.cos(angle) * distance
      const y = Math.sin(angle) * distance
      const z = 0
      const point_mesh = new Mesh(plane_point_geometry, plane_point_material)
      point_mesh.name = 'Point mesh PLANE'

      point_mesh.position.set(x, y, z)
      plane_mesh.add(point_mesh)
    }

    return plane_mesh
  }

  static create_wireframe_mesh_from_geometry (orig_geometry: BufferGeometry): Mesh {
    const wireframe_material = new MeshBasicMaterial({
      color: 0x337baa, // light blue color
      wireframe: true,
      opacity: 0.2,
      transparent: true
    })

    const cloned_geometry = orig_geometry.clone()
    return new Mesh(cloned_geometry, wireframe_material)
  }

  /**
   * This function will create a mesh to show the weights of the vertices
   * It will use the skin_indices to assign colors to the vertices
   * @param skin_indices
   */
  static create_weight_painted_mesh (skin_indices: number[], orig_geometry: BufferGeometry): Mesh {
    // Clone the geometry to avoid modifying the original
    const cloned_geometry = orig_geometry.clone()
    const vertex_count = cloned_geometry.attributes.position.array.length / 3

    // Assign a random color for each bone
    // this is an abitrary max value. Not every bone might be used, so getting the bone count by skin_indices
    // might not be a good enough way to determine the number of bone colors to generate.
    // If the mesh is made up of a bunch of small disconnected meshes, there is a good chance we won't need every bone
    const bone_colors: Vector3[] = Generators.generate_deterministic_bone_colors(120)

    // Loop through each vertex and assign color based on the bone index
    const colors = new Float32Array(vertex_count * 3)
    for (let i = 0; i < vertex_count; i++) {
      const bone_index = skin_indices[i * 4] // Primary bone assignment
      let color = bone_colors[bone_index]

      // this shouldn't happen now, but will be a fallback in case we add a skeleton with more than 120 bones
      if (color == null || color === undefined) {
        console.warn(`No color found for bone index ${bone_index}. Using default color. Code needs to increase the number of bone colors generated}`)
        color = new Vector3(1, 1, 1) // white color
      }

      colors[i * 3] = color.x // red
      colors[i * 3 + 1] = color.y // green
      colors[i * 3 + 2] = color.z // blue
    }
    cloned_geometry.setAttribute('color', new BufferAttribute(colors, 3))

    // Create a mesh with vertex colors
    const material = new MeshBasicMaterial({ vertexColors: true, wireframe: false, opacity: 1.0, transparent: false })
    return new Mesh(cloned_geometry, material)
  }

  static generate_deterministic_bone_colors (count: number): Vector3[] {
    // base color, can be any value between 0 and 1
    let r = 0.2
    let g = 0.5
    let b = 0.8

    // Darkening factor (0 < factor < 1)
    const darken = 0.8 // lower value is darker

    // Generate a list of colors based on the count
    const colors: Vector3[] = []
    const step = [-0.1, 0.1, 0.3]
    for (let i = 0; i < count; i++) {
      // Ensure values wrap between 0 and 1
      r = (r + step[0] + 1) % 1
      g = (g + step[1] + 1) % 1
      b = (b + step[2] + 1) % 1

      // Apply darkening factor
      colors.push(new Vector3(r * darken, g * darken, b * darken))
    }
    return colors
  }
}
