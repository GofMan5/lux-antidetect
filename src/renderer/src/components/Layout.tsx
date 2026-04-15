import { Outlet, NavLink } from 'react-router-dom'
import { Users, Globe, Settings, Shield } from 'lucide-react'

const NAV_ITEMS = [
  { to: '/profiles', label: 'Profiles', icon: Users },
  { to: '/proxies', label: 'Proxies', icon: Globe },
  { to: '/settings', label: 'Settings', icon: Settings }
] as const

export function Layout(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="w-[56px] hover:w-[170px] group shrink-0 bg-surface-alt border-r border-edge flex flex-col transition-all duration-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 min-h-[44px]">
          <Shield className="h-5 w-5 text-accent shrink-0" />
          <span className="text-base font-bold tracking-tight text-content whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            Lux
          </span>
        </div>
        <nav aria-label="Main navigation" className="flex flex-col gap-0.5 px-1.5 flex-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={label}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors whitespace-nowrap overflow-hidden ${
                  isActive
                    ? 'bg-accent text-white'
                    : 'text-muted hover:bg-elevated hover:text-content'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                {label}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-2 text-[10px] text-muted border-t border-edge whitespace-nowrap overflow-hidden">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            Lux v1.0.0
          </span>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-hidden bg-surface flex flex-col">
        <Outlet />
      </main>
    </div>
  )
}
