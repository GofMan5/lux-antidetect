/**
 * ProxiesPage — Vault iter-2.
 *
 * Rewritten on canonical shadcn/Radix primitives + Vault tokens. The proxy
 * editor and bulk-import surfaces are viewport-responsive `Sheet`s with
 * dirty-state-aware ESC / overlay-click handling, the table dropped
 * `role="grid"` for a flat virtualized list, and density / sort / group
 * filter chrome runs through canonical `SelectRoot`. The standalone IP
 * fraud-check stays in a centred `Dialog` since it's transactional, not an
 * editor.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type Ref
} from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus,
  Trash2,
  FlaskConical,
  Pencil,
  Loader2,
  Upload,
  Globe,
  MoreHorizontal,
  Copy,
  ClipboardPaste,
  Check,
  ShieldCheck,
  ShieldAlert,
  Shield,
  RefreshCw,
  Filter,
  Rows3,
  Rows2,
  X,
  FileUp,
  CheckSquare
} from 'lucide-react'
import { useProxiesStore } from '../stores/proxies'
import { useConfirmStore } from '../components/ConfirmDialog'
import { useToastStore } from '../components/Toast'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import {
  Button,
  Input,
  Label,
  Badge,
  Sheet,
  SheetContent,
  SheetTitle,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Switch,
  Select,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  EmptyState,
  SearchInput,
  DropdownMenu,
  Tooltip,
  ContextMenu
} from '../components/ui'
import { useViewportWidth } from '../hooks/useViewportWidth'
import { useReducedMotion } from '../hooks/useReducedMotion'
import type { DropdownMenuItem } from '../components/ui'
import type {
  ProxyProtocol,
  ProxyResponse,
  ProxyInput,
  FraudRisk,
  IpFraudReport
} from '../lib/types'

// ──────────────────────────────────────────────────────────────────────────
// Schema & defaults
// ──────────────────────────────────────────────────────────────────────────

const proxySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  protocol: z.enum(['http', 'https', 'socks4', 'socks5']),
  host: z.string().min(1, 'Host is required'),
  port: z.number().min(1).max(65535),
  username: z.string(),
  password: z.string(),
  country: z.string(),
  group_tag: z.string()
})

type ProxyFormData = z.infer<typeof proxySchema>

const DEFAULT_PROXY: ProxyFormData = {
  name: '',
  protocol: 'http',
  host: '',
  port: 8080,
  username: '',
  password: '',
  country: '',
  group_tag: ''
}

const PROTOCOL_OPTIONS: { value: ProxyProtocol; label: string }[] = [
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks4', label: 'SOCKS4' },
  { value: 'socks5', label: 'SOCKS5' }
]

const PROTOCOL_BADGE: Record<
  ProxyProtocol,
  'default' | 'success' | 'warning' | 'destructive' | 'accent'
> = {
  http: 'default',
  https: 'success',
  socks4: 'accent',
  socks5: 'warning'
}

const PROTOCOL_DEFAULT_PORT: Record<ProxyProtocol, number> = {
  http: 8080,
  https: 8443,
  socks4: 1080,
  socks5: 1080
}

const KNOWN_DEFAULT_PORTS: ReadonlySet<number> = new Set(Object.values(PROTOCOL_DEFAULT_PORT))

const QUICK_PASTE_DEBOUNCE_MS = 150
const COUNTRY_CODE_LEN = 2
const QUICK_PASTE_FILLED_MS = 2000

const QUICK_PASTE_HINT = {
  parseFail: "Couldn't parse this string",
  multiline: 'Looks like multiple proxies — use bulk import'
} as const

const PROXY_CHECK_ERROR_MESSAGES: Record<string, string> = {
  auth_failed: 'Authentication failed',
  timeout: 'Connection timed out',
  connect_refused: 'Connection refused',
  connection_reset: 'Connection reset by peer',
  socks_handshake_failed: 'SOCKS handshake failed',
  socks_auth_unsupported: 'Proxy requires an unsupported SOCKS auth method',
  unexpected_status: 'Proxy returned an unexpected response',
  protocol_error: 'Proxy protocol error',
  cert_invalid: 'Proxy TLS certificate is invalid',
  dns_error: 'Could not resolve proxy host',
  unknown_error: 'Unknown proxy error'
}

// ── Layout ────────────────────────────────────────────────────────────────

type Density = 'compact' | 'comfortable'
type StatusFilterValue = 'all' | 'working' | 'failed' | 'untested'
type ProtocolFilterValue = 'all' | ProxyProtocol
type ReputationFilterValue = 'all' | NonNullable<FraudRisk> | 'unchecked'
type SortKey = 'name' | 'last_check' | 'created_at' | 'fraud_score'
type SortDir = 'asc' | 'desc'

const ROW_HEIGHT_BY_DENSITY: Record<Density, number> = {
  compact: 40,
  comfortable: 56
}

const DENSITY_STORAGE_KEY = 'lux.proxies.density'
const SORT_STORAGE_KEY = 'lux.proxies.sort'
const EDITOR_SHEET_WIDTH_PX = 640
const IMPORT_SHEET_WIDTH_PX = 640
// Floor for the editor / import Sheets on cramped viewports — below this
// the two-column form starts wrapping in awkward ways.
const EDITOR_SHEET_MIN_WIDTH_PX = 420
// Pixels of list / chrome the user should still see behind the Sheet so
// they retain spatial context on the layout's hard 900px minimum.
const EDITOR_SHEET_CONTEXT_RESERVE_PX = 360
const BULK_FLOATER_CLEARANCE_PX = 64

// Speed thresholds (ms). Anything faster than `fast` is green;
// `fast..slow` is amber; ≥ `slow` is red.
const SPEED_FAST_MS = 500
const SPEED_SLOW_MS = 1500

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function statusBadge(
  proxy: ProxyResponse
): { variant: 'success' | 'destructive' | 'muted'; label: string } {
  if (proxy.last_check === null) return { variant: 'muted', label: 'Untested' }
  return proxy.check_ok
    ? { variant: 'success', label: 'Working' }
    : { variant: 'destructive', label: 'Failed' }
}

function countryFlag(code: string): string {
  const upper = code.toUpperCase()
  if (upper.length !== 2) return ''
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// Reputation = ensemble verdict from ip-api.com + ipapi.is over the proxy's
// external IP. The 0-100 score is bucketed into clean / low / medium / high
// / critical / unknown — see geoip.ts:combineSignals for the weights. The
// badge shows "<bucket> <score>" so the user sees both the coarse class and
// the precise number; the tooltip lists per-flag detail.
const FRAUD_BUCKET_META: Record<
  Exclude<FraudRisk, never>,
  {
    variant: 'success' | 'destructive' | 'warning' | 'outline'
    label: string
    icon: 'check' | 'alert' | 'shield'
  }
> = {
  clean: { variant: 'success', label: 'Clean', icon: 'check' },
  low: { variant: 'success', label: 'Low', icon: 'check' },
  medium: { variant: 'warning', label: 'Medium', icon: 'alert' },
  high: { variant: 'destructive', label: 'High', icon: 'alert' },
  critical: { variant: 'destructive', label: 'Critical', icon: 'alert' },
  unknown: { variant: 'outline', label: 'Unknown', icon: 'shield' }
}

// Bucket → dot tone for the row's reputation indicator (matches ProfilesPage).
const FRAUD_DOT_CLASS: Record<NonNullable<FraudRisk>, string> = {
  clean: 'bg-ok',
  low: 'bg-ok',
  medium: 'bg-warn',
  high: 'bg-destructive',
  critical: 'bg-destructive',
  unknown: 'bg-muted-foreground/60'
}

function fraudBucketIcon(name: 'check' | 'alert' | 'shield'): React.ReactNode {
  if (name === 'check') return <ShieldCheck className="h-3 w-3" />
  if (name === 'alert') return <ShieldAlert className="h-3 w-3" />
  return <Shield className="h-3 w-3" />
}

interface ReputationDescriptor {
  variant: 'success' | 'destructive' | 'warning' | 'outline'
  label: string
  icon: React.ReactNode
  tooltip: React.ReactNode
  ariaLabel: string
  dotClass: string
}

function reputationBadge(proxy: ProxyResponse): ReputationDescriptor {
  // Pre-lookup state.
  if (proxy.fraud_risk === null || proxy.last_fraud_check === null) {
    const note = 'Reputation not checked yet — click to refresh or wait for the auto-lookup to finish.'
    return {
      variant: 'outline',
      label: 'Unknown',
      icon: fraudBucketIcon('shield'),
      tooltip: <div>{note}</div>,
      ariaLabel: `Reputation: unknown. ${note}`,
      dotClass: FRAUD_DOT_CLASS.unknown
    }
  }

  const flags: string[] = []
  if (proxy.is_datacenter) flags.push('datacenter / hosting ASN')
  if (proxy.is_vpn) flags.push('known VPN')
  if (proxy.is_proxy_detected) flags.push('listed in known-proxy databases')
  if (proxy.is_tor) flags.push('Tor exit node')
  if (proxy.is_abuser) flags.push('past abuse history')
  if (proxy.is_mobile) flags.push('mobile carrier (low-risk)')

  const lines: React.ReactNode[] = []
  if (proxy.external_ip)
    lines.push(
      <div key="ip">
        <span className="text-muted-foreground">IP</span>{' '}
        <span className="font-mono">{proxy.external_ip}</span>
      </div>
    )
  if (proxy.isp)
    lines.push(
      <div key="isp">
        <span className="text-muted-foreground">ISP</span> {proxy.isp}
      </div>
    )
  if (proxy.asn)
    lines.push(
      <div key="asn">
        <span className="text-muted-foreground">ASN</span>{' '}
        <span className="font-mono">{proxy.asn}</span>
        {proxy.asn_type ? ` (${proxy.asn_type})` : ''}
      </div>
    )
  if (proxy.abuse_score !== null)
    lines.push(
      <div key="abuse">
        <span className="text-muted-foreground">Abuse</span> {(proxy.abuse_score * 100).toFixed(1)}%
      </div>
    )
  lines.push(
    <div key="flags">
      <span className="text-muted-foreground">Flags</span>{' '}
      {flags.length > 0 ? flags.join(', ') : 'none'}
    </div>
  )
  if (proxy.fraud_providers.length > 0)
    lines.push(
      <div key="src" className="text-muted-foreground/70 text-[11px]">
        via {proxy.fraud_providers.join(' + ')}
      </div>
    )

  const meta = FRAUD_BUCKET_META[proxy.fraud_risk]
  const score = proxy.fraud_score ?? 0
  const tooltip = <div className="space-y-0.5 leading-snug">{lines}</div>
  const ariaLabel = `Reputation: ${meta.label}, score ${score} of 100. Flags: ${
    flags.length > 0 ? flags.join(', ') : 'none'
  }.`

  return {
    variant: meta.variant,
    label:
      proxy.fraud_risk === 'unknown'
        ? 'Unknown'
        : `${meta.label} ${score}`,
    icon: fraudBucketIcon(meta.icon),
    tooltip,
    ariaLabel,
    dotClass: FRAUD_DOT_CLASS[proxy.fraud_risk]
  }
}

function readDensityFromStorage(): Density {
  try {
    const raw = localStorage.getItem(DENSITY_STORAGE_KEY)
    if (raw === 'compact' || raw === 'comfortable') return raw
  } catch {
    /* ignore */
  }
  return 'compact'
}

