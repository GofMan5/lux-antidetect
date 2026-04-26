import { useEffect, useState } from 'react'

// Reactive `prefers-reduced-motion: reduce` watcher. Returns the live match
// value so smooth-scroll / animated-transition branches can flip back to
// instant when the user changes their OS-level preference without a page
// reload. SSR-safe: when no `window`/`matchMedia` exists we default to false
// so motion-on stays the conservative default.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function readPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => readPrefersReducedMotion())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(REDUCED_MOTION_QUERY)
    const handler = (e: MediaQueryListEvent): void => setReduced(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return reduced
}
