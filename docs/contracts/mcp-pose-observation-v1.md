# mcp-pose-observation/v1 — shared MCP pose-observation contract

**Status:** INITIAL PUBLICATION — OpenCode (frontend) owns this file. Codex owns the Rust MCP tools,
Tauri request transport, MCP image responses and the security/resource boundary. Transport binding is
PROVISIONAL until Codex confirms it in `coordination/handoffs/M2M-030-031-observation-channel.md`.
**Protocol version string:** `mcp-pose-observation/v1`
**Canonical path (shared workspace):** `coordination/contracts/mcp-pose-observation-v1.md`
**Version-controlled copy:** `docs/contracts/mcp-pose-observation-v1.md` in the frontend feature branch
`m2m-030-031-observation-animation`. The commit SHA that first published this text is recorded in §12
and in the handoff channel.

This contract defines how an MCP vision agent obtains real offscreen observations of ONE evaluated
pose of the live rig from six directions. It does NOT change `animation-document/v1`,
`authoring-bridge/v1`, the live rig adapter, or the application's visible orbit camera / XYZ helper.
Cameras are internal only: zero visible controls, overlays, labels or scene objects in the normal UI.

## 1. Goals and invariants

1. All views in one response are rendered from the **same** evaluated skeleton transform: same draft
   ID, same revision, same `timestamp_seconds`, same rig fingerprint.
2. Images are captured from the **real live Three.js model** using an offscreen WebGL2 render target
   (or the existing supported WebGL2 readback path) — never a fabricated diagram or desktop screenshot.
3. Capture never moves the user's orbit camera, zoom, selection, animation playback time, XYZ helper,
   or visible scene contents. No camera object is added to the user-visible scene hierarchy.
4. The frontend exposes a stable callable API (§10) to Codex. Codex decides how/when to call it.
5. Everything is bounded and fail-closed: deadline, size, concurrency, retention and cancellation.

## 2. Request envelope

```ts
interface PoseObservationRequest {
  protocol: 'mcp-pose-observation/v1'
  request_id: string          // 1..64 UTF-8 bytes, unique for app lifetime
  session_id: string          // 1..64 UTF-8 bytes; authoring session if one is active
  sequence: number            // JSON-safe u64 subset 1..2^53-1, strictly increasing per session
  deadline_ms: number         // integer 100..30000
  operation: 'pose.capture' | 'pose.cancel' | 'pose.dispose' | 'pose.status'
  payload: PoseCapturePayload | PoseCancelPayload | PoseDisposePayload | Record<string, never>
}
```

The response echoes `protocol`, `request_id`, `session_id`, `sequence`, and is either:

```ts
interface PoseObservationResponse {
  protocol: 'mcp-pose-observation/v1'
  request_id: string
  session_id: string
  sequence: number
  ok: boolean
  result?: PoseCaptureResult | PoseCancelResult | PoseDisposeResult | PoseStatusResult
  error?: { code: ObservationErrorCode, message: string }
}
```

The whole serialized envelope is measured as UTF-8 bytes (`TextEncoder().encode(JSON.stringify(x)).byteLength`)
and must not exceed **256 KiB**, the same authoritative ceiling as `authoring-bridge/v1`. IDs are
1–64 **UTF-8 bytes**, not JS code units. Unknown top-level envelope fields are rejected. One request
is in flight at a time; duplicate `request_id` is rejected for the app lifetime (bounded 4096-ID
fail-closed ring, same policy as the authoring bridge).

## 3. Capture payload

```ts
interface PoseCapturePayload {
  rig_fingerprint: string               // 64-char lowercase hex SHA-256, REQUIRED
  draft_id: string                      // 1..64 chars; identifies the authoritative AnimationDocument
  expected_revision: number             // positive integer; stale revisions are rejected
  timestamp_seconds: number             // finite, >= 0, <= draft clip duration
  views: ObservationView[]              // subset of the six supported views, 1..6, no duplicates
  focus_bone_id?: string                // optional stable bone ID or supported joint-group ID
  width?: number                        // 64..1024, default 512
  height?: number                       // 64..1024, default 512
  projection?: 'orthographic' | 'perspective'   // default orthographic
  image?: { mime: 'image/png' | 'image/jpeg'; quality?: number }  // default png
  overlays?: { bone_labels?: boolean; skeleton?: boolean }       // capture-image only, default false
  include_joints?: boolean              // default true
  max_image_bytes?: number              // caller ceiling; capped by §8 limits
}
type ObservationView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
```

A request is rejected as `BAD_REQUEST` if the draft is unknown, the timestamp is outside the clip, a
view is unsupported/duplicated, dimensions are out of range, or the focus bone does not exist. An
unknown focus bone returns `UNSUPPORTED_BONE` with the list of supported bone IDs (never invented
positions). A rig fingerprint mismatch returns `RIG_MISMATCH`; a stale `expected_revision` returns
`STALE_REVISION`. No partial view set is returned on rejection.

## 4. Rig identity and pose identity

