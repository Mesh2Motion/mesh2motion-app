import { describe, expect, it } from 'vitest'
import { AnimationClip, Bone, BufferGeometry, NumberKeyframeTrack, SkinnedMesh, Skeleton } from 'three'
import { DraftPreviewSession, type PreviewHost } from './preview'
import { create_engine_preview, type PreviewEngine } from './enginePreview'
import { document_to_animation_clip } from './conversion'
import { create_agent_wave_01_document } from './fixtures/AgentWave01'
import { make_bone_id_resolver, bone_identities } from './rigIdentity'
import { create_agent_wave_skeleton } from './fixtures/AgentWave01'

function make_host (): PreviewHost & { listeners: Array<(delta: number) => void>, paused: number, resumed: number } {
  const listeners: Array<(delta: number) => void> = []
  return {
    listeners,
    paused: 0,
    resumed: 0,
    active_skinned_meshes: () => [],
    add_frame_listener: (listener) => { listeners.push(listener) },
    pause_regular_playback: function () { this.paused += 1 },
    resume_regular_playback: function () { this.resumed += 1 }
  }
}

describe('DraftPreviewSession', () => {
  it('does not touch application selection (no mixer on app meshes until show)', () => {
    const host = make_host()
    const session = new DraftPreviewSession(host)
    expect(session.is_active()).toBe(false)
    expect(session.previewed_clip_name()).toBeNull()
  })

  it('shows a draft clip in its own mixer and stops cleanly', () => {
    const host = make_host()
    const session = new DraftPreviewSession(host)
    const clip = document_to_animation_clip(create_agent_wave_01_document(), {
      resolve_bone_name: make_bone_id_resolver(bone_identities(create_agent_wave_skeleton(), 'human'))
    })
    session.show(clip)
    expect(session.is_active()).toBe(true)
    expect(session.previewed_clip_name()).toBe('Agent_Wave_01')
    expect(host.paused).toBe(1)
    host.listeners.forEach((listener) => listener(0.1))
    session.stop()
    expect(session.is_active()).toBe(false)
    expect(host.resumed).toBe(1)
  })

  it('frames after stop are a no-op', () => {
    const host = make_host()
    const session = new DraftPreviewSession(host)
    const clip = new AnimationClip('draft', 1, [new NumberKeyframeTrack('x', [0, 1], [0, 1])])
    session.show(clip)
    session.stop()
    expect(() => host.listeners.forEach((listener) => listener(1))).not.toThrow()
    expect(session.previewed_clip_name()).toBe('draft')
  })

  it('engine adapter delegates pause/play without touching selection', () => {
    const calls: string[] = []
    const player = {
      pause: () => { calls.push('pause') },
      play: () => { calls.push('play') }
    }
    const engine: PreviewEngine = {
      active_skinned_meshes: () => [],
      add_frame_listener: () => {},
      get_animation_player: () => {
        calls.push('get_player')
        return player
      }
    }
    const session = create_engine_preview(engine)
    const clip = new AnimationClip('draft', 1, [new NumberKeyframeTrack('x', [0, 1], [0, 1])])
    session.show(clip)
    session.stop()
    expect(calls).toEqual(['get_player', 'pause', 'get_player', 'play'])
  })

  it('can drive its own skinned meshes', () => {
    const skeleton = new Skeleton([new Bone()])
    skeleton.bones[0].name = 'hips'
    const mesh = new SkinnedMesh(new BufferGeometry())
    mesh.bind(skeleton)
    const host: PreviewHost = {
      active_skinned_meshes: () => [mesh],
      add_frame_listener: () => {}
    }
    const session = new DraftPreviewSession(host)
    const clip = new AnimationClip('draft', 1, [new NumberKeyframeTrack('hips.position[x]', [0, 1], [0, 1])])
    session.show(clip)
    expect(session.is_active()).toBe(true)
    session.update(0.5)
    session.stop()
  })
})
