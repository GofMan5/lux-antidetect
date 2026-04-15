import { useEffect, useMemo, useState } from 'react'
import { Plus, Play, Square, Copy, Trash2, Loader2, X, AlertCircle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProfilesStore } from '../stores/profiles'
import { useProxiesStore } from '../stores/proxies'
import { ProfileEditorPanel } from './ProfileEditorPage'
import { BTN_PRIMARY, BTN_ICON, BTN_DANGER } from '../lib/ui'
import { api } from '../lib/api'
import type { BrowserType, ProfileStatus } from '../lib/types'

const BROWSER_COLORS: Record<BrowserType, string> = {
  chromium: 'bg-blue-500/20 text-blue-400',
  firefox: 'bg-orange-500/20 text-orange-400',
  edge: 'bg-cyan-500/20 text-cyan-400'
}

const STATUS_INDICATOR: Record<ProfileStatus, string> = {
  ready: 'bg-ok',
  starting: 'bg-accent animate-pulse',
  running: 'bg-warn animate-pulse',
  stopping: 'bg-muted animate-pulse',
  error: 'bg-err'
}

const STATUS_LABEL: Record<ProfileStatus, string> = {
  ready: 'Ready',
  starting: 'Starting...',
  running: 'Running',
  stopping: 'Stopping...',
  error: 'Error'
}

