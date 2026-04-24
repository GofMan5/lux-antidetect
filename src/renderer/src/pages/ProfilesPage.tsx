import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  Plus, Play, Square, Copy, Trash2, Loader2, X, AlertCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Download, Upload, Globe, Globe2,
  Flame, ClipboardCopy, Pencil, Terminal, Camera, MoreHorizontal,
  LayoutGrid, ChevronDown, Check, XCircle, ExternalLink,
  HardDrive, Sparkles, ChevronRight, Rows2, Rows3, Star
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useProfilesStore } from '../stores/profiles'
import { useProxiesStore } from '../stores/proxies'
import { useFavoritesStore } from '../stores/favorites'
import { useConfirmStore } from '../components/ConfirmDialog'
import { useToastStore } from '../components/Toast'
import { ProfileEditorPanel, type InitialFingerprint } from './ProfileEditorPage'
import { AutomationModal } from '../components/profile/AutomationModal'
import { Button, Badge, SearchInput, DropdownMenu, EmptyState, Tooltip, Select, ContextMenu } from '../components/ui'
import type { DropdownMenuItem } from '../components/ui'
import { cn } from '../lib/utils'
import { CHECKBOX } from '../lib/ui'
import { api } from '../lib/api'
import {
  validateProfileFingerprint,
  computeProfileHealth,
  type ValidationWarning,
  type HealthStatus
} from '../lib/fingerprint-validator'
import {
  PRESET_BROWSER_MAP,
  buildPresetMenuItems
} from '../lib/preset-menu'
import type { BrowserType, ProfileStatus } from '../lib/types'
import type { PresetDescriptor } from '../../../preload/api-contract'

// --- Constants ---------------------------------------------------------------

type SortKey = 'name' | 'browser_type' | 'status' | 'updated_at' | 'last_used'
type SortDir = 'asc' | 'desc'

const BROWSER_COLORS: Record<BrowserType, string> = {
  chromium: 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/20',
  firefox: 'bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/20',
  edge: 'bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/20'
}

const BROWSER_ICONS: Record<BrowserType, typeof Globe> = {
  chromium: Globe,
  firefox: Flame,
  edge: Globe2
}

const BROWSER_LABEL: Record<BrowserType, string> = {
  chromium: 'Chromium',
  firefox: 'Firefox',
  edge: 'Edge'
}

// Test sites surfaced as row-menu quick actions. Keep in sync with the
// verification chips in ProfileEditorPage when adding new entries.
const TEST_SITE_CREEPJS = 'https://abrahamjuliot.github.io/creepjs/'
const TEST_SITE_PIXELSCAN = 'https://pixelscan.net'

const STATUS_DOT: Record<ProfileStatus, string> = {
  ready: 'bg-muted/50',
  starting: 'bg-warn animate-pulse',
  running: 'bg-ok shadow-sm shadow-ok/40',
  stopping: 'bg-muted animate-pulse',
  error: 'bg-err shadow-sm shadow-err/40'
}

const STATUS_LABEL: Record<ProfileStatus, string> = {
  ready: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  error: 'Error'
}

const HEALTH_DOT: Record<HealthStatus, string> = {
  good: 'bg-ok shadow-sm shadow-ok/40',
  warn: 'bg-warn shadow-sm shadow-warn/40',
  bad: 'bg-err shadow-sm shadow-err/40',
  unknown: 'bg-muted/70 ring-1 ring-muted/60'
}

const HEALTH_STATUS_TEXT: Record<HealthStatus, string> = {
  good: 'Healthy',
  warn: 'Minor issues',
  bad: 'Issues detected',
  unknown: 'Unknown'
}

// Tooltip fallback copy when there are no discrete reasons to list.
const HEALTH_TOOLTIP_GOOD = 'Looks consistent'
const HEALTH_TOOLTIP_UNKNOWN = 'Proxy not yet tested'

// Virtual scroll constants (hoisted to avoid per-render allocation).
// ROW_HEIGHT is driven by the `density` setting; these are the per-density
// values picked up by a local ternary inside the component.
const ROW_HEIGHT_BY_DENSITY = { compact: 36, cozy: 48 } as const
type Density = keyof typeof ROW_HEIGHT_BY_DENSITY
const OVERSCAN = 5

// Bounded concurrency runner for IPC fan-out on health cache warm-up.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

// --- Sub-components ----------------------------------------------------------

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
  return sortDir === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1 text-accent" />
    : <ArrowDown className="h-3 w-3 ml-1 text-accent" />
}

function RunningTimer({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    const start = new Date(startedAt).getTime()
    const update = (): void => {
      const secs = Math.floor((Date.now() - start) / 1000)
      if (secs < 60) setElapsed(`${secs}s`)
      else if (secs < 3600) setElapsed(`${Math.floor(secs / 60)}m ${secs % 60}s`)
      else {
        const h = Math.floor(secs / 3600)
        const m = Math.floor((secs % 3600) / 60)
        setElapsed(`${h}h ${m}m`)
      }
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return <span className="text-[10px] text-accent font-mono tabular-nums">{elapsed}</span>
}

function TableSkeleton() {
  return (
    <div className="bg-card rounded-[--radius-lg] border border-edge overflow-hidden">
      <div className="h-10 bg-surface-alt/50 border-b border-edge" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-edge/50 last:border-0">
          <div className="h-4 w-4 rounded shimmer shrink-0" />
          <div className="h-3 rounded-md shimmer w-32" />
          <div className="h-5 w-14 rounded-full shimmer" />
          <div className="h-5 w-20 rounded-full shimmer" />
          <div className="h-3 w-24 rounded-md shimmer" />
          <div className="h-4 w-12 rounded-full shimmer" />
          <div className="flex-1" />
          <div className="h-3 w-16 rounded-md shimmer" />
          <div className="h-7 w-7 rounded-lg shimmer" />
        </div>
      ))}
    </div>
  )
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function parseTags(tags: string): string[] {
  if (!tags) return []
  return tags.split(',').map(t => t.trim()).filter(Boolean)
}

// --- Main Component ----------------------------------------------------------

