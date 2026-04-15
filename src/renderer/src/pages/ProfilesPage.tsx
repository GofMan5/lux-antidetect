import { useEffect, useMemo, useState } from 'react'
import { Plus, Play, Square, Copy, Trash2, Loader2, X, AlertCircle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useProfilesStore } from '../stores/profiles'
import { useProxiesStore } from '../stores/proxies'
import { ProfileEditorPanel } from './ProfileEditorPage'
import { BTN_PRIMARY, BTN_ICON, BTN_DANGER, SELECT_CLASS, CHECKBOX_CLASS } from '../lib/ui'
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
      <div className="flex-1 flex flex-col p-4 overflow-hidden min-w-0 relative">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-content">Profiles</h1>
            <span className="text-xs text-muted bg-surface-alt px-2 py-0.5 rounded-full">
              {filteredProfiles.length}
            </span>
          </div>
          <button onClick={handleNewProfile} className={BTN_PRIMARY}>
            <Plus className="h-4 w-4" />
            New Profile
          </button>
        </div>

        {/* Group filter */}
        {groups.length > 0 && (
          <div className="flex items-center gap-2 mb-2 shrink-0">
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className={`${SELECT_CLASS} w-auto min-w-[140px]`}
            >
              <option value="all">All Groups</option>
              {groups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        )}

        {filteredProfiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center">
            <div className="bg-card rounded-xl p-8 border border-edge">
              <p className="text-muted mb-4 text-sm">No profiles yet</p>
              <button onClick={handleNewProfile} className={BTN_PRIMARY}>
                <Plus className="h-4 w-4" />
                Create Profile
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto rounded-lg border border-edge min-h-0 bg-card/30">
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
                <tr className="border-b border-edge bg-surface-alt">
                  <th className="px-2 py-2.5 w-9">
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
                      className={CHECKBOX_CLASS}
                    />
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Name</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Browser</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Status</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Proxy</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted text-xs uppercase tracking-wide">Actions</th>
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
                      className={`border-b border-edge/50 last:border-b-0 cursor-pointer transition-colors ${
                        isSelected ? 'bg-accent/10' : 'hover:bg-elevated/50'
                      }`}
                    >
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
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
                      <td className="px-3 py-2 truncate" title={profile.name}>
                        <span className="inline-flex items-center gap-2">
                          {profile.group_color && (
                            <span className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-white/10" style={{ backgroundColor: profile.group_color }} />
                          )}
                          <span className="text-content text-sm font-medium">{profile.name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${BROWSER_COLORS[profile.browser_type]}`}
                        >
                          {profile.browser_type}
                        </span>
                      </td>
                      <td className="px-3 py-2">
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
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${STATUS_INDICATOR[profile.status]}`}
                            />
                          )}
                          <span className="text-muted">{STATUS_LABEL[profile.status]}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted text-xs truncate" title={proxy?.name}>
                        {proxy?.name ?? <span className="text-muted/50">None</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div
                          className="flex items-center justify-end gap-1 shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {profile.status === 'starting' || profile.status === 'stopping' ? (
                            <button
                              disabled
                              className={`${BTN_ICON} opacity-50`}
                              aria-label="Loading"
                            >
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
                            onClick={() => actions.duplicate(profile.id)}
                            className={BTN_ICON}
                            aria-label={`Duplicate ${profile.name}`}
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(profile.id, profile.name)}
                            className={BTN_DANGER}
                            aria-label={`Delete ${profile.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
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
          <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3 bg-card border border-edge rounded-xl px-4 py-3 shadow-2xl z-20">
            <span className="text-sm text-content font-medium">{selectedIds.size} selected</span>
            <div className="flex-1" />
            <button
              onClick={async () => {
                await api.bulkLaunch(Array.from(selectedIds))
                setSelectedIds(new Set())
                fetchProfiles()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-ok/15 text-ok hover:bg-ok/25 transition-colors"
            >
              <Play className="h-3.5 w-3.5" /> Launch
            </button>
            <button
              onClick={async () => {
                await api.bulkStop(Array.from(selectedIds))
                setSelectedIds(new Set())
                fetchProfiles()
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-warn/15 text-warn hover:bg-warn/25 transition-colors"
            >
              <Square className="h-3.5 w-3.5" /> Stop
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
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-err/15 text-err hover:bg-err/25 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded-md p-1 text-muted hover:text-content hover:bg-elevated transition-colors ml-1"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Right: editor panel */}
      {panelMode && (
        <div className="w-[38%] min-w-[340px] max-w-[460px] shrink-0 border-l border-edge bg-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-edge shrink-0">
            <h2 className="text-sm font-semibold text-content">
              {panelMode === 'create' ? 'New Profile' : 'Edit Profile'}
            </h2>
            <button
              onClick={handlePanelCancel}
              className={BTN_ICON}
              aria-label="Close panel"
            >
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
