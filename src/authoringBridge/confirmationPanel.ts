/**
 * M2M-028A — real in-application confirmation panel.
 *
 * Only a DOM click inside this panel can resolve a pending confirmation. No
 * client-supplied field can approve a commit or undo. State is held locally so
 * an unmounted panel rejects with CONFIRMATION_REQUIRED.
 */

import {
  NATIVE_CONFIRMATION_SCHEMA,
  type NativeConfirmationBridge,
  type NativeConfirmationRequest,
  type NativeConfirmationResult
} from '../animation-document/confirmation'

export interface ConfirmationDetails {
  animation_name: string
  rig_identifier: string
  fingerprint_prefix: string
  duration_seconds: number
  track_count: number
  keyframe_count: number
  operation: string
}

const CONFIRMATION_TIMEOUT_MS = 30000

export class NativeConfirmationPanel implements NativeConfirmationBridge {
  private panel: HTMLElement | null = null
  private pending: {
    request: NativeConfirmationRequest
    resolve: (result: NativeConfirmationResult) => void
    timer: ReturnType<typeof setTimeout>
  } | null = null

  constructor (private readonly host: HTMLElement = document.body) {}

  request_confirmation (
    request: NativeConfirmationRequest,
    details: ConfirmationDetails = {
      animation_name: request.clip_name,
      rig_identifier: 'unknown',
      fingerprint_prefix: '',
      duration_seconds: 0,
      track_count: 0,
      keyframe_count: 0,
      operation: request.operation
    }
  ): Promise<NativeConfirmationResult> {
    this.reject_pending('CONFIRMATION_REQUIRED')
    const panel = this.build_panel(details)
    this.host.append(panel)
    this.panel = panel

    return new Promise<NativeConfirmationResult>((resolve) => {
      const timer = setTimeout(() => this.reject_pending('CONFIRMATION_EXPIRED'), CONFIRMATION_TIMEOUT_MS)
      this.pending = { request, resolve, timer }
      panel.querySelector<HTMLButtonElement>('[data-m2m-confirm="approve"]')?.addEventListener('click', () => {
        this.finish(true)
      })
      panel.querySelector<HTMLButtonElement>('[data-m2m-confirm="reject"]')?.addEventListener('click', () => {
        this.finish(false)
      })
    })
  }

  dispose (): void {
    this.reject_pending('CONFIRMATION_REQUIRED')
  }

  is_pending (): boolean {
    return this.pending !== null
  }

  private finish (approved: boolean): void {
    const pending = this.pending
    if (pending === null) return
    clearTimeout(pending.timer)
    this.pending = null
    this.panel?.remove()
    this.panel = null
    pending.resolve({
      schema_version: NATIVE_CONFIRMATION_SCHEMA,
      request_id: pending.request.request_id,
      approved,
      decided_by: 'user',
      decided_at_utc: new Date().toISOString(),
      ...(approved ? {} : { rejection_reason: 'rejected in native confirmation panel' })
    })
  }

  private reject_pending (reason: 'CONFIRMATION_REQUIRED' | 'CONFIRMATION_EXPIRED'): void {
    const pending = this.pending
    if (pending === null) return
    clearTimeout(pending.timer)
    this.pending = null
    this.panel?.remove()
    this.panel = null
    pending.resolve({
      schema_version: NATIVE_CONFIRMATION_SCHEMA,
      request_id: pending.request.request_id,
      approved: false,
      decided_by: 'user',
      decided_at_utc: null,
      rejection_reason: reason
    })
  }

  private build_panel (details: ConfirmationDetails): HTMLElement {
    const panel = document.createElement('section')
    panel.className = 'm2m-authoring-confirmation'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    panel.innerHTML = `
      <h2>Confirm animation ${details.operation === 'undo' ? 'undo' : 'commit'}</h2>
      <dl>
        <div><dt>Animation</dt><dd data-detail="name"></dd></div>
        <div><dt>Target rig</dt><dd data-detail="rig"></dd></div>
        <div><dt>Duration</dt><dd data-detail="duration"></dd></div>
        <div><dt>Tracks / keyframes</dt><dd data-detail="tracks"></dd></div>
      </dl>
      <div class="m2m-authoring-confirmation-actions">
        <button type="button" data-m2m-confirm="reject">Reject</button>
        <button type="button" data-m2m-confirm="approve">Approve</button>
      </div>`
    const set = (key: string, value: string): void => {
      const element = panel.querySelector<HTMLElement>(`[data-detail="${key}"]`)
      if (element !== null) element.textContent = value
    }
    set('name', details.animation_name)
    set('rig', `${details.rig_identifier} (${details.fingerprint_prefix})`)
    set('duration', `${details.duration_seconds.toFixed(2)} s`)
    set('tracks', `${details.track_count} / ${details.keyframe_count}`)
    return panel
  }
}
