import { useEffect, useState } from 'react'

// Reactive viewport width (px). Used by Sheet sizing so the slide-in panel
// can leave breathing room behind it on the layout's hard 900px minimum
// window width — see ProfilesPage / ProxiesPage editor sheets.
//
// SSR-safe: when no `window` exists we hand back a sensible mid-range
// fallback so first-render layout math doesn't divide by zero. The first
// client tick will then reconcile to the real value and the resize
// listener keeps it live.

const SSR_FALLBACK_WIDTH_PX = 1280

function readViewportWidth(): number {
  if (typeof window === 'undefined') return SSR_FALLBACK_WIDTH_PX
  return window.innerWidth
}

export function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() => readViewportWidth())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', handler, { passive: true })
    return () => window.removeEventListener('resize', handler)
  }, [])

  return width
}
