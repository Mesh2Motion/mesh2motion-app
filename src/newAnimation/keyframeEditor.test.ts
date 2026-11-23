import { describe, expect, it } from 'vitest'
import { create_empty_document, with_animation_channel } from '../animation-document/create'
import { KeyframeEditor, type KeyframeEditorDom, type PlaybackHost } from './keyframeEditor'
import type { SharedDraftController } from '../animation-document/sharedDraft'
import type { AnimationChannel, AnimationDocument, AnimationKeyframe } from '../animation-document/types'
import { make_test_rig } from '../authoringObservation/testFixtures'

function make_document (): AnimationDocument {
  const skeleton = make_test_rig().skeleton
  let document = create_empty_document({ skeleton, rig_identifier: 'human', clip_name: 'Wave', duration_seconds: 2 })
  const bone = document.bones[0]
  document = with_animation_channel(document, {
    bone_id: bone.id,
    property: 'quaternion',
    keyframes: [
      { time_seconds: 0, values: [0, 0, 0, 1], interpolation: 'slerp' },
      { time_seconds: 0.5, values: [0, 0.7071, 0, 0.7071], interpolation: 'slerp' },
      { time_seconds: 1, values: [0, 0, 0, 1], interpolation: 'slerp' }
    ]
  })
  return document
}

function make_dom (): KeyframeEditorDom {
  const ids = ['tracks', 'timeline', 'ruler', 'lanes', 'playhead', 'play', 'stop', 'time', 'values', 'status']
  const nodes = new Map<string, HTMLElement>()
  for (const id of ids) {
    const element = id === 'play' || id === 'stop'
      ? document.createElement('button')
      : document.createElement('div')
    element.id = `test-${id}`
    nodes.set(id, element)
  }
  return {
    tracks: nodes.get('tracks')!,
    timeline: nodes.get('timeline')!,
    ruler: nodes.get('ruler')!,
    lanes: nodes.get('lanes')!,
    playhead: nodes.get('playhead')!,
    play_button: nodes.get('play')! as HTMLButtonElement,
    stop_button: nodes.get('stop')! as HTMLButtonElement,
    time_label: nodes.get('time')!,
    values: nodes.get('values')!,
    status: nodes.get('status')!
  }
}

function make_host (): { host: PlaybackHost, listeners: Array<(dt: number) => void> } {
  const listeners: Array<(dt: number) => void> = []
  return {
    listeners,
    host: {
      add_frame_listener: (listener) => { listeners.push(listener) },
      remove_frame_listener: (listener) => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    }
  }
}

function make_controller (document_data: AnimationDocument | null): SharedDraftController {
  return {
    attach: () => () => {},
    subscribe: () => () => {},
    document: () => document_data,
    snapshot: () => ({ document: document_data, revision: document_data?.revision ?? 0, fingerprint: '', previewing: false, mcp_session_active: false }),
    set_channel: async () => document_data!,
    preview: async () => {}
  } as unknown as SharedDraftController
}

describe('Godot-style clip editor', () => {
  it('renders a time ruler, one lane per channel and keyframe markers', () => {
    const dom = make_dom()
    const editor = new KeyframeEditor(make_controller(make_document()), dom, make_host().host)
    editor.render()
    expect(dom.ruler.querySelectorAll('.m2m-ruler-tick').length).toBeGreaterThan(3)
    expect(dom.lanes.querySelectorAll('.m2m-lane')).toHaveLength(1)
    expect(dom.lanes.querySelectorAll('.m2m-keyframe-marker')).toHaveLength(3)
    expect(dom.tracks.querySelector('.m2m-lane-label')?.textContent).toContain('quaternion')
    editor.dispose()
  })

  it('moves the playhead and re-evaluates the pose when time changes', () => {
    const dom = make_dom()
    const editor = new KeyframeEditor(make_controller(make_document()), dom, make_host().host)
    let applied = -1
    editor.set_pose_applier((time) => { applied = time })
    editor.render()
    editor.set_time(0.5)
    expect(dom.playhead.style.left).toBe('25%')
    expect(dom.time_label.textContent).toContain('0.500 s')
    expect(applied).toBe(0.5)
    editor.dispose()
  })

  it('moves a dragged keyframe while preserving strict time ordering', async () => {
    const source = make_document()
    let current: AnimationDocument | null = source
    const writes: number[][] = []
    const controller = {
      attach: () => () => {},
      subscribe: () => () => {},
      document: () => current,
      snapshot: () => ({ document: current, revision: source.revision, fingerprint: '', previewing: false, mcp_session_active: false }),
      set_channel: async (_revision: number, _bone_id: string, _property: string, keyframes: AnimationKeyframe[]) => {
        writes.push(keyframes.map((key) => key.time_seconds))
        current = { ...source, channels: [{ ...source.channels[0], keyframes }] }
        return current
      },
      preview: async () => {}
    } as unknown as SharedDraftController
    const editor = new KeyframeEditor(controller, make_dom(), make_host().host)
    const mover = editor as unknown as {
      move_keyframe: (channel: AnimationChannel, from: number, to: number) => Promise<void>
    }
    await mover.move_keyframe(source.channels[0], 0.5, 1.4)
    expect(writes[0]).toEqual([0, 1, 1.4])
    // A move onto an existing keyframe is rejected instead of duplicating time.
    await mover.move_keyframe(source.channels[0], 0, 1)
    expect(writes).toHaveLength(1)
    editor.dispose()
  })

  it('registers and removes a frame listener for playback', () => {
    const dom = make_dom()
    const { host, listeners } = make_host()
    const editor = new KeyframeEditor(make_controller(make_document()), dom, host)
    editor.render()
    editor.play()
    expect(editor.is_playing()).toBe(true)
    expect(listeners).toHaveLength(1)
    listeners[0](0.25)
    expect(editor.current_time()).toBeCloseTo(0.25, 6)
    editor.stop()
    expect(editor.is_playing()).toBe(false)
    expect(listeners).toHaveLength(0)
    editor.dispose()
  })

  it('auto-starts a draft and uses the live bone transform for new keyframes', async () => {
    const document_data = make_document()
    const empty: AnimationDocument = { ...document_data, channels: [] }
    let current: AnimationDocument | null = null
    let started = false
    let written_values: number[] | null = null
    const lazy = {
      attach: () => () => {},
      subscribe: () => () => {},
      document: () => current,
      snapshot: () => ({ document: current, revision: 1, fingerprint: '', previewing: false, mcp_session_active: false }),
      set_channel: async (_revision: number, _bone_id: string, _property: string, keyframes: AnimationKeyframe[]) => {
        written_values = keyframes[0].values
        current = { ...empty, channels: [{ bone_id: document_data.bones[0].id, property: 'quaternion', keyframes }] }
        return current
      },
      preview: async () => {}
    } as unknown as SharedDraftController
    const editor = new KeyframeEditor(lazy, make_dom(), make_host().host)
    editor.set_autostart(async () => { started = true; current = empty }, () => [0.1, 0.2, 0.3, 0.9])
    editor.select_channel(document_data.bones[0].id, 'quaternion')
    await editor.add_keyframe()
    expect(started).toBe(true)
    expect(written_values).toEqual([0.1, 0.2, 0.3, 0.9])
    editor.dispose()
  })

  it('shows an empty editor until a draft exists', () => {
    const dom = make_dom()
    const editor = new KeyframeEditor(make_controller(null), dom, make_host().host)
    editor.render()
    expect(dom.play_button.disabled).toBe(true)
    expect(dom.tracks.textContent).toContain('Create or import')
    editor.dispose()
  })
})
