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
      surface: '#09090b',
      surfaceAlt: '#0c0c10',
      card: '#131318',
      elevated: '#1a1a22',
      edge: '#232330',
      content: '#ececef',
      muted: '#71717a',
      accent: '#3b82f6',
      accentDim: '#2563eb',
      ok: '#22c55e',
      warn: '#eab308',
      err: '#ef4444'
    }
  },
  {
    id: 'midnight-purple',
    name: 'Violet Night',
    colors: {
      surface: '#09090b',
      surfaceAlt: '#0e0c14',
      card: '#15131e',
      elevated: '#1c1a28',
      edge: '#282636',
      content: '#ececef',
      muted: '#8b85a0',
      accent: '#8b5cf6',
      accentDim: '#7c3aed',
      ok: '#22c55e',
      warn: '#eab308',
      err: '#ef4444'
    }
  },
  {
    id: 'emerald-dark',
    name: 'Emerald',
    colors: {
      surface: '#09090b',
      surfaceAlt: '#0a0e0c',
      card: '#111916',
      elevated: '#182620',
      edge: '#203028',
      content: '#ececef',
      muted: '#6b8577',
      accent: '#10b981',
      accentDim: '#059669',
      ok: '#22c55e',
      warn: '#eab308',
      err: '#ef4444'
    }
  },
  {
    id: 'crimson-dark',
    name: 'Crimson',
    colors: {
      surface: '#09090b',
      surfaceAlt: '#0e0a0a',
      card: '#181214',
      elevated: '#241a1c',
      edge: '#302224',
      content: '#ececef',
      muted: '#9a7b7e',
      accent: '#f43f5e',
      accentDim: '#e11d48',
      ok: '#22c55e',
      warn: '#eab308',
      err: '#f87171'
    }
  },
  {
    id: 'ocean-teal',
    name: 'Ocean',
    colors: {
      surface: '#09090b',
      surfaceAlt: '#0a0d0e',
      card: '#111819',
      elevated: '#182424',
      edge: '#202e30',
      content: '#ececef',
      muted: '#6b8a8e',
      accent: '#14b8a6',
      accentDim: '#0d9488',
      ok: '#22c55e',
      warn: '#eab308',
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
