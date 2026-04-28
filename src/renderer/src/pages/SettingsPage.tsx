/**
 * SettingsPage — Vault iter-2.
 *
 * Rewritten on canonical shadcn/Radix primitives + Vault tokens. Tab chrome
 * runs through the canonical `TabsRoot` family, theme tiles use a div with
 * `role="button"` to avoid the prior nested-button HTML invalidity, and the
 * DebugPanel honors `prefers-reduced-motion` on auto-scroll. Keyboard focus
 * inside the theme-tile action overlay now reveals the overlay via
 * `group-focus-within` so focus rings stay visible.
 */
import {
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  lazy,
  Suspense,
  type Dispatch,
  type SetStateAction,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  CheckCircle2,
  Plus,
  Trash2,
  Check,
  Palette,
  History,
  FileText,
  Download,
  Upload,
  HardDrive,
  Loader2,
  Settings2,
  Fingerprint,
  RefreshCw,
  Pencil,
  Bug,
  Monitor,
  Database,
  Info,
  ShieldCheck,
  Languages,
  KeyRound,
  Server
} from 'lucide-react'
import { api } from '../lib/api'
import { useSettingsStore } from '../stores/settings'
import { useProfilesStore } from '../stores/profiles'
import { THEME_PRESETS } from '../lib/themes'
import type { Theme, ThemeColors } from '../lib/themes'
import type { ManagedBrowserResponse, AvailableBrowser, Profile } from '../lib/types'
import { useToastStore } from '../components/Toast'
import { useConfirmStore } from '../components/ConfirmDialog'
// ThemeEditor pulls in the color picker + portal setup — only needed when
// the user actually opens the editor, so keep it out of the Settings chunk.
const ThemeEditor = lazy(() =>
  import('../components/ThemeEditor').then((m) => ({ default: m.ThemeEditor }))
)
import { useLogStore } from '../stores/debug'
import { useReducedMotion } from '../hooks/useReducedMotion'
import type { LogEntry, LogLevel } from '../stores/debug'
import { cn } from '../lib/utils'
import { FEATURE_TEMPLATES_ENABLED } from '../lib/features'
import {
  Badge,
  Button,
  CardContent,
  CardDescription,
  CardHeader,
  CardRoot,
  CardTitle,
  EmptyState,
  Label,
  ScrollArea,
  Separator,
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
  Toggle
} from '../components/ui'

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

type SettingsTab = 'appearance' | 'browsers' | 'general' | 'fingerprint' | 'data' | 'about' | 'debug'

interface TabSpec {
  id: SettingsTab
  label: string
  icon: typeof Palette
}

interface LocalApiServerStatus {
  enabled: boolean
  running: boolean
  host: string
  port: number
  baseUrl: string
  token: string
}

const TAB_ITEMS: TabSpec[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'browsers', label: 'Browsers', icon: HardDrive },
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'fingerprint', label: 'Fingerprint', icon: Fingerprint },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'about', label: 'About', icon: Info },
  { id: 'debug', label: 'Debug', icon: Bug }
]

// Debounce window for numeric scratch-pad inputs (max-concurrent, session
// timeout). Both write-through to the DB so we coalesce keystrokes.
const NUMERIC_PERSIST_DEBOUNCE_MS = 500

// Maximum bounds on the numeric session controls. Match the previous values.
const MAX_CONCURRENT_LIMIT = 50
const SESSION_TIMEOUT_MAX_MIN = 1440
const API_PORT_MIN = 1024
const API_PORT_MAX = 65535

// History table caps at 20 rows in the rendered slice. Backed by a virtual
// scroll-area so additional rows would just keep flowing off the bottom.
const SESSION_HISTORY_VISIBLE_ROWS = 20

// Debug log viewer height (px). Picked to fit ~14 rows at the current density
// without expanding the card vertically when there are no logs.
const DEBUG_LOG_VIEWER_HEIGHT_PX = 320

// Theme swatch keys rendered in the picker tile (5 of the 12 ThemeColors).
// Picked to communicate the entire surface depth + accent in one row.
const THEME_SWATCH_KEYS: (keyof ThemeColors)[] = [
  'surface',
  'card',
  'elevated',
  'accent',
  'content'
]

// Log-level → Tailwind text utility for the debug log viewer.
const LOG_LEVEL_STYLES: Record<LogLevel, string> = {
  info: 'text-primary',
  warn: 'text-warn',
  error: 'text-destructive',
  debug: 'text-muted-foreground'
}

