import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowLeft,
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
  Plus
} from 'lucide-react'
import { api } from '../lib/api'
import { useProxiesStore } from '../stores/proxies'
import { useToastStore } from '../components/Toast'
import { useConfirmStore } from '../components/ConfirmDialog'
import { cn } from '../lib/utils'
import { Button, Input, Select, Card, Toggle, Tabs, Badge, Tooltip } from '../components/ui'
import { TEXTAREA, LABEL } from '../lib/ui'
import { validateProfileFingerprint } from '../lib/fingerprint-validator'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCREEN_PRESETS = [
  { value: '1920x1080', label: '1920×1080' },
  { value: '2560x1440', label: '2560×1440' },
  { value: '1366x768', label: '1366×768' },
  { value: '1536x864', label: '1536×864' },
  { value: '1440x900', label: '1440×900' },
  { value: '1280x720', label: '1280×720' }
]

const TIMEZONES = [
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

const BROWSER_OPTIONS = [
  { value: 'chromium', label: 'Chromium' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'edge', label: 'Edge' }
]

const DEVICE_TYPE_OPTIONS = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Mobile' }
]

const HARDWARE_CONCURRENCY_OPTIONS = [
  { value: '4', label: '4 cores' },
  { value: '8', label: '8 cores' },
  { value: '12', label: '12 cores' },
  { value: '16', label: '16 cores' }
]

const DEVICE_MEMORY_OPTIONS = [
  { value: '4', label: '4 GB' },
  { value: '8', label: '8 GB' },
  { value: '16', label: '16 GB' }
]

const WEBRTC_POLICIES = [
  { value: 'disable_non_proxied_udp', label: 'Disable non-proxied UDP' },
  { value: 'default_public_interface_only', label: 'Default public only' },
  { value: 'default', label: 'Default' }
]

const COLOR_DEPTH_OPTIONS = [
  { value: '24', label: '24-bit' },
  { value: '30', label: '30-bit' },
  { value: '32', label: '32-bit' }
]

const PIXEL_RATIO_OPTIONS = [
  { value: '1', label: '1.0×' },
  { value: '1.25', label: '1.25×' },
  { value: '1.5', label: '1.5×' },
  { value: '2', label: '2.0×' },
  { value: '3', label: '3.0×' }
]

const FORM_TABS = [
  { id: 'general', label: 'General', icon: <Settings className="h-3.5 w-3.5" /> },
  { id: 'browser', label: 'Browser', icon: <Monitor className="h-3.5 w-3.5" /> },
  { id: 'proxy', label: 'Proxy', icon: <Globe className="h-3.5 w-3.5" /> },
  { id: 'fingerprint', label: 'Fingerprint', icon: <Shield className="h-3.5 w-3.5" /> }
]

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
// Component
// ---------------------------------------------------------------------------

interface ProfileEditorPanelProps {
  profileId?: string | null
  onSave: () => void
  onCancel: () => void
}