- **Rig fingerprint:** identical algorithm to `animation-document/v1` — SHA-256 over ordered bone
  names, parent indices and local rest transforms quantized to 6 decimals. The frontend computes it
  from the live `Skeleton` via the frozen `compute_rig_fingerprint` / `read_live_rig` entry points.
- **Draft ID / revision:** the authoritative `AnimationDocument` owned by the application draft
  controller. `expected_revision` must equal the current document revision. The revision is the same
  one shown by the GUI editor and the authoring bridge (no separate timeline-only source of truth).
- **Pose digest:** SHA-256 over the canonicalized evaluated local transforms (bone ID + position +
  quaternion XYZW + scale, 6-decimal quantization, bone order) at the requested timestamp. Returned in
  the result; identical for every view in a capture. This is the deterministic equality proof that
  all six views share one pose.
- **Determinism:** the same (fingerprint, draft_id, revision, timestamp, view, projection, dimensions,
  overlays) yields the same pose digest and the same camera matrices. PNG bytes are byte-identical
  when the renderer is deterministic; JPEG quality is fixed per request.

## 5. Six internal cameras

Default projection is **orthographic** so pose measurements stay comparable across views. The
frontend frames the model using its true rig-relative bounds and orientation, not a hardcoded "faces
+Z" assumption.

| View | Direction (camera → target) | Camera up |
| --- | --- | --- |
| `front` | −Z looking toward +Z | +Y |
| `back` | +Z looking toward −Z | +Y |
| `left` | +X looking toward −X | +Y |
| `right` | −X looking toward +X | +Y |
| `top` | +Y looking toward −Y | −Z (explicit) |
| `bottom` | −Y looking toward +Y | +Z (explicit) |

Top/bottom cameras require explicit up vectors to avoid degenerate `lookAt`. Humanoid and
non-Humanoid proportions are handled by fitting the orthographic frustum to the evaluated pose bounds
of the whole model (or the focus group), with a small deterministic margin. `focus_bone_id` reframes
the camera to that bone or a supported joint group (hand, foot, finger chain) using the same pose.
Framing is recomputed after any rig change. Cameras are plain `THREE.OrthographicCamera` /
`THREE.PerspectiveCamera` objects that are **never added to the user-visible scene**, and are disposed
with their render target when no longer required. No continuous render loop is created; rendering
happens only inside a capture request.

## 6. Capture result

```ts
interface PoseCaptureResult {
  protocol_version: 'mcp-pose-observation/v1'
  capture_id: string                  // unique, opaque
  expires_at_ms: number               // absolute epoch ms; bounded TTL (§8)
  rig: { identifier: string; fingerprint: string }
  draft_id: string
  revision: number
  timestamp_seconds: number
  pose_digest: string                 // same for every view
  width: number
  height: number
  projection: 'orthographic' | 'perspective'
  views: Array<{
    view: ObservationView
    mime: 'image/png' | 'image/jpeg'
    image_bytes: number               // actual byte count
    image_base64?: string              // included only when bytes <= caller/transport limit
    image_ref?: string                 // opaque handle for pose.get_image_bytes
    camera: {
      projection: 'orthographic' | 'perspective'
      position: [number, number, number]
      target: [number, number, number]
      up: [number, number, number]
      near: number
      far: number
      left?: number; right?: number; top?: number; bottom?: number  // orthographic
      fov_degrees?: number; aspect?: number                         // perspective
      view_matrix: number[]            // 16 floats, column-major (matrixWorldInverse)
      projection_matrix: number[]      // 16 floats, column-major
    }
    joints: JointObservation[]
  }>
}
```

`image_base64` is omitted (and `image_ref` supplied) when the encoded image would exceed the caller's
`max_image_bytes` or the transport limit. Codex can then fetch bytes by reference (§10). MCP image
content blocks use the exact `mime` value returned here; no re-encoding.

## 7. Joint and visibility format

```ts
interface JointObservation {
  bone_id: string                 // <rig.identifier>:bone:<3-digit index>, from live Skeleton
  display_name: string            // informational, never an identity key
  parent_id: string | null
  world_position: [number, number, number]
  local_position: [number, number, number]
  local_quaternion: [number, number, number, number]   // XYZW, normalized
  local_scale: [number, number, number]
  projected: {
    u: number                     // 0..1 horizontal, left→right
    v: number                     // 0..1 vertical, top→bottom
    depth: number                 // camera-space depth (orthographic linear)
    in_frame: boolean             // 0<=u<=1 && 0<=v<=1 && depth within near..far
    visible: boolean              // in_frame && not occluded by model geometry
    occlusion: 'none' | 'self' | 'other' | 'unknown'
    reason?: 'off_frame' | 'behind_near' | 'beyond_far' | 'occluded' | 'no_geometry'
  }
}
```

Projected coordinates use the exact camera matrices returned in §6 and the same image dimensions.
`visible`/`occlusion` are grounded by a raycast against the live evaluated skinned mesh (when
geometry is available); otherwise the honest value `unknown` is returned. Missing bones are never
invented or inferred from names. Optional `bone_labels` / `skeleton` overlays are drawn **only into
the captured image**, never into the user's viewport.

