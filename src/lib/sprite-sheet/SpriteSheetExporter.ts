import * as THREE from 'three'
import {
  type AnimationClip,
  type AnimationMixer,
  type SkinnedMesh,
  type Scene,
  OrthographicCamera,
  WebGLRenderer,
  PerspectiveCamera,
  type AnimationAction,
  type Object3D,
  MeshBasicMaterial,
  Color
} from 'three'
import { SpriteSheetSettings, type DirectionEntry } from './SpriteSheetSettings.ts'

export interface SpriteSheetExportResult {
  blob: Blob
  total_width: number
  total_height: number
  frame_count: number
  direction_count: number
  /** How many frames actually fit on the sheet. When this is less than
   *  frame_count * direction_count, the user requested more cells than
   *  the canvas can hold; we silently drop the tail. */
  cells_rendered: number
  /** Cells skipped because they would overflow the canvas. */
  cells_overflow: number
  /** Actual frame width / height used after clamping to fit the canvas.
   *  May be smaller than the user-requested frame_w/h if the canvas is
   *  too small to fit all cells at full size. */
  rendered_frame_width: number
  rendered_frame_height: number
}

export class SpriteSheetExporter {
  /**
   * Export a sprite sheet from the given animation.
   *
   * Canvas-first layout: the canvas dimensions drive the sheet size. The
   * frame width/height is clamped down to whatever fits in the canvas at
   * the requested cell count, while preserving the requested aspect ratio.
   * If the user asked for more cells than fit at any non-zero frame size,
   * we warn and drop the tail.
   */
  public static async export (
    skinned_meshes: SkinnedMesh[],
    clip: AnimationClip,
    mixer: AnimationMixer,
    settings: SpriteSheetSettings,
    main_scene: Scene,
    on_progress?: (pct: number) => void
  ): Promise<SpriteSheetExportResult> {
    const fps = 30
    const total_frames = Math.floor(clip.duration * fps)
    const sample_interval = Math.max(1, Math.round(settings.sample_every_n_frames))

    // Build array of frame indices to sample
    const frame_indices: number[] = []
    for (let i = 0; i < total_frames; i += sample_interval) {
      frame_indices.push(i)
    }
    if (frame_indices[frame_indices.length - 1] < total_frames - 1) {
      frame_indices.push(total_frames - 1)
    }

    const directions = settings.enabled_directions()
    const requested_fw = Math.max(16, Math.round(settings.frame_width))
    const requested_fh = Math.max(16, Math.round(settings.frame_height))
    const pad = Math.max(0, Math.round(settings.padding))
    const canvas_w = Math.max(64, Math.round(settings.canvas_width))
    const canvas_h = Math.max(64, Math.round(settings.canvas_height))

    // ---- Grid layout ----
    // When one_row_per_direction is true (legacy): rows = directions, cols = frames.
    // When false (default): all cells flow left-to-right, top-to-bottom with
    // auto-wrap. cols = canvas capacity, rows = ceil(total / cols).
    const total_cells = frame_indices.length * directions.length
    let requested_cols: number
    let requested_rows: number
    if (settings.one_row_per_direction) {
      requested_cols = frame_indices.length
      requested_rows = directions.length
    } else {
      // Flow layout: pack as many cells per row as the canvas allows.
      const max_cols_by_canvas = Math.max(1, Math.floor((canvas_w + pad) / (requested_fw + pad)))
      const max_rows_by_canvas = Math.max(1, Math.floor((canvas_h + pad) / (requested_fh + pad)))
      requested_cols = Math.min(max_cols_by_canvas, total_cells)
      requested_rows = Math.ceil(total_cells / requested_cols)
      // Silently cap rows to canvas capacity; overflow warning below handles the rest.
      if (requested_rows > max_rows_by_canvas) {
        requested_rows = max_rows_by_canvas
      }
    }

    if (frame_indices.length === 0 || directions.length === 0) {
      throw new Error('SpriteSheet: no frames or directions selected')
    }
        /*  1. Frame size is inviolable — canvas just frames the result   */
        /* ---------------------------------------------------------------- */
        // The user-set frame_width / frame_height is the one thing that
        // must NOT change: it's the pixel size at which each model frame is
        // rendered. Both the WebGL renderer viewport and the destination
        // drawImage call use these exact dimensions. The canvas_w/h is
        // simply the bounding "container" that determines when the entire
        // sheet overflows — extra canvas room stays blank.
        const cell_w = requested_fw
        const cell_h = requested_fh

        // How much vertical / horizontal space the cell grid actually
        // occupies in the canvas.
        const sheet_w = requested_cols * (cell_w + pad) - pad
        const sheet_h = requested_rows * (cell_h + pad) - pad

        // If the grid doesn't fit in the canvas, the user wants to know.
        // We still render what fits in the chosen dimensions — the cell
        // size is non-negotiable per the spec; what we drop is the cells
        // that wouldn't have fit at all.
        let cols_render = requested_cols
        let rows_render = requested_rows
        let cells_overflow = 0
        if (sheet_w > canvas_w || sheet_h > canvas_h) {
          // Limit rendering to what fits in the chosen canvas.
          cols_render = Math.max(1, Math.floor((canvas_w + pad) / (cell_w + pad)))
          rows_render = Math.max(1, Math.floor((canvas_h + pad) / (cell_h + pad)))
        }
        // Clamp rows_render to whatever directions are actually available.
        // This clamp is ONLY valid for the legacy "1 row per direction"
        // layout, where each row maps to exactly one direction, so rows can
        // never exceed the enabled direction count. In flow layout (false),
        // rows_render is a purely geometric value — how many rows of cells
        // fit in the canvas — and must NOT be limited by the direction
        // count, otherwise a single direction with many frames can't wrap
        // to the next row and gets silently truncated.
        if (settings.one_row_per_direction && rows_render > directions.length) {
          rows_render = directions.length
        }
        cells_overflow = (requested_cols * requested_rows) - (cols_render * rows_render)
        if (cells_overflow > 0) {
          console.warn(
            `SpriteSheet: ${cells_overflow} of ${requested_cols * requested_rows} cells don't fit on the ` +
            `${canvas_w}×${canvas_h} canvas (each cell is ${cell_w}×${cell_h}). ` +
            `Increase the canvas size, decrease frame size, or sample fewer frames/directions.`
          )
        }

        /* ---------------------------------------------------------------- */
            /*  2. Temporarily modify main scene for capture                    */
            /* ---------------------------------------------------------------- */
            const saved_bg = main_scene.background
                const saved_fog = main_scene.fog
                if (settings.silhouette) {
                  if (settings.silhouette) {
                    main_scene.background = new THREE.Color(0x00ff00)
                  } else {
                    // Color mode: user-chosen background color. Default green so
                    // the output is chroma-key friendly. We avoid fully transparent
                    // backgrounds because the WebGLRenderer + 2D canvas drawImage
                    // path can drop colors to near-black when the scene's background
                    // is null (the framebuffer comes back essentially empty and the
                    // 2D context composites as opaque black).
                    main_scene.background = new THREE.Color(settings.background_color)
                  }
                }

    // Hide helpers / decorative objects
    const hidden_objects: Object3D[] = []
    main_scene.traverse((obj) => {
      if (
        (obj.name === 'Setup objects' || obj.name === 'Skeleton Helper' ||
         obj.name.includes('Helper') || obj.name.includes('helper') ||
         obj.type === 'GridHelper' || obj.type === 'ArrowHelper' ||
         obj.type === 'TransformControls' || obj.type === 'TransformControlsPlane') &&
        obj.visible
      ) {
        hidden_objects.push(obj)
        obj.visible = false
      }
    })

    // For silhouette mode, swap every skinned mesh's material to a flat
    // black material so the output is a clean black shape on green.
    // We restore the originals when done.
    const material_swaps: Array<{ mesh: SkinnedMesh; original: THREE.Material | THREE.Material[] }> = []
    if (settings.silhouette) {
      const black = new MeshBasicMaterial({ color: 0x000000 })
      for (const mesh of skinned_meshes) {
        material_swaps.push({ mesh, original: mesh.material })
        mesh.material = black
      }
    }

    /* ---------------------------------------------------------------- */
    /*  3. Hidden renderer                                              */
    /* ---------------------------------------------------------------- */
    const renderer = new WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true
    })
    renderer.setSize(cell_w, cell_h)
    renderer.setPixelRatio(1)
    if (settings.silhouette) {
      renderer.setClearColor(0x00ff00, 1)
    } else {
      // Color mode: the user-chosen background color. Default is green
      // (#00ff00) so the output is chroma-key friendly. We avoid fully
      // transparent backgrounds because the WebGLRenderer + 2D canvas
      // drawImage path can drop colors to near-black when the framebuffer
      // comes back as (0,0,0,0).
      renderer.setClearColor(settings.background_color, 1)
    }
    // Match the live preview renderer's settings (SpriteSheetUI's preview
    // canvas) — which works correctly for color rendering. The main
    // scene renderer uses ACESFilmicToneMapping + SRGB output, but
    // applying those on the new export renderer in combination with the
    // orthographic camera was producing a near-black silhouette in
    // color mode (the user-reported bug). Skipping them here restores
    // the original color values straight from the GLB materials.
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    // CRITICAL: the main scene's lights (DirectionalLight intensity=1.0,
    // AmbientLight intensity=1.2) are authored in "legacy" light units
    // (the convention when Mesh2Motion was first written). three.js r155+
    // made physical lights the only mode, but main_scene was built
    // against the old convention. A fresh WebGLRenderer interprets those
    // intensities in physical units and produces a near-black render
    // even though the model's base color is white. We can either force
    // legacy mode (useLegacyLights, removed in r165+) OR temporarily
    // boost intensities. The cleanest fix is the latter — restore the
    // original intensities after we render each cell.
    const saved_light_intensities: Array<{ light: any; original: number }> = []
    const hidden_lights: any[] = []
    if (!settings.silhouette) {
      main_scene.traverse((obj: any) => {
        if (obj.isLight && obj.intensity !== undefined) {
          // Try multiple strategies to make sure the model is lit:
          // 1. Boost intensity 30x
          // 2. Also add a flat ambient light for guaranteed minimum
          saved_light_intensities.push({ light: obj, original: obj.intensity })
          obj.intensity = obj.intensity * 30
        }
      })
      // Add a bright AmbientLight as a guaranteed floor — this should
      // make any PBR material at least show its base color, even if
      // DirectionalLight / shadow setup is wrong.
      const ambient = new THREE.AmbientLight(0xffffff, 5.0)
      main_scene.add(ambient)
      hidden_lights.push(ambient)
    }
    renderer.domElement.style.position = 'fixed'
    renderer.domElement.style.top = '-9999px'
    renderer.domElement.style.left = '-9999px'
    document.body.appendChild(renderer.domElement)

    /* ---------------------------------------------------------------- */
    /*  4. Orthographic camera sized to model                           */
    /* ---------------------------------------------------------------- */
    /* ---------------------------------------------------------------- */
        /*  4. Camera — perspective, mirrors the preview                    */
        /* ---------------------------------------------------------------- */
        // Use the same PerspectiveCamera type and fov as the sprite-sheet
        // preview (45° vertical fov, see SpriteSheetUI.start_live_preview).
        // The renderer viewport is set to the cell size below, so what we
        // render here is the model as it would appear in a (cell_w × cell_h)
        // preview at the user-configured pitch + distance. This means
        // tweaking distance or pitch in the panel moves the model in the
        // exported sprite the same way it moves in the live preview.
        //
        // Cell aspect is set on the camera directly — non-square cells get a
        // non-square frustum so the model fits without stretching the way it
        // would in an orthographic projection.
        const box = new THREE.Box3()
        for (const mesh of skinned_meshes) {
          mesh.updateWorldMatrix(true, true)
          box.expandByObject(mesh)
        }
        const center = box.getCenter(new THREE.Vector3())

        const pitch_rad = (settings.pitch_angle_degrees * Math.PI) / 180
        const export_distance = Math.max(0.1, settings.camera_distance)
        const export_horizontal = export_distance * Math.cos(pitch_rad)
        const export_vertical = export_distance * Math.sin(pitch_rad)

        const camera = new PerspectiveCamera(
          45,
          cell_w / cell_h,
          0.1,
          100
        )

    /* ---------------------------------------------------------------- */
    /*  5. Prepare animation actions for seeking                        */
    /* ---------------------------------------------------------------- */
    // Stop any existing actions so we start fresh
    mixer.stopAllAction()

    const actions: AnimationAction[] = []
    for (const mesh of skinned_meshes) {
      const action = mixer.clipAction(clip, mesh)
      if (action) {
        action.play()
        actions.push(action)
      }
    }

    /* ---------------------------------------------------------------- */
    /*  6. Render each cell and composite onto the output canvas        */
    /* ---------------------------------------------------------------- */
    const canvas = document.createElement('canvas')
    canvas.width = canvas_w
    canvas.height = canvas_h
    const ctx = canvas.getContext('2d')!
    // Fill with green / transparent so missing pixels stay chroma-key-friendly
    if (settings.silhouette) {
      ctx.fillStyle = '#00ff00'
    } else {
      // Color mode: user-chosen background. fillStyle is a CSS hex
      // string; settings stores the raw integer 0xRRGGBB.
      ctx.fillStyle = '#' + settings.background_color.toString(16).padStart(6, '0')
    }
    ctx.fillRect(0, 0, canvas_w, canvas_h)

    const total_render_cells = rows_render * cols_render
    let cells_done = 0

    // pitch_rad / export_distance / export_horizontal / export_vertical
    // are computed once above when the PerspectiveCamera is created; they're
    // reused in the per-direction orbit loop below.

    if (settings.one_row_per_direction) {
      // Legacy layout: one direction per row, frames across columns.
      for (let row = 0; row < rows_render; row++) {
        const dir = directions[row]
        if (!dir) {
          console.warn(`SpriteSheet: skipping row ${row}; only ${directions.length} direction(s) available.`)
          continue
        }
        const angle = dir.angle
        const cam_x = center.x + export_horizontal * Math.sin(angle)
        const cam_z = center.z + export_horizontal * Math.cos(angle)
        const cam_y = center.y + export_vertical
        camera.position.set(cam_x, cam_y, cam_z)
        camera.lookAt(center)

        for (let col = 0; col < cols_render; col++) {
          const frame_idx = frame_indices[col]
          const time = frame_idx / fps
          for (const action of actions) { action.time = time }
          mixer.update(0)
          for (const mesh of skinned_meshes) { mesh.updateMatrixWorld(true) }

          renderer.render(main_scene, camera)
          const dst_x = col * (cell_w + pad)
          const dst_y = row * (cell_h + pad)
          ctx.drawImage(renderer.domElement, 0, 0, cell_w, cell_h, dst_x, dst_y, cell_w, cell_h)

          cells_done++
          on_progress?.(cells_done / total_render_cells)
          if (cells_done % 16 === 0) { await new Promise((r) => setTimeout(r, 0)) }
        }
      }
    } else {
      // Flow layout: all cells flow left-to-right, top-to-bottom with auto-wrap.
      // Cell order: dir0_f0, dir0_f1, ..., dir0_fN, dir1_f0, dir1_f1, ...
      for (let flat = 0; flat < total_render_cells; flat++) {
        const dir_idx = Math.floor(flat / frame_indices.length)
        const frame_idx_in_dir = flat % frame_indices.length
        const dir = directions[dir_idx]
        if (!dir) {
          console.warn(`SpriteSheet: skipping flat ${flat}; dir ${dir_idx} not available.`)
          continue
        }
        const angle = dir.angle
        const cam_x = center.x + export_horizontal * Math.sin(angle)
        const cam_z = center.z + export_horizontal * Math.cos(angle)
        const cam_y = center.y + export_vertical
        camera.position.set(cam_x, cam_y, cam_z)
        camera.lookAt(center)

        const frame_idx = frame_indices[frame_idx_in_dir]
        const time = frame_idx / fps
        for (const action of actions) { action.time = time }
        mixer.update(0)
        for (const mesh of skinned_meshes) { mesh.updateMatrixWorld(true) }

        renderer.render(main_scene, camera)
        const col = flat % cols_render
        const row = Math.floor(flat / cols_render)
        const dst_x = col * (cell_w + pad)
        const dst_y = row * (cell_h + pad)
        ctx.drawImage(renderer.domElement, 0, 0, cell_w, cell_h, dst_x, dst_y, cell_w, cell_h)

        cells_done++
        on_progress?.(cells_done / total_render_cells)
        if (cells_done % 16 === 0) { await new Promise((r) => setTimeout(r, 0)) }
      }
    }

    /* ---------------------------------------------------------------- */
    /*  7. Cleanup                                                      */
    /* ---------------------------------------------------------------- */
    for (const action of actions) {
      action.stop()
    }

    // Restore materials swapped for silhouette mode.
    for (const swap of material_swaps) {
      swap.mesh.material = swap.original
    }

    // Restore any light intensities we boosted for physical-light
    // compatibility (see the corresponding boost in step 3).
    for (const saved of saved_light_intensities) {
      saved.light.intensity = saved.original
    }
    // Remove any temporary lights we added.
    for (const light of hidden_lights) {
      main_scene.remove(light)
    }

    renderer.dispose()
    document.body.removeChild(renderer.domElement)

    main_scene.background = saved_bg
    main_scene.fog = saved_fog
    for (const obj of hidden_objects) {
      obj.visible = true
    }

    /* ---------------------------------------------------------------- */
    /*  8. Produce PNG blob                                             */
    /* ---------------------------------------------------------------- */
    const blob: Blob = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b!), 'image/png')
    })

    return {
      blob,
      total_width: canvas_w,
      total_height: canvas_h,
      frame_count: cols_render,
      direction_count: settings.one_row_per_direction ? rows_render : 1,
      cells_rendered: cells_done,
      cells_overflow,
      rendered_frame_width: cell_w,
      rendered_frame_height: cell_h
    }
  }
}