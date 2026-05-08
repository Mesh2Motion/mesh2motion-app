# Restore Point - 2026-05-08 (Position Joints Topbar)

Date: 2026-05-08
Workspace: c:\Users\jeffa\mesh2motion-app

## Summary

This restore point captures the Position Joints UI refactor into a create-only topbar layout, with a dedicated stylesheet and horizontal Visible Chains layout matching the reference screenshot.

## Key behavior

- Position Joints UI renders as a topbar only on the Create page during Edit Skeleton.
- The right-side tool panel is hidden in Edit Skeleton on Create page.
- Visible Chains checkboxes flow horizontally across the topbar row.
- Controls row is centered with compact spacing; Back/Finish sit to the far right after undo/redo.

## Files touched

- src/create.html
- src/create-position-joints.css
- src/Mesh2MotionEngine.ts
- src/lib/processes/edit-skeleton/StepEditSkeleton.ts

## Detailed notes

### Create page topbar layout

- Added `create-page` class on `body` in `create.html`.
- Injected a dedicated stylesheet `create-position-joints.css`.
- Moved Edit Skeleton UI (`#skeleton-step-actions`) into `#position-joints-topbar`.
- Topbar rows:
  - Row 1: Selected bone label centered.
  - Row 2: Visible Chains checkbox list (label removed).
  - Row 3: Controls row with Position by mesh volume, Preview toggle, Vertex Snap slider, Mirror/Move options, Undo/Redo, Back/Finish.

### Scoped CSS

- All topbar styles scoped under `body.create-page` to avoid bleeding into other pages.
- `body.create-page.edit-skeleton-topbar` toggles topbar visibility and hides `#tool-panel`.
- Visible Chains list forced to horizontal layout via flex row and a custom fieldset class.
- Controls row centered with 10px gaps between items.

### Process step hook

- `Mesh2MotionEngine` toggles `edit-skeleton-topbar` on the Create page when entering/leaving `ProcessStep.EditSkeleton`.

### Visible Chains rendering

- `StepEditSkeleton` renders the chain checkboxes into a fieldset with class `position-joints-chain-fieldset` to enforce horizontal layout and avoid duplicate labels.

## Verification checklist

- Create page (Use Your Model) shows topbar only in Edit Skeleton step.
- Explore and Retarget pages are unaffected.
- Visible Chains checkboxes flow horizontally in one row.
- Back/Finish buttons appear to the right of undo/redo.
- Controls row items are centered and tightly spaced.
