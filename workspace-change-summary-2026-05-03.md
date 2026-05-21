# Workspace Change Summary - 2026-05-03

This file summarizes the changes made in this workspace since the previous commit.

## Main outcomes

- Improved skeleton editing for centerline bones so pelvis, spine, chest, neck, and head snap toward the mesh center instead of drifting toward the front surface.
- Added vertex snap strength controls for mesh-drag joint placement.
- Added condensed bone-chain visibility controls so main chains can be shown or hidden while keeping finger bones grouped under the hand chain.
- Refined skeleton helper rendering so finger joints use smaller circles and hidden chains are respected by both points and lines.
- Expanded skin-weight smoothing substantially for human shoulder, clavicle, torso, pelvis, thigh, buttocks, and glute-area transitions.
- Prevented branching parent bones such as the chest from auto-rotating during independent child movement, which helps preserve the default human rig shoulder orientation.
- Added focused regression tests for utility chain grouping, mesh-drag snapping, independent bone movement, and weight smoothing.
- Added temporary investigation scripts under `tmp/` for comparing rigs and weight profiles outside the runtime app.

## UI and interaction changes

### Position Joints workflow

- Added `Visible Chains` UI in `src/create.html` and wired it through `src/lib/UI.ts` and `src/lib/processes/edit-skeleton/StepEditSkeleton.ts`.
- Added mesh-drag vertex snap slider controls in `src/create.html`, `src/lib/UI.ts`, and `src/lib/processes/edit-skeleton/StepEditSkeleton.ts`.
- Added chain visibility event handling in `src/lib/EventListeners.ts` and helper sync in `src/Mesh2MotionEngine.ts`.

### Skeleton helper rendering

- Updated `src/lib/CustomSkeletonHelper.ts` to:
  - support hidden chain roots
  - hide helper lines for hidden chains
  - render finger joints with a dedicated smaller points layer
  - keep small finger circles independent from mesh weighting logic

## Bone placement and orientation changes

### Mesh drag placement

- Updated `src/lib/processes/edit-skeleton/MeshDragBonePlacement.ts` to:
  - support configurable vertex snap influence
  - find nearest hit-face vertex for snapping
  - compute mesh centerline targets for centerline bones
  - snap primary centerline bones to the mesh center when the skeleton loads

### Independent bone movement

- Updated `src/lib/processes/edit-skeleton/IndependentBoneMovement.ts` so branching parents like chest or pelvis preserve their template orientation when a child bone is translated.
- This prevents chest and shoulder hubs from twisting backward due to averaged child-direction reorientation.

## Weight smoothing changes

### Broader smoothing model

- Updated `src/lib/solvers/WeightSmoother.ts` to:
  - preserve and merge multiple influences instead of collapsing back to simple two-weight assignments
  - expand standard boundary smoothing with extra neighbor rings
  - add an axial joint-to-center gradient for simple bone chains
  - add symmetric socket smoothing for pelvis-thigh, spine/neck-to-shoulder, and clavicle-to-upperarm boundaries
  - widen pelvis-thigh socket smoothing further
  - add dedicated pelvis-basin smoothing for glute-area vertices
  - bias the front shoulder seam to keep torso-to-upperarm regions better connected

### Areas specifically improved

- Pelvis to thigh transition
- Buttocks and central pelvis basin
- Spine, chest, neck to shoulder transition
- Clavicle to upper arm transition
- Front torso to upper arm seam

## Utility and grouping changes

- Updated `src/lib/Utilities.ts` to support:
  - chain root detection
  - grouped hand and foot chains
  - condensed chain labels
  - mapping descendant bones back to grouped main chains

## Test coverage added

- `src/lib/Utilities.test.ts`
- `src/lib/processes/edit-skeleton/IndependentBoneMovement.test.ts`
- `src/lib/processes/edit-skeleton/MeshDragBonePlacement.test.ts`
- `src/lib/solvers/WeightSmoother.test.ts`

These tests cover:

- condensed chain grouping
- centerline and vertex snap logic
- shoulder/chest orientation preservation
- boundary accumulation and advanced smoothing regressions

## Temporary investigation scripts

Added under `tmp/`:

- `compare-skeletons.mjs`
- `compare-weight-profiles.mjs`
- `inspect-moo-skeleton.mjs`

These were used for one-off inspection of imported rigs and weight distributions.

## Files touched

Modified:

- `src/Mesh2MotionEngine.ts`
- `src/create.html`
- `src/lib/CustomSkeletonHelper.ts`
- `src/lib/EventListeners.ts`
- `src/lib/UI.ts`
- `src/lib/Utilities.ts`
- `src/lib/processes/edit-skeleton/IndependentBoneMovement.ts`
- `src/lib/processes/edit-skeleton/MeshDragBonePlacement.ts`
- `src/lib/processes/edit-skeleton/StepEditSkeleton.ts`
- `src/lib/solvers/WeightSmoother.ts`

Added:

- `src/lib/Utilities.test.ts`
- `src/lib/processes/edit-skeleton/IndependentBoneMovement.test.ts`
- `src/lib/processes/edit-skeleton/MeshDragBonePlacement.test.ts`
- `src/lib/solvers/WeightSmoother.test.ts`
- `tmp/compare-skeletons.mjs`
- `tmp/compare-weight-profiles.mjs`
- `tmp/inspect-moo-skeleton.mjs`
- `workspace-change-summary-2026-05-03.md`