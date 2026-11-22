import { afterEach, describe, expect, it } from 'vitest'
import { ControlSession } from './ControlSession.ts'
import { EngineControlHost, EngineLike, create_engine_control_host } from './EngineControlHost.ts'

function mock_engine (overrides: Partial<EngineLike> = {}): EngineLike {
  return {
    renderer: { domElement: { width: 1100, height: 700 } },
    camera: { position: { x: 0, y: 1.7, z: 15 } },
    scene: { children: new Array<unknown>(12).fill({}) },
    process_step: 'animations-export',
    load_model_step: {
      vertex_count: 1000,
      triangle_count: 500,
      model_meshes: () => ({ children: [{}, {}] })
    },
    load_skeleton_step: { skeleton_type: () => 'human' },
    edit_skeleton_step: { skeleton: () => ({ bones: [{ name: 'hips' }, { name: 'spine' }] }) },
    animations_listing_step: {
      animation_clips: () => [{ name: 'Idle', duration: 1, tracks: [{}, {}] }],
      get_animation_metadata: () => ({ source_type: 'default-library', tags: ['test'] })
    },
    control_state: () => ({
      first_frame_rendered: true,
      context_lost: false,
      render_loop_stopped: false,
      render_failures: 0
    }),
    ...overrides
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('EngineControlHost', () => {
  it('reads renderer, scene, rig and animation state through public getters', () => {
    const host = new EngineControlHost(mock_engine(), {
      page: 'explore', version: '1.0.0', build: 'git:test', diagnostics_enabled: false
    })
    const observation = host.observe()

    expect(observation.engine_attached).toBe(true)
    expect(observation.renderer_created).toBe(true)
    expect(observation.canvas_width).toBe(1100)
    expect(observation.has_loaded_model).toBe(true)
    expect(observation.scene?.model.vertex_count).toBe(1000)
    expect(observation.scene?.skeleton.bone_count).toBe(2)
    expect(observation.scene?.camera.position).toEqual([0, 1.7, 15])
    expect(observation.rigs.length).toBeGreaterThan(0)
    expect(observation.animations.some(a => a.origin === 'loaded' && a.name === 'Idle')).toBe(true)
    expect(observation.animations.some(a => a.origin === 'manifest')).toBe(true)
    // No GPU query is performed; gl is intentionally omitted.
    expect(observation.gl).toBeUndefined()
  })

  it('reports no scene when no model has been loaded', () => {
    const engine = mock_engine()
    engine.load_model_step = { ...engine.load_model_step, vertex_count: 0, triangle_count: 0 }
    const observation = new EngineControlHost(engine).observe()
    expect(observation.has_loaded_model).toBe(false)
    expect(observation.scene).toBeNull()
  })

  it('propagates context loss and render-loop failures', () => {
    const engine = mock_engine()
    engine.control_state = () => ({
      first_frame_rendered: true,
      context_lost: true,
      render_loop_stopped: true,
      render_failures: 3
    })
    const observation = new EngineControlHost(engine).observe()
    expect(observation.context_lost).toBe(true)
    expect(observation.render_loop_stopped).toBe(true)
    expect(observation.render_failures).toBe(3)
  })

  it('detects the fatal startup panel without importing engine internals', () => {
    const panel = document.createElement('div')
    panel.id = 'm2m-startup-error'
    panel.textContent = 'Mesh2Motion could not start: renderer failed'
    document.body.appendChild(panel)

    const observation = new EngineControlHost(mock_engine()).observe()
    expect(observation.fatal).toBe(true)
    expect(observation.last_error).toContain('renderer failed')
  })

  it('works with a ControlSession without touching animation state', () => {
    const session = new ControlSession(() => 2000)
    session.attach(create_engine_control_host(mock_engine(), { page: 'create' }))
    session.refresh()

    const status = session.applicationStatus()
    expect(status.ok && status.data.phase).toBe('ready')
    expect(status.ok && status.data.page).toBe('create')
    const renderer = session.rendererState()
    expect(renderer.ok && renderer.data.loop.active).toBe(true)
  })
})
