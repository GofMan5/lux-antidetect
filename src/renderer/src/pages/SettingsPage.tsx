import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Plus, Trash2, Check, Palette, History, FileText, Download } from 'lucide-react'
import { api } from '../lib/api'
import { useSettingsStore } from '../stores/settings'
import { THEME_PRESETS } from '../lib/themes'
import type { Theme, ThemeColors } from '../lib/themes'
import { BTN_PRIMARY, BTN_SECONDARY, BTN_DANGER, LABEL_CLASS, INPUT_CLASS } from '../lib/ui'

const COLOR_LABELS: Record<keyof ThemeColors, string> = {
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

const DEFAULT_CUSTOM_COLORS: ThemeColors = {
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

export function SettingsPage(): React.JSX.Element {
  const [browsers, setBrowsers] = useState<Record<string, string>>({})
  const [browsersLoading, setBrowsersLoading] = useState(true)

  const activeThemeId = useSettingsStore((s) => s.activeThemeId)
  const customThemes = useSettingsStore((s) => s.customThemes)
  const setActiveTheme = useSettingsStore((s) => s.setActiveTheme)
  const addCustomTheme = useSettingsStore((s) => s.addCustomTheme)
  const deleteCustomTheme = useSettingsStore((s) => s.deleteCustomTheme)
  const autoRegenFingerprint = useSettingsStore((s) => s.autoRegenFingerprint)
  const setAutoRegenFingerprint = useSettingsStore((s) => s.setAutoRegenFingerprint)

  const [sessionHistory, setSessionHistory] = useState<Array<{
    id: string; profile_id: string; started_at: string; stopped_at: string | null;
    duration_seconds: number | null; exit_code: number | null
  }>>([])
  const [templates, setTemplates] = useState<Array<{
    id: string; name: string; description: string; browser_type: string; created_at: string
  }>>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const [showCustomEditor, setShowCustomEditor] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customColors, setCustomColors] = useState<ThemeColors>({ ...DEFAULT_CUSTOM_COLORS })

  useEffect(() => {
    api.detectBrowsers().then((result) => {
      setBrowsers(result)
      setBrowsersLoading(false)
    })
  }, [])

  useEffect(() => {
    api.getSessionHistory().then((h: unknown) => {
      setSessionHistory(h as typeof sessionHistory)
      setHistoryLoading(false)
    }).catch(() => setHistoryLoading(false))

    api.listTemplates().then((t: unknown) => {
      setTemplates(t as typeof templates)
    }).catch(() => {})
  }, [])

  function formatDuration(seconds: number | null): string {
    if (seconds === null) return '\u2014'
    if (seconds < 60) return `${seconds}s`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }

  const handleCreateCustom = (): void => {
    if (!customName.trim()) return
    const theme: Theme = {
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      colors: { ...customColors },
      isCustom: true
    }
    addCustomTheme(theme)
    setActiveTheme(theme.id)
    setShowCustomEditor(false)
    setCustomName('')
    setCustomColors({ ...DEFAULT_CUSTOM_COLORS })
  }

  const allThemes = [...THEME_PRESETS, ...customThemes]
  const browserEntries = Object.entries(browsers)

  return (
    <div className="p-3 h-full overflow-y-auto">
      <h1 className="text-lg font-bold text-content mb-2">Settings</h1>

      {/* Appearance */}
      <section className="bg-card rounded-md border border-edge p-2.5 mb-2">
        <h2 className="text-xs font-semibold text-content mb-2 flex items-center gap-1.5 uppercase tracking-wide">
          <Palette className="h-3.5 w-3.5 text-accent" />
          Appearance
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-2">
          {allThemes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setActiveTheme(theme.id)}
              className={`relative rounded-md border p-2 text-left transition-colors ${
                activeThemeId === theme.id
                  ? 'border-accent bg-accent/10'
                  : 'border-edge hover:border-muted'
              }`}
            >
              {activeThemeId === theme.id && (
                <Check className="absolute top-1.5 right-1.5 h-3 w-3 text-accent" />
              )}
              <p className="text-xs font-medium text-content mb-1.5 truncate">{theme.name}</p>
              <div className="flex gap-1">
                <div
                  className="h-4 w-4 rounded-sm border border-edge"
                  style={{ backgroundColor: theme.colors.surface }}
                />
                <div
                  className="h-4 w-4 rounded-sm border border-edge"
                  style={{ backgroundColor: theme.colors.card }}
                />
                <div
                  className="h-4 w-4 rounded-sm border border-edge"
                  style={{ backgroundColor: theme.colors.accent }}
                />
                <div
                  className="h-4 w-4 rounded-sm border border-edge"
                  style={{ backgroundColor: theme.colors.content }}
                />
              </div>
              {theme.isCustom && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteCustomTheme(theme.id)
                  }}
                  className={`${BTN_DANGER} absolute bottom-1.5 right-1.5`}
                  aria-label={`Delete ${theme.name}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </button>
          ))}
        </div>

        {!showCustomEditor ? (
          <button
            onClick={() => setShowCustomEditor(true)}
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-dim transition-colors"
          >
            <Plus className="h-3 w-3" />
            Create Custom Theme
          </button>
        ) : (
          <div className="border-t border-edge pt-2 mt-2 space-y-2">
            <div>
              <label className={LABEL_CLASS}>Theme Name</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="My Theme"
                className={INPUT_CLASS}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((key) => (
                <div key={key}>
                  <label className="block text-[10px] text-muted mb-0.5">{COLOR_LABELS[key]}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="color"
                      value={customColors[key]}
                      onChange={(e) =>
                        setCustomColors((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="h-6 w-6 rounded border border-edge bg-transparent cursor-pointer p-0"
                    />
                    <input
                      type="text"
                      value={customColors[key]}
                      onChange={(e) =>
                        setCustomColors((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full rounded border border-edge bg-surface-alt px-1 py-0.5 text-[10px] text-content font-mono"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateCustom} className={BTN_PRIMARY}>
                Create
              </button>
              <button
                onClick={() => {
                  setShowCustomEditor(false)
                  setCustomName('')
                  setCustomColors({ ...DEFAULT_CUSTOM_COLORS })
                }}
                className={BTN_SECONDARY}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Fingerprint */}
      <section className="bg-card rounded-md border border-edge p-2.5 mb-2">
        <h2 className="text-xs font-semibold text-content mb-2 uppercase tracking-wide">Fingerprint</h2>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRegenFingerprint}
            onChange={(e) => setAutoRegenFingerprint(e.target.checked)}
            className="h-4 w-4 rounded border-edge accent-accent"
          />
          <span className="text-xs text-content">Auto-regenerate fingerprint on each launch</span>
        </label>
        <p className="text-[11px] text-muted mt-1 ml-6">
          When enabled, every browser launch generates a unique fingerprint automatically.
        </p>
      </section>

      {/* Session History */}
      <section className="bg-card rounded-md border border-edge p-2.5 mb-2">
        <h2 className="text-xs font-semibold text-content mb-2 flex items-center gap-1.5 uppercase tracking-wide">
          <History className="h-3.5 w-3.5 text-accent" />
          Session History
        </h2>
        {historyLoading ? (
          <p className="text-muted text-xs">Loading...</p>
        ) : sessionHistory.length === 0 ? (
          <p className="text-muted text-xs">No session history yet</p>
        ) : (
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-edge">
                  <th className="text-left px-1 py-1 text-muted font-medium">Date</th>
                  <th className="text-left px-1 py-1 text-muted font-medium">Duration</th>
                  <th className="text-left px-1 py-1 text-muted font-medium">Exit</th>
                </tr>
              </thead>
              <tbody>
                {sessionHistory.slice(0, 20).map((h) => (
                  <tr key={h.id} className="border-b border-edge last:border-0">
                    <td className="px-1 py-1 text-content">
                      {new Date(h.started_at).toLocaleString()}
                    </td>
                    <td className="px-1 py-1 text-content">
                      {formatDuration(h.duration_seconds)}
                    </td>
                    <td className="px-1 py-1">
                      <span className={h.exit_code === 0 || h.exit_code === null ? 'text-ok' : 'text-warn'}>
                        {h.exit_code ?? '\u2014'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Templates */}
      <section className="bg-card rounded-md border border-edge p-2.5 mb-2">
        <h2 className="text-xs font-semibold text-content mb-2 flex items-center gap-1.5 uppercase tracking-wide">
          <FileText className="h-3.5 w-3.5 text-accent" />
          Templates
        </h2>
        {templates.length === 0 ? (
          <p className="text-muted text-xs">No templates yet. Save a profile as a template from the editor.</p>
        ) : (
          <div className="space-y-1">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between bg-surface-alt rounded px-2 py-1.5">
                <div>
                  <p className="text-xs text-content font-medium">{t.name}</p>
                  <p className="text-[10px] text-muted">{t.browser_type} — {t.description || 'No description'}</p>
                </div>
                <button
                  onClick={async () => {
                    await api.deleteTemplate(t.id)
                    setTemplates(prev => prev.filter(x => x.id !== t.id))
                  }}
                  className={BTN_DANGER}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Detected Browsers */}
      <section className="bg-card rounded-md border border-edge p-2.5 mb-2">
        <h2 className="text-xs font-semibold text-content mb-2 uppercase tracking-wide">Detected Browsers</h2>
        {browsersLoading ? (
          <p className="text-muted text-xs">Detecting browsers...</p>
        ) : browserEntries.length === 0 ? (
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-err" />
            <p className="text-xs text-muted">No browsers detected</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {browserEntries.map(([name, path]) => (
              <div key={name} className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-content capitalize">{name}</p>
                  <p className="text-[11px] text-muted truncate">{path}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* About */}
      <section className="bg-card rounded-md border border-edge p-2.5 mb-2">
        <h2 className="text-xs font-semibold text-content mb-1 uppercase tracking-wide">About</h2>
        <p className="text-xs text-muted">Lux Antidetect Browser v1.0.0</p>
      </section>

      {/* Updates */}
      <section className="bg-card rounded-md border border-edge p-2.5 mb-2">
        <h2 className="text-xs font-semibold text-content mb-2 flex items-center gap-1.5 uppercase tracking-wide">
          <Download className="h-3.5 w-3.5 text-accent" />
          Updates
        </h2>
        <p className="text-xs text-muted">
          Auto-updater will check for new versions when available. Current: v1.0.0
        </p>
      </section>
    </div>
  )
}
