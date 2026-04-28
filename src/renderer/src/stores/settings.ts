import { create } from 'zustand'
import { applyTheme, findTheme, getDefaultTheme, DEFAULT_THEME_ID } from '../lib/themes'
import type { Theme } from '../lib/themes'
import { api } from '../lib/api'

// Languages offered by the in-browser auto-translator. Kept aligned with
// Chrome's Translate language codes; the underlying preferences write uses
// these as `translate_recent_target` / whitelist values.
export type TranslationTargetLang =
  | 'en' | 'ru' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'zh-CN' | 'ja' | 'ko' | 'tr' | 'uk' | 'pl'

interface SettingsStore {
  activeThemeId: string
  customThemes: Theme[]
  autoRegenFingerprint: boolean
  blockWebAuthn: boolean
  translationEnabled: boolean
  translationTargetLang: TranslationTargetLang
  initialized: boolean

  initSettings: () => Promise<void>
  setActiveTheme: (themeId: string) => Promise<void>
  addCustomTheme: (theme: Theme) => Promise<void>
  updateCustomTheme: (theme: Theme) => Promise<void>
  deleteCustomTheme: (themeId: string) => Promise<void>
  setAutoRegenFingerprint: (val: boolean) => Promise<void>
  setBlockWebAuthn: (val: boolean) => Promise<void>
  setTranslationEnabled: (val: boolean) => Promise<void>
  setTranslationTargetLang: (val: TranslationTargetLang) => Promise<void>
}

const VALID_LANGS: ReadonlySet<TranslationTargetLang> = new Set([
  'en', 'ru', 'es', 'fr', 'de', 'it', 'pt', 'zh-CN', 'ja', 'ko', 'tr', 'uk', 'pl'
])

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  activeThemeId: DEFAULT_THEME_ID,
  customThemes: [],
  autoRegenFingerprint: false,
  blockWebAuthn: true,
  translationEnabled: false,
  translationTargetLang: 'en',
  initialized: false,

  initSettings: async () => {
    if (get().initialized) return
    try {
      const [themeId, customs, autoRegen, blockWa, transOn, transTarget] = await Promise.all([
        api.getSetting('active_theme_id'),
        api.getSetting('custom_themes'),
        api.getSetting('auto_regenerate_fingerprint'),
        api.getSetting('hardware_identity_lockdown'),
        api.getSetting('translation_enabled'),
        api.getSetting('translation_target_lang')
      ])

      const customThemes = Array.isArray(customs) ? (customs as Theme[]) : []
      const activeThemeId = typeof themeId === 'string' ? themeId : DEFAULT_THEME_ID
      const autoRegenFingerprint = autoRegen === true
      const blockWebAuthn = blockWa !== false
      const translationEnabled = transOn === true
      const translationTargetLang: TranslationTargetLang =
        typeof transTarget === 'string' && VALID_LANGS.has(transTarget as TranslationTargetLang)
          ? (transTarget as TranslationTargetLang)
          : 'en'

      const theme = findTheme(activeThemeId, customThemes) || getDefaultTheme()
      applyTheme(theme)
      if (theme.id !== activeThemeId) {
        await api.setSetting('active_theme_id', theme.id)
      }

      set({
        activeThemeId: theme.id,
        customThemes,
        autoRegenFingerprint,
        blockWebAuthn,
        translationEnabled,
        translationTargetLang,
        initialized: true
      })
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
  },

  setBlockWebAuthn: async (val: boolean) => {
    set({ blockWebAuthn: val })
    await api.setSetting('hardware_identity_lockdown', val)
  },

  setTranslationEnabled: async (val: boolean) => {
    set({ translationEnabled: val })
    await api.setSetting('translation_enabled', val)
  },

  setTranslationTargetLang: async (val: TranslationTargetLang) => {
    set({ translationTargetLang: val })
    await api.setSetting('translation_target_lang', val)
  }
}))
