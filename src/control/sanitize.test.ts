import { describe, expect, it } from 'vitest'
import { CONTROL_SCHEMA_VERSION, ControlSnapshot } from './contracts.ts'
import { REDACTED, sanitize_snapshot } from './sanitize.ts'

function snapshot (): ControlSnapshot {
  return {
    meta: { schema_version: CONTROL_SCHEMA_VERSION, sequence: 3, captured_at: new Date(0).toISOString(), age_ms: 0 },
    application: {
      phase: 'ready', page: 'explore', version: '1.0.0', build: 'git:abc-test',
      uptime_ms: 100, diagnostics_enabled: false,
      last_error: 'failed at /home/user/secret.glb'
    },
    renderer: {
      created: true, context_lost: false,
      loop: { active: true, stopped: false, consecutive_failures: 0 },
      canvas: { width: 800, height: 600 },
      gl: { vendor: 'file:///etc/passwd', renderer: 'Intel', version: 'WebGL 2.0' }
    },
    rigs: [{
      key: 'human', display_name: 'Human',
      model_asset: '/home/user/models/model-human.glb',
      rig_asset: 'rigs/rig-human.glb',
      animation_assets: ['animations/human-base-animations.glb', 'C:\\Users\\me\\anim.glb']
    }],
    animations: [{
      index: 0, name: '/tmp/secret_anim', duration_s: 1, track_count: 2,
      source_type: 'default-library', tags: ['C:\\secret'], rig: 'human', origin: 'loaded'
    }],
    scene: {
      process_step: 'animations-export',
      model: { loaded: true, mesh_count: 1, vertex_count: 10, triangle_count: 5 },
      skeleton: { loaded: true, type: 'human', bone_count: 2, root_name: '/home/user/hips' },
      animations: { loaded_count: 1 },
      camera: { position: [0, 0, 0] },
      object_count: 1
    }
  }
}

describe('sanitize_snapshot', () => {
  it('redacts absolute paths without changing the schema version', () => {
    const input = snapshot()
    const output = sanitize_snapshot(input)
    const json = JSON.stringify(output)

    expect(output.meta.schema_version).toBe(CONTROL_SCHEMA_VERSION)
    expect(json).not.toContain('/home/')
    expect(json).not.toContain('/tmp/')
    expect(json).not.toContain('C:\\')
    expect(json).not.toContain('file://')
    expect(json).toContain(REDACTED)
    expect(output.application.last_error).toBe(REDACTED)
    expect(output.rigs[0].model_asset).toBe(REDACTED)
    expect(output.rigs[0].rig_asset).toBe('rigs/rig-human.glb')
    expect(output.animations[0].tags[0]).toBe(REDACTED)
    expect(output.scene.skeleton.root_name).toBe(REDACTED)
    expect(output.renderer.gl?.renderer).toBe('Intel')
  })

  it('preserves relative bundle keys and does not mutate the input', () => {
    const input = snapshot()
    const output = sanitize_snapshot(input)

    expect(output.rigs[0].animation_assets[0]).toBe('animations/human-base-animations.glb')
    expect(output.rigs[0].animation_assets[1]).toBe(REDACTED)
    expect(input.rigs[0].model_asset).toBe('/home/user/models/model-human.glb')
    expect(input.application.last_error).toBe('failed at /home/user/secret.glb')
    expect(output.scene.camera.position).not.toBe(input.scene.camera.position)
  })
})
