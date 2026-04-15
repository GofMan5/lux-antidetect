import { useState, useEffect } from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { Users, Globe, Settings, Shield, Download, RefreshCw } from 'lucide-react'

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
      <div className="px-3 py-1.5 bg-accent/15 border-t border-accent/30">
        <div className="flex items-center gap-2 text-[11px] text-accent">
          <Download className="h-3 w-3 animate-pulse" />
          <span>Downloading update… {downloading}%</span>
        </div>
        <div className="mt-1 h-1 rounded-full bg-surface overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${downloading}%` }}
          />
        </div>
      </div>
    )
  }

  if (!updateReady) return null

  return (
    <div className="px-3 py-1.5 bg-accent/15 border-t border-accent/30">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-accent">v{updateReady} ready</span>
        <button
          onClick={() => window.api.installUpdate()}
          className="flex items-center gap-1 text-[11px] font-medium text-accent hover:text-white transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Restart
        </button>
      </div>
    </div>
  )
}

export function Layout(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="w-[180px] shrink-0 bg-surface-alt border-r border-edge flex flex-col">
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-edge">
          <Shield className="h-5 w-5 text-accent shrink-0" />
          <span className="text-sm font-bold tracking-tight text-content">
            Lux Antidetect
          </span>
        </div>
        <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-2 py-2 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors ${
                  isActive
                    ? 'bg-accent text-white'
                    : 'text-muted hover:bg-elevated hover:text-content'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <UpdateBanner />
        <div className="px-4 py-2.5 text-[11px] text-muted border-t border-edge">
          Lux v1.0.0
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-hidden bg-surface flex flex-col">
        <Outlet />
      </main>
    </div>
  )
}
