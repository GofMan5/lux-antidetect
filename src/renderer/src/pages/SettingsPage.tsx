import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { CheckCircle2, XCircle, Plus, Trash2, Check, Palette, History, FileText, Download, HardDrive, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { useSettingsStore } from '../stores/settings'
import { useProfilesStore } from '../stores/profiles'
import { THEME_PRESETS } from '../lib/themes'
import type { Theme, ThemeColors } from '../lib/themes'
import { BTN_PRIMARY, BTN_SECONDARY, BTN_DANGER, LABEL_CLASS, INPUT_CLASS, CHECKBOX_CLASS } from '../lib/ui'
import type { ManagedBrowserResponse, AvailableBrowser } from '../lib/types'
import { useToastStore } from '../components/Toast'
import { useConfirmStore } from '../components/ConfirmDialog'

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

  // Browser Manager state
  const [managedBrowsers, setManagedBrowsers] = useState<ManagedBrowserResponse[]>([])
  const [availableBrowsers, setAvailableBrowsers] = useState<AvailableBrowser[]>([])
  const [downloading, setDownloading] = useState<Record<string, number>>({}) // key → percent
  const addToast = useToastStore((s) => s.addToast)
  const confirm = useConfirmStore((s) => s.show)

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

  const profiles = useProfilesStore((s) => s.profiles)
  const profileNameMap = useMemo(() => new Map(profiles.map(p => [p.id, p.name])), [profiles])

  const [sessionTimeout, setSessionTimeout] = useState(0)

  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

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
    api.getSetting('session_timeout_minutes').then((v: unknown) => {
      if (typeof v === 'number') setSessionTimeout(v)
    }).catch(() => {})
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

  // Browser Manager: load managed & available browsers + listen to download events
  const refreshManagedBrowsers = useCallback(() => {
    api.listManagedBrowsers().then(setManagedBrowsers).catch(() => {})
  }, [])

  useEffect(() => {
    refreshManagedBrowsers()
    api.getAvailableBrowsers().then(setAvailableBrowsers).catch(() => {})

    const offProgress = api.onBrowserDownloadProgress((data) => {
      setDownloading(prev => ({ ...prev, [`${data.browser}-${data.buildId}`]: data.percent }))
    })
    const offComplete = api.onBrowserDownloadComplete(() => {
      refreshManagedBrowsers()
      // Re-detect system browsers after managed install
      api.detectBrowsers().then(setBrowsers)
    })
    const offError = api.onBrowserDownloadError((data) => {
      setDownloading(prev => {
        const next = { ...prev }
        delete next[`${data.browser}-${data.buildId}`]
        return next
      })
      addToast(`Download failed: ${data.message}`, 'error')
    })

    return () => { offProgress(); offComplete(); offError() }
  }, [refreshManagedBrowsers, addToast])

  const handleDownloadBrowser = async (browserType: string, channel: string, browser: string, buildId: string): Promise<void> => {
    const key = `${browser}-${buildId}`
    if (downloading[key] !== undefined) return // already downloading
    setDownloading(prev => ({ ...prev, [key]: 0 }))
    try {
      await api.downloadBrowser(browserType as 'chromium' | 'firefox' | 'edge', channel)
      setDownloading(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      addToast(`${browserType} ${buildId} downloaded successfully`, 'success')
    } catch {
      // Error events handled by listener above
    }
  }

  const handleRemoveBrowser = async (browser: string, buildId: string): Promise<void> => {
    const ok = await confirm({
      title: 'Remove Browser',
      message: `Remove ${browser} ${buildId}? You will need to re-download it.`,
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    try {
      await api.removeManagedBrowser(browser, buildId)
      setManagedBrowsers(prev => prev.filter(b => !(b.browser === browser && b.buildId === buildId)))
      api.detectBrowsers().then(setBrowsers)
      addToast(`${browser} ${buildId} removed`, 'success')
    } catch (err) {
      addToast(`Failed to remove: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }

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
    <div className="p-4 h-full overflow-y-auto">
      <h1 className="text-lg font-bold text-content mb-4">Settings</h1>

      {/* Appearance */}
      <section className="bg-card rounded-lg border border-edge p-4 mb-3">
        <h2 className="text-xs font-semibold text-muted mb-3 flex items-center gap-2 uppercase tracking-wide">
          <Palette className="h-4 w-4 text-accent" />
          Appearance
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          {allThemes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setActiveTheme(theme.id)}
              className={`relative rounded-lg border p-3 text-left transition-all ${
                activeThemeId === theme.id
                  ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
                  : 'border-edge hover:border-muted hover:bg-elevated/30'
              }`}
            >
              {activeThemeId === theme.id && (
                <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-accent" />
              )}
              <p className="text-xs font-medium text-content mb-2 truncate">{theme.name}</p>
              <div className="flex gap-1.5">
                <div
                  className="h-5 w-5 rounded border border-edge/50"
                  style={{ backgroundColor: theme.colors.surface }}
                />
                <div
                  className="h-5 w-5 rounded border border-edge/50"
                  style={{ backgroundColor: theme.colors.card }}
                />
                <div
                  className="h-5 w-5 rounded border border-edge/50"
                  style={{ backgroundColor: theme.colors.accent }}
                />
                <div
                  className="h-5 w-5 rounded border border-edge/50"
                  style={{ backgroundColor: theme.colors.content }}
                />
              </div>
              {theme.isCustom && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteCustomTheme(theme.id)
                  }}
                  className={`${BTN_DANGER} absolute bottom-2 right-2`}
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
            className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-dim transition-colors font-medium"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Custom Theme
          </button>
        ) : (
          <div className="border-t border-edge pt-3 mt-3 space-y-3">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(Object.keys(COLOR_LABELS) as (keyof ThemeColors)[]).map((key) => (
                <div key={key}>
                  <label className="block text-[11px] text-muted mb-1">{COLOR_LABELS[key]}</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={customColors[key]}
                      onChange={(e) =>
                        setCustomColors((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="h-8 w-8 rounded-md border border-edge bg-transparent cursor-pointer p-0 shrink-0"
                    />
                    <input
                      type="text"
                      value={customColors[key]}
                      onChange={(e) =>
                        setCustomColors((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full rounded-md border border-edge bg-surface-alt px-2 py-1 text-xs text-content font-mono focus:outline-none focus:ring-2 focus:ring-accent/60"
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
      <section className="bg-card rounded-lg border border-edge p-4 mb-3">
        <h2 className="text-xs font-semibold text-muted mb-3 uppercase tracking-wide">Fingerprint</h2>
        <label className="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={autoRegenFingerprint}
            onChange={(e) => setAutoRegenFingerprint(e.target.checked)}
            className={CHECKBOX_CLASS}
          />
          <span className="text-sm text-content">Auto-regenerate fingerprint on each launch</span>
        </label>
        <p className="text-xs text-muted mt-1.5 ml-[26px]">
          When enabled, every browser launch generates a unique fingerprint automatically.
        </p>
      </section>

      {/* Session History */}
      <section className="bg-card rounded-lg border border-edge p-4 mb-3">
        <h2 className="text-xs font-semibold text-muted mb-3 flex items-center gap-2 uppercase tracking-wide">
          <History className="h-4 w-4 text-accent" />
          Session History
        </h2>
        {historyLoading ? (
          <p className="text-muted text-sm">Loading...</p>
        ) : sessionHistory.length === 0 ? (
          <p className="text-muted text-sm">No session history yet</p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded-lg border border-edge">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="border-b border-edge bg-surface-alt">
                  <th className="text-left px-3 py-2 text-muted font-medium text-xs uppercase tracking-wide">Profile</th>
                  <th className="text-left px-3 py-2 text-muted font-medium text-xs uppercase tracking-wide">Date</th>
                  <th className="text-left px-3 py-2 text-muted font-medium text-xs uppercase tracking-wide">Duration</th>
                  <th className="text-left px-3 py-2 text-muted font-medium text-xs uppercase tracking-wide">Exit</th>
                </tr>
              </thead>
              <tbody>
                {sessionHistory.slice(0, 20).map((h, i) => (
                  <tr key={h.id} className={`border-b border-edge/50 last:border-0 ${i % 2 === 1 ? 'bg-elevated/20' : ''}`}>
                    <td className="px-3 py-2 text-content text-xs truncate max-w-[140px]" title={profileNameMap.get(h.profile_id) ?? h.profile_id}>
                      {profileNameMap.get(h.profile_id) ?? <span className="text-muted/50 font-mono">{h.profile_id.slice(0, 8)}</span>}
                    </td>
                    <td className="px-3 py-2 text-content text-xs">
                      {new Date(h.started_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-content text-xs font-mono">
                      {formatDuration(h.duration_seconds)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 text-xs ${h.exit_code === 0 || h.exit_code === null ? 'text-ok' : 'text-warn'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${h.exit_code === 0 || h.exit_code === null ? 'bg-ok' : 'bg-warn'}`} />
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
      <section className="bg-card rounded-lg border border-edge p-4 mb-3">
        <h2 className="text-xs font-semibold text-muted mb-3 flex items-center gap-2 uppercase tracking-wide">
          <FileText className="h-4 w-4 text-accent" />
          Templates
        </h2>
        {templates.length === 0 ? (
          <p className="text-muted text-sm">No templates yet. Save a profile as a template from the editor.</p>
        ) : (
          <div className="space-y-1.5">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between bg-surface-alt rounded-lg px-3 py-2.5 border border-edge/50">
                <div>
                  <p className="text-sm text-content font-medium">{t.name}</p>
                  <p className="text-xs text-muted">{t.browser_type} — {t.description || 'No description'}</p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await api.deleteTemplate(t.id)
                      setTemplates(prev => prev.filter(x => x.id !== t.id))
                    } catch (err) {
                      addToast(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
                    }
                  }}
                  className={BTN_DANGER}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Browser Manager */}
      <section className="bg-card rounded-lg border border-edge p-4 mb-3">
        <h2 className="text-xs font-semibold text-muted mb-3 flex items-center gap-2 uppercase tracking-wide">
          <HardDrive className="h-4 w-4 text-accent" />
          Browser Manager
        </h2>

        {/* Installed managed browsers */}
        {managedBrowsers.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-muted mb-2 font-medium">Installed Browsers</p>
            <div className="space-y-1.5">
              {managedBrowsers.map((b) => (
                <div key={`${b.browser}-${b.buildId}`} className="flex items-center gap-2.5 bg-surface-alt rounded-lg px-3 py-2.5 border border-edge/50">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-content capitalize">{b.browser}</p>
                    <p className="text-xs text-muted truncate font-mono">{b.buildId} — {b.platform}</p>
                  </div>
                  <button
                    onClick={() => handleRemoveBrowser(b.browser, b.buildId)}
                    className={BTN_DANGER}
                    title="Remove this browser"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available for download */}
        <p className="text-xs text-muted mb-2 font-medium">Download Browsers</p>
        {availableBrowsers.length === 0 ? (
          <p className="text-xs text-muted">Checking available downloads...</p>
        ) : (
          <div className="space-y-1.5">
            {availableBrowsers.map((ab) => {
              const dlKey = `${ab.browser}-${ab.buildId}`
              const isDownloading = downloading[dlKey] !== undefined
              const percent = downloading[dlKey] ?? 0
              const isInstalled = managedBrowsers.some(m => m.browser === ab.browser && m.buildId === ab.buildId)
              return (
                <div key={dlKey} className="flex items-center gap-2.5 bg-surface-alt rounded-lg px-3 py-2.5 border border-edge/50">
                  <Download className="h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-content capitalize">{ab.browserType}</p>
                    <p className="text-xs text-muted font-mono">{ab.channel} — {ab.buildId}</p>
                    {isDownloading && (
                      <div className="mt-1.5 w-full bg-surface rounded-full h-1.5">
                        <div
                          className="bg-accent h-1.5 rounded-full transition-all duration-300"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {isInstalled ? (
                    <span className="text-xs text-ok font-medium px-2 py-1 rounded bg-ok/10">Installed</span>
                  ) : isDownloading ? (
                    <span className="flex items-center gap-1.5 text-xs text-accent font-medium">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {percent}%
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDownloadBrowser(ab.browserType, ab.channel, ab.browser, ab.buildId)}
                      className={BTN_PRIMARY + ' text-xs !px-3 !py-1.5'}
                    >
                      Download
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* System-detected browsers as fallback info */}
        <div className="mt-4 border-t border-edge pt-3">
          <p className="text-xs text-muted mb-2 font-medium">System Browsers (auto-detected)</p>
          {browsersLoading ? (
            <p className="text-muted text-xs">Detecting...</p>
          ) : browserEntries.length === 0 ? (
            <div className="flex items-center gap-2">
              <XCircle className="h-3.5 w-3.5 text-err" />
              <p className="text-xs text-muted">No system browsers detected</p>
            </div>
          ) : (
            <div className="space-y-1">
              {browserEntries.map(([name, path]) => (
                <div key={name} className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="h-3 w-3 shrink-0 text-ok" />
                  <span className="text-content capitalize font-medium">{name}</span>
                  <span className="text-muted truncate font-mono">{path}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* About */}
      <section className="bg-card rounded-lg border border-edge p-4 mb-3">
        <h2 className="text-xs font-semibold text-muted mb-2 uppercase tracking-wide">About</h2>
        <p className="text-sm text-muted">Lux Antidetect Browser v1.0.2</p>
      </section>

      {/* Data Management */}
      <section className="bg-card rounded-lg border border-edge p-4 mb-3">
        <h2 className="text-xs font-semibold text-muted mb-3 flex items-center gap-2 uppercase tracking-wide">
          <Trash2 className="h-4 w-4 text-err" />
          Data Management
        </h2>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-content">Session Timeout</p>
              <p className="text-xs text-muted">Auto-stop browsers after this duration (0 = disabled)</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={1440}
                value={sessionTimeout}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 0
                  setSessionTimeout(val)
                  clearTimeout(sessionTimeoutRef.current)
                  sessionTimeoutRef.current = setTimeout(() => {
                    api.setSetting('session_timeout_minutes', val)
                  }, 500)
                }}
                className="w-20 rounded-md border border-edge bg-surface-alt px-2 py-1.5 text-sm text-content text-center focus:outline-none focus:ring-2 focus:ring-accent/60"
              />
              <span className="text-xs text-muted">min</span>
            </div>
          </div>
        </div>
      </section>

      {/* Updates */}
      <section className="bg-card rounded-lg border border-edge p-4 mb-3">
        <h2 className="text-xs font-semibold text-muted mb-2 flex items-center gap-2 uppercase tracking-wide">
          <Download className="h-4 w-4 text-accent" />
          Updates
        </h2>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">Current: v1.0.2</p>
          <button
            onClick={() => api.checkForUpdates()}
            className={BTN_SECONDARY + ' text-xs'}
          >
            Check for Updates
          </button>
        </div>
      </section>
    </div>
  )
}
