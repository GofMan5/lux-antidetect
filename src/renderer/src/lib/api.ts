// Lazy accessor — window.api may not be set when this module first loads
let _api: typeof window.api | undefined

export function getApi(): typeof window.api {
  if (!_api) _api = window.api
  return _api
}

// For backwards compat: exported as a getter-backed object
export const api = new Proxy({} as typeof window.api, {
  get(_, prop) {
    return getApi()?.[prop as keyof typeof window.api]
  }
})

export function isApiAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.api !== 'undefined'
}
