/**
 * ProfilesPage — Vault iter-2.
 *
 * Rewritten on canonical shadcn/Radix primitives + Vault tokens. The editor
 * surface moved from a heavyweight Modal to a viewport-responsive `Sheet`,
 * the row table dropped `role="grid"` in favour of a flat virtualized list,
 * and all density / sort / group filter chrome runs through the canonical
 * `SelectRoot` family. ESC and overlay-click on the editor Sheet now defer
 * to the in-panel dirty-state confirm via a parent-held `isDirty` ref.
 */
import {
  memo,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  Plus,
  Play,
  Square,
  Copy,
  Trash2,
  Loader2,
  X,
  AlertCircle,
  Download,
  Upload,
  Globe,
  Globe2,
  Flame,
  ClipboardCopy,
  Pencil,
  Terminal,
  Camera,
  MoreHorizontal,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  HardDrive,
  Sparkles,
  Star,
  Eraser,
  ArrowUpDown,
  Rows3,
  Rows2,
  Filter,
  Shield,
  ShieldOff
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useProfilesStore } from '../stores/profiles'
import { useProxiesStore } from '../stores/proxies'
import { useFavoritesStore } from '../stores/favorites'
import { useConfirmStore } from '../components/ConfirmDialog'
import { useToastStore } from '../components/Toast'
import { ProfileEditorPanel, type InitialFingerprint } from './ProfileEditorPage'
import { AutomationModal } from '../components/profile/AutomationModal'
import {
  Button,
  Badge,
  SearchInput,
  DropdownMenu,
  EmptyState,
  Tooltip,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  ContextMenu,
  Sheet,
  SheetContent,
  SheetTitle
} from '../components/ui'
import type { DropdownMenuItem } from '../components/ui'
import { cn } from '../lib/utils'
import { api } from '../lib/api'
import { formatRelativeTime } from '../lib/formatRelativeTime'
import { useGroupCollapsedState } from '../hooks/useGroupCollapsedState'
import { useViewportWidth } from '../hooks/useViewportWidth'
import { useReducedMotion } from '../hooks/useReducedMotion'
import {
  PRESET_BROWSER_MAP,
  buildPresetMenuItems
} from '../lib/preset-menu'
import { parseTags } from '../lib/tags'
import type {
  BrowserType,
  ProfileStatus,
  Profile,
  ProxyResponse,
  FraudRisk,
  SessionInfo,
  UpdateFingerprintInput
} from '../lib/types'
import type { PresetDescriptor } from '../../../preload/api-contract'

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'last_used' | 'created_at'
type SortDir = 'asc' | 'desc'
type Density = 'compact' | 'comfortable'
type StatusFilterValue = 'all' | 'running' | 'error' | 'ready'
type ProxyFilterValue = 'all' | 'with-proxy' | 'no-proxy'

// Pixel heights per density for virtualization. Group headers add a fixed
// 28px stripe between sections.
const ROW_HEIGHT_BY_DENSITY: Record<Density, number> = {
  compact: 40,
  comfortable: 56
}
const GROUP_HEADER_HEIGHT_PX = 28
const OVERSCAN = 5

// LocalStorage keys for compact persistence (UI prefs only — never the data).
const DENSITY_STORAGE_KEY = 'lux.profiles.density'
const SORT_STORAGE_KEY = 'lux.profiles.sort'

// Test sites surfaced as row-menu quick actions. Keep in sync with the
// verification chips in ProfileEditorPage when adding new entries.
const TEST_SITE_CREEPJS = 'https://abrahamjuliot.github.io/creepjs/'
const TEST_SITE_PIXELSCAN = 'https://pixelscan.net'

// Group bucket name for ungrouped profiles. Empty string here is fine because
// a real group_name can't be empty — the DB column carries either a name or null.
const NO_GROUP_KEY = ''
const NO_GROUP_LABEL = 'Ungrouped'

// Sentinel value for the "Ungrouped" item inside the canonical Select family.
// Radix forbids an empty-string `value` on `<SelectItem>` (it throws at mount
// because empty string is reserved for "no selection"), so we map our internal
// NO_GROUP_KEY ('') to a non-empty token at the SelectItem boundary only.
const NO_GROUP_SENTINEL = '__nogroup__'

// Editor Sheet width (px). Spec says 640.
const EDITOR_SHEET_WIDTH_PX = 640
// Floor for the editor Sheet width on cramped viewports. Below this the
// editor's two-column form starts wrapping in awkward ways, so we'd rather
// let the user scroll the list under it than crush the form.
const EDITOR_SHEET_MIN_WIDTH_PX = 420
// Pixels of list / chrome the user should still see behind the editor on
// small windows. 360px keeps the sticky filter strip + a slice of the
// left rail visible so the user retains spatial context.
const EDITOR_SHEET_CONTEXT_RESERVE_PX = 360

// Vertical clearance reserved at the bottom of the virtualized scroll surface
// while the bulk-action floater is visible. Floater height (~48px) + the 16px
// gap from `bottom-4` so the last row never overlaps the floater controls.
const BULK_FLOATER_CLEARANCE_PX = 64

// Status pill mapping: variant + text. Dot tinting comes from Badge's `dot`
// prop which inherits the variant's foreground color.
const STATUS_BADGE: Record<
  ProfileStatus,
  { variant: 'muted' | 'success' | 'warning' | 'destructive'; label: string }
> = {
  ready: { variant: 'muted', label: 'Ready' },
  starting: { variant: 'warning', label: 'Starting' },
  running: { variant: 'success', label: 'Running' },
  stopping: { variant: 'warning', label: 'Stopping' },
  error: { variant: 'destructive', label: 'Error' }
}

const BROWSER_LABEL: Record<BrowserType, string> = {
  chromium: 'Chromium',
  firefox: 'Firefox',
  edge: 'Edge'
}

const BROWSER_ICONS: Record<BrowserType, typeof Globe> = {
  chromium: Globe,
  firefox: Flame,
  edge: Globe2
}

// Bucket → dot tone for the proxy chip's reputation indicator.
const FRAUD_DOT_CLASS: Record<NonNullable<FraudRisk>, string> = {
  clean: 'bg-ok',
  low: 'bg-ok',
  medium: 'bg-warn',
  high: 'bg-destructive',
  critical: 'bg-destructive',
  unknown: 'bg-muted-foreground/60'
}

// ISO country code → emoji flag (regional indicator pair). Returns empty
// string for unknown / invalid codes so the chip just shows the proxy name.
function countryFlagEmoji(code: string | null): string {
  if (!code || code.length !== 2) return ''
  const upper = code.toUpperCase()
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const FINGERPRINT_EXPORT_KEYS = [
  'user_agent',
  'platform',
  'hardware_concurrency',
  'device_memory',
  'languages',
  'screen_width',
  'screen_height',
  'color_depth',
  'pixel_ratio',
  'timezone',
  'canvas_noise_seed',
  'webgl_vendor',
  'webgl_renderer',
  'audio_context_noise',
  'fonts_list',
  'webrtc_policy',
  'video_inputs',
  'audio_inputs',
  'audio_outputs',
  'device_type'
] as const satisfies readonly (keyof InitialFingerprint)[]

function pickFingerprintFields(raw: unknown): Partial<InitialFingerprint> | undefined {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }

  const source = raw as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const key of FINGERPRINT_EXPORT_KEYS) {
    const value = source[key]
    if (value !== undefined) picked[key] = value
  }

  return Object.keys(picked).length > 0
    ? (picked as Partial<InitialFingerprint>)
    : undefined
}

function parseFingerprintLanguages(raw: unknown): string[] | undefined {
  let values = raw

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    try {
      values = JSON.parse(trimmed) as unknown
    } catch {
      values = trimmed.split(',')
    }
  }

  if (!Array.isArray(values)) return undefined

  const languages = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)

  return languages.length > 0 ? languages : undefined
}

function pickUpdateFingerprintInput(raw: unknown): UpdateFingerprintInput | undefined {
  const fingerprint = pickFingerprintFields(raw)
  if (!fingerprint) return undefined

  const input: UpdateFingerprintInput = {
    user_agent: fingerprint.user_agent,
    platform: fingerprint.platform,
    hardware_concurrency: fingerprint.hardware_concurrency,
    device_memory: fingerprint.device_memory,
    screen_width: fingerprint.screen_width,
    screen_height: fingerprint.screen_height,
    color_depth: fingerprint.color_depth,
    pixel_ratio: fingerprint.pixel_ratio,
    device_type: fingerprint.device_type,
    timezone: fingerprint.timezone,
    webgl_vendor: fingerprint.webgl_vendor,
    webgl_renderer: fingerprint.webgl_renderer,
    webrtc_policy: fingerprint.webrtc_policy,
    languages: parseFingerprintLanguages(fingerprint.languages)
  }

  for (const key of Object.keys(input) as (keyof UpdateFingerprintInput)[]) {
    if (input[key] === undefined) delete input[key]
  }

  return Object.keys(input).length > 0 ? input : undefined
}

function readDensityFromStorage(): Density {
  try {
    const raw = localStorage.getItem(DENSITY_STORAGE_KEY)
    if (raw === 'compact' || raw === 'comfortable') return raw
    // Migration path from prior key value 'cozy' → comfortable.
    if (raw === 'cozy') return 'comfortable'
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
        parsed.key === 'name' || parsed.key === 'last_used' || parsed.key === 'created_at'
          ? parsed.key
          : 'last_used'
      const dir: SortDir = parsed.dir === 'asc' ? 'asc' : 'desc'
      return { key, dir }
    }
  } catch {
    /* ignore */
  }
  return { key: 'last_used', dir: 'desc' }
}