function readSortFromStorage(): { key: SortKey; dir: SortDir } {
  try {
    const raw = localStorage.getItem(SORT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { key?: string; dir?: string }
      const key: SortKey =
        parsed.key === 'name' ||
        parsed.key === 'last_check' ||
        parsed.key === 'created_at' ||
        parsed.key === 'fraud_score'
          ? parsed.key
          : 'created_at'
      const dir: SortDir = parsed.dir === 'asc' ? 'asc' : 'desc'
      return { key, dir }
    }
  } catch {
    /* ignore */
  }
  return { key: 'created_at', dir: 'desc' }
}

function compareProxies(a: ProxyResponse, b: ProxyResponse, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1
  if (key === 'name') {
    return sign * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  }
  if (key === 'fraud_score') {
    const av = a.fraud_score
    const bv = b.fraud_score
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    return av < bv ? -sign : av > bv ? sign : 0
  }
  // last_check is nullable — null sorts to end regardless of direction.
  if (key === 'last_check') {
    const av = a.last_check ?? ''
    const bv = b.last_check ?? ''
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return av < bv ? -sign : av > bv ? sign : 0
  }
  // created_at
  const av = a.created_at ?? ''
  const bv = b.created_at ?? ''
  return av < bv ? -sign : av > bv ? sign : 0
}

// ──────────────────────────────────────────────────────────────────────────
// FilterChip — same visual contract as ProfilesPage
// ──────────────────────────────────────────────────────────────────────────

interface FilterChipProps {
  active: boolean
  onClick: () => void
  onClear?: () => void
  children: React.ReactNode
  dotClass?: string
}

// Memoized so it skips re-renders on unrelated parent updates (filter
// typing, scroll, selection drift). Memo only pays off when the parent
// passes stable handler identities — see the page's `clear*Filter` /
// `set*Filter*` `useCallback`s.
const FilterChip = memo(function FilterChip({
  active,
  onClick,
  onClear,
  children,
  dotClass
}: FilterChipProps): React.JSX.Element {
  if (active && onClear) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 h-7 rounded-full text-[11.5px] font-medium shrink-0',
          'bg-primary text-primary-foreground pl-2.5 pr-1'
        )}
      >
        {dotClass && <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotClass)} />}
        <button type="button" onClick={onClick} className="leading-none" aria-pressed="true">
          {children}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClear()
          }}
          aria-label={typeof children === 'string' ? `Clear ${children} filter` : 'Clear filter'}
          className="inline-flex items-center justify-center h-4 w-4 rounded-full hover:bg-white/15"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 h-7 rounded-full text-[11.5px] font-medium shrink-0',
        'transition-colors duration-150 ease-[var(--ease-osmosis)] px-2.5',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-transparent border border-border text-muted-foreground hover:text-foreground hover:border-edge'
      )}
    >
      {dotClass && <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotClass)} />}
      <span>{children}</span>
    </button>
  )
})

// ──────────────────────────────────────────────────────────────────────────
// ProxyRow — memoized row body
// ──────────────────────────────────────────────────────────────────────────

interface ProxyRowProps {
  proxy: ProxyResponse
  index: number
  selected: boolean
  focused: boolean
  density: Density
  isTesting: boolean
  isCheckingFraud: boolean
  errorTooltip: string | null
  /**
   * Lazy resolver: invoked when the dropdown / context menu actually opens.
   * Stable identity from the parent so the memoized row doesn't re-render
   * on every keystroke. The row memoizes its own resolved action list
   * keyed by (proxy.id, isTesting, isCheckingFraud) to keep the menu fresh.
   */
  getActionsForProxy: (
    proxy: ProxyResponse,
    isTesting: boolean,
    isCheckingFraud: boolean
  ) => DropdownMenuItem[]
  onToggleSelect: (id: string, index: number, shiftKey: boolean) => void
  onClickRow: (proxy: ProxyResponse) => void
  onContextMenu: (e: ReactMouseEvent, proxy: ProxyResponse) => void
  onRecheckFraud: (id: string) => void
  registerRef: (id: string, el: HTMLDivElement | null) => void
}

