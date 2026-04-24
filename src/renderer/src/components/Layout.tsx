import { useState } from 'react'
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

export function Layout(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const showShortcuts = useKeyboardShortcutsStore((s) => s.show)
  const showPalette = useCommandPaletteStore((s) => s.show)
  const location = useLocation()
  // Running-session count from the profiles store — drives a live badge on
  // the Profiles nav item so you can see active browsers at a glance from
  // anywhere in the app.
  const runningCount = useProfilesStore(
    (s) => s.profiles.filter((p) => p.status === 'running' || p.status === 'starting').length
  )

  return (
    <div className="flex h-screen w-screen min-w-[900px] min-h-[600px] overflow-hidden bg-surface">
      {/* Sidebar */}
      <aside
        className={cn(
          'shrink-0 flex flex-col border-r border-edge/60',
          'bg-surface-alt',
          'transition-all duration-300 ease-out relative z-30',
          collapsed ? 'w-[68px]' : 'w-[240px]'
        )}
      >
        {/* Drag region / Brand area */}
        <div
          className={cn(
            'drag-region flex items-center shrink-0 h-[52px] border-b border-edge/40',
            collapsed ? 'justify-center px-0' : 'gap-3 px-4'
          )}
        >
          <div className="no-drag h-9 w-9 rounded-[--radius-md] bg-accent/12 flex items-center justify-center shrink-0 shadow-[0_0_16px_var(--color-accent-glow)]">
            <Shield className="h-[18px] w-[18px] text-accent" />
          </div>
          {!collapsed && (
            <span className="text-sm font-extrabold tracking-tight text-content select-none">
              LUX
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-2 py-4 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const showRunningBadge = to === '/profiles' && runningCount > 0
            const link = (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-[--radius-md] py-2 text-[13px] font-medium',
                    'transition-all duration-150 ease-out',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    isActive
                      ? 'bg-accent/15 text-accent shadow-[inset_0_0_0_1px_var(--color-accent-glow)]'
                      : 'text-muted hover:bg-elevated hover:text-content'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Active left bar indicator — taller and glowing */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
                    )}
                    <div className="relative shrink-0">
                      <Icon className="h-[18px] w-[18px] transition-transform group-hover:scale-110 group-focus-visible:scale-110" />
                      {showRunningBadge && collapsed && (
                        <span
                          className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-ok text-white text-[9px] font-bold flex items-center justify-center px-1 ring-2 ring-surface-alt shadow-[0_0_6px_var(--color-ok)]"
                          aria-label={`${runningCount} running`}
                        >
                          {runningCount > 9 ? '9+' : runningCount}
                        </span>
                      )}
                    </div>
                    {!collapsed && (
                      <span className="flex-1 flex items-center justify-between">
                        {label}
                        {showRunningBadge && (
                          <span
                            className="flex items-center gap-1 text-[10px] font-semibold text-ok bg-ok/10 rounded-full px-1.5 py-0.5"
                            aria-label={`${runningCount} running`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_var(--color-ok)]" aria-hidden />
                            {runningCount}
                          </span>
                        )}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            )

            if (collapsed) {
              return (
                <Tooltip key={to} content={label} side="right">
                  {link}
                </Tooltip>
              )
            }

            return link
          })}
        </nav>

        {/* Bottom area */}
        <div className="flex flex-col gap-1 px-2 pb-2">
          {/* Notifications */}
          <div className={collapsed ? 'flex justify-center' : ''}>
            <NotificationCenter />
          </div>

          {/* Quick find — opens the command palette. Pairs with Ctrl+K. */}
          {(() => {
            const btn = (
              <button
                onClick={showPalette}
                className={cn(
                  'rounded-[--radius-md] p-2.5 text-muted hover:text-content hover:bg-elevated/50',
                  'transition-all duration-200 flex items-center gap-2',
                  collapsed ? 'justify-center' : ''
                )}
                aria-label="Open command palette"
              >
                <Search className="h-4 w-4" />
                {!collapsed && (
                  <span className="flex-1 flex items-center justify-between text-xs">
                    Quick find
                    <span className="flex items-center gap-0.5 text-muted/70">
                      <kbd className="px-1 py-0.5 rounded-[--radius-sm] border border-edge bg-surface text-[10px] font-mono">Ctrl</kbd>
                      <kbd className="px-1 py-0.5 rounded-[--radius-sm] border border-edge bg-surface text-[10px] font-mono">K</kbd>
                    </span>
                  </span>
                )}
              </button>
            )
            return collapsed ? (
              <Tooltip content="Quick find (Ctrl+K)" side="right">
                {btn}
              </Tooltip>
            ) : btn
          })()}

          {/* Keyboard shortcuts discovery — visible affordance for `?` */}
          {(() => {
            const hint = (
              <button
                onClick={showShortcuts}
                className={cn(
                  'rounded-[--radius-md] p-2.5 text-muted hover:text-content hover:bg-elevated/50',
                  'transition-all duration-200 flex items-center gap-2',
                  collapsed ? 'justify-center' : ''
                )}
                aria-label="Show keyboard shortcuts"
              >
                <Keyboard className="h-4 w-4" />
                {!collapsed && (
                  <span className="flex-1 flex items-center justify-between text-xs">
                    Shortcuts
                    <kbd className="px-1.5 py-0.5 rounded-[--radius-sm] border border-edge bg-surface text-[10px] font-mono">?</kbd>
                  </span>
                )}
              </button>
            )
            return collapsed ? (
              <Tooltip content="Keyboard shortcuts (?)" side="right">
                {hint}
              </Tooltip>
            ) : hint
          })()}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'rounded-[--radius-md] p-2.5 text-muted hover:text-content hover:bg-elevated/50',
              'transition-all duration-200 flex items-center gap-2',
              collapsed ? 'justify-center' : ''
            )}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
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

      {/* Main content — keyed on pathname so route changes trigger a fresh
          fade-in, smoothing the hop between pages. */}
      <main
        key={location.pathname}
        className="flex-1 min-w-0 overflow-y-auto bg-surface flex flex-col animate-fadeIn"
      >
        <Outlet />
      </main>

      <UpdateNotification />
    </div>
  )
}
