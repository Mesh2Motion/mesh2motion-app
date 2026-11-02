// when we are auto-mapping, keep track of what rig type we matched the other rig against.
// Lives in its own file so the main app can use bone auto-mapping without pulling in the
// retarget page's UI steps
export enum TargetBoneMappingType {
  Mixamo = 'mixamo',
  Rigify = 'rigify',
  Mesh2Motion = 'mesh2motion',
  Custom = 'custom', // trying to figure out bone mappings with bone name analysis
  None = 'none'
  // TODO: Add more types later
}
