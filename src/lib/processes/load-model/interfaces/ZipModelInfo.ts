import { type ModelFormat } from './ModelFormat'

export interface ZipModelInfo {
  format: ModelFormat
  fileName: string
  fileData: ArrayBuffer
}
