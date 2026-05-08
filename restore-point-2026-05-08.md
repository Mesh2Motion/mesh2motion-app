# Restore Point - 2026-05-08

Date: 2026-05-08
Workspace: c:\Users\jeffa\mesh2motion-app

## Summary

This restore point captures the state after tightening the Visible Chains UI and improving default spine layout for the Fox rig.

## Visible Chains grouping changes

- Condensed spine, head, and quadruped leg chains into fewer checkboxes by grouping chain roots.
- Spine chains now anchor to the rootmost spine bone so multiple spine segments appear under one checkbox.
- Head chains anchor to the main head bone (tips/end bones grouped under head).
- Quadruped front legs group under front leg shoulder anchors (left/right).
- Quadruped back legs group under back leg pelvis anchors (left/right).

Files touched:
- src/lib/Utilities.ts
- src/lib/Utilities.test.ts

## Fox spine default layout

- Added a fox-specific spine spread on skeleton load to place spine bones horizontally.
- The spine chain spreads along the mesh horizontal axis and interpolates height between pelvis and head.
- Runs after centerline snapping during the skeletonLoaded flow.

Files touched:
- src/lib/processes/edit-skeleton/MeshDragBonePlacement.ts
- src/lib/EventListeners.ts

## Notes

- Fox spine distribution uses mesh bounds and pelvis/head positions as hints.
- If rig bone names differ from spine/pelvis/head naming, adjust the matchers in MeshDragBonePlacement.
