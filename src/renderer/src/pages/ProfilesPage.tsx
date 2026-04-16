import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  Plus, Play, Square, Copy, Trash2, Loader2, X, AlertCircle,
  ArrowUpDown, ArrowUp, ArrowDown, Download, Upload, Globe, Globe2,
  Flame, ClipboardCopy, Pencil, Terminal, Camera, MoreHorizontal,
  LayoutGrid, ChevronDown, Check, XCircle
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProfilesStore } from '../stores/profiles'
import { useProxiesStore } from '../stores/proxies'
import { useConfirmStore } from '../components/ConfirmDialog'
import { useToastStore } from '../components/Toast'
import { ProfileEditorPanel, type InitialFingerprint } from './ProfileEditorPage'
import { Button, Badge, SearchInput, DropdownMenu, EmptyState, Tooltip, Select } from '../components/ui'
import type { DropdownMenuItem } from '../components/ui'
import { cn } from '../lib/utils'
import { CHECKBOX } from '../lib/ui'
import { api } from '../lib/api'
import { validateProfileFingerprint, type ValidationWarning } from '../lib/fingerprint-validator'
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

// Grouped order for preset dropdown OS families
const PRESET_GROUP_ORDER: ReadonlyArray<{
  family: PresetDescriptor['os_family']
  label: string
}> = [
  { family: 'windows', label: 'Windows' },
  { family: 'macos', label: 'macOS' },
  { family: 'linux', label: 'Linux' },
  { family: 'android', label: 'Android' },
  { family: 'ios-emu', label: 'iOS-Emu' }
]

type HealthStatus = 'good' | 'warn' | 'bad' | 'unknown'

const HEALTH_DOT: Record<HealthStatus, string> = {
  good: 'bg-ok shadow-sm shadow-ok/40',
  warn: 'bg-warn shadow-sm shadow-warn/40',
  bad: 'bg-err shadow-sm shadow-err/40',
  unknown: 'bg-muted/70 ring-1 ring-muted/60'
}

// Virtual scroll constants (hoisted to avoid per-render allocation).
const ROW_HEIGHT = 48
const OVERSCAN = 5

