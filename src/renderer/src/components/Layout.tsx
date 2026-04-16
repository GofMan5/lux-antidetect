import { useState } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { LayoutGrid, Globe, Settings, Shield, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { NotificationCenter } from './NotificationCenter'
import { UpdateNotification } from './UpdateNotification'

const NAV_ITEMS = [
  { to: '/profiles', label: 'Profiles', icon: LayoutGrid },
  { to: '/proxies', label: 'Proxies', icon: Globe },
  { to: '/settings', label: 'Settings', icon: Settings }
] as const

export function Layout(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen w-screen min-w-[900px] min-h-[600px] overflow-hidden bg-surface">
      {/* Sidebar */}
      <aside
        className={cn(
          'shrink-0 flex flex-col border-r border-edge/60',
          'bg-surface-alt/80 backdrop-blur-xl',
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
        <nav aria-label="Main navigation" className="flex flex-col gap-1 px-2 py-4 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const link = (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-3 rounded-[--radius-md] py-2.5 text-[13px] font-medium transition-all duration-200',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted hover:bg-elevated/50 hover:text-content'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Active left bar indicator */}
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent" />
                    )}
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {!collapsed && <span>{label}</span>}
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
            <div className="px-3 py-2 text-[10px] text-muted/40 border-t border-edge/30 font-mono tracking-wide">
              v{__APP_VERSION__}
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto bg-surface flex flex-col">
        <Outlet />
      </main>

      <UpdateNotification />
    </div>
  )
}
