export interface AnimationLoadProgress {
  loaded: number
  total: number
  percentage: number
  currentFile: string
  currentFileProgress: number
  currentFileLoaded: number
  currentFileTotal: number
  overallBytesLoaded: number
  overallBytesTotal: number
}
