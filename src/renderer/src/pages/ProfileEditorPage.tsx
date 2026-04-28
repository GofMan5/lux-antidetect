/**
 * ProfileEditorPage — Vault iter-2.
 *
 * `ProfileEditorPanel` is the only public entry; ProfilesPage hosts it inside
 * a viewport-responsive `Sheet`. Tabs run through the canonical `TabsRoot`
 * primitive, fingerprint sub-cards expose a real disclosure (button +
 * aria-expanded) instead of a Switch, and the form's `isDirty` bubbles up to
 * the Sheet host via `onDirtyChange` so ESC / overlay-click route through
 * the Discard-changes confirm.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { useForm, Controller, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Save,
  Wand2,
  Bookmark,
  Globe,
  Monitor,
  Shield,
  Settings,
  Zap,
  Check,
  AlertTriangle,
  ShieldCheck,
  Info,
  MapPin,
  X,
  Plus,
  ExternalLink,
  Cookie,
  Puzzle,
  Sparkles,
  ChevronDown
} from 'lucide-react'
import { api } from '../lib/api'
import { useProxiesStore } from '../stores/proxies'
import { useToastStore } from '../components/Toast'
import { useConfirmStore } from '../components/ConfirmDialog'
import { cn } from '../lib/utils'
import {
  Button,
  Input,
  Label,
  Badge,
  Tooltip,
  DropdownMenu,
  Separator,
  TabsRoot,
  TabsList,
  TabsTrigger,
  TabsContent,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from '../components/ui'
import type { DropdownMenuItem } from '../components/ui'
import { TEXTAREA } from '../lib/ui'
import { validateProfileFingerprint } from '../lib/fingerprint-validator'
import type { ValidationWarning } from '../lib/fingerprint-validator'
import { PRESET_BROWSER_MAP, buildPresetMenuItems } from '../lib/preset-menu'
import { formatTagsForForm, parseTagsFromForm } from '../lib/tags'
import { FEATURE_TEMPLATES_ENABLED } from '../lib/features'
import { CookiesTab } from '../components/profile/CookiesTab'
import { ExtensionsTab } from '../components/profile/ExtensionsTab'
import type { Fingerprint, UpdateFingerprintInput } from '../lib/types'
import type { PresetDescriptor } from '../../../preload/api-contract'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Verification test sites for launched profiles
const TEST_SITES: ReadonlyArray<{ label: string; url: string }> = [
  { label: 'WebGL', url: 'https://browserleaks.com/webgl' },
  { label: 'Fonts', url: 'https://browserleaks.com/fonts' },
  { label: 'PixelScan', url: 'https://pixelscan.net' },
  { label: 'CreepJS', url: 'https://abrahamjuliot.github.io/creepjs/' },
  { label: 'WhatIsMyBrowser', url: 'https://www.whatismybrowser.com' },
  { label: 'AmIUnique', url: 'https://amiunique.org' }
] as const

const SCREEN_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1920x1080', label: '1920×1080' },
  { value: '2560x1440', label: '2560×1440' },
  { value: '1366x768', label: '1366×768' },
  { value: '1536x864', label: '1536×864' },
  { value: '1440x900', label: '1440×900' },
  { value: '1280x720', label: '1280×720' }
]

const TIMEZONES: ReadonlyArray<string> = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Australia/Sydney',
  'Pacific/Auckland'
] as const

const BROWSER_OPTIONS: ReadonlyArray<{ value: 'chromium' | 'firefox' | 'edge'; label: string }> = [
  { value: 'chromium', label: 'Chromium' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'edge', label: 'Edge' }
]

const DEVICE_TYPE_OPTIONS: ReadonlyArray<{ value: 'desktop' | 'mobile'; label: string }> = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Mobile' }
]

const HARDWARE_CONCURRENCY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '4', label: '4 cores' },
  { value: '8', label: '8 cores' },
  { value: '12', label: '12 cores' },
  { value: '16', label: '16 cores' }
]

const DEVICE_MEMORY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '4', label: '4 GB' },
  { value: '8', label: '8 GB' },
  { value: '16', label: '16 GB' }
]

const WEBRTC_POLICIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'disable_non_proxied_udp', label: 'Disable non-proxied UDP' },
  { value: 'default_public_interface_only', label: 'Default public only' },
  { value: 'default', label: 'Default' }
]

const COLOR_DEPTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '24', label: '24-bit' },
  { value: '30', label: '30-bit' },
  { value: '32', label: '32-bit' }
]

const PIXEL_RATIO_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1', label: '1.0×' },
  { value: '1.25', label: '1.25×' },
  { value: '1.5', label: '1.5×' },
  { value: '2', label: '2.0×' },
  { value: '3', label: '3.0×' }
]

// Tab identifiers — keep in sync with TabsTrigger values below.
const TAB_GENERAL = 'general'
const TAB_BROWSER = 'browser'
const TAB_PROXY = 'proxy'
const TAB_FINGERPRINT = 'fingerprint'
const TAB_COOKIES = 'cookies'
const TAB_EXTENSIONS = 'extensions'

// Radix Select rejects an empty-string `value` on `<SelectItem>` — the
// placeholder slot is the only way to render "no value" — so we use a sentinel
// for the proxy picker's "No proxy" option and translate it back to '' before
// it lands in the form state.
const PROXY_NONE_SENTINEL = '__none__'

type TabId =
  | typeof TAB_GENERAL
  | typeof TAB_BROWSER
  | typeof TAB_PROXY
  | typeof TAB_FINGERPRINT
  | typeof TAB_COOKIES
  | typeof TAB_EXTENSIONS

// Maps a validator field back to the tab the field lives on, for the
// "jump to tab" affordance under each warning row.
const FIELD_TAB_MAP: Record<string, TabId> = {
  platform: TAB_BROWSER,
  user_agent: TAB_BROWSER,
  languages: TAB_BROWSER,
  timezone: TAB_FINGERPRINT,
  screen: TAB_FINGERPRINT,
  hardware_concurrency: TAB_FINGERPRINT,
  device_memory: TAB_FINGERPRINT,
  webgl_vendor: TAB_FINGERPRINT
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  browser_type: z.enum(['chromium', 'firefox', 'edge']),
  group_name: z.string(),
  group_color: z.string(),
  notes: z.string(),
  proxy_id: z.string(),
  start_url: z.string(),
  user_agent: z.string(),
  platform: z.string(),
  screen: z.string(),
  timezone: z.string(),
  hardware_concurrency: z.number(),
  device_memory: z.number(),
  webgl_vendor: z.string(),
  webgl_renderer: z.string(),
  webrtc_policy: z.string(),
  languages: z.string(),
  tags: z.string(),
  color_depth: z.number(),
  pixel_ratio: z.number(),
  device_type: z.enum(['desktop', 'mobile'])
})

type ProfileFormData = z.infer<typeof profileSchema>

const DEFAULT_VALUES: ProfileFormData = {
  name: '',
  browser_type: 'chromium',
  group_name: '',
  group_color: '',
  notes: '',
  proxy_id: '',
  start_url: '',
  user_agent: '',
  platform: '',
  screen: '1920x1080',
  timezone: 'America/New_York',
  hardware_concurrency: 8,
  device_memory: 8,
  webgl_vendor: '',
  webgl_renderer: '',
  webrtc_policy: 'disable_non_proxied_udp',
  languages: 'en-US',
  tags: '',
  color_depth: 24,
  pixel_ratio: 1.0,
  device_type: 'desktop' as const
}

export type InitialFingerprint = Omit<Fingerprint, 'id' | 'profile_id'>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseScreen(value: string): { width: number; height: number } {
  const [w, h] = value.split('x').map(Number)
  return { width: w || 1920, height: h || 1080 }
}

function toScreenValue(w: number, h: number): string {
  return `${w}x${h}`
}

function formatLanguagesForForm(raw: unknown): string {
  const normalizeList = (values: unknown[]): string =>
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
      .join(', ')

  if (Array.isArray(raw)) return normalizeList(raw)
  if (typeof raw !== 'string') return ''

  const trimmed = raw.trim()
  if (!trimmed) return ''

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) return normalizeList(parsed)
  } catch {
    // Plain comma-separated form value.
  }

  return trimmed
}

function parseLanguageListFromForm(value: string): string[] {
  return formatLanguagesForForm(value)
    .split(',')
    .map((lang) => lang.trim())
    .filter(Boolean)
}

function parseLanguagesFromForm(value: string): string[] {
  const parsed = parseLanguageListFromForm(value)
  return parsed.length > 0 ? parsed : ['en-US', 'en']
}

function getFingerprintStrength(
  watchedFields: [string, string, string | number, string, string]
): { score: number; issues: string[] } {
  const [ua, platform, pixelRatio, webglVendor, timezone] = watchedFields
  const issues: string[] = []

  if (ua.includes('Windows') && platform !== 'Win32') issues.push('UA/Platform mismatch')
  if (ua.includes('Macintosh') && platform !== 'MacIntel') issues.push('UA/Platform mismatch')
  if (ua.includes('Macintosh') && String(pixelRatio) === '1')
    issues.push('Mac usually has 2x pixel ratio')
  if (!ua) issues.push('No User-Agent set')
  if (!webglVendor) issues.push('No WebGL vendor')
  if (!timezone) issues.push('No timezone set')
  if (ua.includes('Windows') && webglVendor === 'Apple')
    issues.push('Windows + Apple GPU impossible')

  const score = Math.max(0, 100 - issues.length * 15)
  return { score, issues }
}

// ---------------------------------------------------------------------------
// Reusable controlled-Select adapter
// ---------------------------------------------------------------------------
//
// Radix `SelectRoot` is fully controlled (`value` + `onValueChange`) so it
// can't be wired through `register()` like a native <select>. RHF's
// `Controller` is the canonical adapter — extracted here once so each call
// site stays terse.
//
// `numeric` flips the on-change marshalling to `Number(value)` so the form
// keeps numeric fields typed as numbers (CPU cores, memory, color depth,
// pixel ratio). Without it Radix would write strings into number fields and
// break Zod parsing on submit.

interface ControlledSelectFieldProps<TName extends keyof ProfileFormData> {
  control: Control<ProfileFormData>
  name: TName
  options: ReadonlyArray<{ value: string; label: string }>
  numeric?: boolean
  placeholder?: string
  triggerId?: string
  className?: string
  disabled?: boolean
  ariaLabel?: string
}

function ControlledSelectField<TName extends keyof ProfileFormData>({
  control,
  name,
  options,
  numeric,
  placeholder,
  triggerId,
  className,
  disabled,
  ariaLabel
}: ControlledSelectFieldProps<TName>): React.JSX.Element {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const stringValue = field.value === undefined || field.value === null ? '' : String(field.value)
        return (
          <SelectRoot
            value={stringValue}
            onValueChange={(next) => {
              field.onChange(numeric ? Number(next) : next)
            }}
            disabled={disabled}
          >
            <SelectTrigger
              id={triggerId}
              ref={field.ref}
              onBlur={field.onBlur}
              aria-label={ariaLabel}
              className={className}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        )
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ProfileEditorPanelProps {
  profileId?: string | null
  onSave: () => void
  onCancel: () => void
  /** Pre-filled fingerprint for create mode (e.g. from a preset). */
  initialFingerprint?: InitialFingerprint | null
  /**
   * Pre-selected browser for create mode. Derived from the preset's browser
   * field so e.g. Firefox presets open the editor with browser_type='firefox'.
   */
  initialBrowser?: 'chromium' | 'firefox' | 'edge' | null
  /**
   * Notifies the parent whenever react-hook-form's `isDirty` flips. The
   * Sheet host (ProfilesPage) latches this into a ref and consults it on
   * ESC / overlay-click so closing a dirty panel routes through the
   * Discard-changes confirm instead of dropping edits silently.
   */
  onDirtyChange?: (isDirty: boolean) => void
}

