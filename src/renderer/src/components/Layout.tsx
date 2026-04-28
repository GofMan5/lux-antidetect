import { useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutGrid,
  Globe,
  Settings,
  Shield,
  Keyboard,
  Search,
  FileText,
  User,
  ExternalLink,
  Bot,
  Workflow
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import {
  Tooltip,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Separator,
  Toaster
} from '@renderer/components/ui'
import { NotificationCenter } from './NotificationCenter'
import { UpdateNotification } from './UpdateNotification'
import { useKeyboardShortcutsStore } from './KeyboardShortcutsHelp'
import { useCommandPaletteStore } from './CommandPalette'
import { useProfilesStore } from '../stores/profiles'
import { FEATURE_AI_ENABLED, FEATURE_TEMPLATES_ENABLED } from '../lib/features'

// ─── Constants ─────────────────────────────────────────────────────────────

const TOPBAR_HEIGHT_PX = 56
// Sidebar width — 216px holds the icon column (a 48-wide brand zone on the
// top bar) plus a label column wide enough for "Templates" without truncation
// at the default font scale. Brand row is locked to this same width so the
// shield sits flush with the rail's icon column underneath.
const SIDEBAR_WIDTH_PX = 208
// Width of the icon column inside the sidebar — also drives BrandMark's
// shield zone so the shield is vertically centered on the rail icons below.
const SIDEBAR_ICON_COL_PX = 48
const LEFTRAIL_ICON_SIZE_PX = 18

// LocalStorage key from the previous collapsible-sidebar design. Kept here
// only so we can clear it on mount — the new shell isn't collapsible.
const LEGACY_SIDEBAR_KEY = 'lux:sidebar-collapsed'

// External project links surfaced in the account popover. Hoisted so the
// canonical URL lives in one place; if the team renames the GitHub repo,
// only this constant needs to change.
const PROJECT_REPO_URL = 'https://github.com/GofMan5/lux-antidetect'

interface RailItem {
  to: string
  label: string
  icon: typeof LayoutGrid
  shortcut: string
  /**
   * When true, the item is rendered but disabled (route doesn't exist yet).
   * Tooltip surfaces the "Coming in iteration 2" copy.
   */
  comingSoon?: boolean
}

const RAIL_ITEMS: RailItem[] = [
  { to: '/profiles', label: 'Profiles', icon: LayoutGrid, shortcut: 'G P' },
  { to: '/proxies', label: 'Proxies', icon: Globe, shortcut: 'G X' },
  { to: '/automation', label: 'Automation', icon: Workflow, shortcut: 'G B' },
  ...(FEATURE_AI_ENABLED ? [{ to: '/ai', label: 'AI', icon: Bot, shortcut: 'G A' }] : []),
  ...(FEATURE_TEMPLATES_ENABLED
    ? [{ to: '/templates', label: 'Templates', icon: FileText, shortcut: '', comingSoon: true }]
    : []),
  { to: '/settings', label: 'Settings', icon: Settings, shortcut: 'G S' }
]

// Detected once; cosmetic ⌘K vs Ctrl K rendering only.
function getMetaKeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
}

// ─── Sub-components ────────────────────────────────────────────────────────

function BrandMark(): React.JSX.Element {
  return (
    <NavLink
      to="/profiles"
      className={cn(
        'no-drag flex items-center h-full select-none',
        'transition-opacity duration-150 ease-[var(--ease-osmosis)] hover:opacity-90'
      )}
      aria-label="Lux home"
    >
      {/*
       * Shield zone — width matches the sidebar's icon column so the shield
       * is vertically centered on the rail icons directly below.
       */}
      <div
        className="flex items-center justify-center shrink-0"
        style={{ width: SIDEBAR_ICON_COL_PX }}
      >
        <div
          className={cn(
            'h-8 w-8 rounded-[--radius-md] flex items-center justify-center',
            'bg-primary/12 ring-1 ring-inset ring-primary/20',
            'shadow-[0_0_18px_rgba(59,130,246,0.18)]'
          )}
        >
          <Shield className="h-4 w-4 text-primary" strokeWidth={2.2} />
        </div>
      </div>
      {/* Wordmark — sits to the right of the icon-column-aligned shield zone. */}
      <div className="flex flex-col leading-none pr-3">
        <span className="text-[13px] font-bold tracking-[0.04em] text-foreground">LUX</span>
        <span className="text-[9px] font-medium tracking-[0.18em] text-muted-foreground/70 uppercase mt-0.5">
          Antidetect
        </span>
      </div>
    </NavLink>
  )
}

interface TopBarSearchTriggerProps {
  onClick: () => void
}