export function ProfilesPage(): React.JSX.Element {
  const profiles = useProfilesStore((s) => s.profiles)
  const loading = useProfilesStore((s) => s.loading)
  const profileErrors = useProfilesStore((s) => s.profileErrors)
  const fetchProfiles = useProfilesStore((s) => s.fetchProfiles)
  const fetchSessions = useProfilesStore((s) => s.fetchSessions)
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

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelMode, setPanelMode] = useState<'edit' | 'create' | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [groupFilter, setGroupFilter] = useState<string>('all')

  useEffect(() => {
    fetchProfiles()
    fetchSessions()
    fetchProxies()
  }, [fetchProfiles, fetchSessions, fetchProxies])

  const proxyMap = useMemo(() => new Map(proxies.map((p) => [p.id, p])), [proxies])

  const groups = useMemo(() => {
    const set = new Set(profiles.filter(p => p.group_name).map(p => p.group_name!))
    return Array.from(set).sort()
  }, [profiles])

  const filteredProfiles = useMemo(() => {
    if (groupFilter === 'all') return profiles
    return profiles.filter(p => p.group_name === groupFilter)
  }, [profiles, groupFilter])

  const handleDelete = (id: string, name: string): void => {
    if (window.confirm(`Delete profile "${name}"?`)) {
      actions.delete(id).then(() => {
        if (selectedId === id) {
          setSelectedId(null)
          setPanelMode(null)
        }
      })
    }
  }

  const handleRowClick = (id: string): void => {
    setSelectedId(id)
    setPanelMode('edit')
  }

  const handleNewProfile = (): void => {
    setSelectedId(null)
    setPanelMode('create')
  }

  const handlePanelSave = (): void => {
    fetchProfiles()
    setPanelMode(null)
    setSelectedId(null)
  }

  const handlePanelCancel = (): void => {
    setPanelMode(null)
    setSelectedId(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Left: profiles table */}
      <div className="flex-1 flex flex-col p-3 overflow-hidden min-w-0 relative">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <h1 className="text-lg font-bold text-content truncate">Profiles</h1>
          <button onClick={handleNewProfile} className={`${BTN_PRIMARY} shrink-0`}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New</span>
          </button>
        </div>

        {/* Group filter */}
        {groups.length > 0 && (
          <div className="flex items-center gap-2 mb-1.5 shrink-0">
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="rounded border border-edge bg-surface-alt px-2 py-0.5 text-xs text-content"
            >
              <option value="all">All Groups</option>
              {groups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <span className="text-xs text-muted">{filteredProfiles.length} profiles</span>
          </div>
        )}

        {filteredProfiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center">
            <p className="text-muted mb-3 text-sm">No profiles yet</p>
            <button onClick={handleNewProfile} className={BTN_PRIMARY}>
              Create Profile
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-auto rounded-md border border-edge min-h-0">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-[32px]" />
                <col className="w-[28%]" />
                <col className="w-[14%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[26%]" />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-edge bg-surface-alt">
                  <th className="px-1 py-1.5 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === filteredProfiles.length && filteredProfiles.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(filteredProfiles.map(p => p.id)))
                        } else {
                          setSelectedIds(new Set())
                        }
                      }}
                      className="h-3 w-3 rounded border-edge accent-accent"
                    />
                  </th>
                  <th className="text-left px-2 py-1.5 font-medium text-muted text-xs">Name</th>
                  <th className="text-left px-2 py-1.5 font-medium text-muted text-xs">Browser</th>
                  <th className="text-left px-2 py-1.5 font-medium text-muted text-xs">Status</th>
                  <th className="text-left px-2 py-1.5 font-medium text-muted text-xs">Proxy</th>
                  <th className="text-right px-2 py-1.5 font-medium text-muted text-xs">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((profile) => {
                  const proxy = proxyMap.get(profile.proxy_id ?? '')
                  const isSelected = selectedId === profile.id && panelMode === 'edit'
                  return (
                    <tr
                      key={profile.id}
                      onClick={() => handleRowClick(profile.id)}
                      className={`border-b border-edge last:border-b-0 cursor-pointer transition-colors ${
                        isSelected ? 'bg-accent/10' : 'hover:bg-elevated'
                      }`}
                    >
                      <td className="px-1 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(profile.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) next.add(profile.id)
                            else next.delete(profile.id)
                            setSelectedIds(next)
                          }}
                          className="h-3 w-3 rounded border-edge accent-accent"
                        />
                      </td>
                      <td className="px-2 py-1.5 truncate" title={profile.name}>
                        <span className="inline-flex items-center gap-1.5">
                          {profile.group_color && (
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: profile.group_color }} />
                          )}
                          <span className="text-content text-sm">{profile.name}</span>
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${BROWSER_COLORS[profile.browser_type]}`}
                        >
                          {profile.browser_type}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="inline-flex items-center gap-1 text-[11px]">
                          {profile.status === 'starting' || profile.status === 'stopping' ? (
                            <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />
                          ) : profile.status === 'error' ? (
                            <span
                              className="cursor-pointer"
                              title={profileErrors[profile.id] || 'Error'}
                              onClick={(e) => {
                                e.stopPropagation()
                                clearProfileError(profile.id)
                              }}
                            >
                              <AlertCircle className="h-3 w-3 text-err shrink-0" />
                            </span>
                          ) : (
                            <span
                              className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_INDICATOR[profile.status]}`}
                            />
                          )}
                          {STATUS_LABEL[profile.status]}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-muted text-xs truncate" title={proxy?.name}>
                        {proxy?.name ?? '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <div
                          className="flex items-center justify-end gap-0.5 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {profile.status === 'starting' || profile.status === 'stopping' ? (
                            <button
                              disabled
                              className={`${BTN_ICON} opacity-50`}
                              aria-label="Loading"
                            >
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            </button>
                          ) : profile.status === 'running' ? (
                            <button
                              onClick={() => actions.stop(profile.id)}
                              className={`${BTN_ICON} text-warn`}
                              aria-label={`Stop ${profile.name}`}
                            >
                              <Square className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => actions.launch(profile.id)}
                              className={`${BTN_ICON} text-ok`}
                              aria-label={`Launch ${profile.name}`}
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => actions.duplicate(profile.id)}
                            className={BTN_ICON}
                            aria-label={`Duplicate ${profile.name}`}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(profile.id, profile.name)}
                            className={BTN_DANGER}
                            aria-label={`Delete ${profile.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 bg-elevated border border-edge rounded-lg px-3 py-2 shadow-lg z-20">
            <span className="text-xs text-content font-medium">{selectedIds.size} selected</span>
            <div className="flex-1" />
            <button
              onClick={async () => {
                await api.bulkLaunch(Array.from(selectedIds))
                setSelectedIds(new Set())
                fetchProfiles()
              }}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-ok/20 text-ok hover:bg-ok/30 transition-colors"
            >
              <Play className="h-3 w-3" /> Launch
            </button>
            <button
              onClick={async () => {
                await api.bulkStop(Array.from(selectedIds))
                setSelectedIds(new Set())
                fetchProfiles()
              }}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-warn/20 text-warn hover:bg-warn/30 transition-colors"
            >
              <Square className="h-3 w-3" /> Stop
            </button>
            <button
              onClick={async () => {
                if (!window.confirm(`Delete ${selectedIds.size} profiles?`)) return
                await api.bulkDelete(Array.from(selectedIds))
                setSelectedIds(new Set())
                setPanelMode(null)
                setSelectedId(null)
                fetchProfiles()
              }}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium bg-err/20 text-err hover:bg-err/30 transition-colors"
            >
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Right: editor panel — flexible width, min/max constrained */}
      {panelMode && (
        <div className="w-[36%] min-w-[300px] max-w-[420px] shrink-0 border-l border-edge bg-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-end px-2 pt-2 shrink-0">
            <button
              onClick={handlePanelCancel}
              className={BTN_ICON}
              aria-label="Close panel"
            >
              <X className="h-3.5 w-3.5" />
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