export function ProfileEditorPanel({
  profileId,
  onSave,
  onCancel,
  initialFingerprint,
  initialBrowser,
  onDirtyChange
}: ProfileEditorPanelProps): React.JSX.Element {
  const isEditMode = Boolean(profileId)

  // -- Local state --------------------------------------------------------
  const [activeTab, setActiveTab] = useState<TabId>(TAB_GENERAL)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [templateSaved, setTemplateSaved] = useState(false)
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; browser_type: string }>
  >([])
  const [testingProxy, setTestingProxy] = useState(false)
  const [proxyTestResult, setProxyTestResult] = useState<boolean | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [applyingGeo, setApplyingGeo] = useState(false)

  // Fingerprint-preset picker state.
  const [presets, setPresets] = useState<PresetDescriptor[] | null>(null)
  const [applyingPreset, setApplyingPreset] = useState(false)
  const presetsLoadingRef = useRef(false)

  // Lifecycle guard for async handlers (preset apply). The IPC layer has no
  // cancellation primitive, so we latch this ref and also re-check the captured
  // profileId to avoid side-effects (setValue / toast) landing on a screen the
  // user already navigated away from.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Fingerprint sub-section toggles (UI-only collapse / expand)
  const [webrtcOpen, setWebrtcOpen] = useState(true)
  const [webglOpen, setWebglOpen] = useState(true)
  const [displayOpen, setDisplayOpen] = useState(true)
  const [hardwareOpen, setHardwareOpen] = useState(true)
  const [timezoneOpen, setTimezoneOpen] = useState(true)

  // -- Stores -------------------------------------------------------------
  const proxies = useProxiesStore((s) => s.proxies)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)
  const storeTestProxy = useProxiesStore((s) => s.testProxy)
  const addToast = useToastStore((s) => s.addToast)
  const confirm = useConfirmStore((s) => s.show)

  // -- Form ---------------------------------------------------------------
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    control,
    formState: { errors, isDirty, dirtyFields }
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: DEFAULT_VALUES
  })

  // Bubble dirty-state up so the Sheet host can intercept ESC / overlay-click
  // and route through the Discard-changes confirm instead of dropping edits.
  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  // Watch individual primitives so memo deps stay stable across renders.
  const watchedUserAgent = watch('user_agent')
  const watchedPlatform = watch('platform')
  const watchedPixelRatio = watch('pixel_ratio')
  const watchedWebglVendor = watch('webgl_vendor')
  const watchedTimezone = watch('timezone')
  const watchedProxyId = watch('proxy_id')
  const watchedTags = watch('tags')
  const watchedLanguages = watch('languages')
  const watchedHardware = watch('hardware_concurrency')
  const watchedMemory = watch('device_memory')
  const watchedScreen = watch('screen')

  const selectedProxy = useMemo(
    () => proxies.find((p) => p.id === watchedProxyId),
    [proxies, watchedProxyId]
  )
  const selectedProxyCountry = selectedProxy?.country ?? null
  const isCustomScreen = !SCREEN_PRESETS.some((p) => p.value === watchedScreen)
  const isCustomTimezone = !(TIMEZONES as readonly string[]).includes(watchedTimezone)

  // -- Derived ------------------------------------------------------------
  const tagsList = watchedTags
    ? watchedTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const proxyOptions = useMemo<ReadonlyArray<{ value: string; label: string }>>(
    () => [
      { value: PROXY_NONE_SENTINEL, label: 'No proxy' },
      ...proxies.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.protocol}://${p.host}:${p.port})`
      }))
    ],
    [proxies]
  )

  const screenOptions = useMemo<ReadonlyArray<{ value: string; label: string }>>(
    () => [
      ...SCREEN_PRESETS,
      ...(isCustomScreen ? [{ value: watchedScreen, label: watchedScreen }] : [])
    ],
    [isCustomScreen, watchedScreen]
  )

  const timezoneOptions = useMemo<ReadonlyArray<{ value: string; label: string }>>(
    () => [
      ...TIMEZONES.map((tz) => ({ value: tz, label: tz })),
      ...(isCustomTimezone
        ? [{ value: watchedTimezone, label: watchedTimezone }]
        : [])
    ],
    [isCustomTimezone, watchedTimezone]
  )

  const fpStrength = watchedUserAgent
    ? getFingerprintStrength([
        watchedUserAgent,
        watchedPlatform,
        watchedPixelRatio,
        watchedWebglVendor,
        watchedTimezone
      ])
    : null

  const validationWarnings = useMemo(
    () =>
      validateProfileFingerprint({
        user_agent: watchedUserAgent ?? '',
        platform: watchedPlatform ?? '',
        timezone: watchedTimezone ?? '',
        languages: watchedLanguages ?? '',
        screen: watchedScreen ?? '',
        hardware_concurrency: Number(watchedHardware ?? 0),
        device_memory: Number(watchedMemory ?? 0),
        webgl_vendor: watchedWebglVendor ?? '',
        proxyCountryCode: selectedProxyCountry
      }),
    [
      watchedUserAgent,
      watchedPlatform,
      watchedTimezone,
      watchedLanguages,
      watchedScreen,
      watchedHardware,
      watchedMemory,
      watchedWebglVendor,
      selectedProxyCountry
    ]
  )

  const hasWarnSeverity = validationWarnings.some((w) => w.severity === 'warn')
  const [showAllWarnings, setShowAllWarnings] = useState(false)
  const visibleWarnings =
    validationWarnings.length > 3 && !showAllWarnings
      ? validationWarnings.slice(0, 3)
      : validationWarnings

  // -- Effects ------------------------------------------------------------

  useEffect(() => {
    fetchProxies()
  }, [fetchProxies])

  useEffect(() => {
    if (!FEATURE_TEMPLATES_ENABLED) return
    api
      .listTemplates()
      .then((t: unknown[]) => {
        setTemplates(t as Array<{ id: string; name: string; browser_type: string }>)
      })
      .catch(() => {})
  }, [])

  // Load fingerprint presets once. On failure we store an empty list so the
  // dropdown shows "No presets available" rather than staying in the loading
  // state. The ref guard prevents duplicate IPC calls under strict-mode double-mount.
  useEffect(() => {
    if (presetsLoadingRef.current) return
    presetsLoadingRef.current = true
    api
      .listFingerprintPresets()
      .then((list) => setPresets(list))
      .catch((err: unknown) => {
        console.error('Failed to load fingerprint presets', err)
        setPresets([])
      })
  }, [])

  useEffect(() => {
    if (!profileId) {
      if (initialFingerprint) {
        const fp = initialFingerprint
        reset({
          ...DEFAULT_VALUES,
          browser_type: initialBrowser ?? DEFAULT_VALUES.browser_type,
          user_agent: fp.user_agent ?? '',
          platform: fp.platform ?? '',
          screen: toScreenValue(fp.screen_width ?? 1920, fp.screen_height ?? 1080),
          timezone: fp.timezone ?? DEFAULT_VALUES.timezone,
          hardware_concurrency: fp.hardware_concurrency ?? DEFAULT_VALUES.hardware_concurrency,
          device_memory: fp.device_memory ?? DEFAULT_VALUES.device_memory,
          webgl_vendor: fp.webgl_vendor ?? '',
          webgl_renderer: fp.webgl_renderer ?? '',
          webrtc_policy: fp.webrtc_policy ?? DEFAULT_VALUES.webrtc_policy,
          languages: formatLanguagesForForm(fp.languages) || DEFAULT_VALUES.languages,
          color_depth: fp.color_depth ?? DEFAULT_VALUES.color_depth,
          pixel_ratio: fp.pixel_ratio ?? DEFAULT_VALUES.pixel_ratio,
          device_type: (fp.device_type as 'desktop' | 'mobile') || DEFAULT_VALUES.device_type
        })
      } else {
        reset({
          ...DEFAULT_VALUES,
          browser_type: initialBrowser ?? DEFAULT_VALUES.browser_type
        })
      }
      return
    }
    api
      .getProfile(profileId)
      .then((detail) => {
        reset({
          name: detail.profile.name,
          browser_type: detail.profile.browser_type,
          group_name: detail.profile.group_name ?? '',
          group_color: detail.profile.group_color ?? '',
          notes: detail.profile.notes,
          proxy_id: detail.profile.proxy_id ?? '',
          start_url: detail.profile.start_url ?? '',
          tags: formatTagsForForm(detail.profile.tags),
          user_agent: detail.fingerprint.user_agent,
          platform: detail.fingerprint.platform,
          screen: toScreenValue(
            detail.fingerprint.screen_width,
            detail.fingerprint.screen_height
          ),
          timezone: detail.fingerprint.timezone,
          hardware_concurrency: detail.fingerprint.hardware_concurrency,
          device_memory: detail.fingerprint.device_memory,
          webgl_vendor: detail.fingerprint.webgl_vendor,
          webgl_renderer: detail.fingerprint.webgl_renderer,
          webrtc_policy: detail.fingerprint.webrtc_policy,
          color_depth: detail.fingerprint.color_depth ?? 24,
          pixel_ratio: detail.fingerprint.pixel_ratio ?? 1.0,
          languages:
            formatLanguagesForForm(detail.fingerprint.languages) ||
            DEFAULT_VALUES.languages,
          device_type:
            (detail.fingerprint.device_type as 'desktop' | 'mobile') || 'desktop'
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      })
  }, [profileId, reset, initialFingerprint, initialBrowser])

  // -- Handlers -----------------------------------------------------------

  const handleCancel = async (): Promise<void> => {
    if (isDirty) {
      const ok = await confirm({
        title: 'Discard unsaved changes?',
        message: 'You have edits in this profile that will be lost if you continue.',
        confirmLabel: 'Discard',
        danger: true
      })
      if (!ok) return
    }
    onCancel()
  }

  const handleGenerateFingerprint = async (): Promise<void> => {
    try {
      setGenerating(true)
      const browserType = getValues('browser_type')
      const fp = await api.generateFingerprint(browserType)
      setValue('user_agent', fp.user_agent, { shouldDirty: true })
      setValue('platform', fp.platform, { shouldDirty: true })
      setValue('screen', toScreenValue(fp.screen_width, fp.screen_height), {
        shouldDirty: true
      })
      setValue('timezone', fp.timezone, { shouldDirty: true })
      setValue('hardware_concurrency', fp.hardware_concurrency, { shouldDirty: true })
      setValue('device_memory', fp.device_memory, { shouldDirty: true })
      setValue('webgl_vendor', fp.webgl_vendor, { shouldDirty: true })
      setValue('webgl_renderer', fp.webgl_renderer, { shouldDirty: true })
      setValue('webrtc_policy', fp.webrtc_policy, { shouldDirty: true })
      setValue('languages', formatLanguagesForForm(fp.languages) || DEFAULT_VALUES.languages, {
        shouldDirty: true
      })
      setValue('color_depth', fp.color_depth ?? 24, { shouldDirty: true })
      setValue('pixel_ratio', fp.pixel_ratio ?? 1.0, { shouldDirty: true })
      setActiveTab(TAB_FINGERPRINT)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate fingerprint')
    } finally {
      setGenerating(false)
    }
  }

  const handleApplyPreset = useCallback(
    async (preset: PresetDescriptor): Promise<void> => {
      // Snapshot the profileId so a mid-flight profile switch (or unmount)
      // skips the setValue-loop and toast instead of writing to the wrong form.
      const initialProfileId = profileId
      setApplyingPreset(true)
      try {
        const fp = await api.generateFingerprintFromPreset(preset.id)
        if (!isMountedRef.current || profileId !== initialProfileId) return

        const langs = formatLanguagesForForm(fp.languages)

        // Overwrite only fingerprint-owned fields plus browser_type (a Firefox
        // preset must flip the form to firefox). Non-fingerprint fields —
        // profile name, start URL, proxy, tags, notes, group — are left intact
        // by using setValue per-field rather than reset().
        const dirtyOpt = { shouldDirty: true } as const
        setValue('browser_type', PRESET_BROWSER_MAP[preset.browser], dirtyOpt)
        setValue('user_agent', fp.user_agent ?? '', dirtyOpt)
        setValue('platform', fp.platform ?? '', dirtyOpt)
        setValue(
          'screen',
          toScreenValue(fp.screen_width ?? 1920, fp.screen_height ?? 1080),
          dirtyOpt
        )
        setValue('timezone', fp.timezone ?? DEFAULT_VALUES.timezone, dirtyOpt)
        setValue(
          'hardware_concurrency',
          fp.hardware_concurrency ?? DEFAULT_VALUES.hardware_concurrency,
          dirtyOpt
        )
        setValue(
          'device_memory',
          fp.device_memory ?? DEFAULT_VALUES.device_memory,
          dirtyOpt
        )
        setValue('webgl_vendor', fp.webgl_vendor ?? '', dirtyOpt)
        setValue('webgl_renderer', fp.webgl_renderer ?? '', dirtyOpt)
        setValue(
          'webrtc_policy',
          fp.webrtc_policy ?? DEFAULT_VALUES.webrtc_policy,
          dirtyOpt
        )
        setValue('languages', langs || DEFAULT_VALUES.languages, dirtyOpt)
        setValue(
          'color_depth',
          fp.color_depth ?? DEFAULT_VALUES.color_depth,
          dirtyOpt
        )
        setValue(
          'pixel_ratio',
          fp.pixel_ratio ?? DEFAULT_VALUES.pixel_ratio,
          dirtyOpt
        )
        setValue(
          'device_type',
          (fp.device_type as 'desktop' | 'mobile') || DEFAULT_VALUES.device_type,
          dirtyOpt
        )
        addToast(`Preset applied: ${preset.label}`, 'success')
      } catch (err: unknown) {
        if (!isMountedRef.current || profileId !== initialProfileId) return
        addToast(
          err instanceof Error ? err.message : 'Failed to apply preset',
          'error'
        )
      } finally {
        // Only touch local UI state if we're still the live editor for this
        // profile; otherwise the next editor instance owns `applyingPreset`.
        if (isMountedRef.current && profileId === initialProfileId) {
          setApplyingPreset(false)
        }
      }
    },
    [addToast, setValue, profileId]
  )

  // Build grouped DropdownMenu items via the shared helper. See
  // src/renderer/src/lib/preset-menu.tsx for grouping / label policy.
  const presetMenuItems = useMemo<DropdownMenuItem[]>(
    () => buildPresetMenuItems(presets, (p) => void handleApplyPreset(p)),
    [presets, handleApplyPreset]
  )

  const handleTestProxy = async (): Promise<void> => {
    if (!watchedProxyId) return
    setTestingProxy(true)
    setProxyTestResult(null)
    try {
      const ok = await storeTestProxy(watchedProxyId)
      setProxyTestResult(ok)
    } catch {
      setProxyTestResult(false)
    } finally {
      setTestingProxy(false)
    }
  }

  const handleApplyProxyGeo = async (): Promise<void> => {
    if (!watchedProxyId) return
    setApplyingGeo(true)
    try {
      const geo = await api.lookupProxyGeo(watchedProxyId)
      if (!geo) {
        addToast('Could not determine proxy geolocation', 'error')
        return
      }

      // Compute the target languages list we would apply.
      const existing = parseLanguageListFromForm(getValues('languages') || '')
      let targetLanguagesStr: string | null = null
      if (geo.locale) {
        const next = [geo.locale, 'en-US']
        for (const l of existing) {
          if (!next.includes(l)) next.push(l)
        }
        targetLanguagesStr = next.slice(0, 4).join(', ')
      }

      // If operator has curated non-empty languages that would change, confirm.
      const currentStr = existing.join(', ')
      const willChangeLanguages =
        targetLanguagesStr !== null &&
        existing.length > 0 &&
        targetLanguagesStr !== currentStr

      if (willChangeLanguages) {
        const ok = await confirm({
          title: 'Apply proxy geo?',
          message: `Will set timezone to "${geo.timezone ?? '(unchanged)'}" and languages to "${targetLanguagesStr}". Current languages: "${currentStr}".`,
          confirmLabel: 'Apply'
        })
        if (!ok) return
      }

      const applied: string[] = []
      if (geo.timezone) {
        setValue('timezone', geo.timezone, { shouldDirty: true })
        applied.push(geo.timezone)
      }
      if (targetLanguagesStr !== null && geo.locale) {
        setValue('languages', targetLanguagesStr, { shouldDirty: true })
        applied.push(geo.locale)
      }

      addToast(
        applied.length > 0 ? `Applied: ${applied.join(' · ')}` : 'Applied proxy geo',
        'success'
      )
    } catch (err: unknown) {
      addToast(
        err instanceof Error ? err.message : 'Failed to look up proxy geolocation',
        'error'
      )
    } finally {
      setApplyingGeo(false)
    }
  }

  const handleSaveAsTemplate = async (): Promise<void> => {
    if (!FEATURE_TEMPLATES_ENABLED) return
    try {
      const data = getValues()
      const { width, height } = parseScreen(data.screen)
      const languagesArray = parseLanguagesFromForm(data.languages)
      await api.createTemplate({
        name: `${data.name} Template`,
        browser_type: data.browser_type,
        config: {
          group_name: data.group_name || null,
          group_color: data.group_color || null,
          notes: data.notes,
          start_url: data.start_url,
          proxy_id: data.proxy_id || null,
          fingerprint: {
            user_agent: data.user_agent,
            platform: data.platform,
            screen_width: width,
            screen_height: height,
            timezone: data.timezone,
            hardware_concurrency: data.hardware_concurrency,
            device_memory: data.device_memory,
            webgl_vendor: data.webgl_vendor,
            webgl_renderer: data.webgl_renderer,
            webrtc_policy: data.webrtc_policy,
            languages: languagesArray,
            color_depth: data.color_depth,
            pixel_ratio: data.pixel_ratio,
            device_type: data.device_type
          }
        } as Record<string, unknown>
      })
      setTemplateSaved(true)
      setTimeout(() => setTemplateSaved(false), 2000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    }
  }

  const handleApplyTemplate = useCallback(
    async (templateId: string): Promise<void> => {
      if (!FEATURE_TEMPLATES_ENABLED) return
      if (!templateId) return
      try {
        const tmpl = (await api.getTemplate(templateId)) as {
          config: string
          browser_type: string
        }
        const config = JSON.parse(tmpl.config) as Record<string, unknown>
        const markDirty = { shouldDirty: true }
        if (config.group_name !== undefined) setValue('group_name', (config.group_name as string | null) ?? '', markDirty)
        if (config.group_color !== undefined) setValue('group_color', (config.group_color as string | null) ?? '', markDirty)
        if (config.notes !== undefined) setValue('notes', (config.notes as string | null) ?? '', markDirty)
        if (config.start_url !== undefined) setValue('start_url', (config.start_url as string | null) ?? '', markDirty)
        if (config.proxy_id !== undefined) setValue('proxy_id', (config.proxy_id as string | null) ?? '', markDirty)
        setValue('browser_type', tmpl.browser_type as 'chromium' | 'firefox' | 'edge', markDirty)
        const fp = config.fingerprint as Record<string, unknown> | undefined
        if (fp) {
          if (fp.user_agent) setValue('user_agent', fp.user_agent as string, markDirty)
          if (fp.platform) setValue('platform', fp.platform as string, markDirty)
          if (fp.screen_width && fp.screen_height) {
            setValue(
              'screen',
              toScreenValue(fp.screen_width as number, fp.screen_height as number),
              markDirty
            )
          }
          if (fp.timezone) setValue('timezone', fp.timezone as string, markDirty)
          if (fp.languages)
            setValue(
              'languages',
              formatLanguagesForForm(fp.languages) || DEFAULT_VALUES.languages,
              markDirty
            )
          if (fp.webrtc_policy) setValue('webrtc_policy', fp.webrtc_policy as string, markDirty)
          if (fp.webgl_vendor) setValue('webgl_vendor', fp.webgl_vendor as string, markDirty)
          if (fp.webgl_renderer) setValue('webgl_renderer', fp.webgl_renderer as string, markDirty)
          if (fp.hardware_concurrency)
            setValue('hardware_concurrency', fp.hardware_concurrency as number, markDirty)
          if (fp.device_memory) setValue('device_memory', fp.device_memory as number, markDirty)
          if (fp.color_depth) setValue('color_depth', fp.color_depth as number, markDirty)
          if (fp.pixel_ratio) setValue('pixel_ratio', fp.pixel_ratio as number, markDirty)
          if (fp.device_type)
            setValue('device_type', fp.device_type as 'desktop' | 'mobile', markDirty)
        }
      } catch {
        // Template lookups failing silently keeps the UX simple — the user can
        // pick a different template or fill the form by hand.
      }
    },
    [setValue]
  )

  const onSubmit = async (data: ProfileFormData): Promise<void> => {
    try {
      setSaving(true)
      setError(null)
      const { width, height } = parseScreen(data.screen)
      const languagesArray = parseLanguagesFromForm(data.languages)
      const tagsArray = parseTagsFromForm(data.tags)

      if (isEditMode && profileId) {
        const preserveProxySyncedGeo =
          Boolean(dirtyFields.proxy_id) &&
          !dirtyFields.timezone &&
          !dirtyFields.languages
        const fingerprintInput: UpdateFingerprintInput = {
          user_agent: data.user_agent,
          platform: data.platform,
          screen_width: width,
          screen_height: height,
          hardware_concurrency: data.hardware_concurrency,
          device_memory: data.device_memory,
          webgl_vendor: data.webgl_vendor,
          webgl_renderer: data.webgl_renderer,
          webrtc_policy: data.webrtc_policy,
          color_depth: data.color_depth,
          pixel_ratio: data.pixel_ratio,
          device_type: data.device_type
        }

        if (!preserveProxySyncedGeo) {
          fingerprintInput.timezone = data.timezone
          fingerprintInput.languages = languagesArray
        }

        await api.updateProfile(profileId, {
          name: data.name,
          browser_type: data.browser_type,
          group_name: data.group_name || null,
          notes: data.notes,
          proxy_id: data.proxy_id || null,
          start_url: data.start_url,
          group_color: data.group_color || null,
          tags: tagsArray
        })
        await api.updateFingerprint(profileId, fingerprintInput)
      } else {
        await api.createProfile({
          name: data.name,
          browser_type: data.browser_type,
          group_name: data.group_name || null,
          notes: data.notes,
          proxy_id: data.proxy_id || null,
          start_url: data.start_url,
          group_color: data.group_color || null,
          tags: tagsArray,
          fingerprint: {
            user_agent: data.user_agent,
            platform: data.platform,
            screen_width: width,
            screen_height: height,
            timezone: data.timezone,
            hardware_concurrency: data.hardware_concurrency,
            device_memory: data.device_memory,
            webgl_vendor: data.webgl_vendor,
            webgl_renderer: data.webgl_renderer,
            webrtc_policy: data.webrtc_policy,
            languages: languagesArray,
            color_depth: data.color_depth,
            pixel_ratio: data.pixel_ratio,
            device_type: data.device_type
          } as Record<string, unknown>
        })
      }
      onSave()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  // -- Tag helpers --------------------------------------------------------

  const addTag = (): void => {
    const tag = tagInput.trim()
    if (!tag || tagsList.includes(tag)) return
    setValue('tags', [...tagsList, tag].join(', '), { shouldDirty: true })
    setTagInput('')
  }

  const removeTag = (tag: string): void => {
    setValue(
      'tags',
      tagsList.filter((t) => t !== tag).join(', '),
      { shouldDirty: true }
    )
  }

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    }
  }

  // -- Render -------------------------------------------------------------
  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col h-full min-h-0"
      aria-label={isEditMode ? 'Edit profile' : 'New profile'}
    >
      {/* ── Compact action header ───────────────────────────────────────────
          The Sheet's parent already renders a SheetTitle + close button, so
          this row carries the *primary actions* for the form: inline name
          rename, browser picker, dirty badge, save / generate / discard.
          Sits flush against the SheetHeader from the parent — no extra
          card chrome (double border was flagged in v1.0.54 review). */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border/60 shrink-0">
        <Input
          {...register('name')}
          placeholder="Profile name"
          aria-label="Profile name"
          aria-invalid={errors.name ? true : undefined}
          className="h-8 flex-1 min-w-0 text-[13px] font-medium"
        />
        <div className="w-[120px] shrink-0">
          <ControlledSelectField
            control={control}
            name="browser_type"
            options={BROWSER_OPTIONS}
            ariaLabel="Browser type"
            className="h-8 text-[12px]"
          />
        </div>
        {isDirty && (
          <Badge variant="warning" dot className="shrink-0">
            Unsaved
          </Badge>
        )}
        {FEATURE_TEMPLATES_ENABLED && isEditMode && (
          <Tooltip content={templateSaved ? 'Saved!' : 'Save as Template'}>
            <Button
              variant="ghost"
              size="sm"
              icon={<Bookmark className="h-3.5 w-3.5" />}
              onClick={handleSaveAsTemplate}
              type="button"
              aria-label="Save as template"
            />
          </Tooltip>
        )}
        <Button
          variant="default"
          size="sm"
          icon={<Save className="h-3.5 w-3.5" />}
          type="submit"
          loading={saving}
        >
          {isEditMode ? 'Save' : 'Create'}
        </Button>
        <Tooltip content={isDirty ? 'Discard changes & close' : 'Close'}>
          <Button
            variant="ghost"
            size="sm"
            icon={<X className="h-3.5 w-3.5" />}
            onClick={handleCancel}
            type="button"
            aria-label="Close editor without saving"
          />
        </Tooltip>
      </div>

      {/* Field-level error banner — surfaces top-of-form save errors and the
          name validation error when the user submits with an empty name. */}
      {(error || errors.name) && (
        <div
          role="alert"
          className="mx-5 mt-3 rounded-[--radius-md] bg-destructive/10 border border-destructive/25 px-3 py-2 text-xs text-destructive font-medium flex items-center gap-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {error ?? errors.name?.message ?? 'Invalid form data'}
          </span>
          {error && (
            <button
              type="button"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="rounded p-0.5 hover:bg-destructive/15"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <TabsRoot
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabId)}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="px-5 pt-3 shrink-0 overflow-x-auto scrollbar-hide border-b border-border">
          <TabsList className="border-b-0">
            <TabsTrigger value={TAB_GENERAL}>
              <Settings className="h-3.5 w-3.5" />
              General
            </TabsTrigger>
            <TabsTrigger value={TAB_BROWSER}>
              <Monitor className="h-3.5 w-3.5" />
              Browser
            </TabsTrigger>
            <TabsTrigger value={TAB_PROXY}>
              <Globe className="h-3.5 w-3.5" />
              Proxy
            </TabsTrigger>
            <TabsTrigger value={TAB_FINGERPRINT}>
              <Shield className="h-3.5 w-3.5" />
              Fingerprint
            </TabsTrigger>
            {isEditMode && (
              <TabsTrigger value={TAB_COOKIES}>
                <Cookie className="h-3.5 w-3.5" />
                Cookies
              </TabsTrigger>
            )}
            {isEditMode && (
              <TabsTrigger value={TAB_EXTENSIONS}>
                <Puzzle className="h-3.5 w-3.5" />
                Extensions
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* Scrollable body — every TabsContent lives inside this surface. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ═══ Health summary (visible on every tab) ═══ */}
          {validationWarnings.length > 0 && (
            <FingerprintHealthPanel
              warnings={validationWarnings}
              visibleWarnings={visibleWarnings}
              hasWarnSeverity={hasWarnSeverity}
              showAll={showAllWarnings}
              onToggleShowAll={() => setShowAllWarnings((v) => !v)}
              onJumpToTab={(tab) => setActiveTab(tab)}
              activeTab={activeTab}
            />
          )}

          {/* ═══ Verification chips ═══ */}
          {isEditMode && profileId ? (
            <VerificationChips
              disabled={false}
              onOpen={async (label, url) => {
                try {
                  await api.openUrlInProfile(profileId, url)
                  addToast(`Opened ${label}`, 'success')
                } catch (err) {
                  addToast(
                    err instanceof Error ? err.message : `Failed to open ${label}`,
                    'error'
                  )
                }
              }}
            />
          ) : (
            <VerificationChips disabled />
          )}

          {/* ═══ General ═══ */}
          <TabsContent value={TAB_GENERAL} className="px-5 py-4 m-0 space-y-5">
            {/* Template selector (create-mode only) */}
            {FEATURE_TEMPLATES_ENABLED && !isEditMode && templates.length > 0 && (
              <section className="space-y-1.5">
                <Label htmlFor="profile-template">Start from template</Label>
                <SelectRoot
                  onValueChange={(v) => void handleApplyTemplate(v)}
                >
                  <SelectTrigger id="profile-template" aria-label="Profile template">
                    <SelectValue placeholder="Pick a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </section>
            )}

            {/* Group + Color */}
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="profile-group">Group</Label>
                <Input id="profile-group" {...register('group_name')} placeholder="Work, Personal" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-group-color">Color</Label>
                <input
                  id="profile-group-color"
                  type="color"
                  className="h-9 w-9 rounded-[--radius-md] border border-border bg-input cursor-pointer"
                  {...register('group_color')}
                />
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-tag-input">Tags</Label>
              {tagsList.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tagsList.map((tag) => (
                    <Badge key={tag} variant="accent">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="ml-1 text-primary/60 hover:text-primary transition-colors"
                        aria-label={`Remove tag ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  id="profile-tag-input"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Add tag…"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={addTag}
                  type="button"
                >
                  Add
                </Button>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-notes">Notes</Label>
              <textarea
                id="profile-notes"
                rows={3}
                placeholder="Additional notes…"
                className={TEXTAREA}
                {...register('notes')}
              />
            </div>

            {/* Start URL */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-start-url">Start URL</Label>
              <Input
                id="profile-start-url"
                {...register('start_url')}
                placeholder="https://example.com"
                icon={<Globe className="h-3.5 w-3.5" />}
              />
            </div>
          </TabsContent>

          {/* ═══ Browser ═══ */}
          <TabsContent value={TAB_BROWSER} className="px-5 py-4 m-0 space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="profile-browser-type-tab">Browser</Label>
                <ControlledSelectField
                  control={control}
                  name="browser_type"
                  options={BROWSER_OPTIONS}
                  triggerId="profile-browser-type-tab"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-device-type">Device Type</Label>
                <ControlledSelectField
                  control={control}
                  name="device_type"
                  options={DEVICE_TYPE_OPTIONS}
                  triggerId="profile-device-type"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-platform">Platform</Label>
              <Input
                id="profile-platform"
                {...register('platform')}
                placeholder="Win32, MacIntel, Linux x86_64"
              />
              <p className="text-[10px] text-muted-foreground">
                Auto-filled when generating a fingerprint
              </p>
            </div>

            {/* User Agent */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="profile-user-agent">User Agent</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Wand2 className="h-3.5 w-3.5" />}
                  onClick={handleGenerateFingerprint}
                  loading={generating}
                  type="button"
                >
                  Generate
                </Button>
              </div>
              <Input
                id="profile-user-agent"
                {...register('user_agent')}
                placeholder="Mozilla/5.0 …"
                className="font-mono text-xs"
              />
            </div>

            {/* Languages */}
            <div className="space-y-1.5">
              <Label htmlFor="profile-languages">Languages</Label>
              <Input
                id="profile-languages"
                {...register('languages')}
                placeholder="en-US, en"
              />
              <p className="text-[10px] text-muted-foreground">
                Comma-separated language codes
              </p>
            </div>
          </TabsContent>

          {/* ═══ Proxy ═══ */}
          <TabsContent value={TAB_PROXY} className="px-5 py-4 m-0 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="profile-proxy">Select Proxy</Label>
              <Controller
                control={control}
                name="proxy_id"
                render={({ field }) => (
                  <SelectRoot
                    value={field.value === '' ? PROXY_NONE_SENTINEL : field.value}
                    onValueChange={(next) => {
                      field.onChange(next === PROXY_NONE_SENTINEL ? '' : next)
                    }}
                  >
                    <SelectTrigger
                      id="profile-proxy"
                      ref={field.ref}
                      onBlur={field.onBlur}
                      aria-label="Proxy"
                    >
                      <SelectValue placeholder="No proxy" />
                    </SelectTrigger>
                    <SelectContent>
                      {proxyOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectRoot>
                )}
              />
            </div>

            {selectedProxy ? (
              // Inset preview block — matches the Vault rhythm of
              // FingerprintSubsection (`bg-elevated/40 surface-lit border ...`)
              // so it reads as a recessed sibling of the form, not a duplicated
              // Card chrome inside the Sheet's Card-toned container.
              <div className="rounded-[--radius-lg] border border-border bg-elevated/40 p-4 surface-lit shadow-[var(--shadow-sm)]">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {selectedProxy.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {selectedProxy.protocol}://{selectedProxy.host}:
                        {selectedProxy.port}
                      </p>
                    </div>
                    <Badge variant={selectedProxy.check_ok ? 'success' : 'destructive'} dot>
                      {selectedProxy.check_ok ? 'Online' : 'Offline'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="default">
                      {selectedProxy.protocol.toUpperCase()}
                    </Badge>
                    {selectedProxy.country && (
                      <Badge variant="default">{selectedProxy.country}</Badge>
                    )}
                    {selectedProxy.check_latency_ms != null && (
                      <Badge
                        variant={
                          selectedProxy.check_latency_ms < 500 ? 'success' : 'warning'
                        }
                      >
                        {selectedProxy.check_latency_ms}ms
                      </Badge>
                    )}
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    icon={
                      testingProxy ? undefined : proxyTestResult === true ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : proxyTestResult === false ? (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" />
                      )
                    }
                    loading={testingProxy}
                    onClick={handleTestProxy}
                    type="button"
                  >
                    {proxyTestResult === true
                      ? 'Connected'
                      : proxyTestResult === false
                        ? 'Failed'
                        : 'Test Connection'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-[--radius-lg] border border-dashed border-border p-8 text-center">
                <Globe className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No proxy selected</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Profile will use a direct connection
                </p>
              </div>
            )}
          </TabsContent>

          {/* ═══ Fingerprint ═══ */}
          <TabsContent value={TAB_FINGERPRINT} className="px-5 py-4 m-0 space-y-5">
            {/* Generate / preset / strength bar */}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                icon={<Wand2 className="h-3.5 w-3.5" />}
                onClick={handleGenerateFingerprint}
                loading={generating}
                type="button"
              >
                Generate All
              </Button>

              <DropdownMenu
                align="left"
                items={presetMenuItems}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Sparkles className="h-3.5 w-3.5" />}
                    type="button"
                    loading={applyingPreset}
                    disabled={applyingPreset || presets === null}
                    aria-label="Apply fingerprint preset"
                  >
                    <span className="inline-flex items-center gap-1">
                      Preset
                      <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </Button>
                }
              />

              {fpStrength && (
                <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                  <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-300',
                        fpStrength.score >= 80
                          ? 'bg-ok'
                          : fpStrength.score >= 50
                            ? 'bg-warn'
                            : 'bg-destructive'
                      )}
                      style={{ width: `${fpStrength.score}%` }}
                    />
                  </div>
                  <Tooltip
                    content={
                      fpStrength.issues.length > 0
                        ? fpStrength.issues.join(', ')
                        : 'No issues'
                    }
                  >
                    <span
                      className={cn(
                        'text-xs font-bold tabular-nums cursor-help',
                        fpStrength.score >= 80
                          ? 'text-ok'
                          : fpStrength.score >= 50
                            ? 'text-warn'
                            : 'text-destructive'
                      )}
                    >
                      {fpStrength.score}%
                    </span>
                  </Tooltip>
                </div>
              )}
            </div>

            <Separator />

            {/* WebRTC */}
            <FingerprintSubsection
              title="WebRTC"
              description="Control WebRTC IP leak behavior"
              open={webrtcOpen}
              onOpenChange={setWebrtcOpen}
            >
              <div className="space-y-1.5">
                <Label htmlFor="profile-webrtc-policy">Policy</Label>
                <ControlledSelectField
                  control={control}
                  name="webrtc_policy"
                  options={WEBRTC_POLICIES}
                  triggerId="profile-webrtc-policy"
                />
              </div>
            </FingerprintSubsection>

            {/* WebGL */}
            <FingerprintSubsection
              title="WebGL"
              description="GPU fingerprint spoofing"
              open={webglOpen}
              onOpenChange={setWebglOpen}
            >
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-webgl-vendor">
                    Vendor{' '}
                    <span className="text-muted-foreground/60 font-normal text-[10px]">
                      (auto-generated)
                    </span>
                  </Label>
                  <Input
                    id="profile-webgl-vendor"
                    {...register('webgl_vendor')}
                    readOnly
                    className="opacity-60 font-mono text-xs cursor-default"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-webgl-renderer">
                    Renderer{' '}
                    <span className="text-muted-foreground/60 font-normal text-[10px]">
                      (auto-generated)
                    </span>
                  </Label>
                  <Input
                    id="profile-webgl-renderer"
                    {...register('webgl_renderer')}
                    readOnly
                    className="opacity-60 font-mono text-xs cursor-default"
                  />
                </div>
              </div>
            </FingerprintSubsection>

            {/* Screen & Display */}
            <FingerprintSubsection
              title="Screen & Display"
              description="Resolution and rendering settings"
              open={displayOpen}
              onOpenChange={setDisplayOpen}
            >
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-screen">Resolution</Label>
                  <ControlledSelectField
                    control={control}
                    name="screen"
                    options={screenOptions}
                    triggerId="profile-screen"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-color-depth">Color Depth</Label>
                    <ControlledSelectField
                      control={control}
                      name="color_depth"
                      options={COLOR_DEPTH_OPTIONS}
                      numeric
                      triggerId="profile-color-depth"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-pixel-ratio">Pixel Ratio</Label>
                    <ControlledSelectField
                      control={control}
                      name="pixel_ratio"
                      options={PIXEL_RATIO_OPTIONS}
                      numeric
                      triggerId="profile-pixel-ratio"
                    />
                  </div>
                </div>
              </div>
            </FingerprintSubsection>

            {/* Hardware */}
            <FingerprintSubsection
              title="Hardware"
              description="CPU and memory configuration"
              open={hardwareOpen}
              onOpenChange={setHardwareOpen}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-hardware-concurrency">CPU Cores</Label>
                  <ControlledSelectField
                    control={control}
                    name="hardware_concurrency"
                    options={HARDWARE_CONCURRENCY_OPTIONS}
                    numeric
                    triggerId="profile-hardware-concurrency"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="profile-device-memory">Memory</Label>
                  <ControlledSelectField
                    control={control}
                    name="device_memory"
                    options={DEVICE_MEMORY_OPTIONS}
                    numeric
                    triggerId="profile-device-memory"
                  />
                </div>
              </div>
            </FingerprintSubsection>

            {/* Timezone */}
            <FingerprintSubsection
              title="Timezone & Locale"
              description="Geographic identity settings"
              open={timezoneOpen}
              onOpenChange={setTimezoneOpen}
              actions={
                <Tooltip
                  content={
                    watchedProxyId
                      ? 'Fill timezone and languages from the attached proxy IP'
                      : 'Attach a proxy to apply geo'
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<MapPin className="h-3.5 w-3.5" />}
                    onClick={handleApplyProxyGeo}
                    loading={applyingGeo}
                    disabled={!watchedProxyId || applyingGeo}
                    type="button"
                    aria-label={
                      watchedProxyId
                        ? 'Apply geo from proxy'
                        : 'Attach a proxy to apply geo'
                    }
                  >
                    {applyingGeo ? 'Resolving…' : 'Apply geo'}
                  </Button>
                </Tooltip>
              }
            >
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="profile-timezone">Timezone</Label>
                  <ControlledSelectField
                    control={control}
                    name="timezone"
                    options={timezoneOptions}
                    triggerId="profile-timezone"
                  />
                </div>
                {!watchedProxyId && (
                  <p className="text-[10px] text-muted-foreground">
                    Attach a proxy to enable “Apply geo from proxy”.
                  </p>
                )}
              </div>
            </FingerprintSubsection>
          </TabsContent>

          {/* ═══ Cookies ═══ */}
          {isEditMode && profileId && (
            <TabsContent value={TAB_COOKIES} className="px-5 py-4 m-0">
              <CookiesTab profileId={profileId} profileName={getValues('name')} />
            </TabsContent>
          )}

          {/* ═══ Extensions ═══ */}
          {isEditMode && profileId && (
            <TabsContent value={TAB_EXTENSIONS} className="px-5 py-4 m-0">
              <ExtensionsTab profileId={profileId} />
            </TabsContent>
          )}
        </div>
      </TabsRoot>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface FingerprintSubsectionProps {
  title: string
  description?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  actions?: React.ReactNode
  children: React.ReactNode
}

/**
 * Collapsible group for fingerprint sub-cards (WebRTC / WebGL / Display /
 * Hardware / Timezone). Subtle inset card chrome with a header that exposes
 * a disclosure button and optional inline action button. Body unmounts when
 * collapsed so a closed section doesn't keep reactive form subscriptions
 * live. The disclosure is a real chevron button with `aria-expanded` +
 * `aria-controls` — the prior `<Switch>` semantically described an on/off
 * setting, not a collapse/expand region, which mis-represented intent to AT.
 */
function FingerprintSubsection({
  title,
  description,
  open,
  onOpenChange,
  actions,
  children
}: FingerprintSubsectionProps): React.JSX.Element {
  const titleId = `fp-section-${title.toLowerCase().replace(/\s+/g, '-')}`
  const bodyId = `${titleId}-body`
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-[--radius-lg] border border-border bg-elevated/40 p-4 surface-lit shadow-[var(--shadow-sm)]"
    >
      <header className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3
            id={titleId}
            className="text-[14px] font-semibold text-foreground tracking-tight"
          >
            {title}
          </h3>
          {description && (
            <p className="text-[12px] text-muted-foreground leading-relaxed">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {actions}
          <button
            type="button"
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
            className={cn(
              'inline-flex items-center justify-center h-7 w-7 rounded-[--radius-sm]',
              'text-muted-foreground hover:text-foreground hover:bg-elevated/60',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
            )}
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
        </div>
      </header>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  )
}

interface FingerprintHealthPanelProps {
  warnings: ValidationWarning[]
  visibleWarnings: ValidationWarning[]
  hasWarnSeverity: boolean
  showAll: boolean
  onToggleShowAll: () => void
  onJumpToTab: (tab: TabId) => void
  activeTab: TabId
}

/**
 * Surfaces validator warnings as a compact panel above the tab body. Clicking
 * a row jumps to the tab the field lives on. Stays sticky-ish at the top of
 * the scroll surface — collapses to 3 rows + "show more" when there are many.
 */
function FingerprintHealthPanel({
  warnings,
  visibleWarnings,
  hasWarnSeverity,
  showAll,
  onToggleShowAll,
  onJumpToTab,
  activeTab
}: FingerprintHealthPanelProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'mx-5 mt-3 rounded-[--radius-md] border px-3.5 py-2.5 text-xs',
        hasWarnSeverity ? 'bg-warn/10 border-warn/25' : 'bg-elevated border-border'
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 mb-2 font-medium',
          hasWarnSeverity ? 'text-warn' : 'text-muted-foreground'
        )}
      >
        {hasWarnSeverity ? (
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Info className="h-3.5 w-3.5 shrink-0" />
        )}
        <span>Fingerprint consistency</span>
        <Badge
          variant={hasWarnSeverity ? 'warning' : 'muted'}
          className="ml-auto h-4 px-1.5 text-[10px] tabular-nums"
        >
          {warnings.length}
        </Badge>
      </div>
      <ul
        className={cn(
          'space-y-1.5',
          warnings.length > 3 && showAll && 'max-h-44 overflow-y-auto pr-1'
        )}
      >
        {visibleWarnings.map((w, i) => {
          const targetTab = FIELD_TAB_MAP[w.field]
          const isOnTargetTab = targetTab && activeTab === targetTab
          return (
            <li
              key={`${w.field}:${w.severity}:${i}`}
              className="flex items-start gap-2 text-foreground/85"
            >
              {w.severity === 'warn' ? (
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-warn" />
              ) : (
                <Info className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
              )}
              <span className="flex-1">{w.message}</span>
              {targetTab && !isOnTargetTab && (
                <button
                  type="button"
                  onClick={() => onJumpToTab(targetTab)}
                  className="text-[10px] font-medium uppercase tracking-wider text-primary hover:text-accent-dim transition-colors shrink-0"
                  aria-label={`Jump to ${targetTab} tab`}
                >
                  Fix →
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {warnings.length > 3 && (
        <button
          type="button"
          onClick={onToggleShowAll}
          className="mt-2 text-[11px] font-medium text-primary hover:text-accent-dim transition-colors"
        >
          {showAll ? 'Show less' : `Show ${warnings.length - 3} more`}
        </button>
      )}
    </div>
  )
}

interface VerificationChipsProps {
  disabled: boolean
  onOpen?: (label: string, url: string) => Promise<void> | void
}

/**
 * Quick-action chips that open detection-vector test sites in the launched
 * browser. Disabled in create-mode (no profileId yet) — saves the operator
 * a click instead of failing silently after they hit a chip.
 */
function VerificationChips({ disabled, onOpen }: VerificationChipsProps): React.JSX.Element {
  return (
    <div className="mx-5 mt-3 rounded-[--radius-md] bg-elevated/40 border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Verification</span>
        </div>
        {disabled && (
          <span
            id="verification-hint"
            className="text-[10px] font-medium text-muted-foreground/70"
          >
            Available after saving
          </span>
        )}
      </div>
      <div
        role="group"
        aria-label="Verification test sites"
        className="flex flex-wrap gap-1.5"
      >
        {TEST_SITES.map((site) => (
          // Use `aria-disabled` + click guard instead of the native `disabled`
          // attribute so the chip stays in the keyboard tab order and screen
          // readers can still announce the chip + the "Available after saving"
          // hint via `aria-describedby`. Native `disabled` removes the element
          // from the accessibility tree entirely.
          <button
            key={site.url}
            type="button"
            aria-disabled={disabled || undefined}
            aria-describedby={disabled ? 'verification-hint' : undefined}
            onClick={() => {
              if (disabled) return
              void onOpen?.(site.label, site.url)
            }}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2.5 py-1',
              'text-[11px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              disabled
                ? 'bg-card/60 border border-border/50 text-muted-foreground cursor-not-allowed opacity-70'
                : 'bg-card border border-border text-foreground/85 hover:text-primary hover:border-primary/40 hover:bg-primary/5'
            )}
          >
            {site.label}
          </button>
        ))}
      </div>
    </div>
  )
}
