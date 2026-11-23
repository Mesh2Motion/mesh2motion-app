/**
 * M2M-031 — Godot-style clip/keyframe editor.
 *
 * A time ruler, one lane per authored channel with diamond keyframes, a draggable
 * playhead, and transport controls. Scrubbing and playback evaluate the pose onto
 * the live rig through the shared authoritative AnimationDocument.
 */

import type { AnimationDocument, AnimationKeyframe, AnimationProperty, KeyframeInterpolation } from '../animation-document/types'
import { evaluate_document_at_time } from '../authoringObservation/poseEvaluation'
import type { SharedDraftController } from '../animation-document/sharedDraft'

export interface KeyframeEditorDom {
  tracks: HTMLElement
  timeline: HTMLElement
  ruler: HTMLElement
  lanes: HTMLElement
  playhead: HTMLElement
  play_button: HTMLButtonElement
  stop_button: HTMLButtonElement
  time_label: HTMLElement
  values: HTMLElement
  status: HTMLElement
}

export interface PlaybackHost {
  add_frame_listener (listener: (delta_time: number) => void): void
  remove_frame_listener? (listener: (delta_time: number) => void): void
}

interface Selection {
  bone_id: string
  property: AnimationProperty
}

export class KeyframeEditor {
  private selection: Selection | null = null
  private selected_key_time: number | null = null
  private time_seconds = 0
  private playing = false
  private readonly unsubscribe: () => void
  private pose_applier: ((time: number) => void) | null = null
  private readonly frame_listener: (delta_time: number) => void

  constructor (
    private readonly controller: SharedDraftController,
    private readonly dom: KeyframeEditorDom,
    private readonly host: PlaybackHost
  ) {
    this.unsubscribe = controller.attach()
    controller.subscribe(() => this.render())
    this.frame_listener = (delta_time: number): void => {
      if (!this.playing) return
      const duration = this.controller.document()?.clip.duration_seconds ?? 0
      if (duration <= 0) return
      let next = this.time_seconds + delta_time
      if (next > duration) next = 0
      this.set_time(next, true)
    }
    this.dom.play_button.addEventListener('click', () => { this.toggle_play() })
    this.dom.stop_button.addEventListener('click', () => { this.stop() })
  }

  set_pose_applier (applier: (time: number) => void): void {
    this.pose_applier = applier
  }

  dispose (): void {
    this.stop()
    this.unsubscribe()
  }

  is_playing (): boolean { return this.playing }
  current_time (): number { return this.time_seconds }

  toggle_play (): void {
    if (this.playing) this.stop()
    else this.play()
  }

  play (): void {
    if (this.controller.document() === null) {
      this.set_status('Create a clip before playing the timeline.')
      return
    }
    if (this.playing) return
    this.playing = true
    this.dom.play_button.textContent = '❚❚'
    this.dom.play_button.setAttribute('aria-label', 'Pause')
    this.host.add_frame_listener(this.frame_listener)
  }

  stop (): void {
    if (!this.playing) return
    this.playing = false
    this.host.remove_frame_listener?.(this.frame_listener)
    this.dom.play_button.textContent = '▶'
    this.dom.play_button.setAttribute('aria-label', 'Play')
    this.set_time(0)
  }

  set_time (time: number, light = false): void {
    const duration = this.controller.document()?.clip.duration_seconds ?? 0
    this.time_seconds = Math.max(0, Math.min(time, duration))
    this.dom.time_label.textContent = `${this.time_seconds.toFixed(3)} s / ${duration.toFixed(3)} s`
    this.update_playhead()
    this.pose_applier?.(this.time_seconds)
    if (!light) {
      this.render_lanes()
      this.render_values()
    }
  }

  private time_from_pointer (event: MouseEvent | PointerEvent): number {
    const rect = this.dom.lanes.getBoundingClientRect()
    const duration = this.controller.document()?.clip.duration_seconds ?? 0
    if (rect.width <= 0) return 0
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    return ratio * duration
  }

