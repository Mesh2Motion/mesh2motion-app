/**
 * M2M-031 — keyframe timeline and track/channel editor.
 *
 * All edits go through SharedDraftController, i.e. the same authoritative
 * AnimationDocument that MCP edits. The timeline never owns a second copy.
 */

import type { AnimationDocument, AnimationKeyframe, AnimationProperty, KeyframeInterpolation } from '../animation-document/types'
import { evaluate_document_at_time } from '../authoringObservation/poseEvaluation'
import type { SharedDraftController } from '../animation-document/sharedDraft'

export interface KeyframeEditorDom {
  tracks: HTMLElement
  timeline: HTMLElement
  time_label: HTMLElement
  values: HTMLElement
  status: HTMLElement
}

interface Selection {
  bone_id: string
  property: AnimationProperty
}

export class KeyframeEditor {
  private selection: Selection | null = null
  private time_seconds = 0
  private readonly unsubscribe: () => void

  constructor (private readonly controller: SharedDraftController, private readonly dom: KeyframeEditorDom) {
    this.unsubscribe = controller.attach()
    controller.subscribe(() => this.render())
  }

  dispose (): void { this.unsubscribe() }

  current_time (): number { return this.time_seconds }

  set_time (time: number): void {
    const document = this.controller.document()
    this.time_seconds = Math.max(0, Math.min(time, document?.clip.duration_seconds ?? 0))
    this.dom.time_label.textContent = `${this.time_seconds.toFixed(3)} s`
    this.render_timeline()
    this.render_values()
  }

  async add_keyframe (): Promise<void> {
    const document = this.controller.document()
    if (document === null || this.selection === null) return
    const channel = document.channels.find((entry) =>
      entry.bone_id === this.selection!.bone_id && entry.property === this.selection!.property)
    const values = this.values_at_time(document)
    if (values === null) return
    const keyframes = channel === undefined ? [] : channel.keyframes.map((key) => ({ ...key, values: [...key.values] }))
    const existing = keyframes.findIndex((key) => Math.abs(key.time_seconds - this.time_seconds) < 1e-6)
    const keyframe: AnimationKeyframe = {
      time_seconds: this.time_seconds,
      values: [...values],
      interpolation: this.selection.property === 'quaternion' ? 'slerp' : 'linear'
    }
    if (existing >= 0) keyframes[existing] = keyframe
    else keyframes.push(keyframe)
    keyframes.sort((a, b) => a.time_seconds - b.time_seconds)
    await this.controller.set_channel(document.revision, this.selection.bone_id, this.selection.property, keyframes)
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
    await this.refresh_preview()
    this.set_status('Keyframe removed')
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
    const document = this.controller.document()
    this.render_tracks(document)
    this.render_timeline()
    this.render_values()
  }

  private render_tracks (document: AnimationDocument | null): void {
    this.dom.tracks.replaceChildren()
    if (document === null) {
      this.dom.tracks.textContent = 'Create or import an animation to edit its tracks.'
      return
    }
    for (const channel of document.channels) {
      const bone = document.bones.find((entry) => entry.id === channel.bone_id)
      const button = document_is_button(
        `${bone?.display_name ?? channel.bone_id} · ${channel.property} (${channel.keyframes.length})`
      )
      const selected = this.selection?.bone_id === channel.bone_id && this.selection?.property === channel.property
      button.classList.add('m2m-track-row')
      if (selected) button.setAttribute('aria-selected', 'true')
      button.addEventListener('click', () => {
        this.selection = { bone_id: channel.bone_id, property: channel.property }
        this.render()
      })
      this.dom.tracks.appendChild(button)
    }
    if (document.channels.length === 0) {
      this.dom.tracks.textContent = 'No bone channels yet. Select a bone and add a keyframe.'
    }
  }

  private render_timeline (): void {
    this.dom.timeline.replaceChildren()
    const document = this.controller.document()
    if (document === null) return
    const slider = window.document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = String(document.clip.duration_seconds)
    slider.step = '0.001'
    slider.value = String(this.time_seconds)
    slider.setAttribute('aria-label', 'Current time cursor in seconds')
    slider.addEventListener('input', () => { this.set_time(Number(slider.value)) })
    this.dom.timeline.appendChild(slider)

    if (this.selection === null) return
    const channel = document.channels.find((entry) =>
      entry.bone_id === this.selection!.bone_id && entry.property === this.selection!.property)
    if (channel === undefined) return
    for (const keyframe of channel.keyframes) {
      const marker = window.document.createElement('button')
      marker.type = 'button'
      marker.className = 'm2m-keyframe-marker'
      marker.style.left = `${(keyframe.time_seconds / Math.max(document.clip.duration_seconds, 1e-6)) * 100}%`
      marker.title = `${keyframe.time_seconds.toFixed(3)} s`
      marker.setAttribute('aria-label', `Keyframe at ${keyframe.time_seconds.toFixed(3)} seconds`)
      marker.addEventListener('click', () => { this.set_time(keyframe.time_seconds) })
      this.dom.timeline.appendChild(marker)
    }
  }

  private render_values (): void {
    this.dom.values.replaceChildren()
    const document = this.controller.document()
    if (document === null || this.selection === null) {
      this.dom.values.textContent = 'Select a track to edit its local transform.'
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

function document_is_button (label: string): HTMLButtonElement {
  const button = window.document.createElement('button')
  button.type = 'button'
  button.textContent = label
  return button
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
  const index = keyframes.findIndex((key) => Math.abs(key.time_seconds - time) < 1e-6)
  const keyframe: AnimationKeyframe = {
    time_seconds: time,
    values,
    interpolation: interpolation ?? (selection.property === 'quaternion' ? 'slerp' : 'linear')
  }
  if (index >= 0) keyframes[index] = keyframe
  else keyframes.push(keyframe)
  return keyframes.sort((a, b) => a.time_seconds - b.time_seconds)
}