// Browser mapping for PresetDescriptor['browser'] -> BrowserType used by
// the profile form. Edge presets don't exist today (presets are chrome|firefox).
const PRESET_BROWSER_MAP: Record<'chrome' | 'firefox', BrowserType> = {
  chrome: 'chromium',
  firefox: 'firefox'
}

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
  const openEditor = useProfilesStore((s) => s.openEditor)
  const closeEditor = useProfilesStore((s) => s.closeEditor)
  const actions = useProfilesStore(
    useShallow((s) => ({
      launch: s.launchBrowser,
      stop: s.stopBrowser,
      delete: s.deleteProfile,
      duplicate: s.duplicateProfile
    }))
  )

  const proxies = useProxiesStore((s) => s.proxies)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)
  const confirm = useConfirmStore((s) => s.show)
  const addToast = useToastStore((s) => s.addToast)

  // Local state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const lastCheckedIdx = useRef<number | null>(null)

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
    let result = profiles
    if (groupFilter !== 'all') {
      result = result.filter(p => p.group_name === groupFilter)
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
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      return av < bv ? -dir : av > bv ? dir : 0
    })
  }, [profiles, groupFilter, searchQuery, sortKey, sortDir])

  const statusCounts = useMemo(() => {
    const running = profiles.filter(p => p.status === 'running').length
    const error = profiles.filter(p => p.status === 'error').length
    return { running, error }
  }, [profiles])

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
      message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    try {
      await actions.delete(id)
      addToast('Profile deleted', 'success')
      if (editorProfileId === id) {
        closeEditor()
      }
    } catch (err) {
      addToast(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
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

  const handleCopyCdpInfo = async (profileId: string): Promise<void> => {
    try {
      const info = await window.api.getCdpInfo(profileId)
      await navigator.clipboard.writeText(info.wsEndpoint)
      addToast(`CDP endpoint copied  port ${info.port}`, 'success')
    } catch (err) {
      addToast(`CDP info: ${err instanceof Error ? err.message : 'Unavailable'}`, 'error')
    }
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

  // Build grouped DropdownMenu items. Disabled label-only rows act as section
  // headers; this keeps the existing DropdownMenu primitive without forking.
  const presetMenuItems = useMemo<DropdownMenuItem[]>(() => {
    if (!presets) {
      return [{ label: 'Loading presets…', disabled: true, onClick: () => {} }]
    }
    if (presets.length === 0) {
      return [{ label: 'No presets available', disabled: true, onClick: () => {} }]
    }
    const items: DropdownMenuItem[] = []
    for (const group of PRESET_GROUP_ORDER) {
      const inGroup = presets.filter((p) => p.os_family === group.family)
      if (inGroup.length === 0) continue
      items.push({
        label: group.label,
        kind: 'heading',
        onClick: () => {}
      })
      for (const p of inGroup) {
        items.push({
          label: p.label,
          onClick: () => void handleNewFromPreset(p.id)
        })
      }
    }
    return items
  }, [presets, handleNewFromPreset])

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
    const ok = await confirm({
      title: 'Delete Profiles',
      message: `Delete ${selectedIds.size} selected profiles? This cannot be undone.`,
      confirmLabel: 'Delete All',
      danger: true
    })
    if (!ok) return
    try {
      const results = await api.bulkDelete(Array.from(selectedIds))
      const failed = results.filter(r => !r.ok).length
      if (failed > 0) addToast(`${results.length - failed} deleted, ${failed} failed`, 'warning')
      else addToast(`${results.length} profiles deleted`, 'success')
    } catch { addToast('Bulk delete failed', 'error') }
    setSelectedIds(new Set())
    closeEditor()
    fetchProfiles()
  }

  // --- Row action dropdown items ---------------------------------------------

  const getRowActions = useCallback((profileId: string, profileName: string, status: ProfileStatus): DropdownMenuItem[] => {
    const isRunning = status === 'running'
    const isTransitioning = status === 'starting' || status === 'stopping'

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
        { label: 'Copy CDP Endpoint', icon: <Terminal className="h-4 w-4" />, onClick: () => handleCopyCdpInfo(profileId) },
        { label: 'Screenshot', icon: <Camera className="h-4 w-4" />, onClick: () => handleScreenshot(profileId) }
      )
    }

    items.push(
      { label: 'Delete', icon: <Trash2 className="h-4 w-4" />, variant: 'danger', onClick: () => handleDelete(profileId, profileName) }
    )

    return items
  }, [handleLaunch, handleStop, addToast])

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
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [editorMode, selectedIds.size, handleNewProfile, handlePanelCancel])

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
        <div className="flex items-center justify-between mb-5 shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-content">Profiles</h1>
            <Badge variant="default" className="text-[11px] tabular-nums">{profiles.length}</Badge>
            {statusCounts.running > 0 && (
              <Badge variant="warning" dot>{statusCounts.running} running</Badge>
            )}
            {statusCounts.error > 0 && (
              <Badge variant="error" dot>{statusCounts.error} error</Badge>
            )}
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
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={<LayoutGrid className="h-12 w-12" />}
              title={profiles.length === 0 ? 'No profiles yet' : 'No matching profiles'}
              description={profiles.length === 0
                ? 'Create your first browser profile to get started'
                : 'Try adjusting your search or filter'
              }
              action={profiles.length === 0 ? (
                <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={handleNewProfile}>
                  Create Profile
                </Button>
              ) : undefined}
            />
          </div>
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
                            className={cn(
                              'border-b border-edge/50 cursor-pointer transition-colors',
                              isEditing ? 'bg-accent/8' : 'hover:bg-elevated/50'
                            )}
                            style={{ height: ROW_HEIGHT }}
                          >
                            {/* Checkbox */}
                            <td className="px-3" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => handleCheckbox(profile.id, idx, (e.nativeEvent as MouseEvent).shiftKey)}
                                className={CHECKBOX}
                              />
                            </td>

                            {/* Name */}
                            <td className="px-3 truncate" title={profile.name}>
                              <div className="flex items-center gap-2 min-w-0">
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
                                const proxyBad =
                                  profile.proxy_id != null &&
                                  proxyMap.get(profile.proxy_id)?.check_ok === false
                                let status: HealthStatus
                                let reasons: string[]
                                if (!entry) {
                                  status = proxyBad ? 'bad' : 'unknown'
                                  reasons = proxyBad ? ['Proxy check failed'] : ['Checking…']
                                } else {
                                  const warns = entry.warnings
                                  const hasWarn = warns.some((w) => w.severity === 'warn')
                                  const hasInfo = warns.some((w) => w.severity === 'info')
                                  status = proxyBad || hasWarn ? 'bad' : hasInfo ? 'warn' : 'good'
                                  reasons = []
                                  if (proxyBad) reasons.push('Proxy check failed')
                                  for (const w of warns) reasons.push(w.message)
                                }
                                const statusText =
                                  status === 'good' ? 'Healthy'
                                  : status === 'warn' ? 'Minor issues'
                                  : status === 'bad' ? 'Issues detected'
                                  : 'Unknown'
                                const tipLabel = reasons.length
                                  ? reasons.slice(0, 2).join(' · ')
                                  : statusText
                                const ariaLabel = `Profile health: ${statusText}.${reasons.length ? ' ' + reasons.join('. ') : ''}`
                                const Glyph =
                                  status === 'good' ? Check
                                  : status === 'warn' ? AlertCircle
                                  : status === 'bad' ? XCircle
                                  : null
                                return (
                                  <Tooltip content={tipLabel}>
                                    <button
                                      type="button"
                                      aria-label={ariaLabel}
                                      className={cn(
                                        'inline-flex items-center justify-center h-4 w-4 rounded-full text-white/90',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                                        HEALTH_DOT[status]
                                      )}
                                    >
                                      {Glyph && <Glyph className="h-2.5 w-2.5" aria-hidden="true" />}
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
                                items={getRowActions(profile.id, profile.name, profile.status)}
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
    </div>
  )
}