export function ProfilesPage() {
  // Store selectors
  const profiles = useProfilesStore((s) => s.profiles)
  const loading = useProfilesStore((s) => s.loading)
  const profileErrors = useProfilesStore((s) => s.profileErrors)
  const fetchProfiles = useProfilesStore((s) => s.fetchProfiles)
  const fetchSessions = useProfilesStore((s) => s.fetchSessions)
  const sessions = useProfilesStore((s) => s.sessions)
  const clearProfileError = useProfilesStore((s) => s.clearProfileError)
  const editorMode = useProfilesStore((s) => s.editorMode)
  const editorProfileId = useProfilesStore((s) => s.editorProfileId)
  const navigate = useNavigate()
  const openEditor = useProfilesStore((s) => s.openEditor)
  const closeEditor = useProfilesStore((s) => s.closeEditor)
  const setPendingHealthBannerExpand = useProfilesStore((s) => s.setPendingHealthBannerExpand)
  const actions = useProfilesStore(
    useShallow((s) => ({
      launch: s.launchBrowser,
      stop: s.stopBrowser,
      delete: s.deleteProfile,
      duplicate: s.duplicateProfile,
      scheduleDelete: s.scheduleDelete
    }))
  )
  const pendingDeletes = useProfilesStore((s) => s.pendingDeletes)

  const proxies = useProxiesStore((s) => s.proxies)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)
  const confirm = useConfirmStore((s) => s.show)
  const addToast = useToastStore((s) => s.addToast)
  const favoriteIds = useFavoritesStore((s) => s.ids)
  const toggleFavorite = useFavoritesStore((s) => s.toggle)

  // Local state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | ProfileStatus>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [density, setDensity] = useState<Density>(() => {
    try {
      const saved = localStorage.getItem('lux.profiles.density')
      if (saved === 'compact' || saved === 'cozy') return saved
    } catch { /* storage disabled */ }
    return 'cozy'
  })
  const ROW_HEIGHT = ROW_HEIGHT_BY_DENSITY[density]
  const lastCheckedIdx = useRef<number | null>(null)

  // Persist density across sessions without a round-trip through the DB.
  useEffect(() => {
    try { localStorage.setItem('lux.profiles.density', density) } catch { /* ignore */ }
  }, [density])

  // Right-click context menu state — coords + the profile that was clicked.
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    profileId: string
    profileName: string
    status: ProfileStatus
    browserType: BrowserType
  } | null>(null)

  // Presets cache for "New from preset" dropdown
  const [presets, setPresets] = useState<PresetDescriptor[] | null>(null)
  const presetsLoadingRef = useRef(false)

  // When a preset is chosen we hand its generated fingerprint to the editor.
  const [pendingFingerprint, setPendingFingerprint] = useState<InitialFingerprint | null>(null)
  const [pendingSeed, setPendingSeed] = useState(0)

  // Per-profile health signals (fingerprint warnings). Cached by id+updated_at.
  const [healthCache, setHealthCache] = useState<
    Record<string, { warnings: ValidationWarning[] }>
  >({})

  // When a profile is created via preset, we forward the preset's browser so
  // the editor form opens with the correct browser_type (avoids UA/platform
  // mismatch warnings for Firefox/Edge presets).
  const [pendingBrowser, setPendingBrowser] = useState<BrowserType | null>(null)

  // Automation modal state
  const [automationFor, setAutomationFor] = useState<{ id: string; name: string } | null>(null)

  // Virtual scroll
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  const handleTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
    setViewportHeight(e.currentTarget.clientHeight)
  }, [])

  // --- Data fetch ------------------------------------------------------------

  useEffect(() => {
    fetchProfiles()
    fetchSessions()
    fetchProxies()
  }, [fetchProfiles, fetchSessions, fetchProxies])

  useEffect(() => {
    const running = profiles.filter(p => p.status === 'running').length
    document.title = running > 0 ? `Lux (${running} running)` : 'Lux Antidetect'
    return () => { document.title = 'Lux Antidetect' }
  }, [profiles])

  // Fetch fingerprint presets once (cached). Swallow errors silently —
  // the dropdown simply won't populate and the plain "New Profile" still works.
  const loadPresets = useCallback(async (): Promise<void> => {
    if (presets || presetsLoadingRef.current) return
    presetsLoadingRef.current = true
    try {
      const list = await api.listFingerprintPresets()
      setPresets(list)
    } catch {
      setPresets([])
    } finally {
      presetsLoadingRef.current = false
    }
  }, [presets])

  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  // Populate health cache: compute fingerprint validator warnings per profile.
  // Key by `${id}:${updated_at}` so a profile edit invalidates just that entry.
  useEffect(() => {
    let cancelled = false
    const pending = profiles.filter((p) => {
      const key = `${p.id}:${p.updated_at}`
      return !(key in healthCache)
    })
    if (pending.length === 0) return
    ;(async () => {
      // Cap at 8 concurrent IPC calls to avoid blocking the main process.
      const results = await mapWithConcurrency(pending, 8, async (p) => {
          try {
            const detail = await api.getProfile(p.id)
            let langs = ''
            try {
              const parsed = JSON.parse(detail.fingerprint.languages)
              langs = Array.isArray(parsed) ? parsed.join(', ') : String(detail.fingerprint.languages ?? '')
            } catch {
              langs = detail.fingerprint.languages ?? ''
            }
            const warnings = validateProfileFingerprint({
              user_agent: detail.fingerprint.user_agent,
              platform: detail.fingerprint.platform,
              timezone: detail.fingerprint.timezone,
              languages: langs,
              screen: `${detail.fingerprint.screen_width}x${detail.fingerprint.screen_height}`,
              hardware_concurrency: detail.fingerprint.hardware_concurrency,
              device_memory: detail.fingerprint.device_memory,
              webgl_vendor: detail.fingerprint.webgl_vendor,
              proxyCountryCode: detail.proxy?.country ?? null
            })
            return { key: `${p.id}:${p.updated_at}`, warnings }
          } catch {
            return { key: `${p.id}:${p.updated_at}`, warnings: [] as ValidationWarning[] }
          }
        })
      if (cancelled) return
      setHealthCache((prev) => {
        // Prune entries for profiles that no longer exist (or whose
        // updated_at has rolled forward) to prevent unbounded growth.
        const valid = new Set(profiles.map((p) => `${p.id}:${p.updated_at}`))
        const next: Record<string, { warnings: ValidationWarning[] }> = {}
        for (const k of Object.keys(prev)) {
          if (valid.has(k)) next[k] = prev[k]
        }
        for (const r of results) next[r.key] = { warnings: r.warnings }
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [profiles, healthCache])

  // --- Derived data ----------------------------------------------------------

  const proxyMap = useMemo(() => new Map(proxies.map((p) => [p.id, p])), [proxies])

  const groups = useMemo(() => {
    const set = new Set(profiles.filter(p => p.group_name).map(p => p.group_name!))
    return Array.from(set).sort()
  }, [profiles])

  const groupOptions = useMemo(() => [
    { value: 'all', label: 'All Groups' },
    ...groups.map(g => ({ value: g, label: g }))
  ], [groups])

  const filteredProfiles = useMemo(() => {
    // Hide profiles that are in the middle of a pending (undoable) delete
    // so they disappear from the UI while the Undo toast is visible.
    let result = pendingDeletes.size === 0
      ? profiles
      : profiles.filter((p) => !pendingDeletes.has(p.id))
    if (groupFilter !== 'all') {
      result = result.filter(p => p.group_name === groupFilter)
    }
    if (statusFilter !== 'all') {
      result = result.filter((p) =>
        statusFilter === 'running'
          ? p.status === 'running' || p.status === 'starting'
          : statusFilter === 'ready'
            ? p.status === 'ready'
            : p.status === statusFilter
      )
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.browser_type.toLowerCase().includes(q) ||
        (p.group_name?.toLowerCase().includes(q)) ||
        parseTags(p.tags).some(t => t.toLowerCase().includes(q))
      )
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...result].sort((a, b) => {
      // Favorites always float above non-favorites regardless of sort key.
      const aFav = favoriteIds.has(a.id)
      const bFav = favoriteIds.has(b.id)
      if (aFav !== bFav) return aFav ? -1 : 1
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      return av < bv ? -dir : av > bv ? dir : 0
    })
  }, [profiles, pendingDeletes, groupFilter, statusFilter, searchQuery, sortKey, sortDir, favoriteIds])

  const statusCounts = useMemo(() => {
    // `pending` deletes shouldn't factor into visible counts.
    const pool = profiles.filter((p) => !pendingDeletes.has(p.id))
    const running = pool.filter((p) => p.status === 'running' || p.status === 'starting').length
    const ready = pool.filter((p) => p.status === 'ready').length
    const error = pool.filter((p) => p.status === 'error').length
    return { total: pool.length, running, ready, error }
  }, [profiles, pendingDeletes])

  // --- Sorting ---------------------------------------------------------------

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }, [sortKey])

  // --- Profile actions -------------------------------------------------------

  const handleLaunch = useCallback(async (id: string): Promise<void> => {
    const p = profiles.find(x => x.id === id)
    const name = p?.name ?? 'Profile'
    try {
      await actions.launch(id)
      const updated = useProfilesStore.getState().profiles.find(x => x.id === id)
      if (updated?.status === 'error') {
        addToast(`Failed to launch ${name}`, 'error')
      } else if (updated?.status === 'running' || updated?.status === 'starting') {
        addToast(`${name} launched`, 'success')
      }
    } catch (err) {
      addToast(`Launch failed: ${err instanceof Error ? err.message : 'Unknown'}`, 'error')
    }
  }, [actions, profiles, addToast])

  const handleStop = useCallback(async (id: string): Promise<void> => {
    const p = profiles.find(x => x.id === id)
    const name = p?.name ?? 'Profile'
    try {
      await actions.stop(id)
      addToast(`${name} stopped`, 'info')
    } catch (err) {
      addToast(`Stop failed: ${err instanceof Error ? err.message : 'Unknown'}`, 'error')
    }
  }, [actions, profiles, addToast])

  const handleDelete = async (id: string, name: string): Promise<void> => {
    const ok = await confirm({
      title: 'Delete Profile',
      message: `Delete "${name}"? You'll have a few seconds to undo.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    // Soft-delete: hide the row locally, show a toast with Undo. The
    // actual IPC delete fires when the toast times out unless the user
    // clicks Undo first.
    if (editorProfileId === id) closeEditor()
    const undo = actions.scheduleDelete(id)
    addToast(`Profile "${name}" deleted`, 'info', {
      duration: 5000,
      silent: true,
      action: {
        label: 'Undo',
        onClick: () => {
          undo()
          addToast(`Restored "${name}"`, 'success', { silent: true, duration: 2500 })
        }
      }
    })
  }

  const handleDuplicate = async (id: string): Promise<void> => {
    try {
      await actions.duplicate(id)
      addToast('Profile duplicated', 'success')
    } catch (e) {
      addToast((e as Error).message, 'error')
    }
  }

  // --- Cookie / CDP / Screenshot handlers ------------------------------------

  const handleExportCookies = async (profileId: string, format: 'json' | 'netscape'): Promise<void> => {
    try {
      const result = await window.api.exportCookies(profileId, format)
      const ext = format === 'json' ? 'json' : 'txt'
      const blob = new Blob([result.data], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cookies_${profileId.slice(0, 8)}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      addToast(`Exported ${result.count} cookies (${format})`, 'success')
    } catch (err) {
      addToast(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }

  const handleImportCookies = async (profileId: string): Promise<void> => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.txt,.cookies'
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const format = file.name.endsWith('.json') ? 'json' : 'netscape'
        const result = await window.api.importCookies(profileId, text, format)
        addToast(`Imported ${result.imported}/${result.total} cookies`, 'success')
      } catch (err) {
        addToast(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
      }
    }
    input.click()
  }

  const handleScreenshot = async (profileId: string): Promise<void> => {
    try {
      const base64 = await window.api.captureScreenshot(profileId)
      const link = document.createElement('a')
      link.href = `data:image/png;base64,${base64}`
      link.download = `screenshot_${profileId.slice(0, 8)}_${Date.now()}.png`
      link.click()
      addToast('Screenshot saved', 'success')
    } catch (err) {
      addToast(`Screenshot failed: ${err instanceof Error ? err.message : 'Unknown'}`, 'error')
    }
  }

  // --- Import / Export profiles ----------------------------------------------

  const handleExportProfiles = async (): Promise<void> => {
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : profiles.map(p => p.id)
      const exportData: Record<string, unknown>[] = []
      for (const id of ids) {
        const detail = await api.getProfile(id)
        exportData.push({
          name: detail.profile.name,
          browser_type: detail.profile.browser_type,
          group_name: detail.profile.group_name,
          group_color: detail.profile.group_color,
          notes: detail.profile.notes,
          start_url: detail.profile.start_url,
          fingerprint: {
            user_agent: detail.fingerprint.user_agent,
            platform: detail.fingerprint.platform,
            screen_width: detail.fingerprint.screen_width,
            screen_height: detail.fingerprint.screen_height,
            timezone: detail.fingerprint.timezone,
            hardware_concurrency: detail.fingerprint.hardware_concurrency,
            device_memory: detail.fingerprint.device_memory,
            webgl_vendor: detail.fingerprint.webgl_vendor,
            webgl_renderer: detail.fingerprint.webgl_renderer,
            webrtc_policy: detail.fingerprint.webrtc_policy,
            languages: detail.fingerprint.languages
          }
        })
      }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lux-profiles-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      addToast(`Exported ${ids.length} profile(s)`, 'success')
    } catch (err) {
      addToast(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }

  const handleImportProfiles = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text) as Array<{
          name: string
          browser_type: string
          group_name?: string
          group_color?: string
          notes?: string
          start_url?: string
          fingerprint?: Record<string, unknown>
        }>
        if (!Array.isArray(data)) throw new Error('Invalid format')
        for (const item of data) {
          await api.createProfile({
            name: item.name,
            browser_type: item.browser_type as BrowserType,
            group_name: item.group_name,
            group_color: item.group_color,
            notes: item.notes,
            start_url: item.start_url,
            fingerprint: item.fingerprint
          })
        }
        fetchProfiles()
        addToast(`Imported ${data.length} profile(s)`, 'success')
      } catch (err) {
        addToast(`Import failed: ${err instanceof Error ? err.message : 'Invalid file'}`, 'error')
      }
    }
    input.click()
  }

  // --- Navigation & panel ----------------------------------------------------

  const handleRowClick = (id: string): void => {
    openEditor('edit', id)
  }

  const handleNewProfile = useCallback((): void => {
    setPendingFingerprint(null)
    setPendingBrowser(null)
    // Bump the seed so the editor remounts even if we're already in create
    // mode  this triggers the dirty-guard inside ProfileEditorPanel.
    setPendingSeed((s) => s + 1)
    openEditor('create')
  }, [openEditor])

  const handleNewFromPreset = useCallback(async (presetId: string): Promise<void> => {
    try {
      const preset = presets?.find((p) => p.id === presetId)
      const fp = await api.generateFingerprintFromPreset(presetId)
      setPendingFingerprint(fp as InitialFingerprint)
      setPendingBrowser(preset ? PRESET_BROWSER_MAP[preset.browser] : null)
      setPendingSeed((s) => s + 1)
      openEditor('create')
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to generate preset fingerprint',
        'error'
      )
    }
  }, [openEditor, addToast, presets])

  // Build grouped DropdownMenu items via the shared helper so list + editor
  // pages stay in lockstep (see src/renderer/src/lib/preset-menu.tsx).
  const presetMenuItems = useMemo<DropdownMenuItem[]>(
    () => buildPresetMenuItems(presets, (p) => void handleNewFromPreset(p.id)),
    [presets, handleNewFromPreset]
  )

  const handlePanelSave = (): void => {
    setPendingFingerprint(null)
    setPendingBrowser(null)
    fetchProfiles()
    closeEditor()
  }

  const handlePanelCancel = useCallback((): void => {
    setPendingFingerprint(null)
    setPendingBrowser(null)
    closeEditor()
  }, [closeEditor])

  // --- Selection -------------------------------------------------------------

  const handleCheckbox = useCallback((profileId: string, idx: number, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)

      if (shiftKey && lastCheckedIdx.current !== null) {
        const start = Math.min(lastCheckedIdx.current, idx)
        const end = Math.max(lastCheckedIdx.current, idx)
        for (let i = start; i <= end; i++) {
          next.add(filteredProfiles[i].id)
        }
      } else {
        if (next.has(profileId)) next.delete(profileId)
        else next.add(profileId)
      }

      lastCheckedIdx.current = idx
      return next
    })
  }, [filteredProfiles])

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked) setSelectedIds(new Set(filteredProfiles.map(p => p.id)))
    else setSelectedIds(new Set())
  }, [filteredProfiles])

  // --- Bulk actions ----------------------------------------------------------

  const handleBulkLaunch = async (): Promise<void> => {
    try {
      const results = await api.bulkLaunch(Array.from(selectedIds))
      const failed = results.filter(r => !r.ok).length
      if (failed > 0) addToast(`${results.length - failed} launched, ${failed} failed`, 'warning')
      else addToast(`${results.length} profiles launched`, 'success')
    } catch { addToast('Bulk launch failed', 'error') }
    setSelectedIds(new Set())
    fetchProfiles()
  }

  const handleBulkStop = async (): Promise<void> => {
    try {
      const results = await api.bulkStop(Array.from(selectedIds))
      const failed = results.filter(r => !r.ok).length
      if (failed > 0) addToast(`${results.length - failed} stopped, ${failed} failed`, 'warning')
      else addToast(`${results.length} profiles stopped`, 'success')
    } catch { addToast('Bulk stop failed', 'error') }
    setSelectedIds(new Set())
    fetchProfiles()
  }

  const handleBulkDelete = async (): Promise<void> => {
    const count = selectedIds.size
    const ok = await confirm({
      title: 'Delete Profiles',
      message: `Delete ${count} selected profile${count === 1 ? '' : 's'}? You'll have a few seconds to undo.`,
      confirmLabel: count === 1 ? 'Delete' : 'Delete All',
      danger: true
    })
    if (!ok) return
    // Stage a delete for each id so Undo can restore all of them in one
    // click. Each scheduled timer finalizes via api.deleteProfile.
    const ids = Array.from(selectedIds)
    const undos = ids.map((id) => actions.scheduleDelete(id))
    setSelectedIds(new Set())
    closeEditor()
    addToast(`${count} profile${count === 1 ? '' : 's'} deleted`, 'info', {
      duration: 5000,
      silent: true,
      action: {
        label: 'Undo',
        onClick: () => {
          undos.forEach((u) => u())
          addToast(
            `Restored ${count} profile${count === 1 ? '' : 's'}`,
            'success',
            { silent: true, duration: 2500 }
          )
        }
      }
    })
    return
  }

  // --- Row action dropdown items ---------------------------------------------

  const getRowActions = useCallback((profileId: string, profileName: string, status: ProfileStatus, browserType: BrowserType): DropdownMenuItem[] => {
    const isRunning = status === 'running'
    const isTransitioning = status === 'starting' || status === 'stopping'
    const supportsAutomation = browserType !== 'firefox'

    const items: DropdownMenuItem[] = []

    if (isRunning) {
      items.push({ label: 'Stop', icon: <Square className="h-4 w-4" />, onClick: () => handleStop(profileId) })
    } else if (!isTransitioning) {
      items.push({ label: 'Launch', icon: <Play className="h-4 w-4" />, onClick: () => handleLaunch(profileId) })
    }

    items.push(
      { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => handleRowClick(profileId) },
      { label: 'Duplicate', icon: <Copy className="h-4 w-4" />, onClick: () => handleDuplicate(profileId) },
      { label: 'Copy ID', icon: <ClipboardCopy className="h-4 w-4" />, onClick: () => { navigator.clipboard.writeText(profileId); addToast('ID copied', 'info') } }
    )

    if (isRunning) {
      items.push(
        { label: 'Export Cookies', icon: <Download className="h-4 w-4" />, onClick: () => handleExportCookies(profileId, 'json') },
        { label: 'Import Cookies', icon: <Upload className="h-4 w-4" />, onClick: () => handleImportCookies(profileId) },
        {
          label: supportsAutomation ? 'Automation…' : 'Automation… (Chromium only)',
          icon: <Terminal className="h-4 w-4" />,
          disabled: !supportsAutomation,
          onClick: () => {
            setAutomationFor({ id: profileId, name: profileName })
          }
        },
        { label: 'Screenshot', icon: <Camera className="h-4 w-4" />, onClick: () => handleScreenshot(profileId) }
      )
    }

    const openTestSite = async (label: string, url: string): Promise<void> => {
      try {
        await api.openUrlInProfile(profileId, url)
        addToast(`Opened ${label}`, 'success')
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : `Failed to open ${label}`,
          'error'
        )
      }
    }

    items.push(
      {
        label: 'Open in CreepJS',
        icon: <ExternalLink className="h-4 w-4" />,
        onClick: () => { void openTestSite('CreepJS', TEST_SITE_CREEPJS) }
      },
      {
        label: 'Open in PixelScan',
        icon: <ExternalLink className="h-4 w-4" />,
        onClick: () => { void openTestSite('PixelScan', TEST_SITE_PIXELSCAN) }
      }
    )

    items.push(
      { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, variant: 'danger', onClick: () => handleDelete(profileId, profileName) }
    )

    return items
  }, [handleLaunch, handleStop, addToast])

  // --- Keyboard navigation — focused row index ------------------------------
  // A keyboard-driven "selected row" cursor that moves with ↑/↓; Enter opens
  // the editor for the focused row, Space toggles selection, Delete triggers
  // the soft-delete flow. Focus index clamps when the list changes.
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)

  useEffect(() => {
    if (focusedIdx === null) return
    if (focusedIdx >= filteredProfiles.length) {
      setFocusedIdx(filteredProfiles.length > 0 ? filteredProfiles.length - 1 : null)
    }
  }, [filteredProfiles.length, focusedIdx])

  // --- Keyboard shortcuts ----------------------------------------------------

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        handleNewProfile()
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        document.getElementById('profile-search')?.focus()
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        document.getElementById('profile-search')?.focus()
      } else if (e.key === 'Escape') {
        if (editorMode) handlePanelCancel()
        else if (selectedIds.size > 0) setSelectedIds(new Set())
        else if (focusedIdx !== null) setFocusedIdx(null)
      } else if (!editorMode && filteredProfiles.length > 0 && !e.altKey) {
        // Arrow-key row navigation. Only active when the editor isn't open
        // so the editor form keeps its natural Tab focus trapping.
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setFocusedIdx((i) => (i === null ? 0 : Math.min(filteredProfiles.length - 1, i + 1)))
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setFocusedIdx((i) => (i === null ? 0 : Math.max(0, i - 1)))
        } else if (e.key === 'Home') {
          e.preventDefault()
          setFocusedIdx(0)
        } else if (e.key === 'End') {
          e.preventDefault()
          setFocusedIdx(filteredProfiles.length - 1)
        } else if (e.key === 'Enter' && focusedIdx !== null) {
          e.preventDefault()
          const p = filteredProfiles[focusedIdx]
          if (p) openEditor('edit', p.id)
        } else if (e.key === ' ' && focusedIdx !== null) {
          e.preventDefault()
          const p = filteredProfiles[focusedIdx]
          if (p) {
            setSelectedIds((prev) => {
              const next = new Set(prev)
              if (next.has(p.id)) next.delete(p.id)
              else next.add(p.id)
              return next
            })
          }
        } else if (e.key === 'Delete' && focusedIdx !== null) {
          e.preventDefault()
          const p = filteredProfiles[focusedIdx]
          if (p) void handleDelete(p.id, p.name)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, selectedIds.size, focusedIdx, filteredProfiles, handleNewProfile, handlePanelCancel, openEditor])

  // --- Render helpers --------------------------------------------------------

  const isAllSelected = filteredProfiles.length > 0 && selectedIds.size === filteredProfiles.length
  const hasSelection = selectedIds.size > 0

  const thClass = 'text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider select-none'
  const thSortable = cn(thClass, 'cursor-pointer hover:text-content transition-colors')

  // --- Loading state ---------------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-full min-w-0 overflow-hidden">
        <div className="flex-1 flex flex-col p-6 overflow-hidden min-w-0">
          <div className="flex items-center justify-between mb-5 shrink-0">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-content">Profiles</h1>
              <div className="h-5 w-8 rounded-full shimmer" />
            </div>
          </div>
          <TableSkeleton />
        </div>
      </div>
    )
  }

  // --- Main render -----------------------------------------------------------

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Main content area */}
      <div className="flex-1 flex flex-col p-6 overflow-hidden min-w-0 relative">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-content">Profiles</h1>
            <Badge variant="default" className="text-[11px] tabular-nums">{profiles.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search profiles..."
              className="w-64"
            />
            {groups.length > 0 && (
              <Select
                options={groupOptions}
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="w-auto min-w-[140px] !h-9 text-xs"
              />
            )}
            <Tooltip content={density === 'compact' ? 'Switch to cozy rows' : 'Switch to compact rows'}>
              <Button
                variant="ghost"
                icon={density === 'compact' ? <Rows2 className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}
                onClick={() => setDensity(density === 'compact' ? 'cozy' : 'compact')}
                aria-label={density === 'compact' ? 'Switch to cozy rows' : 'Switch to compact rows'}
              />
            </Tooltip>
            <Tooltip content="Import profiles">
              <Button variant="ghost" icon={<Upload className="h-4 w-4" />} onClick={handleImportProfiles} />
            </Tooltip>
            <Tooltip content="Export profiles">
              <Button variant="ghost" icon={<Download className="h-4 w-4" />} onClick={handleExportProfiles} />
            </Tooltip>
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={handleNewProfile}>
              New Profile
            </Button>
            <DropdownMenu
              align="right"
              items={presetMenuItems}
              trigger={
                <button
                  type="button"
                  aria-label="New from preset"
                  title="New from preset"
                  className="h-9 w-8 rounded-[--radius-md] inline-flex items-center justify-center bg-accent/10 text-accent hover:bg-accent/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              }
            />
          </div>
        </div>

        {/* Status filter chips — show only when there's anything to filter. */}
        {statusCounts.total > 0 && (
          <div className="flex items-center gap-1.5 mb-3 shrink-0 animate-fadeIn">
            {([
              { key: 'all', label: 'All', count: statusCounts.total, tone: 'default' },
              { key: 'ready', label: 'Ready', count: statusCounts.ready, tone: 'muted' },
              { key: 'running', label: 'Running', count: statusCounts.running, tone: 'success' },
              { key: 'error', label: 'Error', count: statusCounts.error, tone: 'error' }
            ] as const).map((chip) => {
              if (chip.count === 0 && chip.key !== 'all') return null
              const active = statusFilter === chip.key
              return (
                <button
                  key={chip.key}
                  onClick={() => setStatusFilter(chip.key as typeof statusFilter)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
                    'transition-all duration-150 border',
                    active
                      ? chip.tone === 'success'
                        ? 'bg-ok/15 text-ok border-ok/40'
                        : chip.tone === 'error'
                          ? 'bg-err/15 text-err border-err/40'
                          : chip.tone === 'muted'
                            ? 'bg-elevated text-content border-edge'
                            : 'bg-accent/15 text-accent border-accent/40'
                      : 'bg-surface/60 text-muted border-edge/60 hover:text-content hover:border-edge'
                  )}
                >
                  {chip.tone === 'success' && <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_var(--color-ok)]" />}
                  {chip.tone === 'error' && <span className="h-1.5 w-1.5 rounded-full bg-err" />}
                  {chip.label}
                  <span className={cn('tabular-nums', active ? '' : 'text-muted/80')}>{chip.count}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Bulk Action Bar */}
        {hasSelection && (
          <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-card border border-edge rounded-[--radius-lg] shrink-0 animate-scaleIn">
            <span className="text-sm text-content font-semibold">{selectedIds.size} selected</span>
            <div className="h-4 w-px bg-edge" />
            <Button
              variant="ghost"
              size="sm"
              icon={<Play className="h-3.5 w-3.5" />}
              onClick={handleBulkLaunch}
              className="text-ok hover:text-ok hover:bg-ok/10"
            >
              Launch All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Square className="h-3.5 w-3.5" />}
              onClick={handleBulkStop}
              className="text-warn hover:text-warn hover:bg-warn/10"
            >
              Stop All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={handleExportProfiles}
            >
              Export
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={handleBulkDelete}
              className="text-err hover:text-err hover:bg-err/10"
            >
              Delete
            </Button>
            <div className="flex-1" />
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded-[--radius-sm] p-1 text-muted hover:text-content hover:bg-elevated transition-colors"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Empty State */}
        {filteredProfiles.length === 0 ? (
          profiles.length === 0 ? (
            <OnboardingWelcome
              onCreateProfile={handleNewProfile}
              onImportProfiles={handleImportProfiles}
              onGoSettings={() => navigate('/settings')}
              onGoProxies={() => navigate('/proxies')}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState
                icon={<LayoutGrid />}
                title="No matching profiles"
                description="Try clearing the search, changing the group filter, or resetting the tag filter above."
                action={
                  <Button variant="secondary" size="sm" onClick={() => { setSearchQuery(''); setGroupFilter('all') }}>
                    Clear filters
                  </Button>
                }
              />
            </div>
          )
        ) : (
          /* Data Table */
          <div
            ref={scrollRef}
            onScroll={handleTableScroll}
            className="flex-1 overflow-auto min-h-0 bg-card rounded-[--radius-lg] border border-edge"
          >
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[40px]" />
                <col />
                <col className="w-[60px]" />
                <col className="w-[110px]" />
                <col className="w-[110px]" />
                <col className="w-[130px]" />
                <col className="w-[140px]" />
                <col className="w-[100px]" />
                <col className="w-[52px]" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-alt/50 border-b border-edge">
                  <th className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className={CHECKBOX}
                      aria-label="Select all profiles"
                    />
                  </th>
                  <th className={thSortable} onClick={() => toggleSort('name')}>
                    <span className="inline-flex items-center">Name<SortIcon column="name" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thClass} title="Launch health">Health</th>
                  <th className={thSortable} onClick={() => toggleSort('status')}>
                    <span className="inline-flex items-center">Status<SortIcon column="status" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thSortable} onClick={() => toggleSort('browser_type')}>
                    <span className="inline-flex items-center">Browser<SortIcon column="browser_type" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className={thClass}>Proxy</th>
                  <th className={thClass}>Tags</th>
                  <th className={thSortable} onClick={() => toggleSort('last_used')}>
                    <span className="inline-flex items-center">Last Used<SortIcon column="last_used" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className="px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const totalHeight = filteredProfiles.length * ROW_HEIGHT
                  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
                  const endIdx = Math.min(filteredProfiles.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
                  const topPad = startIdx * ROW_HEIGHT
                  const bottomPad = Math.max(0, totalHeight - endIdx * ROW_HEIGHT)
                  const visibleProfiles = filteredProfiles.slice(startIdx, endIdx)
                  return (
                    <>
                      {topPad > 0 && <tr style={{ height: topPad }}><td colSpan={9} /></tr>}
                      {visibleProfiles.map((profile, localIdx) => {
                        const idx = startIdx + localIdx
                        const proxy = proxyMap.get(profile.proxy_id ?? '')
                        const isEditing = editorProfileId === profile.id && editorMode === 'edit'
                        const isChecked = selectedIds.has(profile.id)
                        const tags = parseTags(profile.tags)
                        const session = sessions.find(s => s.profile_id === profile.id)
                        const isTransitioning = profile.status === 'starting' || profile.status === 'stopping'

                        return (
                          <tr
                            key={profile.id}
                            onClick={() => handleRowClick(profile.id)}
                            onDoubleClick={(e) => {
                              e.preventDefault()
                              if (profile.status === 'ready' || profile.status === 'error') handleLaunch(profile.id)
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                profileId: profile.id,
                                profileName: profile.name,
                                status: profile.status,
                                browserType: profile.browser_type
                              })
                            }}
                            className={cn(
                              'border-b border-edge/50 cursor-pointer transition-colors relative',
                              isEditing
                                ? 'bg-accent/8'
                                : focusedIdx === idx
                                  ? 'bg-elevated/60 ring-1 ring-accent/40 ring-inset'
                                  : 'hover:bg-elevated/50'
                            )}
                            style={{ height: ROW_HEIGHT }}
                          >
                            {/* Checkbox — wrapped in a full-cell label so the entire
                                column area is a safe click target for selection. */}
                            <td className="px-1" onClick={(e) => e.stopPropagation()}>
                              <label
                                className="flex h-full w-full items-center justify-center cursor-pointer select-none py-2 px-2 rounded-[--radius-sm] hover:bg-elevated/60 transition-colors"
                                aria-label={isChecked ? 'Deselect profile' : 'Select profile'}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => handleCheckbox(profile.id, idx, (e.nativeEvent as MouseEvent).shiftKey)}
                                  className={CHECKBOX}
                                />
                              </label>
                            </td>

                            {/* Name */}
                            <td className="px-3 truncate" title={profile.name}>
                              <div className="flex items-center gap-2 min-w-0 group/name">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleFavorite(profile.id)
                                  }}
                                  className={cn(
                                    'shrink-0 rounded-[--radius-sm] p-0.5 transition-all',
                                    favoriteIds.has(profile.id)
                                      ? 'text-warn opacity-100'
                                      : 'text-muted/40 opacity-0 group-hover/name:opacity-100 hover:text-warn'
                                  )}
                                  aria-label={favoriteIds.has(profile.id) ? 'Unstar profile' : 'Star profile'}
                                  title={favoriteIds.has(profile.id) ? 'Unstar' : 'Star (pin to top)'}
                                >
                                  <Star
                                    className="h-3.5 w-3.5"
                                    fill={favoriteIds.has(profile.id) ? 'currentColor' : 'none'}
                                  />
                                </button>
                                {profile.group_color && (
                                  <span
                                    className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-edge"
                                    style={{ backgroundColor: profile.group_color }}
                                  />
                                )}
                                <span className="text-content font-medium truncate">{profile.name}</span>
                              </div>
                            </td>

                            {/* Health */}
                            <td className="px-3" onClick={(e) => e.stopPropagation()}>
                              {(() => {
                                const cacheKey = `${profile.id}:${profile.updated_at}`
                                const entry = healthCache[cacheKey]
                                const proxy = profile.proxy_id != null
                                  ? proxyMap.get(profile.proxy_id)
                                  : undefined
                                // "No proxy attached" is an intentional direct-connection
                                // choice, not a health concern. Map it to 'ok' so a
                                // clean no-proxy profile still shows green instead of
                                // the gray "unknown" dot (regression fix).
                                const proxyCheckStatus: 'ok' | 'failed' | 'untested' =
                                  profile.proxy_id == null ? 'ok'
                                  : proxy?.check_ok === true ? 'ok'
                                  : proxy?.check_ok === false ? 'failed'
                                  : 'untested'
                                // While the per-profile warnings warm-up is in-flight we
                                // treat the row as `unknown` (no reasons yet) rather than
                                // guessing; this avoids flicker when the cache hydrates.
                                // Exception: a no-proxy profile stays 'ok' even during
                                // warm-up — its status doesn't depend on a proxy check,
                                // so gray-flashing it would itself be a regression.
                                const fallbackProxyStatus: 'ok' | 'failed' | 'untested' =
                                  profile.proxy_id == null
                                    ? 'ok'
                                    : proxyCheckStatus === 'ok' ? 'untested' : proxyCheckStatus
                                const { status, reasons } = entry
                                  ? computeProfileHealth({
                                      warnings: entry.warnings,
                                      proxyCheckStatus
                                    })
                                  : computeProfileHealth({
                                      warnings: [],
                                      proxyCheckStatus: fallbackProxyStatus
                                    })
                                const statusText = HEALTH_STATUS_TEXT[status]
                                const tooltipFallback =
                                  status === 'good'
                                    ? HEALTH_TOOLTIP_GOOD
                                    : status === 'unknown'
                                      ? HEALTH_TOOLTIP_UNKNOWN
                                      : statusText
                                const tooltipContent = reasons.length === 0
                                  ? tooltipFallback
                                  : (
                                      <div className="text-left">
                                        <div className="text-xs font-medium mb-1">{statusText}</div>
                                        <ul className="list-disc list-inside text-xs space-y-1">
                                          {reasons.map((r, i) => (
                                            <li key={`${i}:${r}`}>{r}</li>
                                          ))}
                                        </ul>
                                      </div>
                                    )
                                const ariaLabel = reasons.length === 0
                                  ? `Health: ${statusText}`
                                  : `Health: ${statusText}, ${reasons.length} issue${reasons.length === 1 ? '' : 's'}`
                                const Glyph =
                                  status === 'good' ? Check
                                  : status === 'warn' ? AlertCircle
                                  : status === 'bad' ? XCircle
                                  : null
                                return (
                                  <Tooltip content={tooltipContent}>
                                    <button
                                      type="button"
                                      aria-label={ariaLabel}
                                      onClick={() => {
                                        setPendingHealthBannerExpand(profile.id)
                                        openEditor('edit', profile.id)
                                      }}
                                      className={cn(
                                        // 24×24px hit area wraps a 16×16px visual dot —
                                        // keeps column density while meeting minimum
                                        // click-target guidance.
                                        'inline-flex items-center justify-center h-6 w-6 rounded-full',
                                        'cursor-pointer hover:opacity-80 transition-opacity',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
                                      )}
                                    >
                                      <span
                                        aria-hidden="true"
                                        className={cn(
                                          'inline-flex items-center justify-center h-4 w-4 rounded-full text-white/90',
                                          HEALTH_DOT[status]
                                        )}
                                      >
                                        {Glyph && <Glyph className="h-2.5 w-2.5" aria-hidden="true" />}
                                      </span>
                                    </button>
                                  </Tooltip>
                                )
                              })()}
                            </td>

                            {/* Status */}
                            <td className="px-3">
                              <div className="flex items-center gap-2">
                                {isTransitioning ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
                                ) : profile.status === 'error' ? (
                                  <Tooltip content={profileErrors[profile.id] || 'Error - click to dismiss'}>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); clearProfileError(profile.id) }}
                                      className="shrink-0"
                                    >
                                      <AlertCircle className="h-3.5 w-3.5 text-err" />
                                    </button>
                                  </Tooltip>
                                ) : (
                                  <span className={cn('h-2 w-2 rounded-full shrink-0', STATUS_DOT[profile.status])} />
                                )}
                                <span className="text-xs text-muted">{STATUS_LABEL[profile.status]}</span>
                                {profile.status === 'running' && session && (
                                  <RunningTimer startedAt={session.started_at} />
                                )}
                              </div>
                            </td>

                            {/* Browser / OS */}
                            <td className="px-3">
                              <span className={cn(
                                'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
                                BROWSER_COLORS[profile.browser_type]
                              )}>
                                {(() => {
                                  const Icon = BROWSER_ICONS[profile.browser_type]
                                  return <Icon className="h-3 w-3" />
                                })()}
                                {BROWSER_LABEL[profile.browser_type]}
                              </span>
                            </td>

                            {/* Proxy */}
                            <td className="px-3">
                              {proxy ? (
                                <Badge variant="default" className="text-[11px]">
                                  {proxy.name}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted/40">No proxy</span>
                              )}
                            </td>

                            {/* Tags */}
                            <td className="px-3">
                              <div className="flex items-center gap-1 overflow-hidden">
                                {tags.length > 0 ? tags.slice(0, 2).map(tag => (
                                  <Badge key={tag} variant="accent" className="text-[10px] px-1.5 py-0">
                                    {tag}
                                  </Badge>
                                )) : (
                                  <span className="text-xs text-muted/30">{'\u2014'}</span>
                                )}
                                {tags.length > 2 && (
                                  <span className="text-[10px] text-muted/50">+{tags.length - 2}</span>
                                )}
                              </div>
                            </td>

                            {/* Last Used */}
                            <td className="px-3">
                              <Tooltip content={profile.last_used ? new Date(profile.last_used).toLocaleString() : 'Never used'}>
                                <span className="text-xs text-muted tabular-nums">
                                  {formatRelativeTime(profile.last_used)}
                                </span>
                              </Tooltip>
                            </td>

                            {/* Actions dropdown */}
                            <td className="px-2" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenu
                                align="right"
                                trigger={
                                  <button className="h-7 w-7 rounded-[--radius-sm] inline-flex items-center justify-center text-muted hover:text-content hover:bg-elevated transition-colors">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                }
                                items={getRowActions(profile.id, profile.name, profile.status, profile.browser_type)}
                              />
                            </td>
                          </tr>
                        )
                      })}
                      {bottomPad > 0 && <tr style={{ height: bottomPad }}><td colSpan={9} /></tr>}
                    </>
                  )
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Editor Panel */}
      {editorMode && (
        <div className="w-[38%] min-w-[340px] max-w-[460px] shrink-0 border-l border-edge bg-card overflow-hidden flex flex-col animate-slideInRight">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-edge shrink-0">
            <h2 className="text-sm font-semibold text-content">
              {editorMode === 'create' ? 'New Profile' : 'Edit Profile'}
            </h2>
            <Button variant="ghost" icon={<X className="h-4 w-4" />} onClick={handlePanelCancel} aria-label="Close panel" />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <ProfileEditorPanel
              key={editorMode === 'edit' ? editorProfileId : `__new__:${pendingSeed}`}
              profileId={editorMode === 'edit' ? editorProfileId : null}
              initialFingerprint={editorMode === 'create' ? pendingFingerprint : null}
              initialBrowser={editorMode === 'create' ? pendingBrowser : null}
              onSave={handlePanelSave}
              onCancel={handlePanelCancel}
            />
          </div>
        </div>
      )}

      {automationFor && (
        <AutomationModal
          open={!!automationFor}
          onClose={() => setAutomationFor(null)}
          profileId={automationFor.id}
        />
      )}

      {/* Right-click context menu on profile rows — reuses row action items
          so the right-click menu is always in sync with the ⋯ dropdown. */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getRowActions(
            contextMenu.profileId,
            contextMenu.profileName,
            contextMenu.status,
            contextMenu.browserType
          )}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Onboarding welcome — first-run experience (0 profiles)            */
