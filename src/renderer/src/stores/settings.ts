import { create } from 'zustand'
import { applyTheme, findTheme, getDefaultTheme } from '../lib/themes'
import type { Theme } from '../lib/themes'
import { api } from '../lib/api'

interface SettingsStore {
  activeThemeId: string
  customThemes: Theme[]
  autoRegenFingerprint: boolean
  initialized: boolean

  initSettings: () => Promise<void>
  setActiveTheme: (themeId: string) => Promise<void>
  addCustomTheme: (theme: Theme) => Promise<void>
  updateCustomTheme: (theme: Theme) => Promise<void>
  deleteCustomTheme: (themeId: string) => Promise<void>
  setAutoRegenFingerprint: (val: boolean) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  activeThemeId: 'midnight-blue',
  customThemes: [],
  autoRegenFingerprint: true,
  initialized: false,

  initSettings: async () => {
    if (get().initialized) return
    try {
      const [themeId, customs, autoRegen] = await Promise.all([
        api.getSetting('active_theme_id'),
        api.getSetting('custom_themes'),
        api.getSetting('auto_regenerate_fingerprint')
      ])

      const customThemes = Array.isArray(customs) ? (customs as Theme[]) : []
      const activeThemeId = typeof themeId === 'string' ? themeId : 'midnight-blue'
      const autoRegenFingerprint = autoRegen !== false

      const theme = findTheme(activeThemeId, customThemes) || getDefaultTheme()
      applyTheme(theme)

      set({ activeThemeId, customThemes, autoRegenFingerprint, initialized: true })
    } catch {
      const theme = getDefaultTheme()
      applyTheme(theme)
      set({ initialized: true })
    }
  },

  setActiveTheme: async (themeId: string) => {
    const theme = findTheme(themeId, get().customThemes) || getDefaultTheme()
    applyTheme(theme)
    set({ activeThemeId: themeId })
    await api.setSetting('active_theme_id', themeId)
  },

  addCustomTheme: async (theme: Theme) => {
    const customs = [...get().customThemes, { ...theme, isCustom: true }]
    set({ customThemes: customs })
    await api.setSetting('custom_themes', customs)
  },

  updateCustomTheme: async (theme: Theme) => {
    const customs = get().customThemes.map((t) => (t.id === theme.id ? { ...theme, isCustom: true } : t))
    set({ customThemes: customs })
    await api.setSetting('custom_themes', customs)

    if (get().activeThemeId === theme.id) {
      applyTheme(theme)
    }
  },

  deleteCustomTheme: async (themeId: string) => {
    const customs = get().customThemes.filter((t) => t.id !== themeId)
    set({ customThemes: customs })
    await api.setSetting('custom_themes', customs)

    if (get().activeThemeId === themeId) {
      const def = getDefaultTheme()
      applyTheme(def)
      set({ activeThemeId: def.id })
      await api.setSetting('active_theme_id', def.id)
    }
  },

  setAutoRegenFingerprint: async (val: boolean) => {
    set({ autoRegenFingerprint: val })
    await api.setSetting('auto_regenerate_fingerprint', val)
  }
}))
