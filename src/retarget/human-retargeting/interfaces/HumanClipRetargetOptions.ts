export interface HumanClipRetargetOptions {
  // name for the baked clip. Defaults to the source clip name
  clip_name?: string
  // corrective X-axis rotation (degrees) applied to the whole target rig. See Retargeter.set_root_correction_x
  root_correction_x_degrees?: number
  // 30 fps for input animations is usually sufficient for now
  fps?: number
}
