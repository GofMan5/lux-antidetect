import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { CheckCircle2, XCircle, Plus, Trash2, Check, Palette, History, FileText, Download, HardDrive, Loader2, Settings2, Fingerprint, RefreshCw } from 'lucide-react'
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

type SettingsTab = 'appearance' | 'browsers' | 'general'

const TABS: { id: SettingsTab; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'browsers', label: 'Browsers', icon: HardDrive },
  { id: 'general', label: 'General', icon: Settings2 }
]

export function SettingsPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')
  const [browsers, setBrowsers] = useState<Record<string, string>>({})
  const [browsersLoading, setBrowsersLoading] = useState(true)

  const [managedBrowsers, setManagedBrowsers] = useState<ManagedBrowserResponse[]>([])
  const [availableBrowsers, setAvailableBrowsers] = useState<AvailableBrowser[]>([])
  const [downloading, setDownloading] = useState<Record<string, number>>({})
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
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [showCustomEditor, setShowCustomEditor] = useState(false)
  const [customName, setCustomName] = useState('')
  const [customColors, setCustomColors] = useState<ThemeColors>({ ...DEFAULT_CUSTOM_COLORS })

  useEffect(() => {
    api.detectBrowsers().then((result) => { setBrowsers(result); setBrowsersLoading(false) })
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
    if (downloading[key] !== undefined) return
    setDownloading(prev => ({ ...prev, [key]: 0 }))
    try {
      await api.downloadBrowser(browserType as 'chromium' | 'firefox' | 'edge', channel)
      setDownloading(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      addToast(`${browserType} downloaded successfully`, 'success')
    } catch { /* Error events handled by listener */ }
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
      addToast(`${browser} removed`, 'success')
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
    <div className="flex h-full overflow-hidden">
      {/* Tab sidebar */}
      <div className="w-[180px] shrink-0 border-r border-edge bg-surface-alt/50 p-3 flex flex-col gap-1">
        <h1 className="text-lg font-bold text-content px-2 mb-3">Settings</h1>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150 w-full text-left ${
              activeTab === id
                ? 'bg-accent/15 text-accent'
                : 'text-muted hover:bg-elevated hover:text-content'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeTab === 'appearance' && (
          <div className="max-w-2xl space-y-5">
            {/* Themes */}
            <section>
              <h2 className="text-sm font-semibold text-content mb-3">Theme</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
                {allThemes.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => setActiveTheme(theme.id)}
                    className={`relative rounded-xl border p-3 text-left transition-all duration-150 ${
                      activeThemeId === theme.id
                        ? 'border-accent bg-accent/8 ring-1 ring-accent/30 shadow-sm shadow-accent/10'
                        : 'border-edge hover:border-muted/50 hover:bg-elevated/30'
                    }`}
                  >
                    {activeThemeId === theme.id && (
                      <Check className="absolute top-2.5 right-2.5 h-3.5 w-3.5 text-accent" />
                    )}
                    <p className="text-xs font-medium text-content mb-2.5 truncate">{theme.name}</p>
                    <div className="flex gap-1.5">
                      {['surface', 'card', 'accent', 'content'].map(k => (
                        <div
                          key={k}
                          className="h-5 w-5 rounded-md border border-white/5"
                          style={{ backgroundColor: theme.colors[k as keyof ThemeColors] }}
                        />
                      ))}
                    </div>
                    {theme.isCustom && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteCustomTheme(theme.id) }}
                        className={`${BTN_DANGER} absolute bottom-2 right-2`}
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
                <div className="rounded-xl border border-edge bg-card p-4 space-y-3">
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
                            onChange={(e) => setCustomColors((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="h-8 w-8 rounded-lg border border-edge bg-transparent cursor-pointer p-0 shrink-0"
                          />
                          <input
                            type="text"
                            value={customColors[key]}
                            onChange={(e) => setCustomColors((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="w-full rounded-lg border border-edge bg-surface px-2 py-1 text-xs text-content font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleCreateCustom} className={BTN_PRIMARY}>Create</button>
                    <button
                      onClick={() => { setShowCustomEditor(false); setCustomName(''); setCustomColors({ ...DEFAULT_CUSTOM_COLORS }) }}
                      className={BTN_SECONDARY}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'browsers' && (
          <div className="max-w-2xl space-y-5">
            {/* Managed browsers */}
            <section>
              <h2 className="text-sm font-semibold text-content mb-3">Installed Browsers</h2>
              {managedBrowsers.length === 0 ? (
                <p className="text-muted text-sm">No managed browsers installed yet</p>
              ) : (
                <div className="space-y-2">
                  {managedBrowsers.map((b) => (
                    <div key={`${b.browser}-${b.buildId}`} className="flex items-center gap-3 rounded-xl bg-card border border-edge px-4 py-3">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-content capitalize">{b.browser}</p>
                        <p className="text-xs text-muted truncate font-mono">{b.buildId} — {b.platform}</p>
                      </div>
                      <button onClick={() => handleRemoveBrowser(b.browser, b.buildId)} className={BTN_DANGER} title="Remove">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Download */}
            <section>
              <h2 className="text-sm font-semibold text-content mb-3">Download Browsers</h2>
              {availableBrowsers.length === 0 ? (
                <div className="flex items-center gap-2 text-muted text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking available downloads...
                </div>
              ) : (
                <div className="space-y-2">
                  {availableBrowsers.map((ab) => {
                    const dlKey = `${ab.browser}-${ab.buildId}`
                    const isDownloading = downloading[dlKey] !== undefined
                    const percent = downloading[dlKey] ?? 0
                    const isInstalled = managedBrowsers.some(m => m.browser === ab.browser && m.buildId === ab.buildId)
                    return (
                      <div key={dlKey} className="flex items-center gap-3 rounded-xl bg-card border border-edge px-4 py-3">
                        <Download className="h-4 w-4 shrink-0 text-accent" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-content capitalize">{ab.browserType}</p>
                          <p className="text-xs text-muted font-mono">{ab.channel} — {ab.buildId}</p>
                          {isDownloading && (
                            <div className="mt-2 w-full bg-elevated rounded-full h-1.5 overflow-hidden">
                              <div className="bg-accent h-1.5 rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
                            </div>
                          )}
                        </div>
                        {isInstalled ? (
                          <span className="text-xs text-ok font-medium px-2.5 py-1 rounded-lg bg-ok/10 ring-1 ring-ok/20">Installed</span>
                        ) : isDownloading ? (
                          <span className="flex items-center gap-1.5 text-xs text-accent font-medium tabular-nums">
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
            </section>

            {/* System browsers */}
            <section>
              <h2 className="text-sm font-semibold text-content mb-3">System Browsers</h2>
              {browsersLoading ? (
                <p className="text-muted text-sm">Detecting...</p>
              ) : browserEntries.length === 0 ? (
                <div className="flex items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 text-err" />
                  <p className="text-sm text-muted">No system browsers detected</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {browserEntries.map(([name, path]) => (
                    <div key={name} className="flex items-center gap-2.5 text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" />
                      <span className="text-content capitalize font-medium">{name}</span>
                      <span className="text-muted truncate font-mono">{path}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeTab === 'general' && (
          <div className="max-w-2xl space-y-5">
            {/* Fingerprint */}
            <section className="rounded-xl border border-edge bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Fingerprint className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-content">Fingerprint</h2>
              </div>
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
                Creates a unique fingerprint for every browser session.
              </p>
            </section>

            {/* Session timeout */}
            <section className="rounded-xl border border-edge bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Settings2 className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-content">Session Timeout</h2>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted">Auto-stop browsers after this duration (0 = disabled)</p>
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
                    className="w-20 rounded-lg border border-edge bg-surface px-2 py-1.5 text-sm text-content text-center focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                  <span className="text-xs text-muted">min</span>
                </div>
              </div>
            </section>

            {/* Session History */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <History className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-content">Session History</h2>
              </div>
              {historyLoading ? (
                <p className="text-muted text-sm">Loading...</p>
              ) : sessionHistory.length === 0 ? (
                <p className="text-muted text-sm">No session history yet</p>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded-xl border border-edge">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0">
                      <tr className="border-b border-edge bg-card">
                        <th className="text-left px-3 py-2.5 text-muted font-medium text-[11px] uppercase tracking-wider">Profile</th>
                        <th className="text-left px-3 py-2.5 text-muted font-medium text-[11px] uppercase tracking-wider">Date</th>
                        <th className="text-left px-3 py-2.5 text-muted font-medium text-[11px] uppercase tracking-wider">Duration</th>
                        <th className="text-left px-3 py-2.5 text-muted font-medium text-[11px] uppercase tracking-wider">Exit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessionHistory.slice(0, 20).map((h, i) => (
                        <tr key={h.id} className={`border-b border-edge/40 last:border-0 ${i % 2 === 1 ? 'bg-elevated/15' : ''}`}>
                          <td className="px-3 py-2 text-content text-xs truncate max-w-[140px]" title={profileNameMap.get(h.profile_id) ?? h.profile_id}>
                            {profileNameMap.get(h.profile_id) ?? <span className="text-muted/50 font-mono">{h.profile_id.slice(0, 8)}</span>}
                          </td>
                          <td className="px-3 py-2 text-content text-xs tabular-nums">
                            {new Date(h.started_at).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 text-content text-xs font-mono tabular-nums">
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
            <section>
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-content">Templates</h2>
              </div>
              {templates.length === 0 ? (
                <p className="text-muted text-sm">No templates yet. Save a profile as template from the editor.</p>
              ) : (
                <div className="space-y-2">
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-center justify-between rounded-xl bg-card border border-edge px-4 py-3">
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

            {/* About & Updates */}
            <section className="rounded-xl border border-edge bg-card p-4">
              <div className="flex items-center gap-2 mb-3">
                <RefreshCw className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-content">Updates</h2>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">Lux Antidetect Browser <span className="font-mono text-xs">v1.0.3</span></p>
                <button
                  onClick={() => api.checkForUpdates()}
                  className={BTN_SECONDARY + ' text-xs'}
                >
                  Check for Updates
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
