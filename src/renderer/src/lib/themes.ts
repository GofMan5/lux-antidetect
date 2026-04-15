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

export const THEME_PRESETS: Theme[] = [
  {
    id: 'midnight-blue',
    name: 'Midnight Blue',
    colors: {
      surface: '#0a0a0f',
      surfaceAlt: '#0d1117',
      card: '#161b22',
      elevated: '#1c2333',
      edge: '#2a3140',
      content: '#e4e4e7',
      muted: '#8b949e',
      accent: '#2563eb',
      accentDim: '#1d4ed8',
      ok: '#22c55e',
      warn: '#f59e0b',
      err: '#ef4444'
    }
  },
  {
    id: 'midnight-purple',
    name: 'Midnight Purple',
    colors: {
      surface: '#0a0a0f',
      surfaceAlt: '#12121a',
      card: '#16161f',
      elevated: '#1e1e2a',
      edge: '#2a2a3a',
      content: '#e4e4e7',
      muted: '#a1a1aa',
      accent: '#7c3aed',
      accentDim: '#6d28d9',
      ok: '#22c55e',
      warn: '#f59e0b',
      err: '#ef4444'
    }
  },
  {
    id: 'emerald-dark',
    name: 'Emerald',
    colors: {
      surface: '#0a0a0f',
      surfaceAlt: '#0d1117',
      card: '#131c16',
      elevated: '#1a2e20',
      edge: '#243830',
      content: '#e4e4e7',
      muted: '#8b949e',
      accent: '#10b981',
      accentDim: '#059669',
      ok: '#22c55e',
      warn: '#f59e0b',
      err: '#ef4444'
    }
  },
  {
    id: 'crimson-dark',
    name: 'Crimson',
    colors: {
      surface: '#0a0a0f',
      surfaceAlt: '#110d0d',
      card: '#1b1416',
      elevated: '#2a1c1e',
      edge: '#3a2428',
      content: '#e4e4e7',
      muted: '#a19898',
      accent: '#ef4444',
      accentDim: '#dc2626',
      ok: '#22c55e',
      warn: '#f59e0b',
      err: '#f87171'
    }
  },
  {
    id: 'ocean-teal',
    name: 'Ocean Teal',
    colors: {
      surface: '#0a0a0f',
      surfaceAlt: '#0d1114',
      card: '#131b1e',
      elevated: '#1a2a2e',
      edge: '#243538',
      content: '#e4e4e7',
      muted: '#8b9a9e',
      accent: '#14b8a6',
      accentDim: '#0d9488',
      ok: '#22c55e',
      warn: '#f59e0b',
      err: '#ef4444'
    }
  }
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

export function getDefaultTheme(): Theme {
  return THEME_PRESETS[0]
}

export function findTheme(id: string, customThemes: Theme[] = []): Theme | undefined {
  return THEME_PRESETS.find((t) => t.id === id) || customThemes.find((t) => t.id === id)
}
