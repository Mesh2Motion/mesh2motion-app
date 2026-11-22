/** Minimal declaration for the browser download helper used by the preview generator. */
declare module 'file-saver' {
  export function saveAs (data: Blob | string | Uint8Array, filename?: string): void
}
