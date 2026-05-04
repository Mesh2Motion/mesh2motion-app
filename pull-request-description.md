# PR: Improve rig fitting, helper controls, and weight smoothing

## Summary

This pull request improves the rig fitting workflow for manually positioned skeletons and softens several problem areas in generated skin weights.

The main functional changes are:

- added mesh-drag vertex snapping with a user-controlled snap strength slider
- added condensed main-chain visibility toggles in Position Joints mode
- centered pelvis, spine, chest, neck, and head placement against the mesh instead of the front surface
- reduced finger joint helper circle size and made helper visibility respect hidden chains
- prevented branching parent bones such as chest and pelvis from being auto-rotated when child bones are moved independently
- expanded weight smoothing around pelvis, thighs, buttocks, shoulders, clavicles, neck, and upper arms
- added focused regression tests for the new placement, chain grouping, rotation, and smoothing behavior

## Why

These changes target the issues seen during rig fitting and auto-weighting on humanoid avatars:

- joint placement needed stronger assistance when dragging bones over the mesh
- main chains needed to be easier to isolate visually during joint positioning
- centerline bones were drifting too far toward the front of the character
- shoulder and hip areas needed softer, more natural blending similar to the imported DAE reference
- chest and shoulder orientation could drift when moving branching child bones

## What changed

### Position Joints workflow

- Added a snap strength slider with a `0` to `20` range for mesh-drag snapping.
- Added visible-chain checkboxes for condensed main chains, with fingers grouped into the hand chain.
- Wired helper visibility changes so hidden chains are removed from the active helper display.

### Bone placement and orientation

- Added nearest-vertex snap blending during mesh drag.
- Added mesh-centerline targeting for primary centerline bones.
- Applied automatic centerline snapping after skeleton load for pelvis, spine, chest, neck, and head chains.
- Preserved template orientation on branching parent bones during independent child movement.

### Weight smoothing

- Expanded boundary smoothing to keep more multi-bone influence at seam regions.
- Added along-bone gradients so bone centers stay dominant while joints retain blended influence.
- Added stronger symmetric socket smoothing for:
  - pelvis to thigh
  - spine/chest/neck to shoulder chain
  - clavicle to upper arm
- Added pelvis-basin smoothing to improve the glute and central pelvis region.
- Strengthened torso-to-upperarm blending in the front shoulder area.

### Helper and utility updates

- Added condensed chain grouping utilities for visibility and labeling.
- Added smaller helper points for finger joints.
- Ensured hidden chain roots affect helper rendering consistently.

### Investigation support

- Added temporary scripts under `tmp/` for comparing skeleton topology and weight profiles during debugging.

## Testing

- `npm run build`
- Focused regression tests were added for:
  - chain grouping utilities
  - mesh drag snapping and centerline helpers
  - independent branching-bone movement behavior
  - advanced weight smoothing boundaries

## Notes for review

- This PR includes temporary analysis scripts in `tmp/` because they were used to validate skeleton and weight-profile differences during the investigation.
- The changes are concentrated in the rig-editing and skin-weight smoothing flow rather than import/export behavior.