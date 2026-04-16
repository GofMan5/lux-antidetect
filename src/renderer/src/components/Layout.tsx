import { useState, useEffect } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Users, Globe, Settings, Shield, Download, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { NotificationCenter } from './NotificationCenter'

const NAV_ITEMS = [
  { to: '/profiles', label: 'Profiles', icon: Users },
  { to: '/proxies', label: 'Proxies', icon: Globe },
  { to: '/settings', label: 'Settings', icon: Settings }
] as const

function UpdateBanner(): React.JSX.Element | null {
  const [updateReady, setUpdateReady] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<number | null>(null)

  useEffect(() => {
    const unsubs = [
      window.api.onUpdateAvailable(() => setDownloading(0)),
      window.api.onUpdateProgress((data) => setDownloading(data.percent)),
      window.api.onUpdateDownloaded((data) => {
        setDownloading(null)
        setUpdateReady(data.version)
      })
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [])

  if (downloading !== null) {
    return (
      <div className="mx-2 mb-1 rounded-lg bg-accent/10 border border-accent/20 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-accent font-medium">
          <Download className="h-3.5 w-3.5 animate-pulse" />
          <span>Updating… {Math.round(downloading)}%</span>
        </div>
        <div className="mt-1.5 h-1 rounded-full bg-surface overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${Math.round(downloading)}%` }}
          />
        </div>
      </div>
    )
  }

  if (!updateReady) return null

  return (
    <div className="mx-2 mb-1 rounded-lg bg-accent/10 border border-accent/20 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-accent font-medium">v{updateReady} ready</span>
        <button
          onClick={() => window.api.installUpdate()}
          className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:text-white transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Restart
        </button>
      </div>
    </div>
  )
}

export function Layout(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside
        className={`${collapsed ? 'w-[56px]' : 'w-[200px]'} shrink-0 bg-surface-alt border-r border-edge flex flex-col transition-all duration-200 ease-out`}
      >
        {/* Brand */}
        <div className={`flex items-center ${collapsed ? 'justify-center' : ''} gap-2.5 px-3 h-14 border-b border-edge shrink-0`}>
          <div className="h-8 w-8 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
            <Shield className="h-4.5 w-4.5 text-accent" />
          </div>
          {!collapsed && (
            <span className="text-[13px] font-bold tracking-tight text-content">
              Lux
            </span>
          )}
        </div>

        {/* Navigation */}
        <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-2 py-3 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `group relative flex items-center ${collapsed ? 'justify-center' : ''} gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-accent/15 text-accent shadow-sm'
                    : 'text-muted hover:bg-elevated hover:text-content'
                }`
              }
              title={collapsed ? label : undefined}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && label}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 rounded-md bg-elevated border border-edge text-xs text-content font-medium opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 shadow-lg">
                  {label}
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Notification bell */}
        <div className={`px-2 mb-1 ${collapsed ? 'flex justify-center' : ''}`}>
          <NotificationCenter />
        </div>

        <UpdateBanner />

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="mx-2 mb-2 rounded-lg p-2 text-muted hover:text-content hover:bg-elevated transition-all duration-150 flex items-center justify-center"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {!collapsed && (
          <div className="px-3 py-2.5 text-[10px] text-muted/50 border-t border-edge font-mono">
            v1.0.6
          </div>
        )}
      </aside>

      <main className="flex-1 min-w-0 overflow-hidden bg-surface flex flex-col">
        <Outlet />
      </main>
    </div>
  )
}
