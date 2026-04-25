import { useEffect, useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { LayoutGrid, Globe, Settings, Shield, ChevronLeft, ChevronRight, Keyboard, Search } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { NotificationCenter } from './NotificationCenter'
import { UpdateNotification } from './UpdateNotification'
import { useKeyboardShortcutsStore } from './KeyboardShortcutsHelp'
import { useCommandPaletteStore } from './CommandPalette'
import { useProfilesStore } from '../stores/profiles'

const NAV_ITEMS = [
  { to: '/profiles', label: 'Profiles', icon: LayoutGrid },
  { to: '/proxies', label: 'Proxies', icon: Globe },
  { to: '/settings', label: 'Settings', icon: Settings }
] as const

const SIDEBAR_COLLAPSED_KEY = 'lux:sidebar-collapsed'
const AUTO_COLLAPSE_BREAKPOINT_PX = 1100

function readPersistedCollapsed(): boolean | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (raw === null) return null
    return raw === '1'
  } catch { return null }
}

export function Layout(): React.JSX.Element {
  // Initial state honors the user's last manual choice; if they never
  // touched the toggle, fall back to viewport-based auto-collapse so
  // small windows don't open with a 240px sidebar eating half the chrome.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const persisted = readPersistedCollapsed()
    if (persisted !== null) return persisted
    return typeof window !== 'undefined' && window.innerWidth < AUTO_COLLAPSE_BREAKPOINT_PX
  })

  // Track whether the user has explicitly chosen — once they have, the
  // auto-collapse rule stops interfering.
  const [userOverrode, setUserOverrode] = useState<boolean>(() => readPersistedCollapsed() !== null)

  useEffect(() => {
    if (userOverrode) return
    const mq = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_BREAKPOINT_PX - 1}px)`)
    const apply = (matches: boolean): void => setCollapsed(matches)
    apply(mq.matches)
    const handler = (e: MediaQueryListEvent): void => apply(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [userOverrode])

  const toggleCollapsed = (): void => {
    setCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0') } catch { /* ignore */ }
      setUserOverrode(true)
      return next
    })
  }

  const showShortcuts = useKeyboardShortcutsStore((s) => s.show)
  const showPalette = useCommandPaletteStore((s) => s.show)
  const location = useLocation()
  const runningCount = useProfilesStore(
    (s) => s.profiles.filter((p) => p.status === 'running' || p.status === 'starting').length
  )

  return (
    <div className="flex h-screen w-screen min-w-[900px] min-h-[600px] overflow-hidden bg-surface">
      {/* Sidebar — surface-lit with a faint vertical gradient for depth */}
      <aside
        className={cn(
          'shrink-0 flex flex-col border-r border-edge/60 relative z-30',
          'bg-surface-alt',
          // Faint gradient: lighter at top, darker at bottom — gives the
          // sidebar a subtle "stood up" feel against the flatter main pane.
          'bg-gradient-to-b from-[rgba(255,255,255,0.014)] to-transparent',
          'transition-[width] duration-200 ease-[var(--ease-osmosis)]',
          collapsed ? 'w-[72px]' : 'w-[224px]'
        )}
      >
        {/* Brand row — drag region for the frameless window */}
        <div
          className={cn(
            'drag-region flex items-center shrink-0 h-[52px] border-b border-edge/40',
            collapsed ? 'justify-center px-0' : 'gap-3 px-4'
          )}
        >
          <div className={cn(
            'no-drag h-9 w-9 rounded-[--radius-md] flex items-center justify-center shrink-0',
            'bg-accent/12 ring-1 ring-inset ring-accent/15',
            'shadow-[0_0_18px_var(--color-accent-glow)]'
          )}>
            <Shield className="h-[18px] w-[18px] text-accent" strokeWidth={2.2} />
          </div>
          {!collapsed && (
            <div className="flex flex-col leading-tight select-none">
              <span className="text-[13px] font-bold tracking-[0.04em] text-content">LUX</span>
              <span className="text-[9.5px] font-medium tracking-[0.18em] text-muted/70 uppercase">Antidetect</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-2 py-3 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const showRunningBadge = to === '/profiles' && runningCount > 0
            const link = (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-[--radius-md] py-2 text-[13px] font-medium',
                    'transition-[background-color,color,box-shadow] duration-150 ease-[var(--ease-osmosis)]',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted hover:bg-elevated/50 hover:text-content'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Active left bar — gold rod with a small glow */}
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent shadow-[0_0_8px_var(--color-accent)]"
                      />
                    )}
                    <span className="relative shrink-0">
                      <Icon
                        className="h-[18px] w-[18px] transition-transform duration-150 ease-[var(--ease-osmosis)] group-hover:scale-105"
                        strokeWidth={isActive ? 2.2 : 1.9}
                      />
                      {showRunningBadge && collapsed && (
                        <span
                          className={cn(
                            'absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full',
                            'bg-ok text-[#0a0b0d] text-[9px] font-bold leading-none',
                            'flex items-center justify-center px-1 ring-2 ring-surface-alt'
                          )}
                          aria-label={`${runningCount} running`}
                        >
                          {runningCount > 9 ? '9+' : runningCount}
                        </span>
                      )}
                    </span>
                    {!collapsed && (
                      <span className="flex-1 flex items-center justify-between">
                        {label}
                        {showRunningBadge && (
                          <span
                            className="flex items-center gap-1 text-[10px] font-semibold text-ok bg-ok/10 ring-1 ring-inset ring-ok/15 rounded-full px-1.5 py-0.5"
                            aria-label={`${runningCount} running`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
                            {runningCount}
                          </span>
                        )}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            )
            return collapsed ? (
              <Tooltip key={to} content={label} side="right">{link}</Tooltip>
            ) : link
          })}
        </nav>

        {/* Bottom controls */}
        <div className="flex flex-col gap-1 px-2 pb-2">
          <div className={collapsed ? 'flex justify-center' : ''}>
            <NotificationCenter />
          </div>

          {/* Quick find — opens command palette */}
          {(() => {
            const btn = (
              <button
                onClick={showPalette}
                className={cn(
                  'rounded-[--radius-md] p-2.5 text-muted hover:text-content hover:bg-elevated/50',
                  'transition-[background-color,color] duration-150 ease-[var(--ease-osmosis)]',
                  'flex items-center gap-2',
                  collapsed ? 'justify-center' : ''
                )}
                aria-label="Open command palette"
              >
                <Search className="h-4 w-4" strokeWidth={1.9} />
                {!collapsed && (
                  <span className="flex-1 flex items-center justify-between text-xs">
                    Quick find
                    <span className="flex items-center gap-0.5 text-muted/70">
                      <kbd className="px-1 py-0.5 rounded-[--radius-sm] border border-edge bg-surface/60 text-[10px] font-mono">Ctrl</kbd>
                      <kbd className="px-1 py-0.5 rounded-[--radius-sm] border border-edge bg-surface/60 text-[10px] font-mono">K</kbd>
                    </span>
                  </span>
                )}
              </button>
            )
            return collapsed ? (
              <Tooltip content="Quick find (Ctrl+K)" side="right">{btn}</Tooltip>
            ) : btn
          })()}

          {/* Keyboard shortcuts discovery */}
          {(() => {
            const hint = (
              <button
                onClick={showShortcuts}
                className={cn(
                  'rounded-[--radius-md] p-2.5 text-muted hover:text-content hover:bg-elevated/50',
                  'transition-[background-color,color] duration-150 ease-[var(--ease-osmosis)]',
                  'flex items-center gap-2',
                  collapsed ? 'justify-center' : ''
                )}
                aria-label="Show keyboard shortcuts"
              >
                <Keyboard className="h-4 w-4" strokeWidth={1.9} />
                {!collapsed && (
                  <span className="flex-1 flex items-center justify-between text-xs">
                    Shortcuts
                    <kbd className="px-1.5 py-0.5 rounded-[--radius-sm] border border-edge bg-surface/60 text-[10px] font-mono">?</kbd>
                  </span>
                )}
              </button>
            )
            return collapsed ? (
              <Tooltip content="Keyboard shortcuts (?)" side="right">{hint}</Tooltip>
            ) : hint
          })()}

          {/* Collapse toggle */}
          <button
            onClick={toggleCollapsed}
            className={cn(
              'rounded-[--radius-md] p-2.5 text-muted hover:text-content hover:bg-elevated/50',
              'transition-[background-color,color] duration-150 ease-[var(--ease-osmosis)]',
              'flex items-center gap-2',
              collapsed ? 'justify-center' : ''
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" strokeWidth={1.9} />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" strokeWidth={1.9} />
                <span className="text-xs">Collapse</span>
              </>
            )}
          </button>

          {/* Version badge */}
          {!collapsed && (
            <div className="mt-1 pt-2 px-3 border-t border-edge/30 flex items-center gap-2 text-[10px] text-muted/60 font-mono tracking-wide">
              <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_var(--color-ok)]" aria-hidden />
              <span>LUX v{__APP_VERSION__}</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main pane — keyed by pathname so route transitions get a clean
          fade-in. Slight bottom-right ambient highlight gives the canvas
          a feel of being lit from the corner. */}
      <main
        key={location.pathname}
        className="flex-1 min-w-0 overflow-y-auto bg-surface flex flex-col animate-fadeIn relative"
      >
        <Outlet />
      </main>

      <UpdateNotification />
    </div>
  )
}