  private update_playhead (): void {
    const duration = this.controller.document()?.clip.duration_seconds ?? 0
    const percent = duration > 0 ? (this.time_seconds / duration) * 100 : 0
    this.dom.playhead.style.left = `${percent}%`
  }

  async add_keyframe (): Promise<void> {
    const document = this.controller.document()
    if (document === null || this.selection === null) return
    const channel = document.channels.find((entry) =>
      entry.bone_id === this.selection!.bone_id && entry.property === this.selection!.property)
    const values = this.values_at_time(document)
    if (values === null) return
    const keyframes = channel === undefined ? [] : channel.keyframes.map((key) => ({ ...key, values: [...key.values] }))
    const keyframe: AnimationKeyframe = {
      time_seconds: this.time_seconds,
      values: [...values],
      interpolation: this.selection.property === 'quaternion' ? 'slerp' : 'linear'
    }
    upsert(keyframes, keyframe)
    await this.controller.set_channel(document.revision, this.selection.bone_id, this.selection.property, keyframes)
    this.selected_key_time = this.time_seconds
    await this.refresh_preview()
    this.set_status(`Keyframe at ${this.time_seconds.toFixed(3)} s written at revision ${this.controller.snapshot().revision}`)
  }

  async remove_keyframe (): Promise<void> {
    const document = this.controller.document()
    if (document === null || this.selection === null) return
    const channel = document.channels.find((entry) =>
      entry.bone_id === this.selection!.bone_id && entry.property === this.selection!.property)
    if (channel === undefined) return
    const keyframes = channel.keyframes.filter((key) => Math.abs(key.time_seconds - this.time_seconds) >= 1e-6)
    await this.controller.set_channel(document.revision, this.selection.bone_id, this.selection.property, keyframes)
    this.selected_key_time = null
    await this.refresh_preview()
    this.set_status('Keyframe removed')
  }

  /** Write a bone's local TRS (from a gizmo drag) at the current timeline cursor. */
  async upsert_channel_key (bone_id: string, property: AnimationProperty, values: number[]): Promise<void> {
    const document = this.controller.document()
    if (document === null) throw new Error('no active draft')
    const keyframes = upsert_keyframe(document, { bone_id, property }, this.time_seconds, values)
    await this.controller.set_channel(document.revision, bone_id, property, keyframes)
    this.selection = { bone_id, property }
    this.selected_key_time = this.time_seconds
    await this.refresh_preview()
    this.set_status(`Gizmo edit written to ${property} at ${this.time_seconds.toFixed(3)} s`)
    this.render()
  }

  private values_at_time (document: AnimationDocument): number[] | null {
    if (this.selection === null) return null
    const evaluated = evaluate_document_at_time(document, Math.min(this.time_seconds, document.clip.duration_seconds))
    const value = evaluated.find((entry) =>
      entry.bone_id === this.selection!.bone_id && entry.property === this.selection!.property)
    if (value !== undefined) return value.values
    const channel = document.channels.find((entry) =>
      entry.bone_id === this.selection!.bone_id && entry.property === this.selection!.property)
    return channel === undefined || channel.keyframes.length === 0
      ? (this.selection.property === 'quaternion' ? [0, 0, 0, 1] : [0, 0, 0])
      : [...channel.keyframes[0].values]
  }

  private async refresh_preview (): Promise<void> {
    if (this.controller.snapshot().previewing) {
      await this.controller.preview(false)
      await this.controller.preview(true)
    }
  }

  private set_status (message: string): void {
    this.dom.status.textContent = message
  }

  render (): void {
    const has_draft = this.controller.document() !== null
    this.dom.play_button.disabled = !has_draft
    this.dom.stop_button.disabled = !has_draft
    this.render_ruler()
    this.render_tracks()
    this.render_lanes()
    this.render_values()
    this.update_playhead()
    this.dom.time_label.textContent =
      `${this.time_seconds.toFixed(3)} s / ${(this.controller.document()?.clip.duration_seconds ?? 0).toFixed(3)} s`
  }