// ────────────────────────────────────────────────────────────────────────────
// Page shell
// ────────────────────────────────────────────────────────────────────────────

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
  const blockWebAuthn = useSettingsStore((s) => s.blockWebAuthn)
  const setBlockWebAuthn = useSettingsStore((s) => s.setBlockWebAuthn)

  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true)

  useEffect(() => {
    api
      .getSetting('auto_check_updates')
      .then((v: unknown) => {
        if (v === false) setAutoCheckUpdates(false)
      })
      .catch(() => {})
  }, [])

  const [autostart, setAutostart] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(false)
  const [maxConcurrent, setMaxConcurrent] = useState(0)
  const maxConcurrentRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [autoStartProfileIds, setAutoStartProfileIds] = useState<string[]>([])
  const [apiServer, setApiServer] = useState<LocalApiServerStatus | null>(null)
  const [apiServerBusy, setApiServerBusy] = useState(false)

  useEffect(() => {
    api.getAutostart().then(setAutostart).catch(() => {})
    api
      .getSetting('minimize_to_tray')
      .then((v: unknown) => {
        if (v === true) setMinimizeToTray(true)
      })
      .catch(() => {})
    api
      .getSetting('max_concurrent_sessions')
      .then((v: unknown) => {
        if (typeof v === 'number') setMaxConcurrent(v)
      })
      .catch(() => {})
    api
      .getSetting('auto_start_profiles')
      .then((v: unknown) => {
        if (Array.isArray(v)) setAutoStartProfileIds(v as string[])
      })
      .catch(() => {})
    api.getApiServerStatus().then(setApiServer).catch(() => {})
  }, [])

  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([])
  const [templates, setTemplates] = useState<TemplateEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const profiles = useProfilesStore((s) => s.profiles)
  const profileNameMap = useMemo(
    () => new Map(profiles.map((p) => [p.id, p.name])),
    [profiles]
  )

  const [sessionTimeout, setSessionTimeout] = useState(0)
  const sessionTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [showThemeEditor, setShowThemeEditor] = useState(false)
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null)

  useEffect(() => {
    api
      .detectBrowsers()
      .then((result) => {
        setBrowsers(result)
        setBrowsersLoading(false)
      })
      .catch(() => setBrowsersLoading(false))
  }, [])

  useEffect(() => {
    api
      .getSetting('session_timeout_minutes')
      .then((v: unknown) => {
        if (typeof v === 'number') setSessionTimeout(v)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    api
      .getSessionHistory()
      .then((h: unknown) => {
        setSessionHistory(h as SessionHistoryEntry[])
        setHistoryLoading(false)
      })
      .catch(() => setHistoryLoading(false))

    if (FEATURE_TEMPLATES_ENABLED) {
      api
        .listTemplates()
        .then((t: unknown) => {
          setTemplates(t as TemplateEntry[])
        })
        .catch(() => {})
    }
  }, [])

  const refreshManagedBrowsers = useCallback(() => {
    api.listManagedBrowsers().then(setManagedBrowsers).catch(() => {})
  }, [])

  useEffect(() => {
    refreshManagedBrowsers()
    api.getAvailableBrowsers().then(setAvailableBrowsers).catch(() => {})

    const offProgress = api.onBrowserDownloadProgress((data) => {
      setDownloading((prev) => ({ ...prev, [`${data.browser}-${data.buildId}`]: data.percent }))
    })
    const offComplete = api.onBrowserDownloadComplete(() => {
      refreshManagedBrowsers()
      api.detectBrowsers().then(setBrowsers)
    })
    const offError = api.onBrowserDownloadError((data) => {
      setDownloading((prev) => {
        const next = { ...prev }
        delete next[`${data.browser}-${data.buildId}`]
        return next
      })
      addToast(`Download failed: ${data.message}`, 'error')
    })

    return () => {
      offProgress()
      offComplete()
      offError()
    }
  }, [refreshManagedBrowsers, addToast])

  const handleDownloadBrowser = async (
    browserType: string,
    channel: string,
    browser: string,
    buildId: string
  ): Promise<void> => {
    const key = `${browser}-${buildId}`
    if (downloading[key] !== undefined) return
    setDownloading((prev) => ({ ...prev, [key]: 0 }))
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
      setDownloading((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      addToast(`${browser} ${buildId} downloaded`, 'success')
    } catch {
      /* Error events handled by listener */
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
      setManagedBrowsers((prev) => prev.filter((b) => !(b.browser === browser && b.buildId === buildId)))
      api.detectBrowsers().then(setBrowsers)
      addToast(`${browser} removed`, 'success')
    } catch (err) {
      addToast(
        `Failed to remove: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error'
      )
    }
  }

  const handleEditTheme = (theme: Theme): void => {
    setEditingTheme(theme)
    setShowThemeEditor(true)
  }

  const handleCloseEditor = (): void => {
    setShowThemeEditor(false)
    setEditingTheme(null)
  }

  const allThemes = useMemo(() => [...THEME_PRESETS, ...customThemes], [customThemes])
  const browserEntries = useMemo(() => Object.entries(browsers), [browsers])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background relative">
      <TabsRoot
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as SettingsTab)}
        className="flex-1 flex flex-col min-h-0"
      >
        {/* Sticky header — page title + tab trigger strip. The wrapper supplies
         * the chrome (background blur, bottom border); the inner TabsList
         * loses its own border so the rule lives on the wrapper alone. */}
        <div
          className={cn(
            'sticky top-0 z-10 shrink-0 px-6 pt-5',
            'entity-toolbar-surface backdrop-blur-sm border-b border-border/50'
          )}
        >
          <h1 className="text-[22px] font-semibold text-foreground tracking-tight mb-3">
            Settings
          </h1>
          <TabsList className="border-b-0 -mb-px">
            {TAB_ITEMS.map((tab) => {
              const Icon = tab.icon
              return (
                <TabsTrigger key={tab.id} value={tab.id}>
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                  {tab.label}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </div>

        {/* Body — each tab's content. The page-level main element supplies
         * the scroll container, so tabs just stack content vertically. */}
        <div className="px-6 py-6">
          <TabsContent value="appearance" className={tabContentClass('max-w-2xl')}>
            <AppearanceTab
              allThemes={allThemes}
              activeThemeId={activeThemeId}
              setActiveTheme={setActiveTheme}
              deleteCustomTheme={deleteCustomTheme}
              onEditTheme={handleEditTheme}
              onCreateTheme={() => {
                setEditingTheme(null)
                setShowThemeEditor(true)
              }}
            />
          </TabsContent>

          <TabsContent value="browsers" className={tabContentClass('max-w-3xl')}>
            <BrowsersTab
              managedBrowsers={managedBrowsers}
              availableBrowsers={availableBrowsers}
              downloading={downloading}
              browserEntries={browserEntries}
              browsersLoading={browsersLoading}
              onDownload={handleDownloadBrowser}
              onRemove={handleRemoveBrowser}
            />
          </TabsContent>

          <TabsContent value="general" className={tabContentClass('max-w-2xl')}>
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
              apiServer={apiServer}
              setApiServer={setApiServer}
              apiServerBusy={apiServerBusy}
              setApiServerBusy={setApiServerBusy}
              profiles={profiles}
              addToast={addToast}
            />
          </TabsContent>

          <TabsContent value="fingerprint" className={tabContentClass('max-w-2xl')}>
            <FingerprintTab
              autoRegenFingerprint={autoRegenFingerprint}
              setAutoRegenFingerprint={setAutoRegenFingerprint}
              blockWebAuthn={blockWebAuthn}
              setBlockWebAuthn={setBlockWebAuthn}
            />
          </TabsContent>

          <TabsContent value="data" className={tabContentClass('max-w-2xl')}>
            <DataTab
              profiles={profiles}
              templates={templates}
              setTemplates={setTemplates}
              sessionHistory={sessionHistory}
              historyLoading={historyLoading}
              profileNameMap={profileNameMap}
              addToast={addToast}
              confirm={confirm}
            />
          </TabsContent>

          <TabsContent value="about" className={tabContentClass('max-w-2xl')}>
            <AboutTab
              autoCheckUpdates={autoCheckUpdates}
              setAutoCheckUpdates={setAutoCheckUpdates}
            />
          </TabsContent>

          <TabsContent value="debug" className={tabContentClass('max-w-3xl')}>
            <DebugPanel />
          </TabsContent>
        </div>
      </TabsRoot>

      {/* Theme Editor Modal — lazy so its dependencies only load on demand */}
      {showThemeEditor && (
        <Suspense fallback={null}>
          <ThemeEditor
            open={showThemeEditor}
            editingTheme={editingTheme}
            onClose={handleCloseEditor}
          />
        </Suspense>
      )}
    </div>
  )
}

// Helper — `TabsContent` needs to override the primitive's default `mt-3`
// so each tab body breathes correctly inside the page padding, and we want
// every tab to be width-clamped consistently.
function tabContentClass(maxW: 'max-w-2xl' | 'max-w-3xl'): string {
  return cn('mt-0 space-y-5', maxW)
}

// ────────────────────────────────────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────────────────────────────────────

interface SessionHistoryEntry {
  id: string
  profile_id: string
  started_at: string
  stopped_at: string | null
  duration_seconds: number | null
  exit_code: number | null
}

interface TemplateEntry {
  id: string
  name: string
  description: string
  browser_type: string
  created_at: string
}

type ToastType = 'success' | 'error' | 'info' | 'warning'
type AddToast = (msg: string, type?: ToastType) => number

type ConfirmFn = (opts: {
  title?: string
  message: string
  confirmLabel?: string
  danger?: boolean
}) => Promise<boolean>

// Format a duration for the Session History column. Returns an em-dash
// when the value is null (session still running or never recorded).
function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

// ────────────────────────────────────────────────────────────────────────────
// Appearance Tab
// ────────────────────────────────────────────────────────────────────────────

interface AppearanceTabProps {
  allThemes: Theme[]
  activeThemeId: string
  setActiveTheme: (id: string) => Promise<void>
  deleteCustomTheme: (id: string) => Promise<void>
  onEditTheme: (theme: Theme) => void
  onCreateTheme: () => void
}

function AppearanceTab({
  allThemes,
  activeThemeId,
  setActiveTheme,
  deleteCustomTheme,
  onEditTheme,
  onCreateTheme
}: AppearanceTabProps): React.JSX.Element {
  return (
    <CardRoot>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>
          Vault is the default. Other palettes are alternative tunings of the same shell —
          surfaces, density, and motion are identical; only the accent and tints change.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {allThemes.map((theme) => (
            <ThemeTile
              key={theme.id}
              theme={theme}
              isActive={activeThemeId === theme.id}
              onSelect={() => setActiveTheme(theme.id)}
              onEdit={() => onEditTheme(theme)}
              onDelete={() => deleteCustomTheme(theme.id)}
            />
          ))}

          <button
            type="button"
            onClick={onCreateTheme}
            className={cn(
              'rounded-[--radius-lg] border border-dashed border-border p-3.5 text-left',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]',
              'hover:border-primary/50 hover:bg-primary/5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              'group'
            )}
          >
            <div className="flex items-center justify-center h-5 mb-3">
              <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
            <p className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
              Custom Theme
            </p>
          </button>
        </div>
      </CardContent>
    </CardRoot>
  )
}

interface ThemeTileProps {
  theme: Theme
  isActive: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

function ThemeTile({
  theme,
  isActive,
  onSelect,
  onEdit,
  onDelete
}: ThemeTileProps): React.JSX.Element {
  // Tile root is a div with role="button" instead of a real <button> so the
  // edit/delete action buttons can nest as children without producing
  // invalid HTML5 (interactive content inside <button>). Keyboard parity
  // with a real button is preserved via Enter/Space dispatching `onSelect`,
  // gated on `e.target === e.currentTarget` so Enter on a nested action
  // button doesn't double-fire as a tile select.
  const handleTileKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleTileKeyDown}
      aria-current={isActive ? 'true' : undefined}
      aria-label={isActive ? `${theme.name} (current theme)` : theme.name}
      className={cn(
        'group relative rounded-[--radius-lg] border p-3.5 text-left cursor-pointer',
        'transition-colors duration-150 ease-[var(--ease-osmosis)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        isActive
          ? 'border-primary/60 bg-primary/8 ring-1 ring-primary/30 shadow-[0_4px_16px_rgba(59,130,246,0.18)]'
          : 'border-border hover:border-edge hover:bg-elevated/40'
      )}
    >
      {isActive && (
        <div
          className={cn(
            'absolute top-2.5 right-2.5 h-5 w-5 rounded-full',
            'bg-primary flex items-center justify-center'
          )}
          aria-hidden="true"
        >
          <Check className="h-3 w-3 text-primary-foreground" strokeWidth={2.4} />
        </div>
      )}

      <div className="flex gap-1.5 mb-3">
        {THEME_SWATCH_KEYS.map((k) => (
          <span
            key={k}
            className="h-5 w-5 rounded-[--radius-sm] border border-white/5"
            style={{ backgroundColor: theme.colors[k] }}
          />
        ))}
      </div>

      <p className="text-xs font-medium text-foreground truncate">{theme.name}</p>

      {theme.isCustom && (
        // `group-focus-within` reveals the overlay when keyboard focus lands
        // on a child action button — `group-hover` alone hid the focus ring
        // for keyboard users (parent stays opacity-0, ring inherits 0).
        <div className="absolute bottom-2.5 right-2.5 flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className={cn(
              'rounded-[--radius-sm] p-1.5 text-muted-foreground',
              'hover:text-primary hover:bg-primary/10 active:scale-95 transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
            )}
            aria-label="Edit theme"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className={cn(
              'rounded-[--radius-sm] p-1.5 text-muted-foreground',
              'hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
            )}
            aria-label="Delete theme"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Browsers Tab
// ────────────────────────────────────────────────────────────────────────────

interface BrowsersTabProps {
  managedBrowsers: ManagedBrowserResponse[]
  availableBrowsers: AvailableBrowser[]
  downloading: Record<string, number>
  browserEntries: [string, string][]
  browsersLoading: boolean
  onDownload: (browserType: string, channel: string, browser: string, buildId: string) => Promise<void>
  onRemove: (browser: string, buildId: string) => Promise<void>
}

function BrowsersTab({
  managedBrowsers,
  availableBrowsers,
  downloading,
  browserEntries,
  browsersLoading,
  onDownload,
  onRemove
}: BrowsersTabProps): React.JSX.Element {
  return (
    <>
      {/* Installed (managed) */}
      <CardRoot>
        <CardHeader>
          <CardTitle>Installed Browsers</CardTitle>
          <CardDescription>Browsers downloaded and managed by Lux.</CardDescription>
        </CardHeader>
        <CardContent>
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
                <ManagedBrowserRow
                  key={`${b.browser}-${b.buildId}`}
                  browser={b}
                  onRemove={() => onRemove(b.browser, b.buildId)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </CardRoot>

      {/* Available downloads */}
      <CardRoot>
        <CardHeader>
          <CardTitle>Download Browsers</CardTitle>
          <CardDescription>Add additional browser engines.</CardDescription>
        </CardHeader>
        <CardContent>
          {availableBrowsers.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking available downloads…
            </div>
          ) : (
            <div className="space-y-2">
              {availableBrowsers.map((ab) => {
                const dlKey = `${ab.browser}-${ab.buildId}`
                const isDownloading = downloading[dlKey] !== undefined
                const percent = downloading[dlKey] ?? 0
                const isInstalled = managedBrowsers.some(
                  (m) => m.browser === ab.browser && m.buildId === ab.buildId
                )
                return (
                  <AvailableBrowserRow
                    key={dlKey}
                    available={ab}
                    isInstalled={isInstalled}
                    isDownloading={isDownloading}
                    percent={percent}
                    onDownload={() => onDownload(ab.browserType, ab.channel, ab.browser, ab.buildId)}
                  />
                )
              })}
            </div>
          )}
        </CardContent>
      </CardRoot>

      {/* System-detected */}
      <CardRoot>
        <CardHeader>
          <CardTitle>System Browsers</CardTitle>
          <CardDescription>Browsers detected on your operating system.</CardDescription>
        </CardHeader>
        <CardContent>
          {browsersLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
                  <span className="text-foreground capitalize font-medium">{name}</span>
                  <span className="text-muted-foreground truncate font-mono">{path}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </CardRoot>
    </>
  )
}

interface ManagedBrowserRowProps {
  browser: ManagedBrowserResponse
  onRemove: () => void
}

function ManagedBrowserRow({ browser, onRemove }: ManagedBrowserRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[--radius-md] bg-input border border-border px-4 py-3',
        'transition-colors duration-150 ease-[var(--ease-osmosis)]',
        'hover:border-edge'
      )}
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground capitalize">{browser.browser}</p>
        <p className="text-xs text-muted-foreground truncate font-mono">
          {browser.buildId} — {browser.platform}
        </p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        icon={<Trash2 className="h-3.5 w-3.5" />}
        onClick={onRemove}
        aria-label={`Remove ${browser.browser} ${browser.buildId}`}
      />
    </div>
  )
}

interface AvailableBrowserRowProps {
  available: AvailableBrowser
  isInstalled: boolean
  isDownloading: boolean
  percent: number
  onDownload: () => void
}

function AvailableBrowserRow({
  available,
  isInstalled,
  isDownloading,
  percent,
  onDownload
}: AvailableBrowserRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[--radius-md] bg-input border border-border px-4 py-3',
        'transition-colors duration-150 ease-[var(--ease-osmosis)]',
        'hover:border-edge'
      )}
    >
      <Download className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground">{available.label}</p>
          <Badge variant="accent">{available.channel}</Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">
          build {available.buildId}
        </p>
        {isDownloading && (
          <div
            className="mt-2 w-full bg-elevated/70 rounded-full h-1.5 overflow-hidden"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Downloading ${available.label}`}
          >
            <div
              className="bg-primary h-1.5 rounded-full transition-[width] duration-300 ease-[var(--ease-osmosis)]"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      {isInstalled ? (
        <Badge variant="success" dot>
          Installed
        </Badge>
      ) : isDownloading ? (
        <span className="flex items-center gap-1.5 text-xs text-primary font-medium tabular-nums">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {percent}%
        </span>
      ) : (
        <Button size="sm" onClick={onDownload}>
          Download
        </Button>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// General Tab
// ────────────────────────────────────────────────────────────────────────────

interface GeneralTabProps {
  autostart: boolean
  setAutostart: (val: boolean) => void
  minimizeToTray: boolean
  setMinimizeToTray: Dispatch<SetStateAction<boolean>>
  maxConcurrent: number
  setMaxConcurrent: Dispatch<SetStateAction<number>>
  maxConcurrentRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>
  sessionTimeout: number
  setSessionTimeout: Dispatch<SetStateAction<number>>
  sessionTimeoutRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>
  autoStartProfileIds: string[]
  setAutoStartProfileIds: Dispatch<SetStateAction<string[]>>
  apiServer: LocalApiServerStatus | null
  setApiServer: Dispatch<SetStateAction<LocalApiServerStatus | null>>
  apiServerBusy: boolean
  setApiServerBusy: Dispatch<SetStateAction<boolean>>
  profiles: Profile[]
  addToast: AddToast
}

function GeneralTab({
  autostart,
  setAutostart,
  minimizeToTray,
  setMinimizeToTray,
  maxConcurrent,
  setMaxConcurrent,
  maxConcurrentRef,
  sessionTimeout,
  setSessionTimeout,
  sessionTimeoutRef,
  autoStartProfileIds,
  setAutoStartProfileIds,
  apiServer,
  setApiServer,
  apiServerBusy,
  setApiServerBusy,
  profiles,
  addToast
}: GeneralTabProps): React.JSX.Element {
  const [apiPortDraft, setApiPortDraft] = useState<number | null>(null)
  const apiPortPersistRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const updateApiServer = (patch: { enabled?: boolean; port?: number | string }): void => {
    setApiServerBusy(true)
    api
      .configureApiServer(patch)
      .then(setApiServer)
      .catch((err: unknown) =>
        addToast(err instanceof Error ? err.message : 'Failed to update API server', 'error')
      )
      .finally(() => setApiServerBusy(false))
  }

  const copyApiValue = (value: string, label: string): void => {
    if (!navigator.clipboard) {
      addToast('Clipboard is not available', 'error')
      return
    }
    navigator.clipboard
      .writeText(value)
      .then(() => addToast(`${label} copied`, 'success'))
      .catch(() => addToast(`Failed to copy ${label.toLowerCase()}`, 'error'))
  }

  return (
    <>
      <CardRoot>
        <CardHeader>
          <CardTitle>System</CardTitle>
          <CardDescription>Control how Lux starts and behaves.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            checked={autostart}
            onChange={(val) => {
              api
                .setAutostart(val)
                .then(setAutostart)
                .catch(() => addToast('Failed to change autostart', 'error'))
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
        </CardContent>
      </CardRoot>

      <CardRoot>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            Local API
          </CardTitle>
          <CardDescription>
            Control Lux from scripts and local automation tools through an authenticated REST API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            checked={apiServer?.enabled ?? false}
            onChange={(val) => updateApiServer({ enabled: val })}
            label="Enable local API server"
            description="Binds to localhost only. Every endpoint except health requires the token below."
          />
          <Separator />
          <NumericRow
            label="API port"
            description="Server restarts immediately when the port changes."
            value={apiPortDraft ?? apiServer?.port ?? 17888}
            onChange={(val) => {
              setApiPortDraft(val)
              clearTimeout(apiPortPersistRef.current)
              if (val < API_PORT_MIN || val > API_PORT_MAX) return
              apiPortPersistRef.current = setTimeout(() => {
                updateApiServer({ port: val })
                setApiPortDraft(null)
              }, NUMERIC_PERSIST_DEBOUNCE_MS)
            }}
            min={API_PORT_MIN}
            max={API_PORT_MAX}
          />
          <div className="rounded-[--radius-md] border border-border bg-input/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">Status</p>
                <p className="text-xs text-muted-foreground">
                  {apiServer?.running ? 'Running' : apiServer?.enabled ? 'Enabled, not running' : 'Disabled'}
                  {apiServer?.baseUrl ? ` · ${apiServer.baseUrl}` : ''}
                </p>
              </div>
              <Badge variant={apiServer?.running ? 'success' : 'default'}>
                {apiServer?.running ? 'Online' : 'Offline'}
              </Badge>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <KeyRound className="h-3.5 w-3.5" />
                  Bearer token
                </Label>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!apiServer?.token}
                    onClick={() => apiServer?.token && copyApiValue(apiServer.token, 'Token')}
                  >
                    Copy
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={apiServerBusy}
                    onClick={() => {
                      setApiServerBusy(true)
                      api
                        .regenerateApiServerToken()
                        .then(setApiServer)
                        .then(() => addToast('API token regenerated', 'success'))
                        .catch(() => addToast('Failed to regenerate API token', 'error'))
                        .finally(() => setApiServerBusy(false))
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Rotate
                  </Button>
                </div>
              </div>
              <code className="block rounded-[--radius-sm] bg-surface px-2 py-2 text-[11px] text-muted-foreground break-all">
                {apiServer?.token ?? 'Loading...'}
              </code>
              <code className="block rounded-[--radius-sm] bg-surface px-2 py-2 text-[11px] text-muted-foreground break-all">
                {`curl -H "Authorization: Bearer ${apiServer?.token ?? '<token>'}" ${apiServer?.baseUrl ?? 'http://127.0.0.1:17888/api/v1'}/profiles`}
              </code>
            </div>
          </div>
        </CardContent>
      </CardRoot>

      <CardRoot>
        <CardHeader>
          <CardTitle>Session Limits</CardTitle>
          <CardDescription>Control concurrent sessions and timeouts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <NumericRow
            label="Max concurrent sessions"
            description="0 = unlimited"
            value={maxConcurrent}
            onChange={(val) => {
              setMaxConcurrent(val)
              clearTimeout(maxConcurrentRef.current)
              maxConcurrentRef.current = setTimeout(() => {
                api.setSetting('max_concurrent_sessions', val)
              }, NUMERIC_PERSIST_DEBOUNCE_MS)
            }}
            min={0}
            max={MAX_CONCURRENT_LIMIT}
          />
          <Separator />
          <NumericRow
            label="Session timeout"
            description="Auto-stop browsers after this duration. 0 = disabled."
            value={sessionTimeout}
            onChange={(val) => {
              setSessionTimeout(val)
              clearTimeout(sessionTimeoutRef.current)
              sessionTimeoutRef.current = setTimeout(() => {
                api.setSetting('session_timeout_minutes', val)
              }, NUMERIC_PERSIST_DEBOUNCE_MS)
            }}
            min={0}
            max={SESSION_TIMEOUT_MAX_MIN}
            unit="min"
          />
        </CardContent>
      </CardRoot>

      <CardRoot>
        <CardHeader>
          <CardTitle>Auto-Launch Profiles</CardTitle>
          <CardDescription>
            Selected profiles will launch automatically when the app starts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <p className="text-xs text-muted-foreground">No profiles yet</p>
          ) : (
            <ScrollArea className="h-40 -mx-1.5 px-1.5">
              <div className="space-y-1">
                {profiles.map((p) => {
                  const checked = autoStartProfileIds.includes(p.id)
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        'flex items-center gap-2.5 cursor-pointer rounded-[--radius-md] px-2 py-1.5',
                        'hover:bg-elevated/40 transition-colors duration-150 ease-[var(--ease-osmosis)]'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...autoStartProfileIds, p.id]
                            : autoStartProfileIds.filter((x) => x !== p.id)
                          setAutoStartProfileIds(next)
                          api.setSetting('auto_start_profiles', next)
                        }}
                        className={cn(
                          'h-4 w-4 rounded-[--radius-sm] border-border bg-input accent-primary cursor-pointer',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
                        )}
                        aria-label={`Auto-launch ${p.name}`}
                      />
                      <span className="text-xs text-foreground truncate flex-1">{p.name}</span>
                      <Badge variant="default" className="capitalize">
                        {p.browser_type}
                      </Badge>
                    </label>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </CardRoot>
    </>
  )
}

interface NumericRowProps {
  label: string
  description?: string
  value: number
  onChange: (val: number) => void
  min: number
  max: number
  unit?: string
}

function NumericRow({
  label,
  description,
  value,
  onChange,
  min,
  max,
  unit
}: NumericRowProps): React.JSX.Element {
  const inputId = `numeric-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={inputId} className="text-[13px] text-foreground">
          {label}
        </Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          id={inputId}
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className={cn(
            'w-20 h-9 rounded-[--radius-md] border border-border bg-input px-2 text-sm text-foreground text-center tabular-nums',
            'transition-colors duration-150 ease-[var(--ease-osmosis)]',
            'hover:border-edge/80',
            'focus:outline-none focus:border-primary/60 focus:ring-[3px] focus:ring-primary/15'
          )}
        />
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Fingerprint Tab
// ────────────────────────────────────────────────────────────────────────────

interface FingerprintTabProps {
  autoRegenFingerprint: boolean
  setAutoRegenFingerprint: (val: boolean) => Promise<void>
  blockWebAuthn: boolean
  setBlockWebAuthn: (val: boolean) => Promise<void>
}

// Static reference list. Codes match Chrome's Translate language identifiers
// (`translate_recent_target` / whitelist values), which is what the main
// process writes to Default/Preferences.
const TRANSLATION_LANGS: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Russian' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'pl', label: 'Polish' }
]

function FingerprintTab({
  autoRegenFingerprint,
  setAutoRegenFingerprint,
  blockWebAuthn,
  setBlockWebAuthn
}: FingerprintTabProps): React.JSX.Element {
  // Pull translation state directly from the store — keeps the prop list of
  // FingerprintTab from ballooning and matches the in-component subscription
  // pattern used in the page-level SettingsPage state for theme + browsers.
  const translationEnabled = useSettingsStore((s) => s.translationEnabled)
  const translationTargetLang = useSettingsStore((s) => s.translationTargetLang)
  const setTranslationEnabled = useSettingsStore((s) => s.setTranslationEnabled)
  const setTranslationTargetLang = useSettingsStore((s) => s.setTranslationTargetLang)

  return (
    <>
      <CardRoot>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <Fingerprint className="h-4 w-4 text-primary" />
            Fingerprint Generation
          </CardTitle>
          <CardDescription>
            Configure how browser fingerprints are generated for your profiles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Toggle
            checked={autoRegenFingerprint}
            onChange={(val) => setAutoRegenFingerprint(val)}
            label="Auto-regenerate fingerprint on each launch"
            description="Creates a unique fingerprint for every browser session."
          />
        </CardContent>
      </CardRoot>

      <CardRoot>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Hardware Identity Lockdown
          </CardTitle>
          <CardDescription>
            Block API surfaces that expose stable device- or account-bound identifiers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Toggle
            checked={blockWebAuthn}
            onChange={(val) => setBlockWebAuthn(val)}
            label={
              <span className="inline-flex items-center gap-2">
                Block tracking probes &amp; identity APIs
                <Badge variant="success" dot>
                  Recommended
                </Badge>
              </span>
            }
            description="Blocks passkeys, Digital Credentials, DBSC, payment-instrument probes, Privacy Sandbox Topics, and DevTools / CDP detection. FedCM, WebOTP, Storage Access, and Private State Tokens stay native for Microsoft/Azure CAPTCHA compatibility."
          />
        </CardContent>
      </CardRoot>

      <CardRoot>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <Languages className="h-4 w-4 text-primary" />
            Auto-translate pages
          </CardTitle>
          <CardDescription>
            Translates foreign-language pages to your chosen language automatically. Uses
            Chromium&apos;s built-in Translate (works on system Chrome / Edge; best-effort on
            unbranded Chromium builds).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            checked={translationEnabled}
            onChange={(val) => void setTranslationEnabled(val)}
            label="Auto-translate foreign-language pages"
            description="Sets Chrome's translate.enabled flag and pre-populates the auto-translate whitelist for every common source language. Applied on every Chromium profile launch."
          />
          <div
            className={cn(
              'flex items-center justify-between gap-3 transition-opacity',
              !translationEnabled && 'opacity-50 pointer-events-none'
            )}
          >
            <div className="min-w-0">
              <Label className="text-[13px] font-medium text-foreground">
                Target language
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pages get translated <em>into</em> this language without showing the prompt.
              </p>
            </div>
            <SelectRoot
              value={translationTargetLang}
              onValueChange={(v) =>
                void setTranslationTargetLang(v as typeof translationTargetLang)
              }
            >
              <SelectTrigger className="!h-8 !text-[12px] w-[200px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSLATION_LANGS.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>
        </CardContent>
      </CardRoot>
    </>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Data Tab
// ────────────────────────────────────────────────────────────────────────────

interface DataTabProps {
  profiles: Profile[]
  templates: TemplateEntry[]
  setTemplates: Dispatch<SetStateAction<TemplateEntry[]>>
  sessionHistory: SessionHistoryEntry[]
  historyLoading: boolean
  profileNameMap: Map<string, string>
  addToast: AddToast
  confirm: ConfirmFn
}

function DataTab({
  profiles,
  templates,
  setTemplates,
  sessionHistory,
  historyLoading,
  profileNameMap,
  addToast,
  confirm
}: DataTabProps): React.JSX.Element {
  const handleExport = async (): Promise<void> => {
    try {
      const result = await api.exportDatabase()
      if (result.ok && result.path) addToast(`Backup saved: ${result.path}`, 'success')
    } catch (err) {
      addToast(
        `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error'
      )
    }
  }

  const handleImport = async (): Promise<void> => {
    try {
      const result = await api.importDatabase()
      if (result.ok && result.requiresRestart) {
        addToast('Database imported! Restart to apply.', 'success')
      } else if (result.error) {
        addToast(result.error, 'error')
      }
    } catch (err) {
      addToast(
        `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error'
      )
    }
  }

  const handleDeleteTemplate = async (template: TemplateEntry): Promise<void> => {
    const ok = await confirm({
      title: 'Delete Template',
      message: `Delete "${template.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await api.deleteTemplate(template.id)
      setTemplates((prev) => prev.filter((x) => x.id !== template.id))
    } catch (err) {
      addToast(
        `Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error'
      )
    }
  }

  return (
    <>
      <CardRoot>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>Overview of your data.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={cn('grid gap-3', FEATURE_TEMPLATES_ENABLED ? 'grid-cols-3' : 'grid-cols-2')}>
            <StatTile value={profiles.length} label="Profiles" />
            {FEATURE_TEMPLATES_ENABLED && <StatTile value={templates.length} label="Templates" />}
            <StatTile value={sessionHistory.length} label="Sessions" />
          </div>
        </CardContent>
      </CardRoot>

      <CardRoot>
        <CardHeader>
          <CardTitle>Database Backup</CardTitle>
          <CardDescription>
            Export saves all profiles, proxies, and settings. Import requires app restart.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={handleExport}
            >
              Export Database
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Upload className="h-3.5 w-3.5" />}
              onClick={handleImport}
            >
              Import Database
            </Button>
          </div>
        </CardContent>
      </CardRoot>

      <CardRoot>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Session History
          </CardTitle>
          <CardDescription>The last {SESSION_HISTORY_VISIBLE_ROWS} sessions.</CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
            <ScrollArea className="h-60 rounded-[--radius-md] border border-border bg-input/40">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border bg-card">
                    <SessionHeaderCell>Profile</SessionHeaderCell>
                    <SessionHeaderCell>Date</SessionHeaderCell>
                    <SessionHeaderCell>Duration</SessionHeaderCell>
                    <SessionHeaderCell>Exit</SessionHeaderCell>
                  </tr>
                </thead>
                <tbody>
                  {sessionHistory.slice(0, SESSION_HISTORY_VISIBLE_ROWS).map((h, i) => (
                    <SessionHistoryRow
                      key={h.id}
                      entry={h}
                      profileName={profileNameMap.get(h.profile_id)}
                      striped={i % 2 === 1}
                    />
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </CardContent>
      </CardRoot>

      {FEATURE_TEMPLATES_ENABLED && (
      <CardRoot>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Templates
          </CardTitle>
          <CardDescription>Saved profile templates.</CardDescription>
        </CardHeader>
        <CardContent>
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
                <div
                  key={t.id}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-[--radius-md] bg-input border border-border px-4 py-3',
                    'transition-colors duration-150 ease-[var(--ease-osmosis)] hover:border-edge'
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground font-medium truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.browser_type} — {t.description || 'No description'}
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => handleDeleteTemplate(t)}
                    aria-label={`Delete template ${t.name}`}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </CardRoot>
      )}
    </>
  )
}

interface StatTileProps {
  value: number
  label: string
}

function StatTile({ value, label }: StatTileProps): React.JSX.Element {
  return (
    <div className="rounded-[--radius-md] bg-input border border-border px-4 py-3 text-center">
      <p className="text-lg font-bold text-foreground tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function SessionHeaderCell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <th
      className={cn(
        'text-left px-3 py-2.5',
        'text-muted-foreground font-medium text-[11px] uppercase tracking-wider'
      )}
    >
      {children}
    </th>
  )
}

interface SessionHistoryRowProps {
  entry: SessionHistoryEntry
  profileName: string | undefined
  striped: boolean
}

function SessionHistoryRow({
  entry,
  profileName,
  striped
}: SessionHistoryRowProps): React.JSX.Element {
  const isOk = entry.exit_code === 0 || entry.exit_code === null
  return (
    <tr
      className={cn(
        'border-b border-border/40 last:border-0',
        striped && 'bg-elevated/15'
      )}
    >
      <td
        className="px-3 py-2 text-foreground text-xs truncate max-w-[140px]"
        title={profileName ?? entry.profile_id}
      >
        {profileName ?? (
          <span className="text-muted-foreground/70 font-mono">
            {entry.profile_id.slice(0, 8)}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-foreground text-xs tabular-nums">
        {new Date(entry.started_at).toLocaleString()}
      </td>
      <td className="px-3 py-2 text-foreground text-xs font-mono tabular-nums">
        {formatDuration(entry.duration_seconds)}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs',
            isOk ? 'text-ok' : 'text-warn'
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', isOk ? 'bg-ok' : 'bg-warn')} />
          {entry.exit_code ?? '—'}
        </span>
      </td>
    </tr>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// About Tab
// ────────────────────────────────────────────────────────────────────────────

interface AboutTabProps {
  autoCheckUpdates: boolean
  setAutoCheckUpdates: (val: boolean) => void
}

function AboutTab({
  autoCheckUpdates,
  setAutoCheckUpdates
}: AboutTabProps): React.JSX.Element {
  return (
    <CardRoot>
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-2">
          <Info className="h-4 w-4 text-primary" />
          Lux Antidetect Browser
        </CardTitle>
        <CardDescription>Version information and updates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Current version</p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              v{__APP_VERSION__}
            </p>
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
        <Separator />
        <Toggle
          checked={autoCheckUpdates}
          onChange={(val) => {
            setAutoCheckUpdates(val)
            api.setSetting('auto_check_updates', val)
          }}
          label="Auto-check for updates on startup"
          description="Checks every 30 minutes in the background. Takes effect on next launch."
        />
      </CardContent>
    </CardRoot>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Debug Panel
// ────────────────────────────────────────────────────────────────────────────

function DebugPanel(): React.JSX.Element {
  const logs = useLogStore((s) => s.logs)
  const clearLogs = useLogStore((s) => s.clear)
  const addLog = useLogStore((s) => s.addLog)
  const [filter, setFilter] = useState<LogLevel | 'all'>('all')
  const logEndRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()

  // Auto-scroll the viewer to the latest entry whenever a new log arrives.
  // Honor `prefers-reduced-motion: reduce` so the smooth scroll flips to
  // instant when the user opted out of motion at the OS level.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth'
    })
  }, [logs.length, prefersReducedMotion])

  const filteredLogs = useMemo(
    () => (filter === 'all' ? logs : logs.filter((l) => l.level === filter)),
    [filter, logs]
  )

  const handleCheckHealth = async (): Promise<void> => {
    try {
      const { dead } = await api.checkProcessHealth()
      if (dead.length === 0) {
        addLog('Process health: all sessions healthy', 'info', 'health')
      } else {
        addLog(
          `Process health: ${dead.length} dead session(s): ${dead.join(', ')}`,
          'warn',
          'health'
        )
      }
    } catch (err) {
      addLog(
        `Health check failed: ${err instanceof Error ? err.message : 'Unknown'}`,
        'error',
        'health'
      )
    }
  }

  return (
    <>
      <CardRoot>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <Bug className="h-4 w-4 text-primary" />
            System Info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <SystemInfoCell label="Platform" value={navigator.platform} />
            <SystemInfoCell
              label="User Agent"
              value={
                navigator.userAgent.includes('Electron')
                  ? `Electron ${navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? ''}`
                  : 'Unknown'
              }
              title={navigator.userAgent}
            />
            <SystemInfoCell
              label="Chrome"
              value={navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'N/A'}
            />
            <SystemInfoCell label="Memory" value={formatMemoryUsage()} />
          </div>
        </CardContent>
      </CardRoot>

      <div className="flex flex-wrap gap-2">
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

      <CardRoot>
        <CardHeader className="!mb-3 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Console Logs</CardTitle>
            <p className="text-[10.5px] text-muted-foreground font-mono mt-0.5 tabular-nums">
              {filteredLogs.length} entries
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SelectRoot
              value={filter}
              onValueChange={(v) => setFilter(v as LogLevel | 'all')}
            >
              <SelectTrigger className="h-7 w-28 text-[11.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </SelectRoot>
            <Button variant="ghost" size="sm" onClick={clearLogs}>
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea
            className="rounded-[--radius-md] border border-border bg-input/40 font-mono"
            style={{ height: DEBUG_LOG_VIEWER_HEIGHT_PX }}
          >
            {filteredLogs.length === 0 ? (
              <div className="flex items-center justify-center h-full min-h-[240px] text-muted-foreground/50 text-xs">
                No logs yet
              </div>
            ) : (
              <div className="text-[11px] leading-relaxed">
                {filteredLogs.map((log) => (
                  <DebugLogRow key={log.id} log={log} />
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </CardRoot>
    </>
  )
}

interface SystemInfoCellProps {
  label: string
  value: string
  title?: string
}

function SystemInfoCell({ label, value, title }: SystemInfoCellProps): React.JSX.Element {
  return (
    <div className="flex justify-between rounded-[--radius-md] bg-input border border-border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-mono truncate max-w-[200px]" title={title ?? value}>
        {value}
      </span>
    </div>
  )
}

// Type-only access to `performance.memory` (Chrome-only, non-standard). Wraps
// the unknown-cast in one place so the component body stays clean.
interface PerformanceWithMemory {
  memory?: { usedJSHeapSize: number }
}

function formatMemoryUsage(): string {
  const mem = (performance as unknown as PerformanceWithMemory).memory
  if (!mem) return 'N/A'
  return `${Math.round(mem.usedJSHeapSize / 1024 / 1024)}MB`
}

interface DebugLogRowProps {
  log: LogEntry
}

function DebugLogRow({ log }: DebugLogRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-1 border-b border-border/30',
        'hover:bg-elevated/30 transition-colors duration-150 ease-[var(--ease-osmosis)]'
      )}
    >
      <span className="text-muted-foreground/60 shrink-0 w-16 tabular-nums">
        {new Date(log.timestamp).toLocaleTimeString()}
      </span>
      <span
        className={cn(
          'shrink-0 w-10 uppercase font-bold text-[9px]',
          LOG_LEVEL_STYLES[log.level]
        )}
      >
        {log.level}
      </span>
      {log.source && (
        <span className="shrink-0 text-muted-foreground/60 text-[9px]">[{log.source}]</span>
      )}
      <span className="text-foreground min-w-0 break-all">{log.message}</span>
    </div>
  )
}