function ProxyRowComponent({
  proxy,
  index,
  selected,
  focused,
  density,
  isTesting,
  isCheckingFraud,
  errorTooltip,
  getActionsForProxy,
  onToggleSelect,
  onClickRow,
  onContextMenu,
  onRecheckFraud,
  registerRef
}: ProxyRowProps): React.JSX.Element {
  const status = statusBadge(proxy)
  const reputation = reputationBadge(proxy)
  const isComfortable = density === 'comfortable'

  // Lazy resolution: only built when something materially affecting menu
  // contents changes. The dropdown only renders its trigger upfront — the
  // menu items are forwarded to Radix and only mounted on open.
  const rowActions = useMemo(
    () => getActionsForProxy(proxy, isTesting, isCheckingFraud),
    [getActionsForProxy, proxy, isTesting, isCheckingFraud]
  )

  const refCallback = useCallback(
    (el: HTMLDivElement | null) => registerRef(proxy.id, el),
    [registerRef, proxy.id]
  )

  const speedClass =
    proxy.check_latency_ms == null
      ? 'bg-muted-foreground/60'
      : proxy.check_latency_ms < SPEED_FAST_MS
        ? 'bg-ok'
        : proxy.check_latency_ms < SPEED_SLOW_MS
          ? 'bg-warn'
          : 'bg-destructive'

  return (
    <div
      ref={refCallback}
      role="option"
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      data-proxy-id={proxy.id}
      onClick={() => onClickRow(proxy)}
      onContextMenu={(e) => onContextMenu(e, proxy)}
      className={cn(
        'group/row relative flex items-center gap-3 pl-4 pr-2 cursor-pointer select-none',
        'border-b border-border/40 transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset',
        focused ? 'bg-elevated/55' : selected ? 'bg-primary/[0.05]' : 'hover:bg-elevated/30'
      )}
      style={{ height: ROW_HEIGHT_BY_DENSITY[density] }}
    >
      {focused && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary shadow-[0_0_8px_var(--color-primary)]"
        />
      )}

      {/* Selection toggle */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`${selected ? 'Deselect' : 'Select'} proxy ${proxy.name}`}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(proxy.id, index, e.shiftKey)
        }}
        className={cn(
          'shrink-0 inline-flex items-center justify-center h-4 w-4 rounded-[--radius-sm]',
          'border bg-input transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          selected ? 'bg-primary border-primary' : 'border-edge hover:border-primary/60'
        )}
      >
        {selected && (
          <svg aria-hidden viewBox="0 0 12 12" className="h-3 w-3 text-primary-foreground">
            <path
              d="M2.5 6.5l2.5 2.5 4.5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Status pill */}
      {isTesting ? (
        <Badge variant="muted" dot className="h-5 shrink-0 min-w-[68px] justify-start tabular-nums">
          <Loader2 className="h-3 w-3 animate-spin -mr-0.5" />
          Testing
        </Badge>
      ) : errorTooltip ? (
        <Tooltip content={errorTooltip}>
          <Badge
            variant={status.variant}
            dot
            className="h-5 shrink-0 min-w-[68px] justify-start tabular-nums cursor-help"
          >
            {status.label}
          </Badge>
        </Tooltip>
      ) : (
        <Badge
          variant={status.variant}
          dot
          className="h-5 shrink-0 min-w-[68px] justify-start tabular-nums"
        >
          {status.label}
        </Badge>
      )}

      {/* Name + host (host stacks below name in comfortable; sits inline in compact) */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 leading-tight">
        <span className="font-medium text-foreground truncate">{proxy.name}</span>
        {isComfortable && (
          <span className="text-[11px] text-muted-foreground font-mono truncate">
            {proxy.host}:{proxy.port}
            {proxy.external_ip && proxy.external_ip !== proxy.host && (
              <span className="text-muted-foreground/60"> → {proxy.external_ip}</span>
            )}
          </span>
        )}
      </div>

      {/* Compact-density inline host:port — stays in name col when comfortable
          mode already stacks it. Hidden on narrow viewports. */}
      {!isComfortable && (
        <span className="hidden md:inline-flex items-center text-[11px] text-muted-foreground/80 font-mono shrink-0 max-w-[200px] truncate">
          {proxy.host}:{proxy.port}
          {proxy.external_ip && proxy.external_ip !== proxy.host && (
            <span className="text-muted-foreground/60"> → {proxy.external_ip}</span>
          )}
        </span>
      )}

      {/* Protocol badge */}
      <Badge
        variant={PROTOCOL_BADGE[proxy.protocol]}
        className="h-5 px-1.5 text-[10px] shrink-0 hidden sm:inline-flex"
      >
        {proxy.protocol.toUpperCase()}
      </Badge>

      {/* Country chip */}
      {proxy.country ? (
        <span
          role="img"
          aria-label={`Country ${proxy.country.toUpperCase()}`}
          className="hidden md:inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0 w-[52px]"
        >
          <span aria-hidden>{countryFlag(proxy.country)}</span>
          <span className="font-medium uppercase">{proxy.country.toUpperCase()}</span>
        </span>
      ) : (
        <span className="hidden md:inline-block w-[52px] text-[11px] text-muted-foreground/40 shrink-0">
          —
        </span>
      )}

      {/* Reputation — focusable trigger */}
      {isCheckingFraud ? (
        <Badge variant="muted" dot className="h-5 shrink-0 inline-flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking
        </Badge>
      ) : (
        <Tooltip content={reputation.tooltip}>
          <button
            type="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onRecheckFraud(proxy.id)
            }}
            disabled={isCheckingFraud}
            aria-label={reputation.ariaLabel}
            className={cn(
              'rounded-full shrink-0',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
            )}
          >
            <Badge
              variant={reputation.variant}
              className="h-5 px-1.5 cursor-pointer inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
            >
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', reputation.dotClass)} aria-hidden />
              {reputation.icon}
              {reputation.label}
            </Badge>
          </button>
        </Tooltip>
      )}

      {/* Speed */}
      <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums shrink-0 w-[60px]">
        {proxy.check_ok && proxy.check_latency_ms != null ? (
          <>
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', speedClass)} aria-hidden />
            <span className="text-foreground">{proxy.check_latency_ms}ms</span>
          </>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </span>

      {/* Last-check timestamp */}
      <Tooltip
        content={
          proxy.last_check ? new Date(proxy.last_check).toLocaleString() : 'Never tested'
        }
      >
        <time
          dateTime={proxy.last_check ?? undefined}
          aria-label={
            proxy.last_check
              ? `Last checked ${new Date(proxy.last_check).toLocaleString()}`
              : 'Never tested'
          }
          tabIndex={0}
          className="hidden lg:inline text-[11px] text-muted-foreground tabular-nums shrink-0 w-[64px] text-right"
        >
          {proxy.last_check ? formatShortRelative(proxy.last_check) : '—'}
        </time>
      </Tooltip>

      {/* Row dropdown */}
      <div className="flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu
          align="right"
          items={rowActions}
          trigger={
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm] text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
              aria-label="Proxy actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        />
      </div>
    </div>
  )
}

const ProxyRow = memo(ProxyRowComponent)

// Compact relative time — keeps the column narrow enough for the dense layout.
function formatShortRelative(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Math.max(0, Date.now() - t)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(days / 365)
  return `${years}y`
}

// ──────────────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────────────

export function ProxiesPage(): React.JSX.Element {
  // ── Stores ────────────────────────────────────────────────────────────
  const proxies = useProxiesStore((s) => s.proxies)
  const loading = useProxiesStore((s) => s.loading)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)
  const deleteProxy = useProxiesStore((s) => s.deleteProxy)
  const testProxy = useProxiesStore((s) => s.testProxy)
  const confirm = useConfirmStore((s) => s.show)
  const addToast = useToastStore((s) => s.addToast)

  // ── Editor / import / IP-check state ──────────────────────────────────
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [editorSaving, setEditorSaving] = useState(false)
  const [editorTesting, setEditorTesting] = useState(false)

  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [checkingFraudIds, setCheckingFraudIds] = useState<Set<string>>(new Set())

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const [importFilterFraud, setImportFilterFraud] = useState(true)
  const [importProgress, setImportProgress] = useState<
    { checked: number; total: number; risky: number } | null
  >(null)
  const [importParsed, setImportParsed] = useState<
    { ok: boolean; data?: { name: string; host: string; port: number; protocol: string } }[] | null
  >(null)

  const [ipCheckOpen, setIpCheckOpen] = useState(false)
  const [ipCheckInput, setIpCheckInput] = useState('')
  const [ipCheckLoading, setIpCheckLoading] = useState(false)
  const [ipCheckReport, setIpCheckReport] = useState<IpFraudReport | null>(null)
  const [ipCheckError, setIpCheckError] = useState<string | null>(null)

  const [bulkTesting, setBulkTesting] = useState(false)
  const [bulkRecheckingFraud, setBulkRecheckingFraud] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all')
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilterValue>('all')
  const [reputationFilter, setReputationFilter] = useState<ReputationFilterValue>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [density, setDensity] = useState<Density>(readDensityFromStorage)
  const initialSort = useMemo(readSortFromStorage, [])
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.key)
  const [sortDir, setSortDir] = useState<SortDir>(initialSort.dir)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const lastCheckedIdx = useRef<number | null>(null)

  // Quick-paste / clear-creds (in editor sheet)
  const [quickPaste, setQuickPaste] = useState('')
  const [quickPasteHint, setQuickPasteHint] = useState<string | null>(null)
  const [quickPasteMultiline, setQuickPasteMultiline] = useState(false)
  const [quickPasteParsing, setQuickPasteParsing] = useState(false)
  const [quickPasteFilled, setQuickPasteFilled] = useState(false)
  const [clearCreds, setClearCreds] = useState<{ username: boolean; password: boolean }>({
    username: false,
    password: false
  })
  const prevProtocolRef = useRef<ProxyProtocol>('http')
  const quickPasteInputRef = useRef<HTMLInputElement | null>(null)

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    proxy: ProxyResponse
  } | null>(null)

  // Row refs (roving tabindex) + bulk floater focus
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const focusedIdRef = useRef<string | null>(null)
  const registerRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      rowRefs.current.set(id, el)
      if (focusedIdRef.current === id && document.activeElement !== el) {
        el.focus({ preventScroll: true })
      }
    } else {
      rowRefs.current.delete(id)
    }
  }, [])
  const bulkFirstActionRef = useRef<HTMLButtonElement | null>(null)
  const previousSelectionSize = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // ── Form ──────────────────────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    watch,
    formState: { errors, isDirty: editorIsDirty }
  } = useForm<ProxyFormData>({
    resolver: zodResolver(proxySchema),
    defaultValues: DEFAULT_PROXY
  })

  // Honor `prefers-reduced-motion: reduce` on imperative smooth scrolls so
  // keyboard focus jumps don't animate when the user has motion turned off.
  const prefersReducedMotion = useReducedMotion()

  // ── Persist density / sort ────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(DENSITY_STORAGE_KEY, density)
    } catch {
      /* ignore */
    }
  }, [density])

  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir }))
    } catch {
      /* ignore */
    }
  }, [sortKey, sortDir])

  // ── Initial fetch ─────────────────────────────────────────────────────
  useEffect(() => {
    fetchProxies()
  }, [fetchProxies])

  // ── Auto-fraud-check events ───────────────────────────────────────────
  // Fires after createProxy in the main process. Two events:
  //   - 'metadata-checking' — toggle the row's Checking spinner
  //   - 'metadata-updated'  — refresh list and clear the spinner
  useEffect(() => {
    const offChecking = api.onProxyMetadataChecking((data) => {
      setCheckingFraudIds((prev) => new Set(prev).add(data.proxy_id))
    })
    const offUpdated = api.onProxyMetadataUpdated((data) => {
      setCheckingFraudIds((prev) => {
        const next = new Set(prev)
        next.delete(data.proxy_id)
        return next
      })
      fetchProxies()
    })
    return () => {
      offChecking()
      offUpdated()
    }
  }, [fetchProxies])

  // ── Unmount: abort any in-flight per-row loops ─────────────────────────
  // Without this, navigating away while the import / bulk-recheck loop is
  // running leaves the loop bumping setState on a torn-down component
  // (React swallows the warning in production, but the API calls keep
  // firing and creating proxies the user no longer expects).
  useEffect(() => {
    return () => {
      importAbortRef.current?.abort()
      bulkRecheckAbortRef.current?.abort()
    }
  }, [])

  // ── Derived: groups / filtered / sorted ───────────────────────────────
  const allGroups = useMemo(() => {
    const set = new Set<string>()
    for (const p of proxies) {
      if (p.group_tag) set.add(p.group_tag)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [proxies])

  const filteredProxies = useMemo(() => {
    let result = proxies

    if (statusFilter !== 'all') {
      result = result.filter((p) => {
        if (statusFilter === 'untested') return p.last_check === null
        if (statusFilter === 'working') return p.last_check !== null && p.check_ok
        return p.last_check !== null && !p.check_ok
      })
    }

    if (protocolFilter !== 'all') {
      result = result.filter((p) => p.protocol === protocolFilter)
    }

    if (reputationFilter !== 'all') {
      if (reputationFilter === 'unchecked') {
        result = result.filter((p) => p.fraud_risk === null || p.last_fraud_check === null)
      } else {
        result = result.filter(
          (p) => p.fraud_risk === reputationFilter && p.last_fraud_check !== null
        )
      }
    }

    if (groupFilter !== 'all') {
      result = result.filter((p) => (p.group_tag ?? '') === groupFilter)
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.host.toLowerCase().includes(q) ||
          p.protocol.includes(q) ||
          (p.external_ip?.toLowerCase().includes(q) ?? false) ||
          (p.country?.toLowerCase().includes(q) ?? false) ||
          (p.group_tag?.toLowerCase().includes(q) ?? false)
      )
    }

    return [...result].sort((a, b) => compareProxies(a, b, sortKey, sortDir))
  }, [proxies, statusFilter, protocolFilter, reputationFilter, groupFilter, searchQuery, sortKey, sortDir])

  // Clamp focused index when the filtered list shrinks below it.
  useEffect(() => {
    if (focusedIdx === null) return
    if (focusedIdx >= filteredProxies.length) {
      setFocusedIdx(filteredProxies.length > 0 ? filteredProxies.length - 1 : null)
    }
  }, [filteredProxies.length, focusedIdx])

  const editingProxy = useMemo(
    () => (editingId ? proxies.find((p) => p.id === editingId) ?? null : null),
    [proxies, editingId]
  )
  const editingProxyHasPassword = editingProxy?.has_password ?? false
  const editingProxyHasUsername = Boolean(editingProxy?.username)

  // ── Selection ─────────────────────────────────────────────────────────
  const handleToggleSelect = useCallback(
    (id: string, index: number, shiftKey: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (shiftKey && lastCheckedIdx.current !== null) {
          const start = Math.min(lastCheckedIdx.current, index)
          const end = Math.max(lastCheckedIdx.current, index)
          for (let i = start; i <= end; i++) {
            const p = filteredProxies[i]
            if (p) next.add(p.id)
          }
        } else {
          if (next.has(id)) next.delete(id)
          else next.add(id)
        }
        lastCheckedIdx.current = index
        return next
      })
    },
    [filteredProxies]
  )

  const handleSelectAllVisible = useCallback(() => {
    setSelected((prev) => {
      const allIds = filteredProxies.map((p) => p.id)
      const allSelected = allIds.every((id) => prev.has(id))
      if (allSelected) return new Set()
      return new Set(allIds)
    })
  }, [filteredProxies])

  // ── Focus the first bulk action on 0→>0 selection edge ────────────────
  useEffect(() => {
    const prev = previousSelectionSize.current
    const current = selected.size
    if (prev === 0 && current > 0) {
      bulkFirstActionRef.current?.focus()
    }
    previousSelectionSize.current = current
  }, [selected])

  // ── Editor open/close ─────────────────────────────────────────────────
  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingId(null)
    setEditorError(null)
    setEditorTesting(false)
    setQuickPaste('')
    setQuickPasteHint(null)
    setQuickPasteMultiline(false)
    setQuickPasteParsing(false)
    setQuickPasteFilled(false)
    setClearCreds({ username: false, password: false })
    reset(DEFAULT_PROXY)
  }, [reset])

  const openAdd = useCallback((): void => {
    reset(DEFAULT_PROXY)
    setEditingId(null)
    setEditorError(null)
    setQuickPaste('')
    setQuickPasteHint(null)
    setQuickPasteMultiline(false)
    setQuickPasteParsing(false)
    setQuickPasteFilled(false)
    setClearCreds({ username: false, password: false })
    prevProtocolRef.current = DEFAULT_PROXY.protocol
    setEditorOpen(true)
  }, [reset])

  const openEdit = useCallback(
    (proxy: ProxyResponse): void => {
      reset({
        name: proxy.name,
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username ?? '',
        password: '',
        country: proxy.country ?? '',
        group_tag: proxy.group_tag ?? ''
      })
      setEditingId(proxy.id)
      setEditorError(null)
      setQuickPaste('')
      setQuickPasteHint(null)
      setQuickPasteMultiline(false)
      setQuickPasteParsing(false)
      setQuickPasteFilled(false)
      setClearCreds({ username: false, password: false })
      prevProtocolRef.current = proxy.protocol
      setEditorOpen(true)
    },
    [reset]
  )

  // ── Protocol → default port auto-swap ─────────────────────────────────
  const watchedProtocol = watch('protocol')
  const watchedUsername = watch('username')
  const watchedPassword = watch('password')
  useEffect(() => {
    if (!editorOpen) return
    const prev = prevProtocolRef.current
    if (prev === watchedProtocol) return
    prevProtocolRef.current = watchedProtocol
    const currentPort = getValues('port')
    if (KNOWN_DEFAULT_PORTS.has(currentPort)) {
      setValue('port', PROTOCOL_DEFAULT_PORT[watchedProtocol], { shouldDirty: true })
    }
  }, [watchedProtocol, editorOpen, getValues, setValue])

  // ── Quick-paste parser ────────────────────────────────────────────────
  const applyParsedProxy = useCallback(
    (data: ProxyInput): void => {
      setValue('protocol', data.protocol, { shouldDirty: true, shouldValidate: true })
      setValue('host', data.host, { shouldDirty: true, shouldValidate: true })
      setValue('port', data.port, { shouldDirty: true, shouldValidate: true })
      setValue('username', data.username ?? '', { shouldDirty: true })
      setValue('password', data.password ?? '', { shouldDirty: true })
      if (data.name && !getValues('name')?.trim()) {
        setValue('name', data.name, { shouldDirty: true, shouldValidate: true })
      }
      prevProtocolRef.current = data.protocol
    },
    [setValue, getValues]
  )

  const runQuickPasteParse = useCallback(
    async (value: string): Promise<void> => {
      const trimmed = value.trim()
      if (!trimmed) {
        setQuickPasteHint(null)
        setQuickPasteMultiline(false)
        setQuickPasteParsing(false)
        setQuickPasteFilled(false)
        return
      }
      const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      if (lines.length >= 2) {
        setQuickPasteHint(QUICK_PASTE_HINT.multiline)
        setQuickPasteMultiline(true)
        setQuickPasteParsing(false)
        setQuickPasteFilled(false)
        return
      }
      setQuickPasteMultiline(false)
      setQuickPasteParsing(true)
      try {
        const results = await api.parseProxyString(lines[0])
        const first = results[0]
        if (first?.ok && first.data) {
          applyParsedProxy(first.data)
          setQuickPasteHint(null)
          setQuickPasteFilled(true)
        } else {
          setQuickPasteHint(QUICK_PASTE_HINT.parseFail)
          setQuickPasteFilled(false)
        }
      } catch {
        setQuickPasteHint(QUICK_PASTE_HINT.parseFail)
        setQuickPasteFilled(false)
      } finally {
        setQuickPasteParsing(false)
      }
    },
    [applyParsedProxy]
  )

  useEffect(() => {
    if (!editorOpen) return
    const timer = setTimeout(() => {
      void runQuickPasteParse(quickPaste)
    }, QUICK_PASTE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [quickPaste, editorOpen, runQuickPasteParse])

  useEffect(() => {
    if (!quickPasteFilled) return
    const t = setTimeout(() => setQuickPasteFilled(false), QUICK_PASTE_FILLED_MS)
    return () => clearTimeout(t)
  }, [quickPasteFilled])

  useEffect(() => {
    if (!editorOpen || editingId) return
    const id = window.setTimeout(() => quickPasteInputRef.current?.focus(), 50)
    return () => window.clearTimeout(id)
  }, [editorOpen, editingId])

  // ── CRUD / test handlers ──────────────────────────────────────────────
  const buildProxyInput = (data: ProxyFormData, isUpdate: boolean): ProxyInput => {
    const country = data.country.trim().toUpperCase()
    const groupTag = data.group_tag.trim()
    const username = data.username
    const password = data.password

    const resolveCred = (
      value: string,
      clearFlag: boolean
    ): string | null | undefined => {
      if (value) return value
      if (isUpdate && clearFlag) return null
      return undefined
    }

    return {
      name: data.name,
      protocol: data.protocol,
      host: data.host,
      port: data.port,
      username: resolveCred(username, clearCreds.username),
      password: resolveCred(password, clearCreds.password),
      country: country.length === COUNTRY_CODE_LEN ? country : undefined,
      group_tag: groupTag || undefined
    }
  }

  const onSubmitProxy = async (data: ProxyFormData): Promise<void> => {
    try {
      setEditorSaving(true)
      setEditorError(null)
      const input = buildProxyInput(data, Boolean(editingId))
      if (editingId) {
        await api.updateProxy(editingId, input)
      } else {
        await api.createProxy(input)
      }
      await fetchProxies()
      closeEditor()
      addToast(editingId ? 'Proxy updated' : 'Proxy created', 'success')
    } catch (err: unknown) {
      setEditorError(err instanceof Error ? err.message : 'Failed to save proxy')
    } finally {
      setEditorSaving(false)
    }
  }

  const handleDelete = useCallback(
    async (id: string, name: string): Promise<void> => {
      const ok = await confirm({
        title: 'Delete Proxy',
        message: `Delete proxy "${name}"?`,
        confirmLabel: 'Delete',
        danger: true
      })
      if (!ok) return
      try {
        await deleteProxy(id)
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        addToast('Proxy deleted', 'success')
      } catch (err) {
        addToast(`Delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
      }
    },
    [confirm, deleteProxy, addToast]
  )

  const handleTest = useCallback(
    async (id: string): Promise<void> => {
      setTestingIds((prev) => new Set(prev).add(id))
      try {
        await testProxy(id)
        await fetchProxies()
        const updated = useProxiesStore.getState().proxies.find((p) => p.id === id)
        addToast(
          updated?.check_ok ? 'Proxy test passed' : 'Proxy test failed',
          updated?.check_ok ? 'success' : 'error'
        )
      } catch {
        addToast('Proxy test failed', 'error')
      }
      setTestingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [testProxy, fetchProxies, addToast]
  )

  const handleStandaloneIpCheck = async (): Promise<void> => {
    const ip = ipCheckInput.trim()
    if (!ip) return
    setIpCheckLoading(true)
    setIpCheckError(null)
    setIpCheckReport(null)
    try {
      const report = await api.lookupFraudByIp(ip)
      if (!report) {
        setIpCheckError('No data — invalid IP, network failure, or both providers rate-limited.')
      } else {
        setIpCheckReport(report)
      }
    } catch (err) {
      setIpCheckError(err instanceof Error ? err.message : 'Check failed')
    }
    setIpCheckLoading(false)
  }

  const handleRecheckFraud = useCallback(
    async (id: string): Promise<void> => {
      let alreadyChecking = false
      setCheckingFraudIds((prev) => {
        if (prev.has(id)) {
          alreadyChecking = true
          return prev
        }
        const next = new Set(prev)
        next.add(id)
        return next
      })
      if (alreadyChecking) return

      try {
        const result = await api.lookupProxyGeo(id)
        await fetchProxies()
        if (result === null) {
          addToast('Reputation check failed — proxy may be down or rate-limited', 'error')
        } else if (result.fraud_risk === 'high') {
          addToast('Proxy IP flagged as risky (datacenter / known proxy)', 'warning')
        } else if (result.fraud_risk === 'unknown') {
          addToast('Reputation: unknown — ip-api returned no risk signals', 'info')
        } else {
          addToast('Reputation: clean', 'success')
        }
      } catch {
        addToast('Reputation check failed', 'error')
      }
      setCheckingFraudIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [fetchProxies, addToast]
  )

  // Stable wrapper passed down to memoized rows. Returns void so the row
  // doesn't have to know about the underlying Promise.
  const handleRowRecheckFraud = useCallback(
    (id: string): void => {
      void handleRecheckFraud(id)
    },
    [handleRecheckFraud]
  )

  const handleTestInEditor = async (): Promise<void> => {
    if (!editingId) return
    setEditorTesting(true)
    try {
      await testProxy(editingId)
      const updated = useProxiesStore.getState().proxies.find((p) => p.id === editingId)
      addToast(
        updated?.check_ok ? 'Proxy test passed' : 'Proxy test failed',
        updated?.check_ok ? 'success' : 'error'
      )
    } catch (err) {
      addToast(`Test failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    } finally {
      setEditorTesting(false)
    }
  }

  const handleCopy = useCallback(
    async (proxy: ProxyResponse): Promise<void> => {
      try {
        const conn = await api.getProxyConnectionString(proxy.id)
        await navigator.clipboard.writeText(conn)
        addToast('Connection string copied', 'success')
      } catch {
        // Fallback: build it client-side without password.
        const auth = proxy.username ? `${proxy.username}@` : ''
        const str = `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`
        try {
          await navigator.clipboard.writeText(str)
          addToast('Copied (without password)', 'info')
        } catch {
          addToast('Copy failed', 'error')
        }
      }
    },
    [addToast]
  )

  // ── Bulk actions ──────────────────────────────────────────────────────
  const bulkTestSelected = useCallback(async (): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkTesting(true)
    try {
      await api.bulkTestProxies(ids)
      await fetchProxies()
      addToast(`Tested ${ids.length} prox${ids.length === 1 ? 'y' : 'ies'}`, 'success')
    } catch {
      addToast('Bulk test failed', 'error')
    }
    setBulkTesting(false)
  }, [selected, fetchProxies, addToast])

  // Recheck-reputation loop is sequential (one IP-api lookup per row through
  // each proxy, ~1s each). If the user clicks the bulk button a second time
  // while the loop is in flight, treat it as a Cancel signal — the button
  // visibly flips to Cancel via the floater UI below.
  const bulkRecheckAbortRef = useRef<AbortController | null>(null)
  const bulkRecheckFraud = useCallback(async (): Promise<void> => {
    if (bulkRecheckingFraud) {
      bulkRecheckAbortRef.current?.abort()
      return
    }
    const ids = [...selected]
    if (ids.length === 0) return
    bulkRecheckAbortRef.current?.abort()
    const ctrl = new AbortController()
    bulkRecheckAbortRef.current = ctrl
    setBulkRecheckingFraud(true)
    addToast(`Rechecking reputation for ${ids.length} prox${ids.length === 1 ? 'y' : 'ies'}…`, 'info', {
      duration: 2000,
      silent: true
    })
    let ok = 0
    let fail = 0
    let aborted = false
    try {
      for (const id of ids) {
        if (ctrl.signal.aborted) {
          aborted = true
          break
        }
        try {
          const r = await api.lookupProxyGeo(id)
          if (ctrl.signal.aborted) {
            aborted = true
            break
          }
          if (r) ok++
          else fail++
        } catch {
          fail++
        }
      }
      try {
        await fetchProxies()
      } catch {
        /* ignore */
      }
      if (aborted) {
        addToast(
          ok > 0 ? `Recheck cancelled — ${ok} refreshed` : 'Recheck cancelled',
          'info'
        )
      } else if (fail === 0) {
        addToast(`Reputation refreshed for ${ok}`, 'success')
      } else {
        addToast(`${ok} refreshed, ${fail} failed`, 'warning')
      }
    } finally {
      if (bulkRecheckAbortRef.current === ctrl) bulkRecheckAbortRef.current = null
      setBulkRecheckingFraud(false)
    }
  }, [bulkRecheckingFraud, selected, fetchProxies, addToast])

  const bulkDeleteSelected = useCallback(async (): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) return
    const ok = await confirm({
      title: 'Delete Proxies',
      message: `Delete ${ids.length} selected prox${ids.length === 1 ? 'y' : 'ies'}? This action cannot be undone.`,
      confirmLabel: ids.length === 1 ? 'Delete' : 'Delete All',
      danger: true
    })
    if (!ok) return
    let deleted = 0
    for (const id of ids) {
      try {
        await deleteProxy(id)
        deleted++
      } catch {
        /* continue */
      }
    }
    setSelected(new Set())
    addToast(`Deleted ${deleted} prox${deleted === 1 ? 'y' : 'ies'}`, 'success')
  }, [selected, confirm, deleteProxy, addToast])

  // ── Import flow ───────────────────────────────────────────────────────
  // Single AbortController across `parseImport` and `executeImport`. Used
  // both by the explicit Cancel button (button doubles as Cancel while the
  // import loop is in flight) and by `closeImport` so closing the sheet
  // halts any per-row reputation probe in flight. The reputation-filtered
  // executeImport branch hits ip-api once per row sequentially (~1s each)
  // and would otherwise keep running invisibly after the sheet closes —
  // creating proxies the user thought they cancelled.
  const importAbortRef = useRef<AbortController | null>(null)

  const cancelImport = useCallback((): void => {
    importAbortRef.current?.abort()
  }, [])

  const closeImport = useCallback((): void => {
    importAbortRef.current?.abort()
    importAbortRef.current = null
    setImportOpen(false)
    setImportText('')
    setImportParsed(null)
    setImportProgress(null)
    setImportLoading(false)
  }, [])

  // Dirty-state-aware close paths used by the Sheet ESC handler / overlay
  // click. The in-panel header X / footer Cancel buttons keep using
  // `closeEditor` / `closeImport` directly; the spec calls for a confirm
  // ONLY when the user attempts a close that bypasses those explicit paths.
  const requestCloseEditor = useCallback(async (): Promise<void> => {
    if (!editorIsDirty) {
      closeEditor()
      return
    }
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      message: 'You have edits in this proxy that will be lost if you continue.',
      confirmLabel: 'Discard',
      danger: true
    })
    if (ok) closeEditor()
  }, [editorIsDirty, closeEditor, confirm])

  // The import Sheet has two effective dirty states: the user typed/pasted
  // proxies into the textarea (`importText`), or the parse step ran and
  // there's a preview list (`importParsed`). Either is non-trivial work to
  // re-do, so closing without confirm would be a regression.
  const importHasPendingWork = useCallback(
    (): boolean => importText.trim().length > 0 || importParsed !== null,
    [importText, importParsed]
  )
  const requestCloseImport = useCallback(async (): Promise<void> => {
    // Active reputation-check / persist loop in flight: closing IS the cancel
    // signal. Don't prompt — the user already clicked close. Forward straight
    // to closeImport which aborts the controller and clears state.
    if (importLoading) {
      closeImport()
      return
    }
    if (!importHasPendingWork()) {
      closeImport()
      return
    }
    const ok = await confirm({
      title: 'Discard import?',
      message: 'Your pasted proxies and any preview will be cleared.',
      confirmLabel: 'Discard',
      danger: true
    })
    if (ok) closeImport()
  }, [importLoading, importHasPendingWork, closeImport, confirm])

  // Route multi-line paste from the editor's quick-paste into the bulk import sheet.
  const openBulkImportWithText = useCallback(
    (text: string): void => {
      // Discard editor form state — explicit per spec.
      setEditorOpen(false)
      setEditingId(null)
      setEditorError(null)
      setEditorTesting(false)
      setQuickPaste('')
      setQuickPasteHint(null)
      setQuickPasteMultiline(false)
      setQuickPasteParsing(false)
      setQuickPasteFilled(false)
      setClearCreds({ username: false, password: false })
      reset(DEFAULT_PROXY)
      setImportParsed(null)
      setImportText(text)
      setImportOpen(true)
    },
    [reset]
  )

  const parseImport = async (): Promise<void> => {
    if (!importText.trim()) return
    importAbortRef.current?.abort()
    const ctrl = new AbortController()
    importAbortRef.current = ctrl
    setImportLoading(true)
    try {
      const parsed = await api.parseProxyString(importText)
      // Sheet may have been closed while the IPC roundtrip was in flight —
      // dropping the result avoids stamping state onto a dismissed sheet.
      if (ctrl.signal.aborted) return
      setImportParsed(parsed)
    } catch {
      if (!ctrl.signal.aborted) addToast('Failed to parse proxies', 'error')
    } finally {
      if (importAbortRef.current === ctrl) importAbortRef.current = null
      setImportLoading(false)
    }
  }

  const executeImport = async (): Promise<void> => {
    if (!importParsed) return
    importAbortRef.current?.abort()
    const ctrl = new AbortController()
    importAbortRef.current = ctrl
    setImportLoading(true)

    const validRows = importParsed.filter((r) => r.ok && r.data)
    let created = 0
    let skippedRisky = 0
    let skippedError = 0
    let aborted = false

    try {
      if (importFilterFraud) {
        // Reputation-filtered path: dry-run each candidate first; sequential
        // to stay under ip-api's 45 req/min free-tier ceiling and to keep the
        // progress counter monotonic for the user. The signal is checked at
        // both iteration boundaries so a close mid-await halts no later than
        // the next probe completion.
        setImportProgress({ checked: 0, total: validRows.length, risky: 0 })
        for (let i = 0; i < validRows.length; i++) {
          if (ctrl.signal.aborted) {
            aborted = true
            break
          }
          const row = validRows[i]
          if (!row.data) continue
          try {
            const probe = await api.dryRunFraudCheck(
              row.data as Parameters<typeof api.dryRunFraudCheck>[0]
            )
            if (ctrl.signal.aborted) {
              aborted = true
              break
            }
            // Drop high / critical / unknown / null. Keep clean / low / medium.
            const verdict = probe?.fraud_risk
            const keep = verdict === 'clean' || verdict === 'low' || verdict === 'medium'
            if (!keep) {
              skippedRisky++
            } else {
              await api.createProxy(row.data as Parameters<typeof api.createProxy>[0])
              created++
            }
          } catch {
            skippedError++
          }
          setImportProgress({ checked: i + 1, total: validRows.length, risky: skippedRisky })
        }
      } else {
        // Unfiltered path: persist every parsed line; the auto-fraud-check
        // still fires per row in the main process but doesn't gate creation.
        for (const r of validRows) {
          if (ctrl.signal.aborted) {
            aborted = true
            break
          }
          if (!r.data) continue
          try {
            await api.createProxy(r.data as Parameters<typeof api.createProxy>[0])
            created++
          } catch {
            skippedError++
          }
        }
      }

      // Refresh the list so the user sees whatever made it in (even on abort).
      try {
        await fetchProxies()
      } catch {
        /* ignore — partial state is still better than stale state */
      }

      if (aborted) {
        addToast(
          created > 0
            ? `Import cancelled — ${created} prox${created === 1 ? 'y' : 'ies'} imported`
            : 'Import cancelled',
          'info'
        )
      } else if (skippedRisky > 0 || skippedError > 0) {
        const parts = [`Imported ${created}`]
        if (skippedRisky > 0) parts.push(`${skippedRisky} risky skipped`)
        if (skippedError > 0) parts.push(`${skippedError} errors`)
        addToast(parts.join(' • '), skippedRisky > 0 ? 'warning' : 'success')
      } else {
        addToast(`Imported ${created} prox${created === 1 ? 'y' : 'ies'}`, 'success')
      }
    } finally {
      if (importAbortRef.current === ctrl) importAbortRef.current = null
      setImportLoading(false)
      setImportProgress(null)
      // On natural completion: close the sheet so the user lands back in
      // the list. On user-initiated abort: keep the sheet open so they can
      // tweak the toggle / set and re-run without re-pasting.
      if (!aborted) closeImport()
    }
  }

  const handleFileUpload = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt,.csv'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      setImportText(text)
      setImportParsed(null)
    }
    input.click()
  }

  const openIpCheck = useCallback((): void => {
    setIpCheckOpen(true)
    setIpCheckInput('')
    setIpCheckReport(null)
    setIpCheckError(null)
  }, [])

  // ── Row context menu / dropdown actions ───────────────────────────────
  // Lazy builder: the row memoizes the resulting array keyed by the proxy
  // identity + the two transient flags that alter `disabled` on individual
  // items. This callback's identity stays stable so memoized rows aren't
  // forced to re-render on unrelated parent updates (filter typing, scroll).
  const getActionsForProxy = useCallback(
    (proxy: ProxyResponse, isTesting: boolean, isCheckingFraud: boolean): DropdownMenuItem[] => [
      {
        label: 'Test',
        icon: <FlaskConical className="h-4 w-4" />,
        onClick: () => void handleTest(proxy.id),
        disabled: isTesting
      },
      {
        label: 'Recheck reputation',
        icon: <RefreshCw className="h-4 w-4" />,
        onClick: () => void handleRecheckFraud(proxy.id),
        disabled: isCheckingFraud
      },
      {
        label: 'Edit',
        icon: <Pencil className="h-4 w-4" />,
        onClick: () => openEdit(proxy)
      },
      {
        label: 'Copy connection string',
        icon: <Copy className="h-4 w-4" />,
        onClick: () => void handleCopy(proxy)
      },
      {
        label: 'Delete',
        icon: <Trash2 className="h-4 w-4" />,
        variant: 'danger',
        onClick: () => void handleDelete(proxy.id, proxy.name)
      }
    ],
    [handleTest, handleRecheckFraud, openEdit, handleCopy, handleDelete]
  )

  const handleClickRow = useCallback(
    (proxy: ProxyResponse): void => {
      openEdit(proxy)
    },
    [openEdit]
  )

  const handleRowContextMenu = useCallback(
    (e: ReactMouseEvent, proxy: ProxyResponse): void => {
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY, proxy })
    },
    []
  )

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  // Global scope: Ctrl/Cmd+N|F|A, /, Esc — fire from anywhere on the page.
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const inEditableTarget = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (inEditableTarget) {
        if (e.key === 'Escape') {
          target?.blur()
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          searchInputRef.current?.focus()
          return
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openAdd()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        handleSelectAllVisible()
        return
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      if (e.key === 'Escape') {
        // Sheet ESC is owned by Radix via `onEscapeKeyDown` (which routes
        // through `requestClose*` and the dirty-state confirm). The global
        // listener only handles ESC for non-Sheet UI (IP check Dialog,
        // selection clear, focus drop) so it doesn't double-close the Sheet.
        if (editorOpen || importOpen) return
        if (ipCheckOpen) setIpCheckOpen(false)
        else if (selected.size > 0) setSelected(new Set())
        else if (focusedIdx !== null) setFocusedIdx(null)
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [
    editorOpen,
    importOpen,
    ipCheckOpen,
    selected.size,
    focusedIdx,
    openAdd,
    handleSelectAllVisible
  ])

  // Listbox-scoped shortcuts.
  const handleListboxKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (editorOpen || importOpen || ipCheckOpen || e.altKey) return
      if (filteredProxies.length === 0) return

      const navigateTo = (next: number | null): void => {
        e.preventDefault()
        setFocusedIdx(next)
      }

      if (e.key === 'ArrowDown') {
        navigateTo(
          focusedIdx === null
            ? 0
            : Math.min(filteredProxies.length - 1, focusedIdx + 1)
        )
        return
      }
      if (e.key === 'ArrowUp') {
        navigateTo(focusedIdx === null ? 0 : Math.max(0, focusedIdx - 1))
        return
      }
      if (e.key === 'Home') {
        navigateTo(0)
        return
      }
      if (e.key === 'End') {
        navigateTo(filteredProxies.length - 1)
        return
      }
      if (focusedIdx === null) return

      const focused = filteredProxies[focusedIdx]
      if (!focused) return

      if (e.key === 'Enter') {
        e.preventDefault()
        openEdit(focused)
      } else if (e.key === ' ') {
        e.preventDefault()
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(focused.id)) next.delete(focused.id)
          else next.add(focused.id)
          return next
        })
      } else if (e.key === 'Delete') {
        e.preventDefault()
        void handleDelete(focused.id, focused.name)
      } else if (e.key.toLowerCase() === 't') {
        e.preventDefault()
        void handleTest(focused.id)
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault()
        openEdit(focused)
      } else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        openAdd()
      }
    },
    [
      editorOpen,
      importOpen,
      ipCheckOpen,
      focusedIdx,
      filteredProxies,
      openEdit,
      handleDelete,
      handleTest,
      openAdd
    ]
  )

  // Bring focused row into view + claim DOM focus.
  useEffect(() => {
    if (focusedIdx === null) {
      focusedIdRef.current = null
      return
    }
    const proxy = filteredProxies[focusedIdx]
    if (!proxy) return
    focusedIdRef.current = proxy.id
    const targetEl = rowRefs.current.get(proxy.id)
    if (!targetEl) return
    if (document.activeElement !== targetEl) {
      targetEl.focus({ preventScroll: true })
    }
    // Bring into view.
    const sc = scrollRef.current
    if (sc) {
      const scrollBehavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'
      const rect = targetEl.getBoundingClientRect()
      const scRect = sc.getBoundingClientRect()
      if (rect.top < scRect.top) {
        sc.scrollBy({ top: rect.top - scRect.top, behavior: scrollBehavior })
      } else if (rect.bottom > scRect.bottom) {
        sc.scrollBy({ top: rect.bottom - scRect.bottom, behavior: scrollBehavior })
      }
    }
  }, [focusedIdx, filteredProxies, prefersReducedMotion])

  // ── Misc derived ───────────────────────────────────────────────────────
  const hasSelection = selected.size > 0
  const hasActiveFilters =
    statusFilter !== 'all' ||
    protocolFilter !== 'all' ||
    reputationFilter !== 'all' ||
    groupFilter !== 'all' ||
    searchQuery.trim().length > 0

  const handleClearAllFilters = useCallback((): void => {
    setSearchQuery('')
    setStatusFilter('all')
    setProtocolFilter('all')
    setReputationFilter('all')
    setGroupFilter('all')
  }, [])

  // ── Stable filter-chip handlers ───────────────────────────────────────
  // Stable callbacks let `React.memo` on FilterChip short-circuit on
  // unrelated parent updates (search keystrokes, scroll, focus drift).
  // Per-value handlers are clearer than a higher-order factory at this
  // scale (<20 chips total).
  const setStatusWorking = useCallback(() => setStatusFilter('working'), [])
  const setStatusFailed = useCallback(() => setStatusFilter('failed'), [])
  const setStatusUntested = useCallback(() => setStatusFilter('untested'), [])
  const clearStatusFilter = useCallback(() => setStatusFilter('all'), [])

  const setProtocolHttp = useCallback(() => setProtocolFilter('http'), [])
  const setProtocolHttps = useCallback(() => setProtocolFilter('https'), [])
  const setProtocolSocks4 = useCallback(() => setProtocolFilter('socks4'), [])
  const setProtocolSocks5 = useCallback(() => setProtocolFilter('socks5'), [])
  const clearProtocolFilter = useCallback(() => setProtocolFilter('all'), [])

  const setReputationClean = useCallback(() => setReputationFilter('clean'), [])
  const setReputationLow = useCallback(() => setReputationFilter('low'), [])
  const setReputationMedium = useCallback(() => setReputationFilter('medium'), [])
  const setReputationHigh = useCallback(() => setReputationFilter('high'), [])
  const setReputationCritical = useCallback(() => setReputationFilter('critical'), [])
  const setReputationUnchecked = useCallback(() => setReputationFilter('unchecked'), [])
  const clearReputationFilter = useCallback(() => setReputationFilter('all'), [])

  // Editor / import Sheets shrink with the viewport so the user keeps a
  // sliver of list visible behind the panel on the layout's hard 900px
  // minimum. Floored at EDITOR_SHEET_MIN_WIDTH_PX so the form doesn't crush.
  const viewportWidth = useViewportWidth()
  const editorSheetWidth = Math.min(
    EDITOR_SHEET_WIDTH_PX,
    Math.max(EDITOR_SHEET_MIN_WIDTH_PX, viewportWidth - EDITOR_SHEET_CONTEXT_RESERVE_PX)
  )
  const importSheetWidth = Math.min(
    IMPORT_SHEET_WIDTH_PX,
    Math.max(EDITOR_SHEET_MIN_WIDTH_PX, viewportWidth - EDITOR_SHEET_CONTEXT_RESERVE_PX)
  )

  // ── Loading skeleton ───────────────────────────────────────────────────
  if (loading && proxies.length === 0) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <div className="h-12 border-b border-border/50" />
        <div className="flex-1 p-4 space-y-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 rounded-[--radius-md] shimmer" />
          ))}
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background relative">
      {/* ── Sticky filter strip ───────────────────────────────────────── */}
      <div
        className={cn(
          'sticky top-0 z-10 shrink-0 flex items-center gap-2 px-4 h-12 min-w-0',
          'bg-card/85 backdrop-blur-sm border-b border-border/50'
        )}
      >
        <SearchInput
          ref={searchInputRef}
          id="proxy-search"
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search proxies…"
          className="w-[280px] shrink-0"
          matchCount={filteredProxies.length}
        />

        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto scrollbar-hide">
          {/* Status */}
          <FilterChip
            active={statusFilter === 'working'}
            onClick={setStatusWorking}
            onClear={clearStatusFilter}
            dotClass="bg-ok"
          >
            Working
          </FilterChip>
          <FilterChip
            active={statusFilter === 'failed'}
            onClick={setStatusFailed}
            onClear={clearStatusFilter}
            dotClass="bg-destructive"
          >
            Failed
          </FilterChip>
          <FilterChip
            active={statusFilter === 'untested'}
            onClick={setStatusUntested}
            onClear={clearStatusFilter}
            dotClass="bg-muted-foreground/60"
          >
            Untested
          </FilterChip>

          <div className="h-5 w-px bg-border/60 mx-1" />

          {/* Protocol */}
          <FilterChip
            active={protocolFilter === 'http'}
            onClick={setProtocolHttp}
            onClear={clearProtocolFilter}
          >
            HTTP
          </FilterChip>
          <FilterChip
            active={protocolFilter === 'https'}
            onClick={setProtocolHttps}
            onClear={clearProtocolFilter}
          >
            HTTPS
          </FilterChip>
          <FilterChip
            active={protocolFilter === 'socks4'}
            onClick={setProtocolSocks4}
            onClear={clearProtocolFilter}
          >
            SOCKS4
          </FilterChip>
          <FilterChip
            active={protocolFilter === 'socks5'}
            onClick={setProtocolSocks5}
            onClear={clearProtocolFilter}
          >
            SOCKS5
          </FilterChip>

          <div className="h-5 w-px bg-border/60 mx-1" />

          {/* Reputation */}
          <FilterChip
            active={reputationFilter === 'clean'}
            onClick={setReputationClean}
            onClear={clearReputationFilter}
            dotClass={FRAUD_DOT_CLASS.clean}
          >
            Clean
          </FilterChip>
          <FilterChip
            active={reputationFilter === 'low'}
            onClick={setReputationLow}
            onClear={clearReputationFilter}
            dotClass={FRAUD_DOT_CLASS.low}
          >
            Low
          </FilterChip>
          <FilterChip
            active={reputationFilter === 'medium'}
            onClick={setReputationMedium}
            onClear={clearReputationFilter}
            dotClass={FRAUD_DOT_CLASS.medium}
          >
            Medium
          </FilterChip>
          <FilterChip
            active={reputationFilter === 'high'}
            onClick={setReputationHigh}
            onClear={clearReputationFilter}
            dotClass={FRAUD_DOT_CLASS.high}
          >
            High
          </FilterChip>
          <FilterChip
            active={reputationFilter === 'critical'}
            onClick={setReputationCritical}
            onClear={clearReputationFilter}
            dotClass={FRAUD_DOT_CLASS.critical}
          >
            Critical
          </FilterChip>
          <FilterChip
            active={reputationFilter === 'unchecked'}
            onClick={setReputationUnchecked}
            onClear={clearReputationFilter}
            dotClass={FRAUD_DOT_CLASS.unknown}
          >
            Unchecked
          </FilterChip>

          {allGroups.length > 0 && (
            <>
              <div className="h-5 w-px bg-border/60 mx-1" />
              <SelectRoot value={groupFilter} onValueChange={setGroupFilter}>
                <SelectTrigger className="ml-1 !h-7 !text-[11.5px] min-w-[120px] shrink-0">
                  <SelectValue placeholder="Group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All groups</SelectItem>
                  {allGroups.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            </>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Density toggle — 2-segment pill so both options are visible at once */}
          <div
            className="inline-flex items-center rounded-[--radius-md] bg-elevated/40 p-0.5"
            role="group"
            aria-label="Row density"
          >
            <button
              type="button"
              aria-pressed={density === 'compact'}
              aria-label="Compact density"
              onClick={() => setDensity('compact')}
              className={cn(
                'inline-flex items-center gap-1 h-6 px-2 rounded-[calc(var(--radius-md)-2px)] text-[11px] font-medium',
                'transition-colors duration-150 ease-[var(--ease-osmosis)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                density === 'compact'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Rows3 className="h-3 w-3" aria-hidden="true" />
              <span className="hidden md:inline">Compact</span>
            </button>
            <button
              type="button"
              aria-pressed={density === 'comfortable'}
              aria-label="Comfortable density"
              onClick={() => setDensity('comfortable')}
              className={cn(
                'inline-flex items-center gap-1 h-6 px-2 rounded-[calc(var(--radius-md)-2px)] text-[11px] font-medium',
                'transition-colors duration-150 ease-[var(--ease-osmosis)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                density === 'comfortable'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Rows2 className="h-3 w-3" aria-hidden="true" />
              <span className="hidden md:inline">Comfortable</span>
            </button>
          </div>

          {/* Sort */}
          <SelectRoot
            value={`${sortKey}:${sortDir}`}
            onValueChange={(v) => {
              const [k, d] = v.split(':') as [SortKey, SortDir]
              setSortKey(k)
              setSortDir(d)
            }}
          >
            <SelectTrigger className="!h-7 !text-[11.5px] min-w-[130px]">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at:desc">Newest</SelectItem>
              <SelectItem value="created_at:asc">Oldest</SelectItem>
              <SelectItem value="name:asc">Name (A→Z)</SelectItem>
              <SelectItem value="name:desc">Name (Z→A)</SelectItem>
              <SelectItem value="last_check:desc">Last check</SelectItem>
              <SelectItem value="fraud_score:asc">Score ↑</SelectItem>
              <SelectItem value="fraud_score:desc">Score ↓</SelectItem>
            </SelectContent>
          </SelectRoot>

          <Tooltip content="Check IP reputation (no proxy added)">
            <button
              type="button"
              onClick={openIpCheck}
              className={cn(
                'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
                'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
                'transition-colors duration-150 ease-[var(--ease-osmosis)]'
              )}
              aria-label="Check IP reputation"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          <Tooltip content="Bulk import proxies">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className={cn(
                'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
                'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
                'transition-colors duration-150 ease-[var(--ease-osmosis)]'
              )}
              aria-label="Import proxies"
            >
              <Upload className="h-3.5 w-3.5" />
            </button>
          </Tooltip>

          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openAdd}>
            Add proxy
          </Button>
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {filteredProxies.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<Globe />}
            title={hasActiveFilters ? 'No matching proxies' : 'No proxies yet'}
            description={
              hasActiveFilters
                ? 'Try clearing filters or adjusting your search.'
                : 'Add HTTP, HTTPS, or SOCKS proxies — attach them to profiles from the editor to route traffic through them.'
            }
            action={
              hasActiveFilters ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleClearAllFilters}
                  icon={<Filter className="h-3.5 w-3.5" />}
                >
                  Clear filters
                </Button>
              ) : (
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openAdd}>
                  Add proxy
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          onKeyDown={handleListboxKeyDown}
          className="flex-1 min-h-0 overflow-auto focus:outline-none"
          role="listbox"
          aria-label="Proxies"
          aria-multiselectable="true"
          tabIndex={focusedIdx === null ? 0 : -1}
          style={
            hasSelection
              ? ({ paddingBottom: BULK_FLOATER_CLEARANCE_PX } as CSSProperties)
              : undefined
          }
        >
          {filteredProxies.map((proxy, index) => {
            const errorTooltip =
              !proxy.check_ok && proxy.check_error
                ? PROXY_CHECK_ERROR_MESSAGES[proxy.check_error] ?? proxy.check_error
                : null
            return (
              <ProxyRow
                key={proxy.id}
                proxy={proxy}
                index={index}
                selected={selected.has(proxy.id)}
                focused={focusedIdx === index}
                density={density}
                isTesting={testingIds.has(proxy.id)}
                isCheckingFraud={checkingFraudIds.has(proxy.id)}
                errorTooltip={errorTooltip}
                getActionsForProxy={getActionsForProxy}
                onToggleSelect={handleToggleSelect}
                onClickRow={handleClickRow}
                onContextMenu={handleRowContextMenu}
                onRecheckFraud={handleRowRecheckFraud}
                registerRef={registerRowRef}
              />
            )
          })}
        </div>
      )}

      {/* ── Bulk action floater ──────────────────────────────────────── */}
      {hasSelection && (
        <div
          role="toolbar"
          aria-label={`Bulk actions for ${selected.size} selected prox${
            selected.size === 1 ? 'y' : 'ies'
          }`}
          className={cn(
            'absolute bottom-4 left-1/2 -translate-x-1/2 z-20',
            'flex items-center gap-2 px-3 py-2',
            'bg-card/85 backdrop-blur-md border border-border/60 rounded-[--radius-lg]',
            'shadow-[var(--shadow-md)] animate-slideUp'
          )}
        >
          <span className="text-[12px] font-semibold text-foreground tabular-nums px-1.5">
            {selected.size} selected
          </span>
          <span className="h-4 w-px bg-border/60" />
          <Button
            ref={bulkFirstActionRef as Ref<HTMLButtonElement>}
            variant="ghost"
            size="sm"
            icon={<FlaskConical className="h-3.5 w-3.5" />}
            onClick={bulkTestSelected}
            loading={bulkTesting}
            disabled={bulkTesting}
          >
            Test all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={
              bulkRecheckingFraud ? (
                <X className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )
            }
            onClick={bulkRecheckFraud}
            className={bulkRecheckingFraud ? 'text-warn hover:text-warn hover:bg-warn/10' : undefined}
          >
            {bulkRecheckingFraud ? 'Cancel recheck' : 'Recheck reputation'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={bulkDeleteSelected}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            Delete
          </Button>
          <span className="h-4 w-px bg-border/60" />
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className={cn(
              'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
              'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]'
            )}
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Add / Edit Sheet ─────────────────────────────────────────── */}
      <Sheet
        open={editorOpen}
        onOpenChange={(open) => {
          if (!open) void requestCloseEditor()
        }}
      >
        <SheetContent
          side="right"
          width={editorSheetWidth}
          hideClose
          className="p-0 gap-0"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (editorIsDirty) {
              e.preventDefault()
              void requestCloseEditor()
            }
          }}
          onPointerDownOutside={(e) => {
            if (editorIsDirty) {
              e.preventDefault()
              void requestCloseEditor()
            }
          }}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60 shrink-0">
            <SheetTitle>{editingId ? 'Edit Proxy' : 'Add Proxy'}</SheetTitle>
            <button
              type="button"
              onClick={() => void requestCloseEditor()}
              className={cn(
                'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
                'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
                'transition-colors duration-150 ease-[var(--ease-osmosis)]'
              )}
              aria-label="Close editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form
            id="proxy-form"
            onSubmit={handleSubmit(onSubmitProxy)}
            className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4"
          >
            {editorError && (
              <div className="rounded-[--radius-md] bg-destructive/10 border border-destructive/25 px-3.5 py-2.5 text-xs text-destructive font-medium">
                {editorError}
              </div>
            )}

            {/* Quick paste */}
            <div className="space-y-1.5">
              <Label htmlFor="proxy-quick-paste">Quick paste</Label>
              <Input
                ref={quickPasteInputRef}
                id="proxy-quick-paste"
                placeholder="socks5://user:pass@host:port"
                value={quickPaste}
                onChange={(e) => setQuickPaste(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void runQuickPasteParse(quickPaste)
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                icon={<ClipboardPaste className="h-4 w-4" />}
                rightIcon={
                  quickPasteParsing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : quickPasteFilled ? (
                    <Check className="h-4 w-4 text-ok" />
                  ) : undefined
                }
              />
              {quickPasteMultiline ? (
                <p className="text-xs leading-snug text-destructive">
                  {QUICK_PASTE_HINT.multiline}
                  {!editingId && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="underline underline-offset-2 text-primary hover:text-accent-dim transition-colors"
                        onClick={() => openBulkImportWithText(quickPaste)}
                      >
                        Open bulk import
                      </button>
                    </>
                  )}
                </p>
              ) : quickPasteParsing ? (
                <p className="text-xs leading-snug text-muted-foreground">Parsing…</p>
              ) : quickPasteFilled ? (
                <p className="text-xs leading-snug text-ok">Filled</p>
              ) : (
                <p
                  className={cn(
                    'text-xs leading-snug',
                    quickPasteHint ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {quickPasteHint ?? 'Paste any format — fields auto-fill'}
                </p>
              )}
            </div>

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="proxy-name">Name</Label>
              <Input
                id="proxy-name"
                placeholder="My Proxy"
                error={errors.name?.message}
                {...register('name')}
              />
            </div>

            {/* Protocol */}
            <div className="space-y-1.5">
              <Label htmlFor="proxy-protocol">Protocol</Label>
              <Select
                id="proxy-protocol"
                options={PROTOCOL_OPTIONS}
                error={errors.protocol?.message}
                {...register('protocol')}
              />
            </div>

            {/* Host + port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="proxy-host">Host</Label>
                <Input
                  id="proxy-host"
                  placeholder="192.168.1.1"
                  error={errors.host?.message}
                  {...register('host')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proxy-port">Port</Label>
                <Input
                  id="proxy-port"
                  type="number"
                  placeholder="8080"
                  error={errors.port?.message}
                  {...register('port', { valueAsNumber: true })}
                />
              </div>
            </div>

            {/* Username / password */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="proxy-username">Username</Label>
                <Input id="proxy-username" placeholder="optional" {...register('username')} />
                {editingId && editingProxyHasUsername && (
                  <div>
                    {clearCreds.username && !watchedUsername ? (
                      <p className="text-xs text-muted-foreground">
                        Username will be cleared on save.{' '}
                        <button
                          type="button"
                          className="underline underline-offset-2 text-primary hover:text-accent-dim transition-colors"
                          onClick={() => setClearCreds((prev) => ({ ...prev, username: false }))}
                        >
                          Undo
                        </button>
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                        onClick={() => {
                          setValue('username', '', { shouldDirty: true })
                          setClearCreds((prev) => ({ ...prev, username: true }))
                        }}
                      >
                        Clear saved username
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proxy-password">Password</Label>
                <Input
                  id="proxy-password"
                  type="password"
                  placeholder={
                    editingId && editingProxyHasPassword
                      ? '•••••• (leave empty to keep)'
                      : 'optional'
                  }
                  {...register('password')}
                />
                {editingId && editingProxyHasPassword && (
                  <div>
                    {clearCreds.password && !watchedPassword ? (
                      <p className="text-xs text-muted-foreground">
                        Password will be cleared on save.{' '}
                        <button
                          type="button"
                          className="underline underline-offset-2 text-primary hover:text-accent-dim transition-colors"
                          onClick={() => setClearCreds((prev) => ({ ...prev, password: false }))}
                        >
                          Undo
                        </button>
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                        onClick={() => {
                          setValue('password', '', { shouldDirty: true })
                          setClearCreds((prev) => ({ ...prev, password: true }))
                        }}
                      >
                        Clear saved password
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Country / group */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="proxy-country">Country</Label>
                <Input
                  id="proxy-country"
                  placeholder="US, DE, etc."
                  maxLength={2}
                  {...register('country')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="proxy-group">Group tag</Label>
                <Input id="proxy-group" placeholder="rotation-group" {...register('group_tag')} />
              </div>
            </div>
          </form>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/60 shrink-0">
            {editingId ? (
              <Button
                variant="ghost"
                size="md"
                icon={<FlaskConical className="h-4 w-4" />}
                onClick={handleTestInEditor}
                loading={editorTesting}
                disabled={editorTesting || editorSaving}
                className="mr-auto"
              >
                Test
              </Button>
            ) : (
              <span className="mr-auto text-xs text-muted-foreground">
                Save the proxy first to test it.
              </span>
            )}
            <Button variant="secondary" size="md" onClick={() => void requestCloseEditor()}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="md"
              type="submit"
              form="proxy-form"
              loading={editorSaving}
              disabled={editorSaving}
            >
              {editingId ? 'Save Changes' : 'Add Proxy'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Import Sheet ─────────────────────────────────────────────── */}
      <Sheet
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) void requestCloseImport()
        }}
      >
        <SheetContent
          side="right"
          width={importSheetWidth}
          hideClose
          className="p-0 gap-0"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (importHasPendingWork()) {
              e.preventDefault()
              void requestCloseImport()
            }
          }}
          onPointerDownOutside={(e) => {
            if (importHasPendingWork()) {
              e.preventDefault()
              void requestCloseImport()
            }
          }}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60 shrink-0">
            <SheetTitle>Import Proxies</SheetTitle>
            <button
              type="button"
              onClick={() => void requestCloseImport()}
              className={cn(
                'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
                'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
                'transition-colors duration-150 ease-[var(--ease-osmosis)]'
              )}
              aria-label="Close import"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            {!importParsed ? (
              <>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Paste proxies below or upload a file — one proxy per line. Supported formats:{' '}
                  <code className="text-primary bg-primary/10 px-1 py-0.5 rounded-[--radius-sm]">
                    host:port
                  </code>
                  ,{' '}
                  <code className="text-primary bg-primary/10 px-1 py-0.5 rounded-[--radius-sm]">
                    host:port:user:pass
                  </code>
                  ,{' '}
                  <code className="text-primary bg-primary/10 px-1 py-0.5 rounded-[--radius-sm]">
                    socks5://host:port
                  </code>
                  ,{' '}
                  <code className="text-primary bg-primary/10 px-1 py-0.5 rounded-[--radius-sm]">
                    user:pass@host:port
                  </code>
                  .
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="proxy-import-text">Proxies</Label>
                  <textarea
                    id="proxy-import-text"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder={'192.168.1.1:8080\nsocks5://proxy.example.com:1080:user:pass'}
                    rows={10}
                    className={cn(
                      'w-full px-3 py-2 rounded-[--radius-md] bg-input border border-border',
                      'text-sm text-foreground placeholder:text-muted-foreground/60',
                      'transition-all duration-150 ease-[var(--ease-osmosis)]',
                      'hover:border-edge/80 focus:outline-none focus:border-primary/60 focus:bg-input/60',
                      'focus:ring-[3px] focus:ring-primary/15 resize-none font-mono'
                    )}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FileUp className="h-4 w-4" />}
                  onClick={handleFileUpload}
                >
                  Upload file
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  {importParsed.map((r, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-[--radius-md] text-xs font-mono',
                        r.ok
                          ? 'bg-ok/5 border border-ok/15 text-foreground'
                          : 'bg-destructive/5 border border-destructive/15 text-muted-foreground line-through'
                      )}
                    >
                      <Badge variant={r.ok ? 'success' : 'destructive'} dot>
                        {r.ok ? 'OK' : 'Invalid'}
                      </Badge>
                      <span className="truncate">
                        {r.data ? `${r.data.protocol}://${r.data.host}:${r.data.port}` : `Line ${i + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {importParsed.filter((r) => r.ok).length} of {importParsed.length} proxies will be
                  imported
                </p>

                <label className="flex items-start gap-3 px-3 py-2.5 rounded-[--radius-md] bg-elevated/40 border border-border cursor-pointer hover:bg-elevated/60 transition-colors">
                  <Switch
                    checked={importFilterFraud}
                    onCheckedChange={setImportFilterFraud}
                    aria-label="Filter by reputation"
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">Filter by reputation</p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                      Skip proxies whose IP is on a datacenter / known-proxy ASN. Each candidate is
                      probed via ip-api.com through the proxy itself before being persisted; risky IPs
                      are dropped silently. Sequential lookup (~1s per proxy).
                    </p>
                  </div>
                </label>

                {importLoading && importProgress && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-[--radius-md] bg-primary/5 border border-primary/15 text-xs text-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                    <span className="font-mono tabular-nums">
                      {importProgress.checked}/{importProgress.total}
                    </span>
                    <span className="text-muted-foreground">checked</span>
                    {importProgress.risky > 0 && (
                      <span className="ml-auto text-warn font-medium">
                        {importProgress.risky} risky skipped
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/60 shrink-0">
            {importParsed ? (
              <>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setImportParsed(null)}
                  disabled={importLoading}
                >
                  Back
                </Button>
                {importLoading ? (
                  // While the per-row reputation loop is running, the primary
                  // CTA flips to Cancel. Aborts the loop in place but keeps
                  // the sheet open so the user can tweak the filter toggle
                  // and re-run without re-pasting.
                  <Button
                    variant="secondary"
                    size="md"
                    icon={<X className="h-4 w-4" />}
                    onClick={cancelImport}
                  >
                    {importProgress
                      ? `Cancel (${importProgress.checked}/${importProgress.total})`
                      : 'Cancel'}
                  </Button>
                ) : (
                  <Button
                    size="md"
                    icon={<CheckSquare className="h-4 w-4" />}
                    onClick={executeImport}
                    disabled={importParsed.filter((r) => r.ok).length === 0}
                  >
                    Import {importParsed.filter((r) => r.ok).length} Proxies
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="secondary" size="md" onClick={() => void requestCloseImport()}>
                  Cancel
                </Button>
                <Button
                  size="md"
                  onClick={parseImport}
                  loading={importLoading}
                  disabled={importLoading || !importText.trim()}
                >
                  Preview
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Standalone IP fraud-check Dialog ──────────────────────────── */}
      <Dialog open={ipCheckOpen} onOpenChange={setIpCheckOpen}>
        <DialogContent className="max-w-md">
          <div className="space-y-1.5 mb-4">
            <DialogTitle>Check IP reputation</DialogTitle>
            <DialogDescription>
              Investigate any IP without adding it as a proxy. Both providers (ip-api + ipapi.is)
              are queried directly from this machine.
            </DialogDescription>
          </div>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ip-check-input">IP address</Label>
              <Input
                id="ip-check-input"
                placeholder="e.g. 84.54.120.38"
                value={ipCheckInput}
                onChange={(e) => setIpCheckInput(e.target.value)}
                disabled={ipCheckLoading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ipCheckInput.trim() && !ipCheckLoading) {
                    void handleStandaloneIpCheck()
                  }
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
              Privacy note: this query runs from your real machine — both providers will see your
              actual IP alongside the IP under investigation. Use the per-row Recheck action when
              you want to characterize a proxy without revealing your host.
            </p>
            {ipCheckError && (
              <div className="rounded-[--radius-md] bg-destructive/10 border border-destructive/25 px-3 py-2 text-xs text-destructive">
                {ipCheckError}
              </div>
            )}
            {ipCheckReport && <IpFraudReportPanel report={ipCheckReport} />}
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setIpCheckOpen(false)}>
              Close
            </Button>
            <Button
              size="md"
              icon={<ShieldCheck className="h-4 w-4" />}
              onClick={() => void handleStandaloneIpCheck()}
              loading={ipCheckLoading}
              disabled={ipCheckLoading || !ipCheckInput.trim()}
            >
              Check
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Right-click context menu ──────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getActionsForProxy(
            contextMenu.proxy,
            testingIds.has(contextMenu.proxy.id),
            checkingFraudIds.has(contextMenu.proxy.id)
          )}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// IpFraudReportPanel — shared between the standalone Dialog and any future
// inline lookup. Mirrors the reputation tooltip but in a full panel so the
// user can read every signal without hovering.
// ──────────────────────────────────────────────────────────────────────────

function IpFraudReportPanel({ report }: { report: IpFraudReport }): React.JSX.Element {
  const meta = FRAUD_BUCKET_META[report.fraud_risk]
  const flags: { label: string; on: boolean | null; tone: 'warn' | 'ok' | 'neutral' }[] = [
    { label: 'Datacenter / hosting', on: report.is_datacenter ?? report.is_hosting, tone: 'warn' },
    { label: 'Known proxy', on: report.is_proxy_detected, tone: 'warn' },
    { label: 'VPN', on: report.is_vpn, tone: 'warn' },
    { label: 'Tor', on: report.is_tor, tone: 'warn' },
    { label: 'Past abuse', on: report.is_abuser, tone: 'warn' },
    { label: 'Mobile carrier', on: report.is_mobile, tone: 'ok' }
  ]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-[--radius-md] bg-elevated/40 border border-border">
        <Badge variant={meta.variant} className="inline-flex items-center gap-1">
          {fraudBucketIcon(meta.icon)}
          {meta.label} {report.fraud_score}
        </Badge>
        <span className="text-xs text-muted-foreground">/ 100</span>
        <span className="ml-auto font-mono text-xs text-foreground">{report.ip}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {report.country && (
          <div className="rounded-[--radius-md] bg-input border border-border px-3 py-2">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Country</p>
            <p className="text-foreground">
              {report.country_code && (
                <span className="mr-1">{countryFlag(report.country_code)}</span>
              )}
              {report.country}
              {report.city ? ` — ${report.city}` : ''}
            </p>
          </div>
        )}
        {report.isp && (
          <div className="rounded-[--radius-md] bg-input border border-border px-3 py-2">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">ISP</p>
            <p className="text-foreground truncate" title={report.isp}>
              {report.isp}
            </p>
          </div>
        )}
        {report.asn && (
          <div className="rounded-[--radius-md] bg-input border border-border px-3 py-2 col-span-2">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">ASN</p>
            <p className="text-foreground font-mono truncate" title={report.asn}>
              {report.asn}
              {report.asn_type ? (
                <span className="text-muted-foreground ml-1">({report.asn_type})</span>
              ) : null}
            </p>
          </div>
        )}
        {report.abuse_score !== null && (
          <div className="rounded-[--radius-md] bg-input border border-border px-3 py-2 col-span-2">
            <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
              Abuse score (ipapi.is)
            </p>
            <p className="text-foreground font-mono">{(report.abuse_score * 100).toFixed(2)}%</p>
          </div>
        )}
      </div>
      <div className="rounded-[--radius-md] bg-input border border-border px-3 py-2">
        <p className="text-muted-foreground text-[10px] uppercase tracking-wider mb-2">Signals</p>
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <Badge
              key={f.label}
              variant={f.on === true ? (f.tone === 'warn' ? 'destructive' : 'success') : 'outline'}
              className="text-[11px]"
            >
              {f.on === null ? '— ' : f.on ? '✓ ' : '✗ '}
              {f.label}
            </Badge>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        Sources: {report.fraud_providers.join(', ') || 'none'}
      </p>
    </div>
  )
}
