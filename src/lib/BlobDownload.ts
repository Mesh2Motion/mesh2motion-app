/**
 * Shared Blob download helper. Previously each export step created an object URL,
 * clicked a hidden anchor and never revoked it, retaining every exported GLB in
 * memory until page unload. Revocation is deferred so the browser has dispatched
 * the download before the URL is invalidated.
 */

export const REVOKE_DELAY_MS = 1000

export function download_blob (blob: Blob, filename: string, link: HTMLAnchorElement): void {
  const url = URL.createObjectURL(blob)
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, REVOKE_DELAY_MS)
}
