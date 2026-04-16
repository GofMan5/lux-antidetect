import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Plus, Play, Square, Copy, Trash2, Loader2, X, AlertCircle, Search, ArrowUpDown, ArrowUp, ArrowDown, Download, Upload, Globe, Globe2, Flame, ClipboardCopy, Pencil, Users, Terminal, Camera } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProfilesStore } from '../stores/profiles'
import { useProxiesStore } from '../stores/proxies'
import { useConfirmStore } from '../components/ConfirmDialog'
import { useToastStore } from '../components/Toast'
import { ProfileEditorPanel } from './ProfileEditorPage'
import { BTN_PRIMARY, BTN_ICON, BTN_DANGER, SELECT_CLASS, CHECKBOX_CLASS, INPUT_CLASS } from '../lib/ui'
import { api } from '../lib/api'
import type { BrowserType, ProfileStatus } from '../lib/types'

type SortKey = 'name' | 'browser_type' | 'status' | 'updated_at'
type SortDir = 'asc' | 'desc'

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey; sortDir: SortDir }): React.JSX.Element {
  if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-20" />
  return sortDir === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1 text-accent" />
    : <ArrowDown className="h-3 w-3 ml-1 text-accent" />
}

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

const STATUS_INDICATOR: Record<ProfileStatus, string> = {
  ready: 'bg-ok shadow-sm shadow-ok/40',
  starting: 'bg-accent animate-pulse shadow-sm shadow-accent/40',
  running: 'bg-warn animate-pulse shadow-sm shadow-warn/40',
  stopping: 'bg-muted animate-pulse',
  error: 'bg-err shadow-sm shadow-err/40'
}

const STATUS_LABEL: Record<ProfileStatus, string> = {
  ready: 'Ready',
  starting: 'Starting...',
  running: 'Running',
  stopping: 'Stopping...',
  error: 'Error'
}

function RunningTimer({ startedAt }: { startedAt: string }): React.JSX.Element {
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
  return <span className="text-[10px] text-accent font-mono ml-1 tabular-nums">{elapsed}</span>
}