// Binary search: smallest index `i` in a non-decreasing `arr` where
// `arr[i] >= target`. Returns `arr.length` when no element satisfies.
// Used to locate the first row whose top offset crosses the viewport.
function lowerBound(arr: number[], target: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Comparators tuned for the ProfilesPage's three sortable columns. `name`
// uses locale-aware compare; the timestamp keys do simple string compare
// because ISO 8601 strings sort correctly lexically.
function compareProfiles(a: Profile, b: Profile, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1
  if (key === 'name') {
    return sign * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  }
  // last_used is nullable — null sorts to the end regardless of direction
  // because "never used" is least informative.
  if (key === 'last_used') {
    const av = a.last_used ?? ''
    const bv = b.last_used ?? ''
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    return av < bv ? -sign : av > bv ? sign : 0
  }
  // created_at
  const av = a[key] ?? ''
  const bv = b[key] ?? ''
  return av < bv ? -sign : av > bv ? sign : 0
}

// Visible row in the virtualized list. We flatten group sections into a
// single sequence so the virtualizer can stay simple.
type VisibleRow =
  | { kind: 'group'; group: string; label: string; count: number; collapsed: boolean }
  | { kind: 'profile'; group: string; profile: Profile; profileIndex: number }

interface BuildSequenceArgs {
  profiles: Profile[]
  isCollapsed: (group: string) => boolean
  density: Density
}

interface BuildSequenceResult {
  rows: VisibleRow[]
  /** Pixel offset of each row from the top of the scroll content. */
  offsets: number[]
  totalHeight: number
  /**
   * Map from `profileIndex` (0-based across all visible profiles) to its
   * position in the `rows` array. Used by keyboard nav to translate ↑/↓
   * row movements into a row index that includes group headers.
   */
  profileIndexToRowIndex: number[]
}

function buildVisibleSequence({
  profiles,
  isCollapsed,
  density
}: BuildSequenceArgs): BuildSequenceResult {
  // Bucket profiles by group preserving the input order (which is already
  // sorted by the caller). Iteration order of a Map matches insertion order.
  const buckets = new Map<string, Profile[]>()
  for (const p of profiles) {
    const key = p.group_name ?? NO_GROUP_KEY
    const list = buckets.get(key)
    if (list) list.push(p)
    else buckets.set(key, [p])
  }

  const rows: VisibleRow[] = []
  const offsets: number[] = []
  const profileIndexToRowIndex: number[] = []
  const profileRowHeight = ROW_HEIGHT_BY_DENSITY[density]
  let cursor = 0
  let visibleProfileCounter = 0

  for (const [group, list] of buckets) {
    // Render a header for any non-empty bucket. Even ungrouped gets a header
    // so the section is visually distinct (only when there's also a "real"
    // group present). When all rows are ungrouped we suppress the header
    // because a single header above the only section reads as noise.
    const renderHeader = group !== NO_GROUP_KEY || buckets.size > 1
    if (renderHeader) {
      const collapsed = isCollapsed(group)
      const label = group === NO_GROUP_KEY ? NO_GROUP_LABEL : group
      rows.push({ kind: 'group', group, label, count: list.length, collapsed })
      offsets.push(cursor)
      cursor += GROUP_HEADER_HEIGHT_PX
      if (collapsed) continue
    }
    for (const p of list) {
      rows.push({ kind: 'profile', group, profile: p, profileIndex: visibleProfileCounter })
      offsets.push(cursor)
      profileIndexToRowIndex[visibleProfileCounter] = rows.length - 1
      visibleProfileCounter++
      cursor += profileRowHeight
    }
  }
  return { rows, offsets, totalHeight: cursor, profileIndexToRowIndex }
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

interface FilterChipProps {
  active: boolean
  onClick: () => void
  onClear?: () => void
  /** Visible label. Always passed for tooltip + a11y; collapses below `lg`. */
  label: string
  /** Optional left-edge tinted dot (status filters). */
  dotClass?: string
  /** Optional left-edge icon (browser / proxy filters). */
  icon?: React.ReactNode
}

// Square, single-button chip. One hit target: clicking an active chip clears
// it (delegates to `onClear` when provided), otherwise activates via `onClick`.
// Below `lg` (1024px) the chip collapses to a 28x28 icon-only square; at and
// above `lg` it expands to icon + label. Memoized — parent passes stable
// callbacks so re-renders on unrelated updates are short-circuited.
const FilterChip = memo(function FilterChip({
  active,
  onClick,
  onClear,
  label,
  dotClass,
  icon
}: FilterChipProps): React.JSX.Element {
  const handleClick = active && onClear ? onClear : onClick
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 shrink-0',
        'h-7 w-7 lg:w-auto lg:px-2.5',
        'rounded-[--radius-md] text-[11.5px] font-medium',
        'transition-colors duration-150 ease-[var(--ease-osmosis)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-elevated/60 hover:text-foreground'
      )}
    >
      {dotClass && (
        <span
          aria-hidden
          className={cn('h-2 w-2 lg:h-1.5 lg:w-1.5 rounded-full shrink-0', dotClass)}
        />
      )}
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
})

function RunningTimer({ startedAt }: { startedAt: string }): React.JSX.Element {
  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    const start = new Date(startedAt).getTime()
    const update = (): void => {
      const secs = Math.floor((Date.now() - start) / 1000)
      if (secs < 60) setElapsed(`${secs}s`)
      else if (secs < 3600) setElapsed(`${Math.floor(secs / 60)}m ${secs % 60}s`)
      else {
        const h = Math.floor(secs / 3600)
        const m = Math.floor((secs % 3600) / 60)
        setElapsed(`${h}h ${m}m`)
      }
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  return <span className="text-[10px] text-primary font-mono tabular-nums">{elapsed}</span>
}

interface ProxyChipProps {
  proxy: ProxyResponse
}

function ProxyChip({ proxy }: ProxyChipProps): React.JSX.Element {
  const flag = countryFlagEmoji(proxy.country)
  const dotClass = FRAUD_DOT_CLASS[proxy.fraud_risk ?? 'unknown']
  const score = proxy.fraud_score
  const country = proxy.country ?? 'unknown country'
  const fraudRisk = proxy.fraud_risk ?? 'unknown'
  const accessibleLabel =
    `Proxy ${proxy.name}, ${country}, fraud risk ${fraudRisk}` +
    (score != null ? `, score ${score}` : '')
  const tooltip = (
    <div className="space-y-0.5 text-[11.5px] leading-snug">
      <div className="font-semibold text-foreground">{proxy.name}</div>
      {proxy.external_ip && (
        <div>
          <span className="text-muted-foreground">IP </span>
          <span className="font-mono">{proxy.external_ip}</span>
        </div>
      )}
      {proxy.isp && (
        <div>
          <span className="text-muted-foreground">ISP </span>
          {proxy.isp}
        </div>
      )}
      {proxy.asn && (
        <div>
          <span className="text-muted-foreground">ASN </span>
          <span className="font-mono">{proxy.asn}</span>
        </div>
      )}
      {proxy.fraud_risk && proxy.fraud_risk !== 'unknown' && score !== null && (
        <div>
          <span className="text-muted-foreground">Score </span>
          <span className="font-mono">{score}</span>
          <span className="text-muted-foreground"> · {proxy.fraud_risk}</span>
        </div>
      )}
    </div>
  )
  return (
    <Tooltip content={tooltip}>
      <span
        tabIndex={0}
        role="img"
        aria-label={accessibleLabel}
        className={cn(
          'inline-flex items-center gap-1.5 h-5 rounded-full px-2 max-w-full',
          'bg-elevated/60 border border-border text-[11px] text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
        )}
      >
        {flag && (
          <span className="leading-none" aria-hidden>
            {flag}
          </span>
        )}
        <span className="truncate font-medium" aria-hidden>
          {proxy.name}
        </span>
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotClass)} aria-hidden />
      </span>
    </Tooltip>
  )
}

interface TagChipsProps {
  tags: string[]
}

function TagChips({ tags }: TagChipsProps): React.JSX.Element | null {
  if (tags.length === 0) {
    return <span className="text-[11px] text-muted-foreground/40">—</span>
  }
  const visible = tags.slice(0, 3)
  const hidden = tags.length - visible.length
  const overflowList = tags.slice(3)
  return (
    <div className="flex items-center gap-1 min-w-0">
      {visible.map((tag) => (
        <Badge key={tag} variant="outline" className="h-5 px-1.5 text-[10px] truncate max-w-[80px]">
          {tag}
        </Badge>
      ))}
      {hidden > 0 && (
        <Tooltip content={overflowList.join(', ')}>
          <Badge
            variant="outline"
            className="h-5 px-1.5 text-[10px]"
            aria-label={`Plus ${hidden} more tags: ${overflowList.join(', ')}`}
          >
            +{hidden}
          </Badge>
        </Tooltip>
      )}
    </div>
  )
}

interface ProfileRowProps {
  profile: Profile
  proxy: ProxyResponse | null
  session: SessionInfo | undefined
  selected: boolean
  focused: boolean
  isFavorite: boolean
  density: Density
  groupColor: string | null
  /**
   * Lazy resolver: called on dropdown / context open so per-row action arrays
   * don't get rebuilt on every parent render. Must be a stable reference.
   */
  getActionsForProfile: (
    profileId: string,
    profileName: string,
    status: ProfileStatus,
    browserType: BrowserType
  ) => DropdownMenuItem[]
  errorMessage: string | undefined
  onToggleSelect: (profileId: string, profileIndex: number, shiftKey: boolean) => void
  onClickRow: (profileId: string) => void
  onDoubleClickRow: (profileId: string, status: ProfileStatus) => void
  onContextMenu: (
    e: ReactMouseEvent,
    profile: { id: string; name: string; status: ProfileStatus; browserType: BrowserType }
  ) => void
  onToggleFavorite: (profileId: string) => void
  onLaunch: (profileId: string) => void
  onStop: (profileId: string) => void
  onClearError: (profileId: string) => void
  /** Position of this row in the visible-profile sequence. */
  profileIndex: number
  /** Ref-callback so the parent can focus a row imperatively for keyboard nav. */
  registerRef: (profileId: string, el: HTMLDivElement | null) => void
}