function TopBarSearchTrigger({ onClick }: TopBarSearchTriggerProps): React.JSX.Element {
  const meta = getMetaKeyLabel()
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'no-drag group relative w-full max-w-[460px] h-9 rounded-[--radius-md]',
        'flex items-center gap-2 pl-3 pr-2 text-left',
        'bg-input border border-border',
        'transition-colors duration-150 ease-[var(--ease-osmosis)]',
        'hover:border-edge/80 hover:bg-input/80',
        'focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/15'
      )}
      aria-label="Open command palette"
    >
      <Search className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="flex-1 text-[12.5px] text-muted-foreground/80 truncate">
        Search profiles, proxies, actions…
      </span>
      <span className="flex items-center gap-0.5 shrink-0">
        <kbd
          className={cn(
            'h-5 min-w-[18px] px-1 inline-flex items-center justify-center',
            'rounded-[--radius-sm] border border-border bg-card/80',
            'text-[10px] font-mono text-muted-foreground'
          )}
        >
          {meta}
        </kbd>
        <kbd
          className={cn(
            'h-5 min-w-[18px] px-1 inline-flex items-center justify-center',
            'rounded-[--radius-sm] border border-border bg-card/80',
            'text-[10px] font-mono text-muted-foreground'
          )}
        >
          K
        </kbd>
      </span>
    </button>
  )
}

interface TopBarIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

function TopBarIconButton({
  label,
  className,
  children,
  ...rest
}: TopBarIconButtonProps): React.JSX.Element {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          'no-drag h-9 w-9 inline-flex items-center justify-center rounded-[--radius-md]',
          'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
          'transition-colors duration-150 ease-[var(--ease-osmosis)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          className
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function AccountMenu(): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className={cn(
            'no-drag h-9 w-9 inline-flex items-center justify-center rounded-full',
            'bg-elevated/60 ring-1 ring-inset ring-border',
            'text-foreground hover:bg-elevated hover:ring-edge/80',
            'transition-colors duration-150 ease-[var(--ease-osmosis)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
          )}
        >
          <User className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="p-3 pb-2">
          <p className="text-[12px] font-medium text-foreground">Lux Antidetect</p>
          <p className="text-[10.5px] text-muted-foreground/80 mt-0.5">
            Local-only, no cloud sync
          </p>
        </div>
        <Separator />
        <div className="p-1.5">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className={cn(
              'w-full inline-flex items-center gap-2 rounded-[--radius-sm] px-2.5 py-1.5',
              'text-[12.5px] text-foreground hover:bg-elevated/60',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]'
            )}
          >
            <Settings className="h-3.5 w-3.5 text-muted-foreground" />
            Settings
          </button>
          <a
            href={PROJECT_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'w-full inline-flex items-center gap-2 rounded-[--radius-sm] px-2.5 py-1.5',
              'text-[12.5px] text-foreground hover:bg-elevated/60',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]'
            )}
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
            Project repository
          </a>
        </div>
        <Separator />
        <div className="px-3 py-2 flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/70">
          <span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_var(--color-ok)]" aria-hidden />
          <span>LUX v{__APP_VERSION__}</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface TopBarProps {
  onOpenPalette: () => void
  onOpenShortcuts: () => void
}

function TopBar({ onOpenPalette, onOpenShortcuts }: TopBarProps): React.JSX.Element {
  return (
    <header
      className={cn(
        'drag-region shrink-0 flex items-stretch',
        'border-b border-border/45 bg-background/90 backdrop-blur-md',
        'relative z-30 shadow-[0_1px_0_rgba(255,255,255,0.025)]'
      )}
      style={{ height: TOPBAR_HEIGHT_PX }}
    >
      {/* Brand sits flush against screen-left so the shield zone (SIDEBAR_ICON_COL_PX wide)
          aligns vertically with the sidebar's icon column below. */}
      <div className="no-drag flex items-center shrink-0">
        <BrandMark />
      </div>

      {/*
       * Drag region — empty middle gutter is draggable, search trigger is no-drag.
       * The search button caps at 360px so visible drag gutters remain on each
       * side at the layout's hard 900px minimum width.
       */}
      <div className="flex-1 flex items-center justify-center min-w-0 px-3">
        <div className="w-full max-w-[520px]">
          <TopBarSearchTrigger onClick={onOpenPalette} />
        </div>
      </div>

      <div className="no-drag flex items-center gap-1 shrink-0 pr-2">
        <NotificationCenter />
        <TopBarIconButton label="Keyboard shortcuts (?)" onClick={onOpenShortcuts}>
          <Keyboard className="h-4 w-4" strokeWidth={1.9} />
        </TopBarIconButton>
        <AccountMenu />
      </div>
    </header>
  )
}

interface LeftRailItemProps {
  item: RailItem
  runningCount: number
}

