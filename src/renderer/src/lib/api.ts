export const api = window.api!

export function isApiAvailable(): boolean {
  return typeof window.api !== 'undefined'
}