function ProfileRowComponent({
  profile,
  proxy,
  session,
  selected,
  focused,
  isFavorite,
  density,
  groupColor,
  getActionsForProfile,
  errorMessage,
  onToggleSelect,
  onClickRow,
  onDoubleClickRow,
  onContextMenu,
  onToggleFavorite,
  onLaunch,
  onStop,
  onClearError,
  profileIndex,
  registerRef
}: ProfileRowProps): React.JSX.Element {
  const status = STATUS_BADGE[profile.status]
  const isTransitioning = profile.status === 'starting' || profile.status === 'stopping'
  const isComfortable = density === 'comfortable'
  const tags = parseTags(profile.tags)
  const BrowserIcon = BROWSER_ICONS[profile.browser_type]

  // Lazy: only built when the dropdown / context menu actually opens.
  const rowActions = useMemo(
    () => getActionsForProfile(profile.id, profile.name, profile.status, profile.browser_type),
    [getActionsForProfile, profile.id, profile.name, profile.status, profile.browser_type]
  )

  // Resolve the last-used timestamp once per row render rather than twice
  // (Tooltip content prop + <time> aria-label). React.memo gates re-renders
  // so this only fires when the row actually changes.
  const lastUsedLabel = useMemo(
    () => (profile.last_used ? new Date(profile.last_used).toLocaleString() : 'Never used'),
    [profile.last_used]
  )

  const refCallback = useCallback(
    (el: HTMLDivElement | null) => registerRef(profile.id, el),
    [registerRef, profile.id]
  )

  return (
    <div
      ref={refCallback}
      role="option"
      tabIndex={focused ? 0 : -1}
      aria-selected={selected}
      data-profile-id={profile.id}
      onClick={() => onClickRow(profile.id)}
      onDoubleClick={() => onDoubleClickRow(profile.id, profile.status)}
      onContextMenu={(e) =>
        onContextMenu(e, {
          id: profile.id,
          name: profile.name,
          status: profile.status,
          browserType: profile.browser_type
        })
      }
      className={cn(
        'group/row relative flex items-center gap-3 pl-4 pr-2 cursor-pointer select-none',
        'border-b border-border/40 transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset',
        focused
          ? 'bg-elevated/55'
          : selected
            ? 'bg-primary/[0.05]'
            : 'hover:bg-elevated/30'
      )}
      style={{ height: ROW_HEIGHT_BY_DENSITY[density] }}
    >
      {/* Left group-color stripe */}
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: groupColor ?? 'transparent' }}
      />
      {/* Focus stripe (overrides group color when focused) */}
      {focused && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary shadow-[0_0_8px_var(--color-primary)]"
        />
      )}

      {/* Selection toggle — `role="checkbox"` makes the toggle a real
          focusable element with proper aria semantics. The button is taken
          out of the tab order (tabIndex=-1) because the row owns roving
          tabindex; Space at the row level toggles selection via the
          listbox keydown handler. Mouse / shift-click users still hit
          the button's `onClick` for range extension. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`${selected ? 'Deselect' : 'Select'} profile ${profile.name}`}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(profile.id, profileIndex, e.shiftKey)
        }}
        className={cn(
          'shrink-0 inline-flex items-center justify-center h-4 w-4 rounded-[--radius-sm]',
          'border bg-input transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          selected ? 'bg-primary border-primary' : 'border-edge hover:border-primary/60'
        )}
      >
        {selected && (
          <svg
            aria-hidden
            viewBox="0 0 12 12"
            className="h-3 w-3 text-primary-foreground"
          >
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

      {/* Star (favorite) */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite(profile.id)
        }}
        className={cn(
          'shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-[--radius-sm] transition-all',
          isFavorite
            ? 'text-warn'
            : 'text-muted-foreground/40 opacity-0 group-hover/row:opacity-100 hover:text-warn'
        )}
        aria-label={isFavorite ? 'Unstar profile' : 'Star profile'}
        title={isFavorite ? 'Unstar' : 'Star (pin to top)'}
      >
        <Star className="h-3.5 w-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
      </button>

      {/* Status pill (badge with leading dot). Error variant tooltips the
          error message and is clickable to dismiss it without opening the
          editor — preserves prior behaviour. */}
      {profile.status === 'error' ? (
        <Tooltip content={errorMessage ?? 'Error - click to dismiss'}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClearError(profile.id)
            }}
            aria-label="Dismiss error"
            className="shrink-0"
          >
            <Badge
              variant={status.variant}
              dot
              className="h-5 min-w-[68px] justify-start tabular-nums cursor-pointer hover:bg-destructive/20"
            >
              <AlertCircle className="h-3 w-3 -mr-0.5" />
              {status.label}
            </Badge>
          </button>
        </Tooltip>
      ) : (
        <Badge
          variant={status.variant}
          dot
          className="h-5 shrink-0 min-w-[68px] justify-start tabular-nums"
        >
          {isTransitioning && <Loader2 className="h-3 w-3 animate-spin -mr-0.5" />}
          {status.label}
        </Badge>
      )}

      {/* Name + meta line */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 leading-tight">
        <span className="font-medium text-foreground truncate">
          {profile.name}
        </span>
        {isComfortable && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 truncate">
            <BrowserIcon className="h-3 w-3" />
            <span>{BROWSER_LABEL[profile.browser_type]}</span>
            {profile.group_name && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="truncate">{profile.group_name}</span>
              </>
            )}
            {profile.status === 'running' && session && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <RunningTimer startedAt={session.started_at} />
              </>
            )}
          </span>
        )}
      </div>

      {/* Compact-density meta inline (browser + group on a single line, hidden in comfortable) */}
      {!isComfortable && (
        <span className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground/80 shrink-0 max-w-[160px] truncate">
          <BrowserIcon className="h-3 w-3" />
          <span>{BROWSER_LABEL[profile.browser_type]}</span>
          {profile.group_name && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate">{profile.group_name}</span>
            </>
          )}
        </span>
      )}

      {/* Tags */}
      <div className="hidden lg:flex items-center min-w-0 max-w-[200px]">
        <TagChips tags={tags} />
      </div>

      {/* Proxy chip */}
      <div className="hidden md:flex items-center min-w-0 max-w-[180px] shrink-0">
        {proxy ? (
          <ProxyChip proxy={proxy} />
        ) : (
          <span className="text-[11px] text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Last used. `<time>` carries the canonical timestamp via `dateTime` and
          a human-readable label via `aria-label`; the visible text remains the
          relative summary so the dense column doesn't blow up. `tabIndex={0}`
          makes the tooltip reachable for keyboard users (the global
          `*:focus-visible` ring in `index.css` paints the focus indicator). */}
      <Tooltip content={lastUsedLabel}>
        <time
          dateTime={profile.last_used ?? undefined}
          aria-label={lastUsedLabel}
          tabIndex={0}
          className="hidden md:inline text-[11px] text-muted-foreground tabular-nums shrink-0 w-[72px] text-right"
        >
          {formatRelativeTime(profile.last_used)}
        </time>
      </Tooltip>

      {/* Quick action — launch / stop on hover */}
      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        {profile.status === 'running' ? (
          <button
            type="button"
            onClick={() => onStop(profile.id)}
            className={cn(
              'opacity-0 group-hover/row:opacity-100 focus:opacity-100',
              'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
              'text-destructive hover:bg-destructive/10 transition-opacity'
            )}
            aria-label="Stop profile"
            title="Stop"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
        ) : profile.status === 'ready' || profile.status === 'error' ? (
          <button
            type="button"
            onClick={() => onLaunch(profile.id)}
            className={cn(
              'opacity-0 group-hover/row:opacity-100 focus:opacity-100',
              'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
              'text-ok hover:bg-ok/10 transition-opacity'
            )}
            aria-label="Launch profile"
            title="Launch"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <DropdownMenu
          align="right"
          items={rowActions}
          trigger={
            <button
              type="button"
              className="h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm] text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
              aria-label="Profile actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          }
        />
      </div>
    </div>
  )
}

// Memoized to keep unrelated rows from re-rendering on every parent update
// (filter typing, scroll, focus drift). All callbacks passed in are wrapped
// in `useCallback` upstream, and `getActionsForProfile` is also stable, so
// the default shallow comparator is enough.
const ProfileRow = memo(ProfileRowComponent)

interface GroupHeaderProps {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
}

function GroupHeaderRow({ label, count, collapsed, onToggle }: GroupHeaderProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full flex items-center gap-2 pl-4 pr-4 text-[11px] font-semibold uppercase tracking-[0.08em]',
        'bg-card/70 border-b border-border/40 text-muted-foreground hover:text-foreground',
        'transition-colors duration-150 ease-[var(--ease-osmosis)]'
      )}
      style={{ height: GROUP_HEADER_HEIGHT_PX }}
      aria-expanded={!collapsed}
    >
      <ChevronDown
        className={cn(
          'h-3 w-3 transition-transform duration-150 ease-[var(--ease-osmosis)]',
          collapsed && '-rotate-90'
        )}
      />
      <span>{label}</span>
      <Badge variant="muted" className="h-4 px-1.5 text-[10px] tabular-nums">
        {count}
      </Badge>
    </button>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────

export function ProfilesPage(): React.JSX.Element {
  // ── Stores ────────────────────────────────────────────────────────────
  const profiles = useProfilesStore((s) => s.profiles)
  const loading = useProfilesStore((s) => s.loading)
  const profileErrors = useProfilesStore((s) => s.profileErrors)
  const fetchProfiles = useProfilesStore((s) => s.fetchProfiles)
  const fetchSessions = useProfilesStore((s) => s.fetchSessions)
  const sessions = useProfilesStore((s) => s.sessions)
  const clearProfileError = useProfilesStore((s) => s.clearProfileError)
  const editorMode = useProfilesStore((s) => s.editorMode)
  const editorProfileId = useProfilesStore((s) => s.editorProfileId)
  const navigate = useNavigate()
  const openEditor = useProfilesStore((s) => s.openEditor)
  const closeEditor = useProfilesStore((s) => s.closeEditor)
  const actions = useProfilesStore(
    useShallow((s) => ({
      launch: s.launchBrowser,
      stop: s.stopBrowser,
      delete: s.deleteProfile,
      duplicate: s.duplicateProfile,
      scheduleDelete: s.scheduleDelete
    }))
  )
  const pendingDeletes = useProfilesStore((s) => s.pendingDeletes)
  const proxies = useProxiesStore((s) => s.proxies)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)
  const confirm = useConfirmStore((s) => s.show)
  const addToast = useToastStore((s) => s.addToast)
  const favoriteIds = useFavoritesStore((s) => s.ids)
  const toggleFavorite = useFavoritesStore((s) => s.toggle)

  // ── Local UI state ────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all')
  const [browserFilter, setBrowserFilter] = useState<BrowserType | 'all'>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [proxyFilter, setProxyFilter] = useState<ProxyFilterValue>('all')
  const [density, setDensity] = useState<Density>(readDensityFromStorage)
  const initialSort = useMemo(readSortFromStorage, [])
  const [sortKey, setSortKey] = useState<SortKey>(initialSort.key)
  const [sortDir, setSortDir] = useState<SortDir>(initialSort.dir)
  const [focusedProfileIdx, setFocusedProfileIdx] = useState<number | null>(null)
  const lastCheckedIdx = useRef<number | null>(null)
  const { isCollapsed, toggle: toggleGroupCollapsed } = useGroupCollapsedState()
  const prefersReducedMotion = useReducedMotion()

  // Map of profileId → row DOM. Populated via the row's ref callback so the
  // listbox can imperatively focus rows on ↑/↓/Home/End. The map is cleaned
  // up by the same callback when a row unmounts (el === null).
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // Currently-focused profile id, kept in a ref so `registerRowRef` can read
  // it without forcing the callback identity to change on every focus move.
  // When a row mounts (or remounts after a virtualization recycle) and its
  // id matches this ref, the callback claims DOM focus immediately. This
  // closes the race where ↑/↓/Home/End/PageDown jumps target a row that
  // hasn't entered the rendered window yet — by the time the row mounts,
  // the focus effect has already run and won't refire.
  const focusedProfileIdRef = useRef<string | null>(null)
  const registerRowRef = useCallback((profileId: string, el: HTMLDivElement | null) => {
    if (el) {
      rowRefs.current.set(profileId, el)
      // Claim focus the moment the targeted row mounts. Guard against
      // grabbing focus during incidental mounts (scroll virtualization
      // recycling rows that happen not to be the focus target) by checking
      // the live ref. `preventScroll` matches the focus effect — scroll
      // positioning is owned by the effect, not the row mount.
      if (
        focusedProfileIdRef.current === profileId &&
        document.activeElement !== el
      ) {
        el.focus({ preventScroll: true })
      }
    } else {
      rowRefs.current.delete(profileId)
    }
  }, [])

  // Bulk-floater first action — focused when a selection appears so keyboard
  // users can act on the bar without an extra Tab.
  const bulkFirstActionRef = useRef<HTMLButtonElement | null>(null)
  const previousSelectionSize = useRef(0)

  // Right-click context menu state — coords + the profile that was clicked.
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    profileId: string
    profileName: string
    status: ProfileStatus
    browserType: BrowserType
  } | null>(null)

  // Presets cache + create-from-preset handoff to the editor
  const [presets, setPresets] = useState<PresetDescriptor[] | null>(null)
  const presetsLoadingRef = useRef(false)
  const [pendingFingerprint, setPendingFingerprint] = useState<InitialFingerprint | null>(null)
  const [pendingBrowser, setPendingBrowser] = useState<BrowserType | null>(null)
  const [pendingSeed, setPendingSeed] = useState(0)

  // Automation modal target
  const [automationFor, setAutomationFor] = useState<{ id: string; name: string } | null>(null)

  // ── Stable filter-chip handlers ───────────────────────────────────────
  // Each chip wires through stable callbacks so `React.memo` on FilterChip
  // can short-circuit on unrelated parent updates (search keystrokes,
  // scroll, focus drift). Per-value handlers are clearer than a higher-
  // order factory at this scale (<20 chips).
  const setStatusRunning = useCallback(() => setStatusFilter('running'), [])
  const setStatusReady = useCallback(() => setStatusFilter('ready'), [])
  const setStatusError = useCallback(() => setStatusFilter('error'), [])
  const clearStatusFilter = useCallback(() => setStatusFilter('all'), [])

  const setBrowserChromium = useCallback(() => setBrowserFilter('chromium'), [])
  const setBrowserFirefox = useCallback(() => setBrowserFilter('firefox'), [])
  const setBrowserEdge = useCallback(() => setBrowserFilter('edge'), [])
  const clearBrowserFilter = useCallback(() => setBrowserFilter('all'), [])

  const setProxyWith = useCallback(() => setProxyFilter('with-proxy'), [])
  const setProxyWithout = useCallback(() => setProxyFilter('no-proxy'), [])
  const clearProxyFilter = useCallback(() => setProxyFilter('all'), [])

  // ── Persist density / sort preferences ────────────────────────────────
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
    fetchProfiles()
    fetchSessions()
    fetchProxies()
  }, [fetchProfiles, fetchSessions, fetchProxies])

  // Title reflects running count. Reads the derived `runningCount` from the
  // store (kept in sync alongside every profiles mutation) so it doesn't
  // re-scan the list per notification.
  const runningCount = useProfilesStore((s) => s.runningCount)
  useEffect(() => {
    document.title = runningCount > 0 ? `Lux (${runningCount} running)` : 'Lux Antidetect'
    return () => {
      document.title = 'Lux Antidetect'
    }
  }, [runningCount])

  // ── Auto-refresh proxies when fraud metadata updates server-side ───────
  // ProxiesPage already listens; the profiles list also benefits because the
  // ProxyChip's reputation dot reflects fraud_risk on the joined ProxyResponse.
  useEffect(() => {
    const off = window.api?.onProxyMetadataUpdated?.(() => {
      void fetchProxies()
    })
    return () => {
      off?.()
    }
  }, [fetchProxies])

  // ── Presets cache ─────────────────────────────────────────────────────
  const loadPresets = useCallback(async (): Promise<void> => {
    if (presets || presetsLoadingRef.current) return
    presetsLoadingRef.current = true
    try {
      const list = await api.listFingerprintPresets()
      setPresets(list)
    } catch {
      setPresets([])
    } finally {
      presetsLoadingRef.current = false
    }
  }, [presets])

  useEffect(() => {
    loadPresets()
  }, [loadPresets])

  // ── Derived: filtered + sorted profiles ───────────────────────────────
  const proxyMap = useMemo(() => new Map(proxies.map((p) => [p.id, p])), [proxies])
  // O(1) lookup for the running session that matches a row, instead of
  // `sessions.find()` per visible row on every scroll/keystroke tick.
  const sessionMap = useMemo(
    () => new Map(sessions.map((s) => [s.profile_id, s])),
    [sessions]
  )

  const allGroups = useMemo(() => {
    const set = new Set<string>()
    for (const p of profiles) {
      if (p.group_name) set.add(p.group_name)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [profiles])

  const filteredProfiles = useMemo(() => {
    let result =
      pendingDeletes.size === 0 ? profiles : profiles.filter((p) => !pendingDeletes.has(p.id))

    if (statusFilter !== 'all') {
      result = result.filter((p) => {
        if (statusFilter === 'running') return p.status === 'running' || p.status === 'starting'
        if (statusFilter === 'ready') return p.status === 'ready'
        return p.status === 'error'
      })
    }

    if (browserFilter !== 'all') {
      result = result.filter((p) => p.browser_type === browserFilter)
    }

    if (groupFilter !== 'all') {
      result = result.filter((p) => (p.group_name ?? NO_GROUP_KEY) === groupFilter)
    }

    if (proxyFilter !== 'all') {
      result = result.filter((p) =>
        proxyFilter === 'with-proxy' ? p.proxy_id != null : p.proxy_id == null
      )
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.browser_type.toLowerCase().includes(q) ||
          (p.group_name?.toLowerCase().includes(q) ?? false) ||
          parseTags(p.tags).some((t) => t.toLowerCase().includes(q))
      )
    }

    return [...result].sort((a, b) => {
      // Favorites float above non-favorites regardless of sort key.
      const aFav = favoriteIds.has(a.id)
      const bFav = favoriteIds.has(b.id)
      if (aFav !== bFav) return aFav ? -1 : 1
      return compareProfiles(a, b, sortKey, sortDir)
    })
  }, [
    profiles,
    pendingDeletes,
    statusFilter,
    browserFilter,
    groupFilter,
    proxyFilter,
    searchQuery,
    sortKey,
    sortDir,
    favoriteIds
  ])

  // ── Virtualization sequence ───────────────────────────────────────────
  const sequence = useMemo(
    () => buildVisibleSequence({ profiles: filteredProfiles, isCollapsed, density }),
    [filteredProfiles, isCollapsed, density]
  )

  // ── Scroll math ───────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
    setViewportHeight(e.currentTarget.clientHeight)
  }, [])

  // Find first/last visible row indices via binary search over the offsets
  // array (monotonically non-decreasing). lowerBound(offsets, top) returns
  // the first row whose top edge is >= scrollTop; we step back one to catch
  // the row whose body straddles the viewport top.
  const { startIdx, endIdx } = useMemo(() => {
    const { offsets, rows } = sequence
    if (rows.length === 0) return { startIdx: 0, endIdx: 0 }
    const top = scrollTop
    const bottom = scrollTop + viewportHeight
    let start = lowerBound(offsets, top)
    if (start > 0) start -= 1
    const end = lowerBound(offsets, bottom)
    return {
      startIdx: Math.max(0, start - OVERSCAN),
      endIdx: Math.min(rows.length, end + OVERSCAN)
    }
  }, [sequence, scrollTop, viewportHeight])

  // Clamp focused profile index when the filtered list shrinks below it.
  const visibleProfileCount = sequence.profileIndexToRowIndex.length
  useEffect(() => {
    if (focusedProfileIdx === null) return
    if (focusedProfileIdx >= visibleProfileCount) {
      setFocusedProfileIdx(visibleProfileCount > 0 ? visibleProfileCount - 1 : null)
    }
  }, [visibleProfileCount, focusedProfileIdx])

  // ── Profile actions ───────────────────────────────────────────────────

  const handleLaunch = useCallback(
    async (id: string): Promise<void> => {
      const p = profiles.find((x) => x.id === id)
      const name = p?.name ?? 'Profile'
      try {
        await actions.launch(id)
        const updated = useProfilesStore.getState().profiles.find((x) => x.id === id)
        if (updated?.status === 'error') {
          addToast(`Failed to launch ${name}`, 'error')
        } else if (updated?.status === 'running' || updated?.status === 'starting') {
          addToast(`${name} launched`, 'success')
        }
      } catch (err) {
        addToast(`Launch failed: ${err instanceof Error ? err.message : 'Unknown'}`, 'error')
      }
    },
    [actions, profiles, addToast]
  )

  const handleStop = useCallback(
    async (id: string): Promise<void> => {
      const p = profiles.find((x) => x.id === id)
      const name = p?.name ?? 'Profile'
      try {
        await actions.stop(id)
        addToast(`${name} stopped`, 'info')
      } catch (err) {
        addToast(`Stop failed: ${err instanceof Error ? err.message : 'Unknown'}`, 'error')
      }
    },
    [actions, profiles, addToast]
  )

  const handleWipeData = useCallback(
    async (id: string, name: string): Promise<void> => {
      const ok = await confirm({
        title: 'Wipe browsing data',
        message:
          `Delete every Chromium-side trace for "${name}" — cookies, localStorage, IndexedDB, ` +
          `cache, history, login data, sessions. The Lux profile (name, group, fingerprint, ` +
          `proxy assignment) stays intact. The browser must be stopped first; the next launch ` +
          `boots a fresh user-data-dir.`,
        confirmLabel: 'Wipe',
        danger: true
      })
      if (!ok) return
      try {
        await api.wipeProfileData(id)
        addToast(`"${name}" wiped — fresh state on next launch`, 'success')
      } catch (err) {
        addToast(
          `Wipe failed: ${err instanceof Error ? err.message : 'unknown error'}`,
          'error'
        )
      }
    },
    [confirm, addToast]
  )

  const handleDelete = useCallback(
    async (id: string, name: string): Promise<void> => {
      const ok = await confirm({
        title: 'Delete Profile',
        message: `Delete "${name}"? You'll have a few seconds to undo.`,
        confirmLabel: 'Delete',
        danger: true
      })
      if (!ok) return
      if (editorProfileId === id) closeEditor()
      const undo = actions.scheduleDelete(id)
      addToast(`Profile "${name}" deleted`, 'info', {
        duration: 5000,
        silent: true,
        action: {
          label: 'Undo',
          onClick: () => {
            undo()
            addToast(`Restored "${name}"`, 'success', { silent: true, duration: 2500 })
          }
        }
      })
    },
    [confirm, editorProfileId, closeEditor, actions, addToast]
  )

  const handleDuplicate = useCallback(
    async (id: string): Promise<void> => {
      try {
        await actions.duplicate(id)
        addToast('Profile duplicated', 'success')
      } catch (e) {
        addToast((e as Error).message, 'error')
      }
    },
    [actions, addToast]
  )

  // Cookie / CDP / screenshot handlers — preserved as-is from prior page.
  const handleExportCookies = useCallback(
    async (profileId: string, format: 'json' | 'netscape'): Promise<void> => {
      try {
        const result = await window.api.exportCookies(profileId, format)
        const ext = format === 'json' ? 'json' : 'txt'
        const blob = new Blob([result.data], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `cookies_${profileId.slice(0, 8)}.${ext}`
        a.click()
        URL.revokeObjectURL(url)
        addToast(`Exported ${result.count} cookies (${format})`, 'success')
      } catch (err) {
        addToast(
          `Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          'error'
        )
      }
    },
    [addToast]
  )

  const handleImportCookies = useCallback(
    async (profileId: string): Promise<void> => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.txt,.cookies'
      input.onchange = async (): Promise<void> => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const text = await file.text()
          const format = file.name.endsWith('.json') ? 'json' : 'netscape'
          const result = await window.api.importCookies(profileId, text, format)
          addToast(`Imported ${result.imported}/${result.total} cookies`, 'success')
        } catch (err) {
          addToast(
            `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
            'error'
          )
        }
      }
      input.click()
    },
    [addToast]
  )

  const handleScreenshot = useCallback(
    async (profileId: string): Promise<void> => {
      try {
        const base64 = await window.api.captureScreenshot(profileId)
        const link = document.createElement('a')
        link.href = `data:image/png;base64,${base64}`
        link.download = `screenshot_${profileId.slice(0, 8)}_${Date.now()}.png`
        link.click()
        addToast('Screenshot saved', 'success')
      } catch (err) {
        addToast(`Screenshot failed: ${err instanceof Error ? err.message : 'Unknown'}`, 'error')
      }
    },
    [addToast]
  )

  // ── Import / Export profiles ──────────────────────────────────────────

  const handleExportProfiles = useCallback(async (): Promise<void> => {
    try {
      const ids = selectedIds.size > 0 ? Array.from(selectedIds) : profiles.map((p) => p.id)
      const exportData: Record<string, unknown>[] = []
      for (const id of ids) {
        const detail = await api.getProfile(id)
        exportData.push({
          name: detail.profile.name,
          browser_type: detail.profile.browser_type,
          group_name: detail.profile.group_name,
          group_color: detail.profile.group_color,
          tags: parseTags(detail.profile.tags),
          notes: detail.profile.notes,
          proxy_id: detail.profile.proxy_id,
          start_url: detail.profile.start_url,
          fingerprint: pickFingerprintFields(detail.fingerprint) ?? {}
        })
      }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lux-profiles-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      addToast(`Exported ${ids.length} profile(s)`, 'success')
    } catch (err) {
      addToast(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error')
    }
  }, [selectedIds, profiles, addToast])

  const handleImportProfiles = useCallback((): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text) as Array<{
          name: string
          browser_type: string
          group_name?: string
          group_color?: string
          tags?: unknown
          notes?: string
          proxy_id?: string | null
          start_url?: string
          fingerprint?: unknown
        }>
        if (!Array.isArray(data)) throw new Error('Invalid format')
        for (const item of data) {
          const fingerprint = pickFingerprintFields(item.fingerprint)
          const fingerprintUpdate = pickUpdateFingerprintInput(item.fingerprint)
          const created = await api.createProfile({
            name: item.name,
            browser_type: item.browser_type as BrowserType,
            group_name: item.group_name,
            group_color: item.group_color,
            tags: parseTags(item.tags),
            notes: item.notes,
            proxy_id: item.proxy_id ?? null,
            start_url: item.start_url,
            fingerprint
          })
          if (fingerprintUpdate) await api.updateFingerprint(created.id, fingerprintUpdate)
        }
        fetchProfiles()
        addToast(`Imported ${data.length} profile(s)`, 'success')
      } catch (err) {
        addToast(
          `Import failed: ${err instanceof Error ? err.message : 'Invalid file'}`,
          'error'
        )
      }
    }
    input.click()
  }, [fetchProfiles, addToast])

  // ── Editor (Sheet) handlers ───────────────────────────────────────────

  const handleEditRow = useCallback(
    (id: string): void => {
      openEditor('edit', id)
    },
    [openEditor]
  )

  // Stable row-event callbacks. Defined once so memoized rows receive stable
  // props identity on every parent re-render — without these wrappers, every
  // keystroke or scroll would force every row to re-render.
  const handleRowClick = useCallback(
    (profileId: string): void => {
      openEditor('edit', profileId)
    },
    [openEditor]
  )

  const handleRowDoubleClick = useCallback(
    (profileId: string, status: ProfileStatus): void => {
      if (status === 'ready' || status === 'error') {
        void useProfilesStore.getState().launchBrowser(profileId)
      }
    },
    []
  )

  const handleRowContextMenu = useCallback(
    (
      e: ReactMouseEvent,
      profile: { id: string; name: string; status: ProfileStatus; browserType: BrowserType }
    ): void => {
      e.preventDefault()
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        profileId: profile.id,
        profileName: profile.name,
        status: profile.status,
        browserType: profile.browserType
      })
    },
    []
  )

  const handleRowLaunch = useCallback(
    (profileId: string): void => {
      void handleLaunch(profileId)
    },
    [handleLaunch]
  )

  const handleRowStop = useCallback(
    (profileId: string): void => {
      void handleStop(profileId)
    },
    [handleStop]
  )

  // `clearProfileError` and `toggleFavorite` from Zustand are already stable
  // identity-wise. We pass them straight through.

  const handleNewProfile = useCallback((): void => {
    setPendingFingerprint(null)
    setPendingBrowser(null)
    setPendingSeed((s) => s + 1)
    openEditor('create')
  }, [openEditor])

  const handleNewFromPreset = useCallback(
    async (presetId: string): Promise<void> => {
      try {
        const preset = presets?.find((p) => p.id === presetId)
        const fp = await api.generateFingerprintFromPreset(presetId)
        setPendingFingerprint(fp as InitialFingerprint)
        setPendingBrowser(preset ? PRESET_BROWSER_MAP[preset.browser] : null)
        setPendingSeed((s) => s + 1)
        openEditor('create')
      } catch (err) {
        addToast(
          err instanceof Error ? err.message : 'Failed to generate preset fingerprint',
          'error'
        )
      }
    },
    [openEditor, addToast, presets]
  )

  const presetMenuItems = useMemo<DropdownMenuItem[]>(
    () => buildPresetMenuItems(presets, (p) => void handleNewFromPreset(p.id)),
    [presets, handleNewFromPreset]
  )

  const handleEditorSave = useCallback((): void => {
    setPendingFingerprint(null)
    setPendingBrowser(null)
    fetchProfiles()
    closeEditor()
  }, [fetchProfiles, closeEditor])

  const handleEditorCancel = useCallback((): void => {
    setPendingFingerprint(null)
    setPendingBrowser(null)
    closeEditor()
  }, [closeEditor])

  // ── Selection / bulk ──────────────────────────────────────────────────

  const handleToggleSelect = useCallback(
    (profileId: string, profileIndex: number, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (shiftKey && lastCheckedIdx.current !== null) {
          const start = Math.min(lastCheckedIdx.current, profileIndex)
          const end = Math.max(lastCheckedIdx.current, profileIndex)
          // Walk the visible profile sequence by row index so selection stays
          // continuous through collapsed groups (collapsed rows aren't visible
          // here so they're naturally skipped).
          for (let i = start; i <= end; i++) {
            const rowIdx = sequence.profileIndexToRowIndex[i]
            const row = sequence.rows[rowIdx]
            if (row && row.kind === 'profile') next.add(row.profile.id)
          }
        } else {
          if (next.has(profileId)) next.delete(profileId)
          else next.add(profileId)
        }
        lastCheckedIdx.current = profileIndex
        return next
      })
    },
    [sequence]
  )

  const handleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      // If every visible profile is already selected → clear selection,
      // matching the toggle semantics of macOS Finder ⌘A.
      const allIds = filteredProfiles.map((p) => p.id)
      const allSelected = allIds.every((id) => prev.has(id))
      if (allSelected) return new Set()
      return new Set(allIds)
    })
  }, [filteredProfiles])

  const handleBulkLaunch = useCallback(async (): Promise<void> => {
    const count = selectedIds.size
    if (count === 0) return
    const ids = Array.from(selectedIds)
    setSelectedIds(new Set())
    addToast(`Launching ${count} profile${count === 1 ? '' : 's'}…`, 'info', {
      duration: 2000,
      silent: true
    })
    try {
      const results = await api.bulkLaunch(ids)
      const failed = results.filter((r) => !r.ok).length
      if (failed > 0) addToast(`${results.length - failed} launched, ${failed} failed`, 'warning')
      else addToast(`${results.length} profile${results.length === 1 ? '' : 's'} launched`, 'success')
    } catch {
      addToast('Bulk launch failed', 'error')
    }
    fetchProfiles()
  }, [selectedIds, fetchProfiles, addToast])

  const handleBulkStop = useCallback(async (): Promise<void> => {
    const count = selectedIds.size
    if (count === 0) return
    const ids = Array.from(selectedIds)
    setSelectedIds(new Set())
    addToast(`Stopping ${count} profile${count === 1 ? '' : 's'}…`, 'info', {
      duration: 2000,
      silent: true
    })
    try {
      const results = await api.bulkStop(ids)
      const failed = results.filter((r) => !r.ok).length
      if (failed > 0) addToast(`${results.length - failed} stopped, ${failed} failed`, 'warning')
      else addToast(`${results.length} profile${results.length === 1 ? '' : 's'} stopped`, 'success')
    } catch {
      addToast('Bulk stop failed', 'error')
    }
    fetchProfiles()
  }, [selectedIds, fetchProfiles, addToast])

  const handleBulkTestProxies = useCallback(async (): Promise<void> => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const proxyIds = new Set<string>()
    for (const id of ids) {
      const p = profiles.find((x) => x.id === id)
      if (p?.proxy_id) proxyIds.add(p.proxy_id)
    }
    if (proxyIds.size === 0) {
      addToast('No proxies attached to selected profiles', 'info')
      return
    }
    addToast(`Testing ${proxyIds.size} prox${proxyIds.size === 1 ? 'y' : 'ies'}…`, 'info', {
      duration: 2000,
      silent: true
    })
    let okCount = 0
    let failCount = 0
    for (const proxyId of proxyIds) {
      try {
        const ok = await api.testProxy(proxyId)
        if (ok) okCount++
        else failCount++
      } catch {
        failCount++
      }
    }
    fetchProxies()
    if (failCount === 0) addToast(`All ${okCount} proxies passed`, 'success')
    else addToast(`${okCount} passed, ${failCount} failed`, 'warning')
  }, [selectedIds, profiles, fetchProxies, addToast])

  const handleBulkDelete = useCallback(async (): Promise<void> => {
    const count = selectedIds.size
    if (count === 0) return
    const ok = await confirm({
      title: 'Delete Profiles',
      message: `Delete ${count} selected profile${count === 1 ? '' : 's'}? You'll have a few seconds to undo.`,
      confirmLabel: count === 1 ? 'Delete' : 'Delete All',
      danger: true
    })
    if (!ok) return
    const ids = Array.from(selectedIds)
    const undos = ids.map((id) => actions.scheduleDelete(id))
    setSelectedIds(new Set())
    closeEditor()
    addToast(`${count} profile${count === 1 ? '' : 's'} deleted`, 'info', {
      duration: 5000,
      silent: true,
      action: {
        label: 'Undo',
        onClick: () => {
          undos.forEach((u) => u())
          addToast(
            `Restored ${count} profile${count === 1 ? '' : 's'}`,
            'success',
            { silent: true, duration: 2500 }
          )
        }
      }
    })
  }, [selectedIds, confirm, closeEditor, actions, addToast])

  // Latest profiles snapshot — used by `getRowActions` so the callback's
  // identity stays stable across refetches. The action list is built lazily
  // (only when a row's dropdown / context menu opens), so reading the latest
  // value at click time is correct without inflating React deps.
  const profilesRef = useRef(profiles)
  useEffect(() => {
    profilesRef.current = profiles
  }, [profiles])

  // ── Row action items (DropdownMenu + ContextMenu share this builder) ──
  // `getRowActions` is intentionally `useCallback`-stable so it can be passed
  // straight through `React.memo`'d rows without busting their props identity.
  // It is only invoked when a row's dropdown / context menu actually opens.

  const getRowActions = useCallback(
    (
      profileId: string,
      profileName: string,
      status: ProfileStatus,
      browserType: BrowserType
    ): DropdownMenuItem[] => {
      const isRunning = status === 'running'
      const isTransitioning = status === 'starting' || status === 'stopping'
      const supportsAutomation = browserType !== 'firefox'

      const items: DropdownMenuItem[] = []

      if (isRunning) {
        items.push({
          label: 'Stop',
          icon: <Square className="h-4 w-4" />,
          onClick: () => handleStop(profileId)
        })
      } else if (!isTransitioning) {
        items.push({
          label: 'Launch',
          icon: <Play className="h-4 w-4" />,
          onClick: () => handleLaunch(profileId)
        })
      }

      items.push(
        { label: 'Edit', icon: <Pencil className="h-4 w-4" />, onClick: () => handleEditRow(profileId) },
        {
          label: 'Duplicate',
          icon: <Copy className="h-4 w-4" />,
          onClick: () => handleDuplicate(profileId)
        },
        {
          label: 'Copy ID',
          icon: <ClipboardCopy className="h-4 w-4" />,
          onClick: () => {
            navigator.clipboard.writeText(profileId)
            addToast('ID copied', 'info')
          }
        },
        {
          label: 'Reveal profile folder',
          icon: <HardDrive className="h-4 w-4" />,
          onClick: async () => {
            try {
              await api.revealProfileDir(profileId)
            } catch (err) {
              addToast(
                `Reveal failed: ${err instanceof Error ? err.message : 'unknown'}`,
                'error'
              )
            }
          }
        }
      )

      const profileRec = profilesRef.current.find((p) => p.id === profileId)
      const attachedProxyId = profileRec?.proxy_id ?? null
      if (attachedProxyId) {
        items.push({
          label: 'Copy proxy string',
          icon: <ClipboardCopy className="h-4 w-4" />,
          onClick: async () => {
            try {
              const conn = await api.getProxyConnectionString(attachedProxyId)
              await navigator.clipboard.writeText(conn)
              addToast('Proxy string copied', 'info', { duration: 2000 })
            } catch (err) {
              addToast(
                `Copy failed: ${err instanceof Error ? err.message : 'unknown'}`,
                'error'
              )
            }
          }
        })
      }

      if (isRunning) {
        items.push(
          {
            label: 'Export Cookies',
            icon: <Download className="h-4 w-4" />,
            onClick: () => handleExportCookies(profileId, 'json')
          },
          {
            label: 'Import Cookies',
            icon: <Upload className="h-4 w-4" />,
            onClick: () => handleImportCookies(profileId)
          },
          {
            label: supportsAutomation ? 'Automation…' : 'Automation… (Chromium only)',
            icon: <Terminal className="h-4 w-4" />,
            disabled: !supportsAutomation,
            onClick: () => {
              setAutomationFor({ id: profileId, name: profileName })
            }
          },
          {
            label: 'Screenshot',
            icon: <Camera className="h-4 w-4" />,
            onClick: () => handleScreenshot(profileId)
          }
        )
      }

      const openTestSite = async (label: string, url: string): Promise<void> => {
        try {
          await api.openUrlInProfile(profileId, url)
          addToast(`Opened ${label}`, 'success')
        } catch (err) {
          addToast(
            err instanceof Error ? err.message : `Failed to open ${label}`,
            'error'
          )
        }
      }

      items.push(
        {
          label: 'Open in CreepJS',
          icon: <ExternalLink className="h-4 w-4" />,
          onClick: () => {
            void openTestSite('CreepJS', TEST_SITE_CREEPJS)
          }
        },
        {
          label: 'Open in PixelScan',
          icon: <ExternalLink className="h-4 w-4" />,
          onClick: () => {
            void openTestSite('PixelScan', TEST_SITE_PIXELSCAN)
          }
        }
      )

      items.push(
        {
          label: isRunning || isTransitioning ? 'Wipe data (stop first)' : 'Wipe browsing data',
          icon: <Eraser className="h-4 w-4" />,
          variant: 'danger',
          disabled: isRunning || isTransitioning,
          onClick: () => handleWipeData(profileId, profileName)
        },
        {
          label: 'Delete',
          icon: <Trash2 className="h-4 w-4" />,
          variant: 'danger',
          onClick: () => handleDelete(profileId, profileName)
        }
      )

      return items
    },
    [
      handleStop,
      handleLaunch,
      handleEditRow,
      handleDuplicate,
      handleExportCookies,
      handleImportCookies,
      handleScreenshot,
      handleWipeData,
      handleDelete,
      addToast
    ]
  )

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  // Split into two scopes:
  //   • Global (document-level) — Ctrl/Cmd+N, Ctrl/Cmd+F, Ctrl/Cmd+A,
  //     `/`, Escape: should fire from anywhere on the page.
  //   • Listbox-scoped — Arrow/Home/End/Enter/Space/Delete/L/S/E/N
  //     (no-modifier single keys): only fire when the list (or one of its
  //     rows) has focus, so they don't hijack typing in inputs / popovers.

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
          document.getElementById('profile-search')?.focus()
          return
        }
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        handleNewProfile()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        document.getElementById('profile-search')?.focus()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        handleSelectAllVisible()
        return
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        document.getElementById('profile-search')?.focus()
        return
      }
      if (e.key === 'Escape') {
        // Editor Sheet ESC is owned by Radix via `onEscapeKeyDown` (which
        // routes through `requestCloseEditor` and the dirty-state confirm).
        // The global listener only handles ESC for non-Sheet UI so it
        // doesn't double-close the Sheet.
        if (editorMode) return
        if (selectedIds.size > 0) setSelectedIds(new Set())
        else if (focusedProfileIdx !== null) setFocusedProfileIdx(null)
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [
    editorMode,
    selectedIds.size,
    focusedProfileIdx,
    handleNewProfile,
    handleSelectAllVisible
  ])

  // Listbox-scoped: only navigation keys when the list (or a row) has focus.
  const handleListboxKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (editorMode || e.altKey) return
      if (filteredProfiles.length === 0) return

      const navigateTo = (next: number | null): void => {
        e.preventDefault()
        setFocusedProfileIdx(next)
      }

      if (e.key === 'ArrowDown') {
        navigateTo(
          focusedProfileIdx === null
            ? 0
            : Math.min(visibleProfileCount - 1, focusedProfileIdx + 1)
        )
        return
      }
      if (e.key === 'ArrowUp') {
        navigateTo(focusedProfileIdx === null ? 0 : Math.max(0, focusedProfileIdx - 1))
        return
      }
      if (e.key === 'Home') {
        navigateTo(0)
        return
      }
      if (e.key === 'End') {
        navigateTo(visibleProfileCount - 1)
        return
      }
      if (focusedProfileIdx === null) return

      const focusedProfile = filteredProfiles[focusedProfileIdx]
      if (!focusedProfile) return

      if (e.key === 'Enter') {
        e.preventDefault()
        openEditor('edit', focusedProfile.id)
      } else if (e.key === ' ') {
        e.preventDefault()
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(focusedProfile.id)) next.delete(focusedProfile.id)
          else next.add(focusedProfile.id)
          return next
        })
      } else if (e.key === 'Delete') {
        e.preventDefault()
        void handleDelete(focusedProfile.id, focusedProfile.name)
      } else if (e.key.toLowerCase() === 'l') {
        e.preventDefault()
        void handleLaunch(focusedProfile.id)
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault()
        void handleStop(focusedProfile.id)
      } else if (e.key.toLowerCase() === 'e') {
        e.preventDefault()
        openEditor('edit', focusedProfile.id)
      } else if (e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleNewProfile()
      }
    },
    [
      editorMode,
      focusedProfileIdx,
      filteredProfiles,
      visibleProfileCount,
      openEditor,
      handleDelete,
      handleLaunch,
      handleStop,
      handleNewProfile
    ]
  )

  // When a selection first appears (size transitions 0 → >0), pull DOM focus
  // onto the floater's first action so keyboard users can immediately Launch
  // / Stop / Delete without an extra Tab. We only do this on the 0→>0 edge,
  // not on every intra-selection change, so adding more rows mid-keystroke
  // doesn't hijack focus repeatedly.
  useEffect(() => {
    const prev = previousSelectionSize.current
    const current = selectedIds.size
    if (prev === 0 && current > 0) {
      bulkFirstActionRef.current?.focus()
    }
    previousSelectionSize.current = current
  }, [selectedIds])

  // Bring the focused row into view when it changes, and shift DOM focus to
  // the matching element so screen readers announce the move and `:focus-visible`
  // paints a real ring (not just the React-driven stripe). Smooth scroll is
  // gated on `prefers-reduced-motion: reduce` per OS-level user preference.
  // For long jumps (Home/End/large arrow runs) the target row may not be in
  // the rendered virtualization window yet at this effect tick; we publish
  // the desired profile id to `focusedProfileIdRef` so `registerRowRef` can
  // claim focus the moment the row mounts. The synchronous `focus()` call
  // below handles the common case (target already rendered, e.g. ↑/↓ by 1).
  useEffect(() => {
    if (focusedProfileIdx === null) {
      focusedProfileIdRef.current = null
      return
    }
    const el = scrollRef.current
    if (!el) return
    const rowIdx = sequence.profileIndexToRowIndex[focusedProfileIdx]
    if (rowIdx === undefined) return
    const row = sequence.rows[rowIdx]
    if (row.kind !== 'profile') return
    focusedProfileIdRef.current = row.profile.id
    const top = sequence.offsets[rowIdx]
    const rowH = getRowHeight(row, density)
    const viewTop = el.scrollTop
    const viewBottom = viewTop + el.clientHeight
    const scrollBehavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'
    if (top < viewTop) el.scrollTo({ top, behavior: scrollBehavior })
    else if (top + rowH > viewBottom) {
      el.scrollTo({ top: top + rowH - el.clientHeight, behavior: scrollBehavior })
    }
    // Move DOM focus to the row so screen-reader users land there too. If the
    // row hasn't mounted yet (long jump outside the rendered window), the ref
    // we published above lets `registerRowRef` claim focus on mount.
    const targetEl = rowRefs.current.get(row.profile.id)
    if (targetEl && document.activeElement !== targetEl) {
      targetEl.focus({ preventScroll: true })
    }
  }, [focusedProfileIdx, sequence, density, prefersReducedMotion])

  // ── Editor Sheet open/close handler ───────────────────────────────────

  // Latched by `ProfileEditorPanel` whenever `react-hook-form.formState.isDirty`
  // flips (panel→parent callback). Read on ESC / overlay-click so the close
  // routes through the Discard-changes confirm instead of dropping edits.
  const panelDirtyRef = useRef(false)
  const handlePanelDirtyChange = useCallback((isDirty: boolean) => {
    panelDirtyRef.current = isDirty
  }, [])

  // Close path that respects the panel's dirty state. Used by Sheet's ESC
  // handler (`onEscapeKeyDown`) and overlay click (`onPointerDownOutside`).
  // The in-panel Cancel/X buttons keep using `handleEditorCancel` directly
  // (they own their own confirm flow inside ProfileEditorPanel.handleCancel).
  const requestCloseEditor = useCallback(async (): Promise<void> => {
    if (!panelDirtyRef.current) {
      handleEditorCancel()
      return
    }
    const ok = await confirm({
      title: 'Discard unsaved changes?',
      message: 'You have edits in this profile that will be lost if you continue.',
      confirmLabel: 'Discard',
      danger: true
    })
    if (ok) handleEditorCancel()
  }, [confirm, handleEditorCancel])

  const handleEditorOpenChange = useCallback(
    (open: boolean) => {
      if (open) return
      void requestCloseEditor()
    },
    [requestCloseEditor]
  )

  // Reset the dirty latch each time the editor closes (Sheet unmounts the
  // panel, which means a fresh mount reports its own initial false anyway,
  // but clearing here removes one frame of stale state).
  useEffect(() => {
    if (editorMode === null) panelDirtyRef.current = false
  }, [editorMode])

  // Editor Sheet width: shrink with the viewport so the user keeps a sliver
  // of list visible behind the panel on the layout's hard 900px minimum.
  // Floored at EDITOR_SHEET_MIN_WIDTH_PX so the form doesn't crush.
  const viewportWidth = useViewportWidth()
  const editorSheetWidth = Math.min(
    EDITOR_SHEET_WIDTH_PX,
    Math.max(EDITOR_SHEET_MIN_WIDTH_PX, viewportWidth - EDITOR_SHEET_CONTEXT_RESERVE_PX)
  )

  // ── Render ────────────────────────────────────────────────────────────

  const hasSelection = selectedIds.size > 0
  const hasActiveFilters =
    statusFilter !== 'all' ||
    browserFilter !== 'all' ||
    groupFilter !== 'all' ||
    proxyFilter !== 'all' ||
    searchQuery.trim().length > 0

  // Loading skeleton — minimal "cards in a strip" feel
  if (loading && profiles.length === 0) {
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

  const showOnboarding = profiles.length === 0 && pendingDeletes.size === 0

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background relative">
      {/* ── Filter strip ──────────────────────────────────────────────── */}
      {/*
       * Layout strategy: outer is a single flex-wrap row. Each section claims
       * its natural width (shrink-0 + flex-wrap inside for content reflow).
       * Chip group has flex-grow so on wide viewports it absorbs slack; the
       * right-block uses ml-auto so it sticks to the trailing edge until the
       * row runs out of space, at which point flex-wrap drops it to row 2 —
       * the chips DO NOT collapse into a vertical column.
       */}
      <div
        className={cn(
          'sticky top-0 z-10 shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-1.5 min-h-12 min-w-0',
          'bg-card/85 backdrop-blur-sm border-b border-border/50'
        )}
      >
        <SearchInput
          id="profile-search"
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search profiles…"
          className="w-full sm:w-[240px] md:w-[260px] shrink-0"
          matchCount={filteredProfiles.length}
        />

        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 grow shrink-0 basis-auto">
          <FilterChip
            active={statusFilter === 'running'}
            onClick={setStatusRunning}
            onClear={clearStatusFilter}
            dotClass="bg-ok"
            label="Running"
          />
          <FilterChip
            active={statusFilter === 'ready'}
            onClick={setStatusReady}
            onClear={clearStatusFilter}
            dotClass="bg-muted-foreground/60"
            label="Ready"
          />
          <FilterChip
            active={statusFilter === 'error'}
            onClick={setStatusError}
            onClear={clearStatusFilter}
            dotClass="bg-destructive"
            label="Error"
          />

          <div aria-hidden className="h-5 w-px bg-border/60 mx-0.5" />

          <FilterChip
            active={browserFilter === 'chromium'}
            onClick={setBrowserChromium}
            onClear={clearBrowserFilter}
            icon={<Globe className="h-3 w-3" aria-hidden />}
            label="Chromium"
          />
          <FilterChip
            active={browserFilter === 'firefox'}
            onClick={setBrowserFirefox}
            onClear={clearBrowserFilter}
            icon={<Flame className="h-3 w-3" aria-hidden />}
            label="Firefox"
          />
          <FilterChip
            active={browserFilter === 'edge'}
            onClick={setBrowserEdge}
            onClear={clearBrowserFilter}
            icon={<Globe2 className="h-3 w-3" aria-hidden />}
            label="Edge"
          />

          <div aria-hidden className="h-5 w-px bg-border/60 mx-0.5" />

          <FilterChip
            active={proxyFilter === 'with-proxy'}
            onClick={setProxyWith}
            onClear={clearProxyFilter}
            icon={<Shield className="h-3 w-3" aria-hidden />}
            label="With proxy"
          />
          <FilterChip
            active={proxyFilter === 'no-proxy'}
            onClick={setProxyWithout}
            onClear={clearProxyFilter}
            icon={<ShieldOff className="h-3 w-3" aria-hidden />}
            label="No proxy"
          />

          {allGroups.length > 0 && (
            <SelectRoot
              value={groupFilter === NO_GROUP_KEY ? NO_GROUP_SENTINEL : groupFilter}
              onValueChange={(v) =>
                setGroupFilter(v === NO_GROUP_SENTINEL ? NO_GROUP_KEY : v)
              }
            >
              {/* w-[120px] at narrow / w-[150px] at lg overrides the trigger's
                  baked-in w-full so it doesn't stretch on a wrapped row. */}
              <SelectTrigger className="ml-1 !h-7 !text-[11.5px] w-[120px] lg:w-[150px] shrink-0">
                <SelectValue placeholder="Group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                <SelectItem value={NO_GROUP_SENTINEL}>{NO_GROUP_LABEL}</SelectItem>
                {allGroups.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          )}
        </div>

        {/* Right block stays as a single row so density/sort/actions don't
            split apart vertically. Whole block wraps as one unit when the
            outer flex-wrap can't fit it alongside chips. */}
        <div className="flex flex-nowrap items-center gap-1 shrink-0 ml-auto">

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
          <SelectTrigger className="!h-7 !text-[11.5px] w-[110px] lg:w-[130px] shrink-0">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_used:desc">Last used</SelectItem>
            <SelectItem value="name:asc">Name (A→Z)</SelectItem>
            <SelectItem value="name:desc">Name (Z→A)</SelectItem>
            <SelectItem value="created_at:desc">Newest</SelectItem>
            <SelectItem value="created_at:asc">Oldest</SelectItem>
          </SelectContent>
        </SelectRoot>

        <Tooltip content="Import profiles from JSON">
          <button
            type="button"
            onClick={handleImportProfiles}
            className={cn(
              'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
              'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]'
            )}
            aria-label="Import profiles"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="Export profiles to JSON">
          <button
            type="button"
            onClick={handleExportProfiles}
            className={cn(
              'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
              'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]'
            )}
            aria-label="Export profiles"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </Tooltip>

        <Button
          size="sm"
          icon={<Plus className="h-3.5 w-3.5" />}
          onClick={handleNewProfile}
          aria-label="New profile"
        >
          <span className="hidden md:inline">New profile</span>
        </Button>
        <DropdownMenu
          align="right"
          items={presetMenuItems}
          trigger={
            <button
              type="button"
              aria-label="New from preset"
              title="New from preset"
              className={cn(
                'h-7 w-7 inline-flex items-center justify-center rounded-[--radius-sm]',
                'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20',
                'hover:bg-primary/15 hover:ring-primary/30',
                'transition-colors duration-150 ease-[var(--ease-osmosis)]'
              )}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          }
        />
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      {showOnboarding ? (
        <OnboardingWelcome
          onCreateProfile={handleNewProfile}
          onImportProfiles={handleImportProfiles}
          onGoSettings={() => navigate('/settings')}
          onGoProxies={() => navigate('/proxies')}
        />
      ) : filteredProfiles.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState
            icon={<LayoutGrid />}
            title={hasActiveFilters ? 'No matching profiles' : 'No profiles yet'}
            description={
              hasActiveFilters
                ? 'Try clearing filters or adjusting your search.'
                : 'Create your first profile to get started.'
            }
            action={
              hasActiveFilters ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter('all')
                    setBrowserFilter('all')
                    setGroupFilter('all')
                    setProxyFilter('all')
                  }}
                  icon={<Filter className="h-3.5 w-3.5" />}
                >
                  Clear filters
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleNewProfile}
                  icon={<Plus className="h-3.5 w-3.5" />}
                >
                  Create profile
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onKeyDown={handleListboxKeyDown}
          className="flex-1 min-h-0 overflow-auto focus:outline-none"
          role="listbox"
          aria-label="Profiles"
          aria-multiselectable="true"
          tabIndex={focusedProfileIdx === null ? 0 : -1}
        >
          {/* Wrapper extra-bottom-padding when a selection is active so the
              floating bulk bar (64px tall) doesn't obscure the last row. */}
          <div
            style={{
              position: 'relative',
              height: sequence.totalHeight + (hasSelection ? BULK_FLOATER_CLEARANCE_PX : 0)
            }}
          >
            {sequence.rows.slice(startIdx, endIdx).map((row, localIdx) => {
              const idx = startIdx + localIdx
              const top = sequence.offsets[idx]
              const style: CSSProperties = {
                position: 'absolute',
                top,
                left: 0,
                right: 0
              }

              if (row.kind === 'group') {
                return (
                  <div key={`group:${row.group}`} style={style}>
                    <GroupHeaderRow
                      label={row.label}
                      count={row.count}
                      collapsed={row.collapsed}
                      onToggle={() => toggleGroupCollapsed(row.group)}
                    />
                  </div>
                )
              }

              const profile = row.profile
              const proxy = profile.proxy_id ? proxyMap.get(profile.proxy_id) ?? null : null
              const session = sessionMap.get(profile.id)
              const isSelected = selectedIds.has(profile.id)
              const isFocused = focusedProfileIdx === row.profileIndex
              const isFavorite = favoriteIds.has(profile.id)

              return (
                <div key={profile.id} style={style}>
                  <ProfileRow
                    profile={profile}
                    proxy={proxy}
                    session={session}
                    selected={isSelected}
                    focused={isFocused}
                    isFavorite={isFavorite}
                    density={density}
                    groupColor={profile.group_color}
                    getActionsForProfile={getRowActions}
                    errorMessage={profileErrors[profile.id]}
                    profileIndex={row.profileIndex}
                    registerRef={registerRowRef}
                    onToggleSelect={handleToggleSelect}
                    onClickRow={handleRowClick}
                    onDoubleClickRow={handleRowDoubleClick}
                    onContextMenu={handleRowContextMenu}
                    onToggleFavorite={toggleFavorite}
                    onLaunch={handleRowLaunch}
                    onStop={handleRowStop}
                    onClearError={clearProfileError}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Bulk action bar ──────────────────────────────────────────── */}
      {hasSelection && (
        <div
          role="toolbar"
          aria-label={`Bulk actions for ${selectedIds.size} selected profile${
            selectedIds.size === 1 ? '' : 's'
          }`}
          className={cn(
            'absolute bottom-4 left-1/2 -translate-x-1/2 z-20',
            'flex items-center gap-2 px-3 py-2',
            'bg-card/85 backdrop-blur-md border border-border/60 rounded-[--radius-lg]',
            'shadow-[var(--shadow-md)] animate-slideUp'
          )}
        >
          <span className="text-[12px] font-semibold text-foreground tabular-nums px-1.5">
            {selectedIds.size} selected
          </span>
          <span className="h-4 w-px bg-border/60" />
          <Button
            ref={bulkFirstActionRef}
            variant="ghost"
            size="sm"
            icon={<Play className="h-3.5 w-3.5" />}
            onClick={handleBulkLaunch}
            className="text-ok hover:text-ok hover:bg-ok/10"
          >
            Launch all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Square className="h-3.5 w-3.5" />}
            onClick={handleBulkStop}
            className="text-warn hover:text-warn hover:bg-warn/10"
          >
            Stop all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowUpDown className="h-3.5 w-3.5" />}
            onClick={handleBulkTestProxies}
          >
            Test proxies
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={handleBulkDelete}
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            Delete
          </Button>
          <span className="h-4 w-px bg-border/60" />
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
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

      {/* ── Editor Sheet ────────────────────────────────────────────── */}
      <Sheet open={editorMode !== null} onOpenChange={handleEditorOpenChange}>
        <SheetContent
          side="right"
          width={editorSheetWidth}
          hideClose
          className="p-0 gap-0"
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            if (panelDirtyRef.current) {
              e.preventDefault()
              void requestCloseEditor()
            }
          }}
          onPointerDownOutside={(e) => {
            if (panelDirtyRef.current) {
              e.preventDefault()
              void requestCloseEditor()
            }
          }}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/60 shrink-0">
            <SheetTitle>
              {editorMode === 'create' ? 'New Profile' : 'Edit Profile'}
            </SheetTitle>
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
          <div className="flex-1 min-h-0 overflow-hidden">
            {editorMode !== null && (
              <ProfileEditorPanel
                key={
                  editorMode === 'edit'
                    ? `edit:${editorProfileId}`
                    : `create:${pendingSeed}`
                }
                profileId={editorMode === 'edit' ? editorProfileId : null}
                initialFingerprint={editorMode === 'create' ? pendingFingerprint : null}
                initialBrowser={editorMode === 'create' ? pendingBrowser : null}
                onSave={handleEditorSave}
                onCancel={handleEditorCancel}
                onDirtyChange={handlePanelDirtyChange}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Automation modal (Chromium only) */}
      {automationFor && (
        <AutomationModal
          open={!!automationFor}
          onClose={() => setAutomationFor(null)}
          profileId={automationFor.id}
        />
      )}

      {/* Right-click context menu — same item builder as the row dropdown */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getRowActions(
            contextMenu.profileId,
            contextMenu.profileName,
            contextMenu.status,
            contextMenu.browserType
          )}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

// Resolve the height of any visible sequence row.
function getRowHeight(row: VisibleRow, density: Density): number {
  return row.kind === 'group' ? GROUP_HEADER_HEIGHT_PX : ROW_HEIGHT_BY_DENSITY[density]
}

// ────────────────────────────────────────────────────────────────────────────
// Onboarding (first-run, 0 profiles)
// ────────────────────────────────────────────────────────────────────────────

interface OnboardingStepProps {
  step: number
  icon: React.ReactNode
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  optional?: boolean
}

function OnboardingStep({
  step,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  optional
}: OnboardingStepProps): React.JSX.Element {
  return (
    <li className="group relative flex items-start gap-4 rounded-[--radius-lg] border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="shrink-0 relative">
        <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-primary">
          {icon}
        </div>
        <div className="absolute -top-1 -left-1 h-5 w-5 rounded-full bg-elevated border border-border text-[10px] font-mono font-semibold text-muted-foreground flex items-center justify-center">
          {step}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
          {optional && (
            <span className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wide">
              Optional
            </span>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground leading-relaxed">{description}</p>
      </div>
      <button
        onClick={onAction}
        className="shrink-0 inline-flex items-center gap-1 rounded-[--radius-md] border border-border bg-elevated px-3 py-2 text-[12px] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary self-center"
      >
        {actionLabel}
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

interface OnboardingWelcomeProps {
  onCreateProfile: () => void
  onImportProfiles: () => void
  onGoSettings: () => void
  onGoProxies: () => void
}

function OnboardingWelcome({
  onCreateProfile,
  onImportProfiles,
  onGoSettings,
  onGoProxies
}: OnboardingWelcomeProps): React.JSX.Element {
  return (
    <div className="flex-1 overflow-y-auto px-6 pb-10">
      <div className="mx-auto max-w-2xl animate-fadeIn">
        <div className="flex flex-col items-center text-center pt-8 pb-6">
          <div className="relative mb-5">
            <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.20)]">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
          </div>
          <h2 className="text-[22px] font-bold text-foreground tracking-tight">Welcome to Lux</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-md">
            Three quick steps. About a minute. Then you&apos;re ready to run isolated browser
            profiles with distinct fingerprints.
          </p>
        </div>

        <ol className="space-y-2.5">
          <OnboardingStep
            step={1}
            icon={<HardDrive className="h-5 w-5" />}
            title="Install a browser"
            description="Download Chromium (recommended) or another supported build from Settings → Browsers. Profiles launch inside it."
            actionLabel="Open Settings"
            onAction={onGoSettings}
          />
          <OnboardingStep
            step={2}
            icon={<Globe className="h-5 w-5" />}
            title="Add a proxy"
            description="Route each profile through a different IP. You can skip this step and add proxies later."
            actionLabel="Open Proxies"
            onAction={onGoProxies}
            optional
          />
          <OnboardingStep
            step={3}
            icon={<Plus className="h-5 w-5" />}
            title="Create your first profile"
            description="Every profile gets its own fingerprint, storage, and optional proxy. You can also import existing profiles from a JSON file."
            actionLabel="Create profile"
            onAction={onCreateProfile}
          />
        </ol>

        <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-muted-foreground">
          <span>Already have profiles?</span>
          <button
            onClick={onImportProfiles}
            className="inline-flex items-center gap-1 font-medium text-primary hover:text-accent-dim transition-colors"
          >
            Import from JSON
            <Upload className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
