import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  CheckCircle2, Plus, Trash2, Check, Palette, History, FileText,
  Download, Upload, HardDrive, Loader2, Settings2, Fingerprint, RefreshCw,
  Pencil, Bug, Monitor, Database, Power, Info
} from 'lucide-react'
import { api } from '../lib/api'
import { useSettingsStore } from '../stores/settings'
import { useProfilesStore } from '../stores/profiles'
import { THEME_PRESETS } from '../lib/themes'
import type { Theme, ThemeColors } from '../lib/themes'
import type { ManagedBrowserResponse, AvailableBrowser } from '../lib/types'
import { useToastStore } from '../components/Toast'
import { useConfirmStore } from '../components/ConfirmDialog'
import { ThemeEditor } from '../components/ThemeEditor'
import { useLogStore } from '../stores/debug'
import type { LogLevel } from '../stores/debug'
import { cn } from '../lib/utils'
import { Tabs } from '../components/ui/Tabs'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Toggle } from '../components/ui/Toggle'
import { Badge } from '../components/ui/Badge'
import { Select } from '../components/ui/Select'
import { EmptyState } from '../components/ui/EmptyState'


type SettingsTab = 'appearance' | 'browsers' | 'general' | 'fingerprint' | 'data' | 'about' | 'debug'

const TAB_ITEMS: { id: string; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette className="h-4 w-4" /> },
  { id: 'browsers', label: 'Browsers', icon: <HardDrive className="h-4 w-4" /> },
  { id: 'general', label: 'General', icon: <Settings2 className="h-4 w-4" /> },
  { id: 'fingerprint', label: 'Fingerprint', icon: <Fingerprint className="h-4 w-4" /> },
  { id: 'data', label: 'Data', icon: <Database className="h-4 w-4" /> },
  { id: 'about', label: 'About', icon: <Info className="h-4 w-4" /> },
  { id: 'debug', label: 'Debug', icon: <Bug className="h-4 w-4" /> }
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
  const deleteCustomTheme = useSettingsStore((s) => s.deleteCustomTheme)
  const autoRegenFingerprint = useSettingsStore((s) => s.autoRegenFingerprint)
  const setAutoRegenFingerprint = useSettingsStore((s) => s.setAutoRegenFingerprint)

  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true)

  useEffect(() => {
    api.getSetting('auto_check_updates').then((v: unknown) => {
      if (v === false) setAutoCheckUpdates(false)
    }).catch(() => {})
  }, [])

  const [autostart, setAutostart] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [maxConcurrent, setMaxConcurrent] = useState(0)
  const maxConcurrentRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [autoStartProfileIds, setAutoStartProfileIds] = useState<string[]>([])

  useEffect(() => {
    api.getAutostart().then(setAutostart).catch(() => {})
    api.getSetting('minimize_to_tray').then((v: unknown) => { if (v === true) setMinimizeToTray(true) }).catch(() => {})
    api.getSetting('max_concurrent_sessions').then((v: unknown) => { if (typeof v === 'number') setMaxConcurrent(v) }).catch(() => {})
    api.getSetting('auto_start_profiles').then((v: unknown) => { if (Array.isArray(v)) setAutoStartProfileIds(v as string[]) }).catch(() => {})
  }, [])

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

  const [showThemeEditor, setShowThemeEditor] = useState(false)
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null)

  useEffect(() => {
    api.detectBrowsers().then((result) => { setBrowsers(result); setBrowsersLoading(false) }).catch(() => setBrowsersLoading(false))
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
      // Pass `browser` + `buildId` explicitly so the user downloads the
      // exact variant/version they picked in the UI (Chromium vs Chrome
      // for Testing, specific channel build), not just the default.
      await api.downloadBrowser(
        browserType as 'chromium' | 'firefox' | 'edge',
        channel,
        browser,
        buildId
      )
      setDownloading(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      addToast(`${browser} ${buildId} downloaded`, 'success')
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

  const handleEditTheme = (theme: Theme): void => {
    setEditingTheme(theme)
    setShowThemeEditor(true)
  }

  const handleCloseEditor = (): void => {
    setShowThemeEditor(false)
    setEditingTheme(null)
  }

  const allThemes = [...THEME_PRESETS, ...customThemes]
  const browserEntries = Object.entries(browsers)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-0">
        <h1 className="text-2xl font-bold text-content mb-4">Settings</h1>
        <Tabs
          tabs={TAB_ITEMS}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as SettingsTab)}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="max-w-2xl">
          {activeTab === 'appearance' && (
            <AppearanceTab
              allThemes={allThemes}
              activeThemeId={activeThemeId}
              setActiveTheme={setActiveTheme}
              deleteCustomTheme={deleteCustomTheme}
              onEditTheme={handleEditTheme}
              onCreateTheme={() => { setEditingTheme(null); setShowThemeEditor(true) }}
            />
          )}

          {activeTab === 'browsers' && (
            <BrowsersTab
              managedBrowsers={managedBrowsers}
              availableBrowsers={availableBrowsers}
              downloading={downloading}
              browsers={browsers}
              browserEntries={browserEntries}
              browsersLoading={browsersLoading}
              onDownload={handleDownloadBrowser}
              onRemove={handleRemoveBrowser}
            />
          )}

          {activeTab === 'general' && (
            <GeneralTab
              autostart={autostart}
              setAutostart={setAutostart}
              minimizeToTray={minimizeToTray}
              setMinimizeToTray={setMinimizeToTray}
              maxConcurrent={maxConcurrent}
              setMaxConcurrent={setMaxConcurrent}
              maxConcurrentRef={maxConcurrentRef}
              sessionTimeout={sessionTimeout}
              setSessionTimeout={setSessionTimeout}
              sessionTimeoutRef={sessionTimeoutRef}
              autoStartProfileIds={autoStartProfileIds}
              setAutoStartProfileIds={setAutoStartProfileIds}
              profiles={profiles}
              addToast={addToast}
            />
          )}

          {activeTab === 'fingerprint' && (
            <FingerprintTab
              autoRegenFingerprint={autoRegenFingerprint}
              setAutoRegenFingerprint={setAutoRegenFingerprint}
            />
          )}

          {activeTab === 'data' && (
            <DataTab
              profiles={profiles}
              templates={templates}
              setTemplates={setTemplates}
              sessionHistory={sessionHistory}
              historyLoading={historyLoading}
              profileNameMap={profileNameMap}
              formatDuration={formatDuration}
              addToast={addToast}
            />
          )}

          {activeTab === 'about' && (
            <AboutTab
              autoCheckUpdates={autoCheckUpdates}
              setAutoCheckUpdates={setAutoCheckUpdates}
            />
          )}

          {activeTab === 'debug' && <DebugPanel />}
        </div>
      </div>

      {/* Theme Editor Modal */}
      <ThemeEditor
        open={showThemeEditor}
        editingTheme={editingTheme}
        onClose={handleCloseEditor}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Appearance Tab                                                      */
/* ------------------------------------------------------------------ */

function AppearanceTab({
  allThemes, activeThemeId, setActiveTheme, deleteCustomTheme, onEditTheme, onCreateTheme
}: {
  allThemes: Theme[]
  activeThemeId: string
  setActiveTheme: (id: string) => Promise<void>
  deleteCustomTheme: (id: string) => Promise<void>
  onEditTheme: (theme: Theme) => void
  onCreateTheme: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-content mb-1">Theme</h2>
        <p className="text-xs text-muted mb-4">Choose a theme or create your own.</p>

        <div className="grid grid-cols-3 gap-3">
          {allThemes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setActiveTheme(theme.id)}
              className={cn(
                'group relative rounded-[--radius-lg] border p-3.5 text-left transition-all duration-150',
                activeThemeId === theme.id
                  ? 'border-accent bg-accent/8 ring-1 ring-accent/30 shadow-sm shadow-accent/10'
                  : 'border-edge hover:border-muted/50 hover:bg-elevated/30'
              )}
            >
              {activeThemeId === theme.id && (
                <div className="absolute top-2.5 right-2.5 h-5 w-5 rounded-full bg-accent flex items-center justify-center">
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
              <div className="flex gap-1.5 mb-3">
                {(['surface', 'card', 'elevated', 'accent', 'content'] as const).map(k => (
                  <div
                    key={k}
                    className="h-5 w-5 rounded-[--radius-sm] border border-white/5"
                    style={{ backgroundColor: theme.colors[k as keyof ThemeColors] }}
                  />
                ))}
              </div>
              <p className="text-xs font-medium text-content truncate">{theme.name}</p>
              {theme.isCustom && (
                <div className="absolute bottom-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onEditTheme(theme) }}
                    className="rounded-[--radius-sm] p-1.5 text-muted hover:text-accent hover:bg-accent/10 active:scale-95 transition-all"
                    title="Edit theme"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteCustomTheme(theme.id) }}
                    className="rounded-[--radius-sm] p-1.5 text-muted hover:text-err hover:bg-err/10 active:scale-95 transition-all"
                    title="Delete theme"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
            </button>
          ))}

          {/* Create custom card */}
          <button
            onClick={onCreateTheme}
            className={cn(
              'rounded-[--radius-lg] border border-dashed border-edge p-3.5 text-left transition-all duration-150',
              'hover:border-accent/50 hover:bg-accent/5 group'
            )}
          >
            <div className="flex items-center justify-center h-5 mb-3">
              <Plus className="h-5 w-5 text-muted group-hover:text-accent transition-colors" />
            </div>
            <p className="text-xs font-medium text-muted group-hover:text-content transition-colors">Custom Theme</p>
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Browsers Tab                                                        */
/* ------------------------------------------------------------------ */

function BrowsersTab({
  managedBrowsers, availableBrowsers, downloading, browsers: _browsers, browserEntries, browsersLoading,
  onDownload, onRemove
}: {
  managedBrowsers: ManagedBrowserResponse[]
  availableBrowsers: AvailableBrowser[]
  downloading: Record<string, number>
  browsers: Record<string, string>
  browserEntries: [string, string][]
  browsersLoading: boolean
  onDownload: (browserType: string, channel: string, browser: string, buildId: string) => Promise<void>
  onRemove: (browser: string, buildId: string) => Promise<void>
}): React.JSX.Element {
  return (
    <div className="space-y-6">
      {/* Managed browsers */}
      <Card title="Installed Browsers" description="Browsers downloaded and managed by Lux.">
        {managedBrowsers.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<HardDrive />}
            title="No browsers installed yet"
            description="Download a browser from the list below — Chromium is the recommended default."
          />
        ) : (
          <div className="space-y-2">
            {managedBrowsers.map((b) => (
              <div key={`${b.browser}-${b.buildId}`} className="flex items-center gap-3 rounded-[--radius-md] bg-surface border border-edge px-4 py-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content capitalize">{b.browser}</p>
                  <p className="text-xs text-muted truncate font-mono">{b.buildId} — {b.platform}</p>
                </div>
                <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => onRemove(b.browser, b.buildId)} />
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Download */}
      <Card title="Download Browsers" description="Download additional browser engines.">
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
                <div key={dlKey} className="flex items-center gap-3 rounded-[--radius-md] bg-surface border border-edge px-4 py-3">
                  <Download className="h-4 w-4 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-content">{ab.label}</p>
                      <Badge variant="accent">{ab.channel}</Badge>
                    </div>
                    <p className="text-xs text-muted font-mono truncate">build {ab.buildId}</p>
                    {isDownloading && (
                      <div className="mt-2 w-full bg-elevated rounded-full h-1.5 overflow-hidden">
                        <div className="bg-accent h-1.5 rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
                      </div>
                    )}
                  </div>
                  {isInstalled ? (
                    <Badge variant="success" dot>Installed</Badge>
                  ) : isDownloading ? (
                    <span className="flex items-center gap-1.5 text-xs text-accent font-medium tabular-nums">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {percent}%
                    </span>
                  ) : (
                    <Button size="sm" onClick={() => onDownload(ab.browserType, ab.channel, ab.browser, ab.buildId)}>
                      Download
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* System browsers */}
      <Card title="System Browsers" description="Browsers detected on your system.">
        {browsersLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Detecting system browsers…
          </div>
        ) : browserEntries.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<Monitor />}
            title="No system browsers detected"
            description="Install Chrome, Chromium, Firefox or Edge system-wide, or download one above."
          />
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
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  General Tab                                                         */
/* ------------------------------------------------------------------ */

function GeneralTab({
  autostart, setAutostart, minimizeToTray, setMinimizeToTray,
  maxConcurrent, setMaxConcurrent, maxConcurrentRef,
  sessionTimeout, setSessionTimeout, sessionTimeoutRef,
  autoStartProfileIds, setAutoStartProfileIds,
  profiles, addToast
}: {
  autostart: boolean
  setAutostart: (val: boolean) => void
  minimizeToTray: boolean
  setMinimizeToTray: (val: boolean) => void
  maxConcurrent: number
  setMaxConcurrent: (val: number) => void
  maxConcurrentRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>
  sessionTimeout: number
  setSessionTimeout: (val: number) => void
  sessionTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>
  autoStartProfileIds: string[]
  setAutoStartProfileIds: (val: string[]) => void
  profiles: { id: string; name: string; browser_type: string }[]
  addToast: (msg: string, type: 'success' | 'error') => void
}): React.JSX.Element {
  return (
    <div className="space-y-5">
      {/* System */}
      <Card
        title="System"
        description="Control how Lux starts and behaves."
        actions={<Monitor className="h-4 w-4 text-accent" />}
      >
        <div className="space-y-4">
          <Toggle
            checked={autostart}
            onChange={(val) => {
              api.setAutostart(val).then(setAutostart).catch(() => addToast('Failed to change autostart', 'error'))
            }}
            label="Launch on system startup"
            description="Start Lux automatically when you log in."
          />
          <Toggle
            checked={minimizeToTray}
            onChange={(val) => {
              setMinimizeToTray(val)
              api.setSetting('minimize_to_tray', val)
              api.setMinimizeToTray(val)
            }}
            label="Minimize to system tray on close"
            description="Keep Lux running in the background."
          />
        </div>
      </Card>

      {/* Session Limits */}
      <Card
        title="Session Limits"
        description="Control concurrent sessions and timeouts."
        actions={<Power className="h-4 w-4 text-accent" />}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-content">Max concurrent sessions</p>
              <p className="text-xs text-muted mt-0.5">0 = unlimited</p>
            </div>
            <input
              type="number"
              min={0}
              max={50}
              value={maxConcurrent}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0
                setMaxConcurrent(val)
                clearTimeout(maxConcurrentRef.current)
                maxConcurrentRef.current = setTimeout(() => {
                  api.setSetting('max_concurrent_sessions', val)
                }, 500)
              }}
              className="w-20 h-9 rounded-[--radius-md] border border-edge bg-surface px-2 text-sm text-content text-center focus:outline-none focus:ring-1 focus:ring-accent/20 focus:border-accent/50"
            />
          </div>
          <div className="h-px bg-edge" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-content">Session timeout</p>
              <p className="text-xs text-muted mt-0.5">Auto-stop browsers after this duration. 0 = disabled.</p>
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
                className="w-20 h-9 rounded-[--radius-md] border border-edge bg-surface px-2 text-sm text-content text-center focus:outline-none focus:ring-1 focus:ring-accent/20 focus:border-accent/50"
              />
              <span className="text-xs text-muted">min</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Auto-launch profiles */}
      <Card
        title="Auto-Launch Profiles"
        description="Selected profiles will launch automatically when the app starts."
        actions={<Power className="h-4 w-4 text-accent" />}
      >
        {profiles.length === 0 ? (
          <p className="text-xs text-muted/50">No profiles yet</p>
        ) : (
          <div className="max-h-40 overflow-y-auto space-y-1">
            {profiles.map((p) => (
              <label key={p.id} className="flex items-center gap-2.5 cursor-pointer rounded-[--radius-md] px-2 py-1.5 hover:bg-elevated/30 transition-colors">
                <input
                  type="checkbox"
                  checked={autoStartProfileIds.includes(p.id)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...autoStartProfileIds, p.id]
                      : autoStartProfileIds.filter(x => x !== p.id)
                    setAutoStartProfileIds(next)
                    api.setSetting('auto_start_profiles', next)
                  }}
                  className="h-4 w-4 rounded-[--radius-sm] border-edge bg-surface accent-accent cursor-pointer"
                />
                <span className="text-xs text-content truncate">{p.name}</span>
                <Badge variant="default">{p.browser_type}</Badge>
              </label>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Fingerprint Tab                                                     */
/* ------------------------------------------------------------------ */

function FingerprintTab({
  autoRegenFingerprint, setAutoRegenFingerprint
}: {
  autoRegenFingerprint: boolean
  setAutoRegenFingerprint: (val: boolean) => Promise<void>
}): React.JSX.Element {
  return (
    <div className="space-y-5">
      <Card
        title="Fingerprint Generation"
        description="Configure how browser fingerprints are generated for your profiles."
        actions={<Fingerprint className="h-4 w-4 text-accent" />}
      >
        <div className="space-y-4">
          <Toggle
            checked={autoRegenFingerprint}
            onChange={(val) => setAutoRegenFingerprint(val)}
            label="Auto-regenerate fingerprint on each launch"
            description="Creates a unique fingerprint for every browser session."
          />
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Data Tab                                                            */
/* ------------------------------------------------------------------ */

function DataTab({
  profiles, templates, setTemplates, sessionHistory, historyLoading, profileNameMap, formatDuration, addToast
}: {
  profiles: { id: string; name: string }[]
  templates: Array<{ id: string; name: string; description: string; browser_type: string; created_at: string }>
  setTemplates: (fn: (prev: typeof templates) => typeof templates) => void
  sessionHistory: Array<{
    id: string; profile_id: string; started_at: string; stopped_at: string | null;
    duration_seconds: number | null; exit_code: number | null
  }>
  historyLoading: boolean
  profileNameMap: Map<string, string>
  formatDuration: (seconds: number | null) => string
  addToast: (msg: string, type: 'success' | 'error') => void
}): React.JSX.Element {
  return (
    <div className="space-y-5">
      {/* Storage overview */}
      <Card title="Storage" description="Overview of your data.">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-[--radius-md] bg-surface border border-edge px-4 py-3 text-center">
            <p className="text-lg font-bold text-content">{profiles.length}</p>
            <p className="text-xs text-muted">Profiles</p>
          </div>
          <div className="rounded-[--radius-md] bg-surface border border-edge px-4 py-3 text-center">
            <p className="text-lg font-bold text-content">{templates.length}</p>
            <p className="text-xs text-muted">Templates</p>
          </div>
          <div className="rounded-[--radius-md] bg-surface border border-edge px-4 py-3 text-center">
            <p className="text-lg font-bold text-content">{sessionHistory.length}</p>
            <p className="text-xs text-muted">Sessions</p>
          </div>
        </div>
      </Card>

      {/* Database Backup */}
      <Card
        title="Database Backup"
        description="Export saves all profiles, proxies, and settings. Import requires app restart."
        actions={<Database className="h-4 w-4 text-accent" />}
      >
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={async () => {
              try {
                const result = await api.exportDatabase()
                if (result.ok) addToast(`Backup saved: ${result.path}`, 'success')
              } catch (err) {
                addToast(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
              }
            }}
          >
            Export Database
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Upload className="h-3.5 w-3.5" />}
            onClick={async () => {
              try {
                const result = await api.importDatabase()
                if (result.ok && result.requiresRestart) {
                  addToast('Database imported! Restart to apply.', 'success')
                } else if (result.error) {
                  addToast(result.error, 'error')
                }
              } catch (err) {
                addToast(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
              }
            }}
          >
            Import Database
          </Button>
        </div>
      </Card>

      {/* Session History */}
      <Card title="Session History" actions={<History className="h-4 w-4 text-accent" />}>
        {historyLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading history…
          </div>
        ) : sessionHistory.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<History />}
            title="No sessions yet"
            description="Launch a profile to start recording session history."
          />
        ) : (
          <div className="max-h-60 overflow-y-auto rounded-[--radius-md] border border-edge">
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
                  <tr key={h.id} className={cn('border-b border-edge/40 last:border-0', i % 2 === 1 && 'bg-elevated/15')}>
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
                      <span className={cn('inline-flex items-center gap-1 text-xs', h.exit_code === 0 || h.exit_code === null ? 'text-ok' : 'text-warn')}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', h.exit_code === 0 || h.exit_code === null ? 'bg-ok' : 'bg-warn')} />
                        {h.exit_code ?? '\u2014'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Templates */}
      <Card title="Templates" description="Saved profile templates." actions={<FileText className="h-4 w-4 text-accent" />}>
        {templates.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<FileText />}
            title="No templates saved"
            description='Open any profile and click "Save as Template" to reuse its fingerprint + settings.'
          />
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between rounded-[--radius-md] bg-surface border border-edge px-4 py-3">
                <div>
                  <p className="text-sm text-content font-medium">{t.name}</p>
                  <p className="text-xs text-muted">{t.browser_type} — {t.description || 'No description'}</p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={async () => {
                    try {
                      await api.deleteTemplate(t.id)
                      setTemplates(prev => prev.filter(x => x.id !== t.id))
                    } catch (err) {
                      addToast(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
                    }
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  About Tab                                                           */
/* ------------------------------------------------------------------ */

function AboutTab({
  autoCheckUpdates, setAutoCheckUpdates
}: {
  autoCheckUpdates: boolean
  setAutoCheckUpdates: (val: boolean) => void
}): React.JSX.Element {
  return (
    <div className="space-y-5">
      <Card
        title="Lux Antidetect Browser"
        description="Version information and updates."
        actions={<Info className="h-4 w-4 text-accent" />}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-content">Current version</p>
              <p className="text-xs text-muted font-mono mt-0.5">v{__APP_VERSION__}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => api.checkForUpdates()}
            >
              Check for Updates
            </Button>
          </div>
          <div className="h-px bg-edge" />
          <Toggle
            checked={autoCheckUpdates}
            onChange={(val) => {
              setAutoCheckUpdates(val)
              api.setSetting('auto_check_updates', val)
            }}
            label="Auto-check for updates on startup"
            description="Checks every 30 minutes in the background. Takes effect on next launch."
          />
        </div>
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Debug Panel                                                        */
/* ------------------------------------------------------------------ */

const LOG_LEVEL_STYLES: Record<LogLevel, string> = {
  info: 'text-accent',
  warn: 'text-warn',
  error: 'text-err',
  debug: 'text-muted'
}

function DebugPanel(): React.JSX.Element {
  const logs = useLogStore((s) => s.logs)
  const clearLogs = useLogStore((s) => s.clear)
  const addLog = useLogStore((s) => s.addLog)
  const [filter, setFilter] = useState<LogLevel | 'all'>('all')
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const filteredLogs = filter === 'all' ? logs : logs.filter((l) => l.level === filter)

  const handleCheckHealth = async (): Promise<void> => {
    try {
      const { dead } = await api.checkProcessHealth()
      if (dead.length === 0) {
        addLog('Process health: all sessions healthy', 'info', 'health')
      } else {
        addLog(`Process health: ${dead.length} dead session(s): ${dead.join(', ')}`, 'warn', 'health')
      }
    } catch (err) {
      addLog(`Health check failed: ${err instanceof Error ? err.message : 'Unknown'}`, 'error', 'health')
    }
  }

  return (
    <div className="space-y-4">
      {/* System info */}
      <Card title="System Info" actions={<Bug className="h-4 w-4 text-accent" />}>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between rounded-[--radius-md] bg-surface border border-edge px-3 py-2">
            <span className="text-muted">Platform</span>
            <span className="text-content font-mono">{navigator.platform}</span>
          </div>
          <div className="flex justify-between rounded-[--radius-md] bg-surface border border-edge px-3 py-2">
            <span className="text-muted">User Agent</span>
            <span className="text-content font-mono truncate max-w-[200px]" title={navigator.userAgent}>
              {navigator.userAgent.includes('Electron') ? 'Electron ' + navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] : 'Unknown'}
            </span>
          </div>
          <div className="flex justify-between rounded-[--radius-md] bg-surface border border-edge px-3 py-2">
            <span className="text-muted">Chrome</span>
            <span className="text-content font-mono">{navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'N/A'}</span>
          </div>
          <div className="flex justify-between rounded-[--radius-md] bg-surface border border-edge px-3 py-2">
            <span className="text-muted">Memory</span>
            <span className="text-content font-mono">
              {(performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
                ? `${Math.round(((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1024 / 1024))}MB`
                : 'N/A'}
            </span>
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={handleCheckHealth}>
          Check Process Health
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => addLog('Manual log entry — testing debug panel', 'info', 'manual')}
        >
          Test Log
        </Button>
      </div>

      {/* Log viewer */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold text-content">Console Logs</h3>
            <span className="text-[10px] text-muted font-mono">{filteredLogs.length} entries</span>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value as LogLevel | 'all')}
              options={[
                { value: 'all', label: 'All' },
                { value: 'info', label: 'Info' },
                { value: 'warn', label: 'Warn' },
                { value: 'error', label: 'Error' },
                { value: 'debug', label: 'Debug' }
              ]}
              className="w-24 !h-7 !text-[10px]"
            />
            <button onClick={clearLogs} className="text-[10px] text-muted hover:text-err transition-colors">
              Clear
            </button>
          </div>
        </div>
        <div className="h-[300px] overflow-y-auto rounded-[--radius-md] border border-edge font-mono text-[11px] leading-relaxed">
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted/40 text-xs">
              No logs yet
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-2 px-3 py-1 border-b border-edge/20 hover:bg-elevated/20 transition-colors"
              >
                <span className="text-muted/40 shrink-0 w-16 tabular-nums">
                  {new Date(log.timestamp).toLocaleTimeString()}
                </span>
                <span className={cn('shrink-0 w-10 uppercase font-bold text-[9px]', LOG_LEVEL_STYLES[log.level])}>
                  {log.level}
                </span>
                {log.source && (
                  <span className="shrink-0 text-muted/50 text-[9px]">[{log.source}]</span>
                )}
                <span className="text-content min-w-0 break-all">{log.message}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </Card>
    </div>
  )
}