// Renders icon column (fixed width = SIDEBAR_ICON_COL_PX) + label + optional
// trailing element (running-count pill or shortcut hint). Same shell across
// nav links, coming-soon buttons, so every row has the same bounding box.
function LeftRailItemBody({
  Icon,
  active,
  label,
  trailing
}: {
  Icon: typeof LayoutGrid
  active: boolean
  label: string
  trailing?: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <span
        className="flex items-center justify-center shrink-0"
        style={{ width: SIDEBAR_ICON_COL_PX - 12 /* row uses px-1.5 */ }}
      >
        <Icon
          style={{ width: LEFTRAIL_ICON_SIZE_PX, height: LEFTRAIL_ICON_SIZE_PX }}
          strokeWidth={active ? 2.1 : 1.85}
        />
      </span>
      <span className="flex-1 truncate text-[13px] font-medium leading-none">{label}</span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </>
  )
}

function LeftRailItem({ item, runningCount }: LeftRailItemProps): React.JSX.Element {
  const Icon = item.icon
  const isProfiles = item.to === '/profiles'
  const showRunningBadge = isProfiles && runningCount > 0

  // Shared row shell — fixed height so rows align and active-rail strip on
  // the left has a known length.
  const itemBaseClass = cn(
    'group relative flex items-center gap-1 h-11 mx-2 px-1.5',
    'rounded-[--radius-md] transition-colors duration-150 ease-[var(--ease-osmosis)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
  )

  // Coming-soon — non-navigating button using the same shell as the NavLinks.
  if (item.comingSoon) {
    return (
      <Tooltip content={`${item.label} — Coming in iteration 2`} side="right">
        <button
          type="button"
          aria-disabled="true"
          aria-label={item.label}
          tabIndex={0}
          className={cn(
            itemBaseClass,
            'text-muted-foreground/40 cursor-not-allowed'
          )}
        >
          <LeftRailItemBody
            Icon={Icon}
            active={false}
            label={item.label}
            trailing={
              <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50 mr-1">
                soon
              </span>
            }
          />
        </button>
      </Tooltip>
    )
  }

  const runningPill = showRunningBadge ? (
    <span
      className={cn(
        'mr-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
        'bg-ok/10 ring-1 ring-inset ring-ok/20',
        'text-[10px] font-semibold text-ok leading-none'
      )}
      aria-label={`${runningCount} running`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
      {runningCount > 99 ? '99+' : runningCount}
    </span>
  ) : null

  const shortcutHint = !showRunningBadge && item.shortcut ? (
    <span
      className={cn(
        'mr-1 rounded-[--radius-sm] border border-border/60 bg-background/30 px-1 py-0.5',
        'font-mono text-[9px] leading-none text-muted-foreground/55 opacity-0',
        'transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100'
      )}
    >
      {item.shortcut}
    </span>
  ) : null

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          itemBaseClass,
          isActive
            ? 'bg-elevated/70 text-foreground ring-1 ring-inset ring-primary/20'
            : 'text-muted-foreground hover:bg-elevated/45 hover:text-foreground'
        )
      }
      aria-label={item.label}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-primary"
            />
          )}
          <LeftRailItemBody
            Icon={Icon}
            active={isActive}
            label={item.label}
            trailing={runningPill ?? shortcutHint}
          />
        </>
      )}
    </NavLink>
  )
}

interface LeftRailProps {
  runningCount: number
}

function LeftRail({ runningCount }: LeftRailProps): React.JSX.Element {
  return (
    <nav
      aria-label="Primary navigation"
      className={cn(
        'shrink-0 flex flex-col bg-background/80 border-r border-border/45',
        'relative z-20 shadow-[1px_0_0_rgba(255,255,255,0.025)]'
      )}
      style={{ width: SIDEBAR_WIDTH_PX }}
    >
      <div className="flex flex-col gap-0.5 py-3 flex-1">
        {RAIL_ITEMS.map((item) => (
          <LeftRailItem key={item.to} item={item} runningCount={runningCount} />
        ))}
      </div>
    </nav>
  )
}

// ─── Layout ────────────────────────────────────────────────────────────────

export function Layout(): React.JSX.Element {
  const showShortcuts = useKeyboardShortcutsStore((s) => s.show)
  const showPalette = useCommandPaletteStore((s) => s.show)
  const location = useLocation()
  const runningCount = useProfilesStore((s) => s.runningCount)

  // Drop the legacy persisted collapsed-sidebar key from previous design.
  // Best-effort — silently ignore storage errors.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_SIDEBAR_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <div className="flex flex-col h-screen w-screen min-w-[900px] min-h-[600px] overflow-hidden bg-background text-foreground">
      <TopBar onOpenPalette={showPalette} onOpenShortcuts={showShortcuts} />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <LeftRail runningCount={runningCount} />

        {/* Keyed by pathname so route transitions get a clean fade. */}
        <main
          key={location.pathname}
          className="flex-1 min-w-0 overflow-y-auto app-workspace flex flex-col animate-fadeIn relative"
        >
          <Outlet />
        </main>
      </div>

      <UpdateNotification />
      <Toaster />
    </div>
  )
}