export function ProfileEditorPanel({
  profileId,
  onSave,
  onCancel
}: ProfileEditorPanelProps): React.JSX.Element {
  const isEditMode = Boolean(profileId)

  // -- Local state --------------------------------------------------------
  const [activeTab, setActiveTab] = useState('general')
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

  // Fingerprint section toggles (UI-only collapse / expand)
  const [webrtcOpen, setWebrtcOpen] = useState(true)
  const [webglOpen, setWebglOpen] = useState(true)
  const [displayOpen, setDisplayOpen] = useState(true)
  const [hardwareOpen, setHardwareOpen] = useState(true)
  const [timezoneOpen, setTimezoneOpen] = useState(true)

  // -- Store --------------------------------------------------------------
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
    formState: { errors, isDirty }
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: DEFAULT_VALUES
  })

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
  const screenValue = watch('screen')

  const selectedProxy = useMemo(
    () => proxies.find((p) => p.id === watchedProxyId),
    [proxies, watchedProxyId]
  )
  const selectedProxyCountry = selectedProxy?.country ?? null
  const isCustomScreen = !SCREEN_PRESETS.some((p) => p.value === screenValue)
  const isCustomTimezone = !(TIMEZONES as readonly string[]).includes(watchedTimezone)

  // -- Derived ------------------------------------------------------------
  const tagsList = watchedTags
    ? watchedTags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const proxyOptions = useMemo(
    () => [
      { value: '', label: 'No proxy' },
      ...proxies.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.protocol}://${p.host}:${p.port})`
      }))
    ],
    [proxies]
  )

  const screenOptions = useMemo(
    () => [
      ...SCREEN_PRESETS,
      ...(isCustomScreen ? [{ value: screenValue, label: screenValue }] : [])
    ],
    [isCustomScreen, screenValue]
  )

  const timezoneOptions = useMemo(
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
        screen: screenValue ?? '',
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
      screenValue,
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
    api
      .listTemplates()
      .then((t: unknown[]) => {
        setTemplates(t as Array<{ id: string; name: string; browser_type: string }>)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!profileId) {
      reset(DEFAULT_VALUES)
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
          tags: detail.profile.tags || '',
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
          languages: (() => {
            try {
              return JSON.parse(detail.fingerprint.languages).join(', ')
            } catch {
              return detail.fingerprint.languages
            }
          })(),
          device_type:
            (detail.fingerprint.device_type as 'desktop' | 'mobile') || 'desktop'
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      })
  }, [profileId, reset])

  // -- Handlers -----------------------------------------------------------

  const handleCancel = (): void => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard them?')) return
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
      setValue('languages', fp.languages, { shouldDirty: true })
      setValue('color_depth', fp.color_depth ?? 24, { shouldDirty: true })
      setValue('pixel_ratio', fp.pixel_ratio ?? 1.0, { shouldDirty: true })
      setActiveTab('fingerprint')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate fingerprint')
    } finally {
      setGenerating(false)
    }
  }

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
      const existing = (getValues('languages') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
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
    try {
      const data = getValues()
      const { width, height } = parseScreen(data.screen)
      await api.createTemplate({
        name: `${data.name} Template`,
        browser_type: data.browser_type,
        config: {
          group_name: data.group_name || null,
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
            webrtc_policy: data.webrtc_policy
          }
        } as Record<string, unknown>
      })
      setTemplateSaved(true)
      setTimeout(() => setTemplateSaved(false), 2000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save template')
    }
  }

  const onSubmit = async (data: ProfileFormData): Promise<void> => {
    try {
      setSaving(true)
      setError(null)
      const { width, height } = parseScreen(data.screen)
      const languagesArray = data.languages
        ? data.languages
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : ['en-US', 'en']

      if (isEditMode && profileId) {
        await api.updateProfile(profileId, {
          name: data.name,
          browser_type: data.browser_type,
          group_name: data.group_name || null,
          notes: data.notes,
          proxy_id: data.proxy_id || null,
          start_url: data.start_url,
          group_color: data.group_color || null,
          tags: data.tags
            ? data.tags
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : []
        })
        await api.updateFingerprint(profileId, {
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
        })
      } else {
        await api.createProfile({
          name: data.name,
          browser_type: data.browser_type,
          group_name: data.group_name || null,
          notes: data.notes,
          proxy_id: data.proxy_id || null,
          start_url: data.start_url,
          group_color: data.group_color || null,
          tags: data.tags
            ? data.tags
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col h-full">
      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-edge shrink-0">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="h-4 w-4" />}
          onClick={handleCancel}
          type="button"
          aria-label="Go back"
        />
        <h2 className="text-sm font-semibold text-content flex-1 truncate">
          {isEditMode ? 'Edit Profile' : 'New Profile'}
        </h2>
        {isDirty && (
          <Badge variant="warning" dot>
            Unsaved
          </Badge>
        )}
        {isEditMode && (
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
          variant="primary"
          size="sm"
          icon={<Save className="h-3.5 w-3.5" />}
          type="submit"
          loading={saving}
        >
          {isEditMode ? 'Save' : 'Create'}
        </Button>
      </div>

      {/* ── Error Banner ────────────────────────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="mx-4 mt-3 rounded-[--radius-md] bg-err/8 border border-err/20 px-3.5 py-2.5 text-xs text-err font-medium flex items-center gap-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* ── Consistency Warnings ────────────────────────────────────────── */}
      {validationWarnings.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'mx-4 mt-3 rounded-[--radius-md] border px-3.5 py-2.5 text-xs',
            hasWarnSeverity
              ? 'bg-warn/8 border-warn/20'
              : 'bg-elevated border-edge'
          )}
        >
          <div
            className={cn(
              'flex items-center gap-1.5 mb-1.5 font-medium',
              hasWarnSeverity ? 'text-warn' : 'text-muted'
            )}
          >
            {hasWarnSeverity ? (
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Info className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>Fingerprint consistency</span>
          </div>
          <ul
            className={cn(
              'space-y-1',
              validationWarnings.length > 3 && showAllWarnings && 'max-h-48 overflow-y-auto pr-1'
            )}
          >
            {visibleWarnings.map((w, i) => (
              <li
                key={`${w.field}:${w.severity}:${i}`}
                className="flex items-start gap-1.5 text-content/80"
              >
                {w.severity === 'warn' ? (
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0 text-warn" />
                ) : (
                  <Info className="h-3 w-3 mt-0.5 shrink-0 text-muted" />
                )}
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
          {validationWarnings.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllWarnings((v) => !v)}
              className="mt-1.5 text-[11px] font-medium text-accent hover:text-accent/80 transition-colors"
            >
              {showAllWarnings
                ? 'Show less'
                : `Show ${validationWarnings.length - 3} more`}
            </button>
          )}
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs
        tabs={FORM_TABS}
        activeTab={activeTab}
        onChange={setActiveTab}
        className="px-4 pt-3"
      />

      {/* ── Tab Content ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* ═══ General ═══ */}
        {activeTab === 'general' && (
          <div className="space-y-4">
            {/* Template selector (create-mode only) */}
            {!isEditMode && templates.length > 0 && (
              <Card title="Template">
                <Select
                  options={[
                    { value: '', label: 'Start from scratch' },
                    ...templates.map((t) => ({ value: t.id, label: t.name }))
                  ]}
                  onChange={async (e) => {
                    const tid = (e.target as HTMLSelectElement).value
                    if (!tid) return
                    try {
                      const tmpl = (await api.getTemplate(tid)) as {
                        config: string
                        browser_type: string
                      }
                      const config = JSON.parse(tmpl.config) as Record<string, unknown>
                      if (config.group_name)
                        setValue('group_name', config.group_name as string)
                      if (config.notes) setValue('notes', config.notes as string)
                      if (config.start_url)
                        setValue('start_url', config.start_url as string)
                      setValue(
                        'browser_type',
                        tmpl.browser_type as 'chromium' | 'firefox' | 'edge'
                      )
                      const fp = config.fingerprint as Record<string, unknown> | undefined
                      if (fp) {
                        if (fp.user_agent) setValue('user_agent', fp.user_agent as string)
                        if (fp.platform) setValue('platform', fp.platform as string)
                        if (fp.screen_width && fp.screen_height)
                          setValue('screen', toScreenValue(fp.screen_width as number, fp.screen_height as number))
                        if (fp.timezone) setValue('timezone', fp.timezone as string)
                        if (fp.languages) setValue('languages', fp.languages as string)
                        if (fp.webrtc_policy) setValue('webrtc_policy', fp.webrtc_policy as string)
                        if (fp.webgl_vendor) setValue('webgl_vendor', fp.webgl_vendor as string)
                        if (fp.webgl_renderer) setValue('webgl_renderer', fp.webgl_renderer as string)
                        if (fp.hardware_concurrency) setValue('hardware_concurrency', fp.hardware_concurrency as number)
                        if (fp.device_memory) setValue('device_memory', fp.device_memory as number)
                        if (fp.color_depth) setValue('color_depth', fp.color_depth as number)
                        if (fp.pixel_ratio) setValue('pixel_ratio', fp.pixel_ratio as number)
                        if (fp.device_type) setValue('device_type', fp.device_type as 'desktop' | 'mobile')
                      }
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </Card>
            )}

            {/* Profile name */}
            <div>
              <label className={LABEL}>Profile Name</label>
              <Input
                {...register('name')}
                placeholder="My Profile"
                error={errors.name?.message}
                className="!text-base font-medium"
              />
            </div>

            {/* Group + Color */}
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div>
                <label className={LABEL}>Group</label>
                <Input {...register('group_name')} placeholder="Work, Personal" />
              </div>
              <div>
                <label className={LABEL}>Color</label>
                <input
                  type="color"
                  className="h-9 w-9 rounded-[--radius-md] border border-edge bg-surface cursor-pointer"
                  {...register('group_color')}
                />
              </div>
            </div>

            {/* Tags */}
            <div>
              <label className={LABEL}>Tags</label>
              {tagsList.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tagsList.map((tag) => (
                    <Badge key={tag} variant="accent">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="ml-1 text-accent/60 hover:text-accent transition-colors"
                        aria-label={`Remove tag ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder="Add tag…"
                  />
                </div>
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
            <div>
              <label className={LABEL}>Notes</label>
              <textarea
                rows={3}
                placeholder="Additional notes…"
                className={TEXTAREA}
                {...register('notes')}
              />
            </div>

            {/* Start URL */}
            <div>
              <label className={LABEL}>Start URL</label>
              <Input
                {...register('start_url')}
                placeholder="https://example.com"
                icon={<Globe className="h-3.5 w-3.5" />}
              />
            </div>
          </div>
        )}

        {/* ═══ Browser ═══ */}
        {activeTab === 'browser' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Browser</label>
                <Select options={BROWSER_OPTIONS} {...register('browser_type')} />
              </div>
              <div>
                <label className={LABEL}>Device Type</label>
                <Select options={DEVICE_TYPE_OPTIONS} {...register('device_type')} />
              </div>
            </div>

            <div>
              <label className={LABEL}>Platform</label>
              <Input
                {...register('platform')}
                placeholder="Win32, MacIntel, Linux x86_64"
              />
              <p className="mt-1 text-[10px] text-muted">
                Auto-filled when generating a fingerprint
              </p>
            </div>

            {/* User Agent */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-content">User Agent</label>
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
                {...register('user_agent')}
                placeholder="Mozilla/5.0 …"
                className="font-mono text-xs"
              />
            </div>

            {/* Languages */}
            <div>
              <label className={LABEL}>Languages</label>
              <Input {...register('languages')} placeholder="en-US, en" />
              <p className="mt-1 text-[10px] text-muted">
                Comma-separated language codes
              </p>
            </div>
          </div>
        )}

        {/* ═══ Proxy ═══ */}
        {activeTab === 'proxy' && (
          <div className="space-y-4">
            <div>
              <label className={LABEL}>Select Proxy</label>
              <Select options={proxyOptions} {...register('proxy_id')} />
            </div>

            {selectedProxy ? (
              <Card>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-content truncate">
                        {selectedProxy.name}
                      </p>
                      <p className="text-xs text-muted mt-0.5 truncate">
                        {selectedProxy.protocol}://{selectedProxy.host}:
                        {selectedProxy.port}
                      </p>
                    </div>
                    <Badge variant={selectedProxy.check_ok ? 'success' : 'error'} dot>
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
              </Card>
            ) : (
              <div className="rounded-[--radius-lg] border border-dashed border-edge p-8 text-center">
                <Globe className="h-8 w-8 text-muted/30 mx-auto mb-2" />
                <p className="text-sm text-muted">No proxy selected</p>
                <p className="text-xs text-muted/60 mt-1">
                  Profile will use a direct connection
                </p>
              </div>
            )}
          </div>
        )}

        {/* ═══ Fingerprint ═══ */}
        {activeTab === 'fingerprint' && (
          <div className="space-y-4">
            {/* Generate & strength bar */}
            <div className="flex items-center gap-3">
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

              {fpStrength && (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="flex-1 h-1.5 bg-elevated rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-300',
                        fpStrength.score >= 80
                          ? 'bg-ok'
                          : fpStrength.score >= 50
                            ? 'bg-warn'
                            : 'bg-err'
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
                            : 'text-err'
                      )}
                    >
                      {fpStrength.score}%
                    </span>
                  </Tooltip>
                </div>
              )}
            </div>

            {/* WebRTC */}
            <Card
              title="WebRTC"
              description="Control WebRTC IP leak behavior"
              actions={<Toggle checked={webrtcOpen} onChange={setWebrtcOpen} />}
            >
              {webrtcOpen && (
                <div className="pt-3">
                  <label className={LABEL}>Policy</label>
                  <Select options={WEBRTC_POLICIES} {...register('webrtc_policy')} />
                </div>
              )}
            </Card>

            {/* WebGL */}
            <Card
              title="WebGL"
              description="GPU fingerprint spoofing"
              actions={<Toggle checked={webglOpen} onChange={setWebglOpen} />}
            >
              {webglOpen && (
                <div className="pt-3 space-y-3">
                  <div>
                    <label className={LABEL}>
                      Vendor{' '}
                      <span className="text-muted/50 font-normal text-[10px]">
                        (auto-generated)
                      </span>
                    </label>
                    <Input
                      {...register('webgl_vendor')}
                      readOnly
                      className="opacity-60 font-mono text-xs cursor-default"
                    />
                  </div>
                  <div>
                    <label className={LABEL}>
                      Renderer{' '}
                      <span className="text-muted/50 font-normal text-[10px]">
                        (auto-generated)
                      </span>
                    </label>
                    <Input
                      {...register('webgl_renderer')}
                      readOnly
                      className="opacity-60 font-mono text-xs cursor-default"
                    />
                  </div>
                </div>
              )}
            </Card>

            {/* Screen & Display */}
            <Card
              title="Screen & Display"
              description="Resolution and rendering settings"
              actions={<Toggle checked={displayOpen} onChange={setDisplayOpen} />}
            >
              {displayOpen && (
                <div className="pt-3 space-y-3">
                  <div>
                    <label className={LABEL}>Resolution</label>
                    <Select options={screenOptions} {...register('screen')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL}>Color Depth</label>
                      <Select
                        options={COLOR_DEPTH_OPTIONS}
                        {...register('color_depth', { valueAsNumber: true })}
                      />
                    </div>
                    <div>
                      <label className={LABEL}>Pixel Ratio</label>
                      <Select
                        options={PIXEL_RATIO_OPTIONS}
                        {...register('pixel_ratio', { valueAsNumber: true })}
                      />
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Hardware */}
            <Card
              title="Hardware"
              description="CPU and memory configuration"
              actions={<Toggle checked={hardwareOpen} onChange={setHardwareOpen} />}
            >
              {hardwareOpen && (
                <div className="pt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL}>CPU Cores</label>
                    <Select
                      options={HARDWARE_CONCURRENCY_OPTIONS}
                      {...register('hardware_concurrency', { valueAsNumber: true })}
                    />
                  </div>
                  <div>
                    <label className={LABEL}>Memory</label>
                    <Select
                      options={DEVICE_MEMORY_OPTIONS}
                      {...register('device_memory', { valueAsNumber: true })}
                    />
                  </div>
                </div>
              )}
            </Card>

            {/* Timezone */}
            <Card
              title="Timezone & Locale"
              description="Geographic identity settings"
              actions={
                <>
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
                      {applyingGeo ? 'Resolving proxy geo…' : 'Apply geo from proxy'}
                    </Button>
                  </Tooltip>
                  <Toggle checked={timezoneOpen} onChange={setTimezoneOpen} />
                </>
              }
            >
              {timezoneOpen && (
                <div className="pt-3 space-y-3">
                  <div>
                    <label className={LABEL}>Timezone</label>
                    <Select options={timezoneOptions} {...register('timezone')} />
                  </div>
                  {!watchedProxyId && (
                    <p className="text-[10px] text-muted">
                      Attach a proxy to the profile to enable “Apply geo from proxy”.
                    </p>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </form>
  )
}