function TableSkeleton(): React.JSX.Element {
  return (
    <div className="flex-1 overflow-auto rounded-xl border border-edge min-h-0 bg-card/50">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-edge/30 last:border-0">
          <div className="h-4 w-4 rounded shimmer" />
          <div className="h-3 rounded-md shimmer flex-1 max-w-[180px]" />
          <div className="h-5 w-16 rounded-full shimmer" />
          <div className="h-3 w-14 rounded-md shimmer" />
          <div className="h-3 w-20 rounded-md shimmer" />
          <div className="flex-1" />
          <div className="flex gap-1.5">
            <div className="h-7 w-7 rounded-lg shimmer" />
            <div className="h-7 w-7 rounded-lg shimmer" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ProfilesPage(): React.JSX.Element {
  const profiles = useProfilesStore((s) => s.profiles)
  const loading = useProfilesStore((s) => s.loading)
  const profileErrors = useProfilesStore((s) => s.profileErrors)
  const fetchProfiles = useProfilesStore((s) => s.fetchProfiles)
  const fetchSessions = useProfilesStore((s) => s.fetchSessions)
  const sessions = useProfilesStore((s) => s.sessions)
  const clearProfileError = useProfilesStore((s) => s.clearProfileError)
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

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelMode, setPanelMode] = useState<'edit' | 'create' | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; profileId: string } | null>(null)

  // Virtual scroll state
  const ROW_HEIGHT = 44
  const OVERSCAN = 5
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  const handleTableScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
    setViewportHeight(e.currentTarget.clientHeight)
  }, [])

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

  const proxyMap = useMemo(() => new Map(proxies.map((p) => [p.id, p])), [proxies])

  const groups = useMemo(() => {
    const set = new Set(profiles.filter(p => p.group_name).map(p => p.group_name!))
    return Array.from(set).sort()
  }, [profiles])

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
        (p.group_name?.toLowerCase().includes(q))
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

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }, [sortKey])

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
      addToast(`CDP endpoint copied — port ${info.port}`, 'success')
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
      if (selectedId === id) {
        setSelectedId(null)
        setPanelMode(null)
      }
    } catch (err) {
      addToast(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }

  const handleRowClick = (id: string): void => {
    setSelectedId(id)
    setPanelMode('edit')
  }

  const handleNewProfile = useCallback((): void => {
    setSelectedId(null)
    setPanelMode('create')
  }, [])

  const handlePanelSave = (): void => {
    fetchProfiles()
    setPanelMode(null)
    setSelectedId(null)
  }

  const handlePanelCancel = useCallback((): void => {
    setPanelMode(null)
    setSelectedId(null)
  }, [])

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
        if (panelMode) handlePanelCancel()
        else if (selectedIds.size > 0) setSelectedIds(new Set())
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [panelMode, selectedIds.size, handleNewProfile, handlePanelCancel])

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    document.addEventListener('click', close)
    document.addEventListener('contextmenu', close)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('contextmenu', close)
    }
  }, [ctxMenu])

  if (loading) {
    return (
      <div className="flex h-full min-w-0 overflow-hidden">
        <div className="flex-1 flex flex-col p-5 overflow-hidden min-w-0">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <h1 className="text-lg font-bold text-content">Profiles</h1>
          </div>
          <TableSkeleton />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Left: profiles table */}
      <div className="flex-1 flex flex-col p-5 overflow-hidden min-w-0 relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-content">Profiles</h1>
            <span className="text-[11px] text-muted bg-elevated px-2 py-0.5 rounded-md font-medium tabular-nums">
              {filteredProfiles.length}
            </span>
            {statusCounts.running > 0 && (
              <span className="text-[11px] text-warn bg-warn/10 px-2 py-0.5 rounded-md font-medium ring-1 ring-warn/20">
                {statusCounts.running} running
              </span>
            )}
            {statusCounts.error > 0 && (
              <span className="text-[11px] text-err bg-err/10 px-2 py-0.5 rounded-md font-medium ring-1 ring-err/20">
                {statusCounts.error} error
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleImportProfiles} className={BTN_ICON} title="Import profiles">
              <Upload className="h-4 w-4" />
            </button>
            <button onClick={handleExportProfiles} className={BTN_ICON} title="Export profiles">
              <Download className="h-4 w-4" />
            </button>
            <button onClick={handleNewProfile} className={BTN_PRIMARY}>
              <Plus className="h-4 w-4" />
              New Profile
            </button>
          </div>
        </div>

        {/* Search + Group filter */}
        <div className="flex items-center gap-2 mb-3 shrink-0">
          <div className="relative flex-1 max-w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
            <input
              id="profile-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search profiles… (/ or Ctrl+F)"
              className={`${INPUT_CLASS} pl-8 !py-1.5 text-xs`}
            />
          </div>
          {groups.length > 0 && (
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className={`${SELECT_CLASS} w-auto min-w-[140px] !py-1.5 text-xs`}
            >
              <option value="all">All Groups</option>
              {groups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          )}
        </div>

        {filteredProfiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center">
            <div className="bg-card rounded-2xl p-10 border border-edge max-w-sm">
              <div className="h-12 w-12 rounded-xl bg-elevated flex items-center justify-center mx-auto mb-4">
                <Users className="h-6 w-6 text-muted/40" />
              </div>
              <p className="text-muted mb-1 text-sm font-medium">
                {profiles.length === 0 ? 'No profiles yet' : 'No matching profiles'}
              </p>
              <p className="text-muted/60 text-xs mb-5">
                {profiles.length === 0 ? 'Create your first browser profile to get started' : 'Try adjusting your search or filter'}
              </p>
              {profiles.length === 0 && (
                <button onClick={handleNewProfile} className={BTN_PRIMARY}>
                  <Plus className="h-4 w-4" />
                  Create Profile
                </button>
              )}
            </div>
          </div>
        ) : (
          <div ref={scrollRef} onScroll={handleTableScroll} className="flex-1 overflow-auto rounded-xl border border-edge min-h-0 bg-card/40">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[36px]" />
                <col className="w-[28%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[26%]" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-edge bg-card">
                  <th className="px-2 py-2.5 w-9">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredProfiles.length && filteredProfiles.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(new Set(filteredProfiles.map(p => p.id)))
                        else setSelectedIds(new Set())
                      }}
                      className={CHECKBOX_CLASS}
                    />
                  </th>
                  <th
                    className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider cursor-pointer select-none hover:text-content transition-colors"
                    onClick={() => toggleSort('name')}
                  >
                    <span className="inline-flex items-center">Name<SortIcon column="name" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th
                    className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider cursor-pointer select-none hover:text-content transition-colors"
                    onClick={() => toggleSort('browser_type')}
                  >
                    <span className="inline-flex items-center">Browser<SortIcon column="browser_type" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th
                    className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider cursor-pointer select-none hover:text-content transition-colors"
                    onClick={() => toggleSort('status')}
                  >
                    <span className="inline-flex items-center">Status<SortIcon column="status" sortKey={sortKey} sortDir={sortDir} /></span>
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Proxy</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Actions</th>
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
                      {topPad > 0 && <tr style={{ height: topPad }}><td colSpan={6} /></tr>}
                      {visibleProfiles.map((profile) => {
                  const proxy = proxyMap.get(profile.proxy_id ?? '')
                  const isSelected = selectedId === profile.id && panelMode === 'edit'
                  return (
                    <tr
                      key={profile.id}
                      onClick={() => handleRowClick(profile.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setCtxMenu({ x: e.clientX, y: e.clientY, profileId: profile.id })
                      }}
                      className={`border-b border-edge/40 last:border-b-0 cursor-pointer transition-all duration-100 ${
                        isSelected ? 'bg-accent/8' : 'hover:bg-elevated/40'
                      }`}
                    >
                      <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(profile.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) next.add(profile.id)
                            else next.delete(profile.id)
                            setSelectedIds(next)
                          }}
                          className={CHECKBOX_CLASS}
                        />
                      </td>
                      <td className="px-3 py-2.5 truncate" title={profile.name}>
                        <span className="inline-flex items-center gap-2">
                          {profile.group_color && (
                            <span className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-white/10" style={{ backgroundColor: profile.group_color }} />
                          )}
                          <span className="text-content text-sm font-medium">{profile.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ${BROWSER_COLORS[profile.browser_type]}`}
                        >
                          {(() => {
                            const Icon = BROWSER_ICONS[profile.browser_type]
                            return <Icon className="h-3 w-3" />
                          })()}
                          {profile.browser_type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          {profile.status === 'starting' || profile.status === 'stopping' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
                          ) : profile.status === 'error' ? (
                            <span
                              className="cursor-pointer"
                              title={profileErrors[profile.id] || 'Error'}
                              onClick={(e) => {
                                e.stopPropagation()
                                clearProfileError(profile.id)
                              }}
                            >
                              <AlertCircle className="h-3.5 w-3.5 text-err shrink-0" />
                            </span>
                          ) : (
                            <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_INDICATOR[profile.status]}`} />
                          )}
                          <span className="text-muted">{STATUS_LABEL[profile.status]}</span>
                          {profile.status === 'running' && (() => {
                            const session = sessions.find(s => s.profile_id === profile.id)
                            return session ? <RunningTimer startedAt={session.started_at} /> : null
                          })()}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted text-xs truncate" title={proxy?.name}>
                        {proxy?.name ?? <span className="text-muted/40">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {profile.status === 'starting' || profile.status === 'stopping' ? (
                            <button disabled className={`${BTN_ICON} opacity-40`} aria-label="Loading">
                              <Loader2 className="h-4 w-4 animate-spin" />
                            </button>
                          ) : profile.status === 'running' ? (
                            <button
                              onClick={() => actions.stop(profile.id)}
                              className={`${BTN_ICON} text-warn hover:text-warn hover:bg-warn/10`}
                              aria-label={`Stop ${profile.name}`}
                            >
                              <Square className="h-4 w-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => actions.launch(profile.id)}
                              className={`${BTN_ICON} text-ok hover:text-ok hover:bg-ok/10`}
                              aria-label={`Launch ${profile.name}`}
                            >
                              <Play className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(profile.id)
                              addToast('ID copied', 'info')
                            }}
                            className={BTN_ICON}
                            title="Copy ID"
                          >
                            <ClipboardCopy className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => actions.duplicate(profile.id).then(() => addToast('Profile duplicated', 'success')).catch((e: Error) => addToast(e.message, 'error'))}
                            className={BTN_ICON}
                            title="Duplicate"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(profile.id, profile.name)}
                            className={BTN_DANGER}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                      {bottomPad > 0 && <tr style={{ height: bottomPad }}><td colSpan={6} /></tr>}
                    </>
                  )
                })()}
              </tbody>
            </table>
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="absolute bottom-5 left-5 right-5 flex items-center gap-3 bg-card border border-edge rounded-2xl px-5 py-3.5 shadow-2xl z-20 animate-scaleIn">
            <span className="text-sm text-content font-semibold">{selectedIds.size} selected</span>
            <div className="flex-1" />
            <button
              onClick={async () => {
                try { await api.bulkLaunch(Array.from(selectedIds)) } catch { /* best effort */ }
                setSelectedIds(new Set())
                fetchProfiles()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-ok/12 text-ok hover:bg-ok/20 ring-1 ring-ok/20 transition-colors"
            >
              <Play className="h-3.5 w-3.5" /> Launch
            </button>
            <button
              onClick={async () => {
                try { await api.bulkStop(Array.from(selectedIds)) } catch { /* best effort */ }
                setSelectedIds(new Set())
                fetchProfiles()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-warn/12 text-warn hover:bg-warn/20 ring-1 ring-warn/20 transition-colors"
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete Profiles',
                  message: `Delete ${selectedIds.size} selected profiles? This cannot be undone.`,
                  confirmLabel: 'Delete All',
                  danger: true
                })
                if (!ok) return
                try { await api.bulkDelete(Array.from(selectedIds)) } catch { /* best effort */ }
                setSelectedIds(new Set())
                setPanelMode(null)
                setSelectedId(null)
                fetchProfiles()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-err/12 text-err hover:bg-err/20 ring-1 ring-err/20 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded-lg p-1 text-muted hover:text-content hover:bg-elevated transition-colors ml-1"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Context menu */}
        {ctxMenu && (() => {
          const profile = profiles.find(p => p.id === ctxMenu.profileId)
          if (!profile) return null
          const menuY = Math.min(ctxMenu.y, window.innerHeight - 340)
          const menuX = Math.min(ctxMenu.x, window.innerWidth - 180)
          return (
            <div
              className="fixed z-50 bg-card border border-edge rounded-xl shadow-2xl py-1.5 min-w-[170px] text-sm animate-scaleIn"
              style={{ left: menuX, top: menuY }}
            >
              {profile.status === 'running' ? (
                <button
                  onClick={() => { actions.stop(profile.id); setCtxMenu(null) }}
                  className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-warn transition-colors flex items-center gap-2.5"
                  style={{ width: 'calc(100% - 4px)' }}
                >
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              ) : (
                <button
                  onClick={() => { actions.launch(profile.id); setCtxMenu(null) }}
                  className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-ok transition-colors flex items-center gap-2.5"
                  style={{ width: 'calc(100% - 4px)' }}
                >
                  <Play className="h-3.5 w-3.5" /> Launch
                </button>
              )}
              <button
                onClick={() => { handleRowClick(profile.id); setCtxMenu(null) }}
                className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-content transition-colors flex items-center gap-2.5"
                style={{ width: 'calc(100% - 4px)' }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
              <button
                onClick={() => { actions.duplicate(profile.id).then(() => addToast('Profile duplicated', 'success')).catch((e: Error) => addToast(e.message, 'error')); setCtxMenu(null) }}
                className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-content transition-colors flex items-center gap-2.5"
                style={{ width: 'calc(100% - 4px)' }}
              >
                <Copy className="h-3.5 w-3.5" /> Duplicate
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(profile.id); addToast('ID copied', 'info'); setCtxMenu(null) }}
                className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-content transition-colors flex items-center gap-2.5"
                style={{ width: 'calc(100% - 4px)' }}
              >
                <ClipboardCopy className="h-3.5 w-3.5" /> Copy ID
              </button>
              {profile.status === 'running' && (
                <>
                  <div className="border-t border-edge my-1 mx-2" />
                  <button
                    onClick={() => { handleExportCookies(profile.id, 'json'); setCtxMenu(null) }}
                    className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-content transition-colors flex items-center gap-2.5"
                    style={{ width: 'calc(100% - 4px)' }}
                  >
                    <Download className="h-3.5 w-3.5" /> Export Cookies
                  </button>
                  <button
                    onClick={() => { handleImportCookies(profile.id); setCtxMenu(null) }}
                    className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-content transition-colors flex items-center gap-2.5"
                    style={{ width: 'calc(100% - 4px)' }}
                  >
                    <Upload className="h-3.5 w-3.5" /> Import Cookies
                  </button>
                  <button
                    onClick={() => { handleCopyCdpInfo(profile.id); setCtxMenu(null) }}
                    className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-accent transition-colors flex items-center gap-2.5"
                    style={{ width: 'calc(100% - 4px)' }}
                  >
                    <Terminal className="h-3.5 w-3.5" /> Copy CDP Endpoint
                  </button>
                  <button
                    onClick={() => { handleScreenshot(profile.id); setCtxMenu(null) }}
                    className="w-full text-left px-3 py-2 hover:bg-elevated rounded-lg mx-0.5 text-content transition-colors flex items-center gap-2.5"
                    style={{ width: 'calc(100% - 4px)' }}
                  >
                    <Camera className="h-3.5 w-3.5" /> Screenshot
                  </button>
                </>
              )}
              <div className="border-t border-edge my-1 mx-2" />
              <button
                onClick={() => { handleDelete(profile.id, profile.name); setCtxMenu(null) }}
                className="w-full text-left px-3 py-2 hover:bg-err/10 rounded-lg mx-0.5 text-err transition-colors flex items-center gap-2.5"
                style={{ width: 'calc(100% - 4px)' }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            </div>
          )
        })()}
      </div>

      {/* Right: editor panel */}
      {panelMode && (
        <div className="w-[38%] min-w-[340px] max-w-[460px] shrink-0 border-l border-edge bg-card overflow-hidden flex flex-col animate-slideInRight">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-edge shrink-0">
            <h2 className="text-sm font-semibold text-content">
              {panelMode === 'create' ? 'New Profile' : 'Edit Profile'}
            </h2>
            <button onClick={handlePanelCancel} className={BTN_ICON} aria-label="Close panel">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <ProfileEditorPanel
              key={panelMode === 'edit' ? selectedId : '__new__'}
              profileId={panelMode === 'edit' ? selectedId : null}
              onSave={handlePanelSave}
              onCancel={handlePanelCancel}
            />
          </div>
        </div>
      )}
    </div>
  )
}