## 8. Resource limits and expiration

| Limit | Value |
| --- | --- |
| Views per request | 1..6, no duplicates |
| Concurrent captures | 1 (second request → `RESOURCE_LIMIT_EXCEEDED`) |
| Retained captures | at most 4, total retained image bytes ≤ 8 MiB |
| Capture TTL | 30 s default; absolute `expires_at_ms`; expired → `CAPTURE_EXPIRED` |
| Image dimensions | 64..1024 per axis; default 512×512 |
| Max encoded bytes / view | PNG ≤ 1 MiB, JPEG ≤ 256 KiB (also bounded by caller `max_image_bytes`) |
| Total IPC frame | 256 KiB UTF-8 for the envelope; larger images fetched by `image_ref` |
| Bones per capture | ≤ 256 (frozen document limit) |
| WebGL contexts | 0 new contexts; reuse the existing renderer/context; 1 shared render target |
| Render target | single reusable `WebGLRenderTarget`, resized per request, disposed on service dispose |
| Render loops | none; capture renders synchronously on request only |

On expiry, cancel, dispose, rig replacement or app exit, all retained image buffers are released and
all `image_ref` handles become invalid (`CAPTURE_NOT_FOUND`). GPU state (render target, viewport,
scissor, clear colour/depth, camera, scene overrides, tone mapping, pixel ratio) is saved and restored
in a `finally` transaction even on failure/cancellation.

## 9. Cancellation, deadline and error codes

- `deadline_ms` is enforced from request arrival; on expiry the in-flight capture is cancelled, the
  render target state is restored, and `DEADLINE_EXCEEDED` is returned. No partial image is returned.
- `pose.cancel` with `{ capture_id? | request_id? }` cancels an in-flight capture or releases a
  retained one; returns `{ cancelled: true }` (idempotent). `pose.dispose` with `{ capture_id }`
  releases one capture; `pose.status` returns service state without rendering.
- Cancellation also arrives from Codex on MCP peer disconnect / authoring disable / shutdown (proposed
  Tauri event `m2m-pose-observation-cancel`). Every cancellation path cleans GPU and memory state.
- **Error codes (closed set):** `BAD_PROTOCOL`, `UNKNOWN_OPERATION`, `BAD_REQUEST`, `PAYLOAD_TOO_LARGE`,
  `DEADLINE_EXCEEDED`, `DUPLICATE_REQUEST_ID`, `SESSION_CONFLICT`, `RIG_UNAVAILABLE`, `RIG_MISMATCH`,
  `STALE_REVISION`, `UNSUPPORTED_BONE`, `CAPTURE_CANCELLED`, `CAPTURE_EXPIRED`, `CAPTURE_NOT_FOUND`,
  `RESOURCE_LIMIT_EXCEEDED`, `PREVIEW_ACTIVE`, `RENDER_FAILED`, `CONTEXT_LOST`, `INTERNAL`.

## 10. Frontend callable API (Codex handoff surface)

Exported from `src/authoringObservation/service.ts` (module singleton `poseObservationService`):

```ts
capturePose(request: PoseObservationRequest): Promise<PoseObservationResponse>
getCaptureImage(captureId: string, view: ObservationView): { mime: string; bytes: Uint8Array } | null
getJointProjection(captureId: string, view: ObservationView): JointObservation[] | null
cancelCapture(id: { capture_id?: string; request_id?: string }): boolean
disposeCapture(captureId: string): void
dispose(): void                        // all captures, render target and listeners
attachObservationAdapter(adapter): void // optional transport adapter installed by the app
```

Transport adapter (PROVISIONAL, to be confirmed by Codex): Rust emits
`m2m-pose-observation-request`, frontend answers via Tauri command `mcp_pose_observation_respond`
with `{ response }`, and emits `m2m-pose-observation-cancel` for cancellation. Browser CustomEvents are
test-only and never authorize a capture. No filesystem path, shell command, or `eval` is accepted.

## 11. Coordination boundaries

- Codex owns: Rust MCP tools, Tauri transport, MCP image response shape, security/resource limits.
- OpenCode owns: frontend observation modules, Three.js render targets, rig geometry/projection
  metadata, capture images, New Animation UI, GUI↔MCP draft controller.
- Do not silently change this contract after both sides start implementing. Amendments must be a new
  version (`mcp-pose-observation/v2`) or an explicitly documented, agreed note in the channel.

## 12. Publication record

| Version | Frontend commit | Note |
| --- | --- | --- |
| `mcp-pose-observation/v1` (initial) | **`9683e96`** | contract published to Codex via handoff channel |
| `mcp-pose-observation/v1` (implementation) | **`d4fd2b5`** … **`badb511`** | six cameras, capture service, New Animation workspace; no frozen rule changed |

The exact SHAs are recorded in the table above and in
`coordination/handoffs/M2M-030-031-observation-channel.md`. No frozen rule of
`animation-document/v1` or `authoring-bridge/v1` is changed by this contract.