/* ------------------------------------------------------------------ */

interface OnboardingStepProps {
  step: number
  icon: React.ReactNode
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  optional?: boolean
}

function OnboardingStep({ step, icon, title, description, actionLabel, onAction, optional }: OnboardingStepProps): React.JSX.Element {
  return (
    <li className="group relative flex items-start gap-4 rounded-[--radius-lg] border border-edge bg-surface/60 p-4 transition-colors hover:border-accent/40">
      <div className="shrink-0 relative">
        <div className="h-10 w-10 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
          {icon}
        </div>
        <div className="absolute -top-1 -left-1 h-5 w-5 rounded-full bg-surface-alt border border-edge text-[10px] font-mono font-semibold text-muted flex items-center justify-center">
          {step}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="text-[14px] font-semibold text-content">{title}</h3>
          {optional && (
            <span className="text-[10px] font-medium text-muted/80 uppercase tracking-wide">Optional</span>
          )}
        </div>
        <p className="text-[13px] text-muted leading-relaxed">{description}</p>
      </div>
      <button
        onClick={onAction}
        className="shrink-0 inline-flex items-center gap-1 rounded-[--radius-md] border border-edge bg-surface px-3 py-2 text-[12px] font-semibold text-content transition-colors hover:border-accent hover:text-accent self-center"
      >
        {actionLabel}
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

interface OnboardingWelcomeProps {
  onCreateProfile: () => void
  onImportProfiles: () => void
  onGoSettings: () => void
  onGoProxies: () => void
}

function OnboardingWelcome({
  onCreateProfile,
  onImportProfiles,
  onGoSettings,
  onGoProxies
}: OnboardingWelcomeProps): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto px-6 pb-10">
      <div className="mx-auto max-w-2xl animate-fadeIn">
        {/* Hero */}
        <div className="flex flex-col items-center text-center pt-8 pb-6">
          <div className="relative mb-5">
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-accent/25 to-accent/5 border border-accent/30 flex items-center justify-center shadow-[0_0_40px_var(--color-accent-glow)]">
              <Sparkles className="h-7 w-7 text-accent" />
            </div>
          </div>
          <h2 className="text-[22px] font-bold text-content tracking-tight">Welcome to Lux</h2>
          <p className="mt-2 text-sm text-muted leading-relaxed max-w-md">
            Let's get you set up. These three steps take about a minute and prepare
            the app for running isolated browser profiles with distinct fingerprints.
          </p>
        </div>

        {/* Steps */}
        <ol className="space-y-2.5">
          <OnboardingStep
            step={1}
            icon={<HardDrive className="h-5 w-5" />}
            title="Install a browser"
            description="Download Chromium (recommended) or another supported build from Settings → Browsers. Profiles launch inside it."
            actionLabel="Open Settings"
            onAction={onGoSettings}
          />
          <OnboardingStep
            step={2}
            icon={<Globe className="h-5 w-5" />}
            title="Add a proxy"
            description="Route each profile through a different IP. You can skip this step and add proxies later."
            actionLabel="Open Proxies"
            onAction={onGoProxies}
            optional
          />
          <OnboardingStep
            step={3}
            icon={<Plus className="h-5 w-5" />}
            title="Create your first profile"
            description="Every profile gets its own fingerprint, storage, and optional proxy. You can also import existing profiles from a JSON file."
            actionLabel="Create Profile"
            onAction={onCreateProfile}
          />
        </ol>

        {/* Secondary action */}
        <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-muted">
          <span>Already have profiles?</span>
          <button
            onClick={onImportProfiles}
            className="inline-flex items-center gap-1 font-medium text-accent hover:text-accent-dim transition-colors"
          >
            Import from JSON
            <Upload className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
