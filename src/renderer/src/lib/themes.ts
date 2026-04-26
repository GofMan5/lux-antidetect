export interface ThemeColors {
  surface: string
  surfaceAlt: string
  card: string
  elevated: string
  edge: string
  content: string
  muted: string
  accent: string
  accentDim: string
  ok: string
  warn: string
  err: string
}

export interface Theme {
  id: string
  name: string
  colors: ThemeColors
  isCustom?: boolean
}

// Status colors are intentionally muted across all presets — neon green
// and screaming red are fatiguing on a tool you stare at for hours. Keep
// them legible but quiet.
const STATUS_MUTED = { ok: '#7eaa6c', warn: '#d4a168', err: '#c95960' }

export const THEME_PRESETS: Theme[] = [
  {
    // Default. "Vault" — electric blue accent on a deep graphite surface.
    // Values mirror the `@theme` block in `index.css` so applying this
    // preset is effectively a no-op; the runtime override path stays
    // identical to switching to any alternate preset below.
    id: 'champagne-noir',
    name: 'Vault',
    colors: {
      surface: '#08090c',
      surfaceAlt: '#0d0e13',
      card: '#11131a',
      elevated: '#181a23',
      edge: '#232631',
      content: '#ffffff',
      muted: '#8a8d9a',
      accent: '#3b82f6',
      accentDim: '#2563eb',
      ok: '#34d399',
      warn: '#fbbf24',
      err: '#ef4444'
    }
  },
  {
    // Cool counterpart for users who prefer blue-leaning accents.
    id: 'sapphire-noir',
    name: 'Sapphire Noir',
    colors: {
      surface: '#0a0b0e',
      surfaceAlt: '#0e1014',
      card: '#14171d',
      elevated: '#1c2029',
      edge: '#282d38',
      content: '#e6e7eb',
      muted: '#7a7f8a',
      accent: '#7ea7d4',
      accentDim: '#5d8bbd',
      ...STATUS_MUTED
    }
  },
  {
    // Mossy / forest green — calmer than typical neon-emerald tools.
    id: 'verdant-noir',
    name: 'Verdant Noir',
    colors: {
      surface: '#0a0c0a',
      surfaceAlt: '#0d100e',
      card: '#141812',
      elevated: '#1c2118',
      edge: '#283021',
      content: '#e7e9e3',
      muted: '#7d847a',
      accent: '#9ab87a',
      accentDim: '#7da062',
      ...STATUS_MUTED
    }
  },
  {
    // Dusty rose — distinct from "cyber red" tropes.
    id: 'rose-noir',
    name: 'Rose Noir',
    colors: {
      surface: '#0c0a0b',
      surfaceAlt: '#0f0c0e',
      card: '#181317',
      elevated: '#221b1f',
      edge: '#2f2429',
      content: '#ebe4e7',
      muted: '#857a7e',
      accent: '#c97e93',
      accentDim: '#b06578',
      ...STATUS_MUTED
    }
  },
  {
    // Cool mineral teal — premium, not "ocean blue Cancun".
    id: 'mineral-noir',
    name: 'Mineral Noir',
    colors: {
      surface: '#0a0c0d',
      surfaceAlt: '#0d0f11',
      card: '#13181a',
      elevated: '#1a2123',
      edge: '#252e30',
      content: '#e4e8ea',
      muted: '#7a8488',
      accent: '#86b9bd',
      accentDim: '#699ba0',
      ...STATUS_MUTED
    }
  }
]

export const COLOR_LABELS: Record<keyof ThemeColors, string> = {
  surface: 'Background',
  surfaceAlt: 'Sidebar',
  card: 'Card',
  elevated: 'Hover',
  edge: 'Border',
  content: 'Text',
  muted: 'Muted Text',
  accent: 'Accent',
  accentDim: 'Accent Hover',
  ok: 'Success',
  warn: 'Warning',
  err: 'Error'
}

export const COLOR_GROUPS: { label: string; keys: (keyof ThemeColors)[] }[] = [
  { label: 'Surfaces', keys: ['surface', 'surfaceAlt', 'card', 'elevated', 'edge'] },
  { label: 'Typography', keys: ['content', 'muted'] },
  { label: 'Brand', keys: ['accent', 'accentDim'] },
  { label: 'Status', keys: ['ok', 'warn', 'err'] }
]

const COLOR_KEY_TO_CSS: Record<keyof ThemeColors, string> = {
  surface: '--color-surface',
  surfaceAlt: '--color-surface-alt',
  card: '--color-card',
  elevated: '--color-elevated',
  edge: '--color-edge',
  content: '--color-content',
  muted: '--color-muted',
  accent: '--color-accent',
  accentDim: '--color-accent-dim',
  ok: '--color-ok',
  warn: '--color-warn',
  err: '--color-err'
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const [key, cssVar] of Object.entries(COLOR_KEY_TO_CSS)) {
    root.style.setProperty(cssVar, theme.colors[key as keyof ThemeColors])
  }
}

export function clearThemeOverrides(): void {
  const root = document.documentElement
  for (const cssVar of Object.values(COLOR_KEY_TO_CSS)) {
    root.style.removeProperty(cssVar)
  }
}

export const DEFAULT_THEME_ID = 'champagne-noir'

export function getDefaultTheme(): Theme {
  return THEME_PRESETS[0]
}

export function findTheme(id: string, customThemes: Theme[] = []): Theme | undefined {
  return THEME_PRESETS.find((t) => t.id === id) || customThemes.find((t) => t.id === id)
}

// ─── Color utilities ───

export interface RGBA {
  r: number // 0-255
  g: number // 0-255
  b: number // 0-255
  a: number // 0-1
}

export interface HSVA {
  h: number // 0-360
  s: number // 0-100
  v: number // 0-100
  a: number // 0-1
}

export function hexToRgba(hex: string): RGBA {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length === 6) h += 'ff'
  const n = parseInt(h, 16)
  return {
    r: (n >> 24) & 0xff,
    g: (n >> 16) & 0xff,
    b: (n >> 8) & 0xff,
    a: Math.round(((n & 0xff) / 255) * 100) / 100
  }
}

export function rgbaToHex(c: RGBA): string {
  const r = Math.round(c.r).toString(16).padStart(2, '0')
  const g = Math.round(c.g).toString(16).padStart(2, '0')
  const b = Math.round(c.b).toString(16).padStart(2, '0')
  if (c.a < 1) {
    const a = Math.round(c.a * 255).toString(16).padStart(2, '0')
    return `#${r}${g}${b}${a}`
  }
  return `#${r}${g}${b}`
}

export function rgbaToString(c: RGBA): string {
  if (c.a < 1) return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${c.a})`
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
}

export function parseColor(str: string): RGBA {
  // Try rgba/rgb
  const rgbaMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgbaMatch) {
    return { r: +rgbaMatch[1], g: +rgbaMatch[2], b: +rgbaMatch[3], a: rgbaMatch[4] !== undefined ? +rgbaMatch[4] : 1 }
  }
  return hexToRgba(str)
}

export function rgbaToHsva(c: RGBA): HSVA {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  const s = max === 0 ? 0 : (d / max) * 100
  const v = max * 100
  return { h: Math.round(h), s: Math.round(s), v: Math.round(v), a: c.a }
}

export function hsvaToRgba(c: HSVA): RGBA {
  const h = c.h / 60, s = c.s / 100, v = c.v / 100
  const i = Math.floor(h), f = h - i
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f))
  let r = 0, g = 0, b = 0
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a: c.a }
}
