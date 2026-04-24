import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { create } from 'zustand'
import { Activity, ChevronUp, ChevronDown, Square, Pencil, Globe, Globe2, X } from 'lucide-react'
import { useProfilesStore } from '../stores/profiles'
import { useToastStore } from './Toast'
import type { BrowserType, SessionInfo } from '../lib/types'
import { cn } from '../lib/utils'

// ─── Store ────────────────────────────────────────────────────────────────

interface DockStore {
  /** Whether the user has manually collapsed the dock. When a new session
   *  starts we reset this to false so the dock reveals itself again. */
  collapsed: boolean
  /** Whether the dock is entirely hidden (user dismissed it). Resets when
   *  running sessions transitions 0 → N. */
  hidden: boolean
  setCollapsed: (v: boolean) => void
  setHidden: (v: boolean) => void
}

export const useDockStore = create<DockStore>((set) => ({
  collapsed: false,
  hidden: false,
  setCollapsed: (collapsed) => set({ collapsed }),
  setHidden: (hidden) => set({ hidden })
}))

// ─── Helpers ──────────────────────────────────────────────────────────────

const BROWSER_ICONS: Record<BrowserType, typeof Globe> = {
  chromium: Globe,
  firefox: Globe,
  edge: Globe2
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m < 60) return `${m}m ${sec.toString().padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return `${h}h ${rem.toString().padStart(2, '0')}m`
}

// ─── Component ────────────────────────────────────────────────────────────

export function RunningSessionsDock(): React.JSX.Element | null {
  const collapsed = useDockStore((s) => s.collapsed)
  const hidden = useDockStore((s) => s.hidden)
  const setCollapsed = useDockStore((s) => s.setCollapsed)
  const setHidden = useDockStore((s) => s.setHidden)

  const navigate = useNavigate()
  const { profiles, sessions, openEditor, stopBrowser } = useProfilesStore(
    useShallow((s) => ({
      profiles: s.profiles,
      sessions: s.sessions,
      openEditor: s.openEditor,
      stopBrowser: s.stopBrowser
    }))
  )
  const addToast = useToastStore((s) => s.addToast)

  // A session row is worth showing only if the profile it references is
  // still present AND actually in a running/starting state. This filters
  // out ghost sessions that lag behind a stale refetch.
  const rows = useMemo(() => {
    const profileMap = new Map(profiles.map((p) => [p.id, p]))
    const items: { session: SessionInfo; name: string; browserType: BrowserType; status: string }[] = []
    for (const s of sessions) {
      const p = profileMap.get(s.profile_id)
      if (!p) continue
      if (p.status !== 'running' && p.status !== 'starting') continue
      items.push({ session: s, name: p.name, browserType: p.browser_type, status: p.status })
    }
    // Newest first.
    items.sort((a, b) => b.session.started_at.localeCompare(a.session.started_at))
    return items
  }, [profiles, sessions])

  // Re-render once per second to refresh duration labels. Scoped to the
  // dock component so it doesn't thrash other views.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (rows.length === 0) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [rows.length])

  // If sessions just appeared while the dock was hidden, re-reveal it so
  // the user can always see their running state. Tracked via a ref-like
  // counter so we don't fight with explicit dismiss clicks.
  const [prevCount, setPrevCount] = useState(rows.length)
  useEffect(() => {
    if (rows.length > prevCount && hidden) {
      setHidden(false)
    }
    setPrevCount(rows.length)
  }, [rows.length, prevCount, hidden, setHidden])

  if (rows.length === 0 || hidden) return null

  async function handleStop(profileId: string, name: string): Promise<void> {
    try {
      await stopBrowser(profileId)
      addToast(`${name} stopped`, 'info', { duration: 2500 })
    } catch (err) {
      addToast(`Stop failed: ${err instanceof Error ? err.message : 'unknown'}`, 'error')
    }
  }

  function handleOpen(profileId: string): void {
    navigate('/profiles')
    openEditor('edit', profileId)
  }

  return (
    <aside
      aria-label="Running sessions"
      // Bottom-centre: sidebar width varies, toast column owns bottom-right,
      // so centring horizontally keeps the dock clear of both regardless of
      // collapse state.
      style={{ left: '50%', transform: 'translateX(-50%)' }}
      className="fixed bottom-3 z-[260] w-[420px] max-w-[calc(100vw-24px)] rounded-[--radius-xl] border border-edge/80 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/50 animate-fadeIn overflow-hidden"
    >
      {/* Header — always visible, acts as the collapse toggle. */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-edge/60">
        <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ok/15 text-ok">
          <Activity className="h-3.5 w-3.5" />
          <span
            className="absolute inset-0 rounded-full border border-ok/40 animate-ping opacity-70"
            aria-hidden
          />
        </span>
        <button
          className="flex-1 min-w-0 text-left"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          <div className="text-[12px] font-semibold text-content leading-tight">
            {rows.length} running session{rows.length === 1 ? '' : 's'}
          </div>
          <div className="text-[10px] text-muted font-mono tabular-nums leading-tight">
            {rows.slice(0, 3).map((r) => r.name).join(' · ')}
            {rows.length > 3 && ` · +${rows.length - 3}`}
          </div>
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-[--radius-sm] p-1 text-muted hover:text-content hover:bg-elevated/50 transition-colors"
          aria-label={collapsed ? 'Expand dock' : 'Collapse dock'}
        >
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => setHidden(true)}
          className="rounded-[--radius-sm] p-1 text-muted hover:text-content hover:bg-elevated/50 transition-colors"
          aria-label="Hide dock"
          title="Hide until next session starts"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* Body — session rows. Hidden when collapsed. */}
      {!collapsed && (
        <ul className="max-h-[220px] overflow-y-auto divide-y divide-edge/40">
          {rows.map(({ session, name, browserType, status }) => {
            const Icon = BROWSER_ICONS[browserType] ?? Globe
            const elapsed = now - new Date(session.started_at).getTime()
            const isStarting = status === 'starting'
            return (
              <li
                key={session.profile_id}
                className="group flex items-center gap-3 px-3 py-2 hover:bg-elevated/40 transition-colors"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted" />
                <button
                  onClick={() => handleOpen(session.profile_id)}
                  className="flex-1 min-w-0 text-left"
                  title="Open profile editor"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-content">{name}</span>
                    {isStarting && (
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-warn bg-warn/10 rounded-full px-1.5 py-0.5">
                        Starting
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted font-mono">
                    <span className="tabular-nums">{formatDuration(elapsed)}</span>
                    <span className="text-muted/60">•</span>
                    <span className="capitalize">{browserType}</span>
                    <span className="text-muted/60">•</span>
                    <span>pid {session.pid}</span>
                  </div>
                </button>
                <button
                  onClick={() => handleOpen(session.profile_id)}
                  className={cn(
                    'opacity-0 group-hover:opacity-100 transition-opacity',
                    'rounded-[--radius-sm] p-1.5 text-muted hover:text-content hover:bg-elevated'
                  )}
                  aria-label={`Open ${name}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleStop(session.profile_id, name)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-[--radius-sm] px-2 py-1 text-[11px] font-semibold text-err border border-err/30 hover:bg-err/10 transition-colors"
                  aria-label={`Stop ${name}`}
                >
                  <Square className="h-3 w-3" />
                  Stop
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