  private render_ruler (): void {
    this.dom.ruler.replaceChildren()
    const duration = this.controller.document()?.clip.duration_seconds ?? 0
    if (duration <= 0) return
    const step = duration <= 2 ? 0.25 : duration <= 6 ? 0.5 : 1
    for (let time = 0; time <= duration + 1e-6; time += step) {
      const tick = window.document.createElement('div')
      tick.className = 'm2m-ruler-tick'
      tick.style.left = `${(time / duration) * 100}%`
      tick.textContent = `${Number(time.toFixed(2))}s`
      this.dom.ruler.appendChild(tick)
    }
  }

  private render_tracks (): void {
    this.dom.tracks.replaceChildren()
    const document = this.controller.document()
    if (document === null) {
      this.dom.tracks.textContent = 'Create or import an animation.'
      return
    }
    for (const channel of document.channels) {
      const bone = document.bones.find((entry) => entry.id === channel.bone_id)
      const label = window.document.createElement('div')
      label.className = 'm2m-lane-label'
      label.textContent = `${bone?.display_name ?? channel.bone_id} · ${channel.property}`
      label.title = label.textContent
      label.setAttribute('role', 'button')
      label.setAttribute('tabindex', '0')
      if (this.is_selected(channel.bone_id, channel.property)) label.classList.add('selected')
      label.addEventListener('click', () => this.select_track(channel.bone_id, channel.property))
      label.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') this.select_track(channel.bone_id, channel.property)
      })
      this.dom.tracks.appendChild(label)
    }
    if (document.channels.length === 0) this.dom.tracks.textContent = 'No channels yet.'
  }

  private is_selected (bone_id: string, property: AnimationProperty): boolean {
    return this.selection?.bone_id === bone_id && this.selection?.property === property
  }

  private select_track (bone_id: string, property: AnimationProperty): void {
    this.selection = { bone_id, property }
    this.selected_key_time = null
    this.render_tracks()
    this.render_lanes()
    this.render_values()
  }

  private render_lanes (): void {
    for (const existing of Array.from(this.dom.lanes.querySelectorAll('.m2m-lane'))) existing.remove()
    const document = this.controller.document()
    if (document === null) return
    const duration = Math.max(document.clip.duration_seconds, 1e-6)
    for (const channel of document.channels) {
      const lane = window.document.createElement('div')
      lane.className = 'm2m-lane'
      if (this.is_selected(channel.bone_id, channel.property)) lane.classList.add('selected')
      lane.addEventListener('click', (event) => {
        this.select_track(channel.bone_id, channel.property)
        this.set_time(this.time_from_pointer(event))
      })
      lane.addEventListener('dblclick', (event) => {
        this.select_track(channel.bone_id, channel.property)
        const time = this.time_from_pointer(event)
        this.set_time(time)
        void this.add_keyframe()
      })
      for (const keyframe of channel.keyframes) {
        const marker = window.document.createElement('button')
        marker.type = 'button'
        marker.className = 'm2m-keyframe-marker'
        marker.style.left = `${(keyframe.time_seconds / duration) * 100}%`
        marker.title = `${keyframe.time_seconds.toFixed(3)} s · ${keyframe.interpolation}`
        marker.setAttribute('aria-label', `Keyframe at ${keyframe.time_seconds.toFixed(3)} seconds`)
        if (this.is_selected(channel.bone_id, channel.property) &&
            this.selected_key_time !== null &&
            Math.abs(keyframe.time_seconds - this.selected_key_time) < 1e-6) {
          marker.classList.add('selected')
        }
        marker.addEventListener('click', (event) => {
          event.stopPropagation()
          this.select_track(channel.bone_id, channel.property)
          this.selected_key_time = keyframe.time_seconds
          this.set_time(keyframe.time_seconds)
        })
        lane.appendChild(marker)
      }
      this.dom.lanes.appendChild(lane)
    }
  }

  private render_values (): void {
    this.dom.values.replaceChildren()
    const document = this.controller.document()
    if (document === null || this.selection === null) {
      this.dom.values.textContent = 'Select a channel to edit its local transform.'
      return
    }
    const values = this.values_at_time(document)
    if (values === null) return
    const labels = this.selection.property === 'quaternion' ? ['X', 'Y', 'Z', 'W'] : ['X', 'Y', 'Z']
    for (let index = 0; index < values.length; index++) {
      const label = window.document.createElement('label')
      label.textContent = `${labels[index]} `
      const input = window.document.createElement('input')
      input.type = 'number'
      input.step = '0.001'
      input.value = values[index].toFixed(4)
      input.setAttribute('aria-label', `${this.selection.property} ${labels[index]}`)
      input.addEventListener('change', async () => {
        const next = this.values_at_time(document) ?? [...values]
        next[index] = Number(input.value)
        const current = this.controller.document()
        if (current === null) return
        await this.controller.set_channel(current.revision, this.selection!.bone_id, this.selection!.property,
          upsert_keyframe(current, this.selection!, this.time_seconds, next))
        await this.refresh_preview()
        this.set_status(`Local ${this.selection!.property} updated at revision ${this.controller.snapshot().revision}`)
      })
      label.appendChild(input)
      this.dom.values.appendChild(label)
    }

    const interpolation_label = window.document.createElement('label')
    interpolation_label.textContent = 'Interpolation '
    const interpolation = window.document.createElement('select')
    interpolation.setAttribute('aria-label', 'Keyframe interpolation')
    const channel = document.channels.find((entry) =>
      entry.bone_id === this.selection!.bone_id && entry.property === this.selection!.property)
    const current = channel?.keyframes.find((key) => Math.abs(key.time_seconds - this.time_seconds) < 1e-6)
    for (const option of ['linear', 'step', 'slerp'] as const) {
      const element = window.document.createElement('option')
      element.value = option
      element.textContent = option
      element.selected = (current?.interpolation ?? (this.selection.property === 'quaternion' ? 'slerp' : 'linear')) === option
      interpolation.appendChild(element)
    }
    interpolation.addEventListener('change', async () => {
      const current_document = this.controller.document()
      if (current_document === null || this.selection === null) return
      await this.controller.set_channel(
        current_document.revision,
        this.selection.bone_id,
        this.selection.property,
        upsert_keyframe(current_document, this.selection, this.time_seconds,
          this.values_at_time(current_document) ?? [], interpolation.value as KeyframeInterpolation)
      )
      await this.refresh_preview()
      this.set_status(`Interpolation set to ${interpolation.value}`)
    })
    interpolation_label.appendChild(interpolation)
    this.dom.values.appendChild(interpolation_label)
  }
}

function upsert (keyframes: AnimationKeyframe[], keyframe: AnimationKeyframe): void {
  const index = keyframes.findIndex((key) => Math.abs(key.time_seconds - keyframe.time_seconds) < 1e-6)
  if (index >= 0) keyframes[index] = keyframe
  else keyframes.push(keyframe)
  keyframes.sort((a, b) => a.time_seconds - b.time_seconds)
}

function upsert_keyframe (
  document: AnimationDocument,
  selection: Selection,
  time: number,
  values: number[],
  interpolation?: KeyframeInterpolation
): AnimationKeyframe[] {
  const existing = document.channels.find((entry) =>
    entry.bone_id === selection.bone_id && entry.property === selection.property)
  const keyframes = (existing?.keyframes ?? []).map((key) => ({ ...key, values: [...key.values] }))
  upsert(keyframes, {
    time_seconds: time,
    values,
    interpolation: interpolation ?? (selection.property === 'quaternion' ? 'slerp' : 'linear')
  })
  return keyframes
}
