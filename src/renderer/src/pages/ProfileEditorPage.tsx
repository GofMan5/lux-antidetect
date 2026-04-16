import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Wand2, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../lib/api'
import { useProxiesStore } from '../stores/proxies'
import { INPUT_CLASS, SELECT_CLASS, LABEL_CLASS, TEXTAREA_CLASS, BTN_PRIMARY, BTN_SECONDARY } from '../lib/ui'

const SCREEN_PRESETS = [
  { label: '1920x1080', value: '1920x1080' },
  { label: '2560x1440', value: '2560x1440' },
  { label: '1366x768', value: '1366x768' },
  { label: '1536x864', value: '1536x864' },
  { label: '1440x900', value: '1440x900' },
  { label: '1280x720', value: '1280x720' }
] as const

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

const HARDWARE_CONCURRENCY_OPTIONS = [4, 8, 12, 16] as const
const DEVICE_MEMORY_OPTIONS = [4, 8, 16] as const

const WEBRTC_POLICIES = [
  { label: 'Disable non-proxied UDP', value: 'disable_non_proxied_udp' },
  { label: 'Default public only', value: 'default_public_interface_only' },
  { label: 'Default', value: 'default' }
] as const

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
  pixel_ratio: z.number()
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
  pixel_ratio: 1.0
}

function parseScreen(value: string): { width: number; height: number } {
  const [w, h] = value.split('x').map(Number)
  return { width: w || 1920, height: h || 1080 }
}

function toScreenValue(w: number, h: number): string {
  return `${w}x${h}`
}

interface ProfileEditorPanelProps {
  profileId?: string | null
  onSave: () => void
  onCancel: () => void
}

function getFingerprintStrength(watchedFields: [string, string, string | number, string, string]): { score: number; issues: string[] } {
  const [ua, platform, pixelRatio, webglVendor, timezone] = watchedFields
  const issues: string[] = []

  if (ua.includes('Windows') && platform !== 'Win32') issues.push('UA/Platform mismatch')
  if (ua.includes('Macintosh') && platform !== 'MacIntel') issues.push('UA/Platform mismatch')
  if (ua.includes('Macintosh') && String(pixelRatio) === '1') issues.push('Mac usually has 2x pixel ratio')
  if (!ua) issues.push('No User-Agent set')
  if (!webglVendor) issues.push('No WebGL vendor')
  if (!timezone) issues.push('No timezone set')
  if (ua.includes('Windows') && webglVendor === 'Apple') issues.push('Windows + Apple GPU impossible')

  const score = Math.max(0, 100 - issues.length * 15)
  return { score, issues }
}

export function ProfileEditorPanel({
  profileId,
  onSave,
  onCancel
}: ProfileEditorPanelProps): React.JSX.Element {
  const isEditMode = Boolean(profileId)
  const [fpOpen, setFpOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [templateSaved, setTemplateSaved] = useState(false)
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; browser_type: string }>>([])

  const proxies = useProxiesStore((s) => s.proxies)
  const fetchProxies = useProxiesStore((s) => s.fetchProxies)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors }
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: DEFAULT_VALUES
  })

  const watchedData = watch(['user_agent', 'platform', 'pixel_ratio', 'webgl_vendor', 'timezone'])

  useEffect(() => {
    fetchProxies()
  }, [fetchProxies])

  useEffect(() => {
    api.listTemplates().then((t: unknown[]) => {
      setTemplates(t as Array<{ id: string; name: string; browser_type: string }>)
    }).catch(() => {})
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
          screen: toScreenValue(detail.fingerprint.screen_width, detail.fingerprint.screen_height),
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
          })()
        })
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      })
  }, [profileId, reset])

  const handleGenerateFingerprint = async (): Promise<void> => {
    try {
      setGenerating(true)
      const browserType = getValues('browser_type')
      const fp = await api.generateFingerprint(browserType)
      setValue('user_agent', fp.user_agent)
      setValue('platform', fp.platform)
      setValue('screen', toScreenValue(fp.screen_width, fp.screen_height))
      setValue('timezone', fp.timezone)
      setValue('hardware_concurrency', fp.hardware_concurrency)
      setValue('device_memory', fp.device_memory)
      setValue('webgl_vendor', fp.webgl_vendor)
      setValue('webgl_renderer', fp.webgl_renderer)
      setValue('webrtc_policy', fp.webrtc_policy)
      setValue('languages', fp.languages)
      setValue('color_depth', fp.color_depth ?? 24)
      setValue('pixel_ratio', fp.pixel_ratio ?? 1.0)
      setFpOpen(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate fingerprint')
    } finally {
      setGenerating(false)
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
          group_name: data.group_name || null,
          notes: data.notes,
          proxy_id: data.proxy_id || null,
          start_url: data.start_url,
          group_color: data.group_color || null,
          tags: data.tags ? data.tags.split(',').map(s => s.trim()).filter(Boolean) : []
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
          languages: languagesArray
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
          tags: data.tags ? data.tags.split(',').map(s => s.trim()).filter(Boolean) : [],
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
            languages: JSON.stringify(languagesArray)
          }
        })
      }
      onSave()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const screenValue = watch('screen')
  const isCustomScreen = !SCREEN_PRESETS.some((p) => p.value === screenValue)
  const timezoneValue = watch('timezone')
  const isCustomTimezone = !TIMEZONES.includes(timezoneValue as (typeof TIMEZONES)[number])

  return (
    <div className="p-4 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg bg-err/10 border border-err/30 px-3 py-2 text-xs text-err mb-3">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        {/* Templates */}
        {!isEditMode && templates.length > 0 && (
          <div>
            <label className={LABEL_CLASS}>From Template</label>
            <select
              onChange={async (e) => {
                if (!e.target.value) return
                try {
                  const tmpl = await api.getTemplate(e.target.value) as { config: string; browser_type: string }
                  const config = JSON.parse(tmpl.config) as Record<string, unknown>
                  if (config.group_name) setValue('group_name', config.group_name as string)
                  if (config.notes) setValue('notes', config.notes as string)
                  if (config.start_url) setValue('start_url', config.start_url as string)
                  setValue('browser_type', tmpl.browser_type as 'chromium' | 'firefox' | 'edge')
                } catch { /* ignore */ }
              }}
              className={SELECT_CLASS}
            >
              <option value="">Select template...</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* General */}
        <section className="bg-surface-alt/50 rounded-lg border border-edge p-3 space-y-2.5">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">General</h3>

          <div>
            <label htmlFor="name" className={LABEL_CLASS}>
              Name
            </label>
            <input
              id="name"
              type="text"
              placeholder="My Profile"
              className={INPUT_CLASS}
              {...register('name')}
            />
            {errors.name && <p className="mt-1 text-xs text-err">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-[1fr_1fr_48px] gap-2">
            <div>
              <label htmlFor="browser_type" className={LABEL_CLASS}>
                Browser
              </label>
              <select id="browser_type" className={SELECT_CLASS} {...register('browser_type')}>
                <option value="chromium">Chromium</option>
                <option value="firefox">Firefox</option>
                <option value="edge">Edge</option>
              </select>
            </div>
            <div>
              <label htmlFor="group_name" className={LABEL_CLASS}>
                Group
              </label>
              <input
                id="group_name"
                type="text"
                placeholder="Work, Personal"
                className={INPUT_CLASS}
                {...register('group_name')}
              />
            </div>
            <div>
              <label htmlFor="group_color" className={LABEL_CLASS}>
                Color
              </label>
              <input
                id="group_color"
                type="color"
                className="h-[38px] w-full rounded-md border border-edge bg-surface-alt cursor-pointer"
                {...register('group_color')}
              />
            </div>
          </div>

          <div>
            <label htmlFor="proxy_id" className={LABEL_CLASS}>
              Proxy
            </label>
            <select id="proxy_id" className={SELECT_CLASS} {...register('proxy_id')}>
              <option value="">None</option>
              {proxies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.protocol}://{p.host}:{p.port})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="tags" className={LABEL_CLASS}>
              Tags <span className="text-muted font-normal">(comma separated)</span>
            </label>
            <input
              id="tags"
              type="text"
              placeholder="social, work, shopping"
              className={INPUT_CLASS}
              {...register('tags')}
            />
          </div>

          <div>
            <label htmlFor="start_url" className={LABEL_CLASS}>
              Start URL
            </label>
            <input
              id="start_url"
              type="text"
              placeholder="https://example.com"
              className={INPUT_CLASS}
              {...register('start_url')}
            />
          </div>

          <div>
            <label htmlFor="notes" className={LABEL_CLASS}>
              Notes
            </label>
            <textarea
              id="notes"
              rows={2}
              placeholder="Additional notes..."
              className={TEXTAREA_CLASS}
              {...register('notes')}
            />
          </div>
        </section>

        {/* Fingerprint */}
        <section className="bg-surface-alt/50 rounded-lg border border-edge overflow-hidden">
          <button
            type="button"
            onClick={() => setFpOpen(!fpOpen)}
            className="flex items-center justify-between w-full px-3 py-2.5 text-left hover:bg-elevated/30 transition-colors"
          >
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">Fingerprint</h3>
            {fpOpen ? (
              <ChevronDown className="h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted" />
            )}
          </button>

          {fpOpen && (
            <div className="px-3 pb-3 space-y-2.5 border-t border-edge pt-2.5">
              <button
                type="button"
                onClick={handleGenerateFingerprint}
                disabled={generating}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
              >
                <Wand2 className="h-3.5 w-3.5" />
                {generating ? 'Generating...' : 'Generate Fingerprint'}
              </button>

              {(() => {
                const [ua] = watchedData
                if (!ua) return null
                const { score, issues } = getFingerprintStrength(watchedData as [string, string, string | number, string, string])
                const color = score >= 80 ? 'text-ok' : score >= 50 ? 'text-warn' : 'text-err'
                const bgColor = score >= 80 ? 'bg-ok' : score >= 50 ? 'bg-warn' : 'bg-err'
                return (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 bg-surface rounded-full overflow-hidden">
                      <div className={`h-full ${bgColor} rounded-full transition-all`} style={{ width: `${score}%` }} />
                    </div>
                    <span className={`text-[10px] font-medium ${color}`}>{score}%</span>
                    {issues.length > 0 && (
                      <span className="text-[10px] text-muted" title={issues.join(', ')}>
                        {issues.length} issue{issues.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                )
              })()}

              <div className="grid grid-cols-1 gap-2.5">
                <div>
                  <label htmlFor="user_agent" className={LABEL_CLASS}>
                    User Agent
                  </label>
                  <input
                    id="user_agent"
                    type="text"
                    className={`${INPUT_CLASS} text-xs font-mono`}
                    {...register('user_agent')}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="platform" className={LABEL_CLASS}>
                      Platform
                    </label>
                    <input
                      id="platform"
                      type="text"
                      className={INPUT_CLASS}
                      {...register('platform')}
                    />
                  </div>

                  <div>
                    <label htmlFor="screen" className={LABEL_CLASS}>
                      Screen
                    </label>
                    <select id="screen" className={SELECT_CLASS} {...register('screen')}>
                      {SCREEN_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                      {isCustomScreen && <option value={screenValue}>{screenValue}</option>}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="timezone" className={LABEL_CLASS}>
                      Timezone
                    </label>
                    <select id="timezone" className={SELECT_CLASS} {...register('timezone')}>
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                      {isCustomTimezone && (
                        <option value={timezoneValue}>{timezoneValue}</option>
                      )}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="languages" className={LABEL_CLASS}>
                      Languages
                    </label>
                    <input
                      id="languages"
                      type="text"
                      placeholder="en-US, en"
                      className={INPUT_CLASS}
                      {...register('languages')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="hardware_concurrency" className={LABEL_CLASS}>
                      CPU Cores
                    </label>
                    <select
                      id="hardware_concurrency"
                      className={SELECT_CLASS}
                      {...register('hardware_concurrency', { valueAsNumber: true })}
                    >
                      {HARDWARE_CONCURRENCY_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="device_memory" className={LABEL_CLASS}>
                      Memory (GB)
                    </label>
                    <select
                      id="device_memory"
                      className={SELECT_CLASS}
                      {...register('device_memory', { valueAsNumber: true })}
                    >
                      {DEVICE_MEMORY_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="color_depth" className={LABEL_CLASS}>
                      Color Depth
                    </label>
                    <select
                      id="color_depth"
                      className={SELECT_CLASS}
                      {...register('color_depth', { valueAsNumber: true })}
                    >
                      <option value={24}>24</option>
                      <option value={30}>30</option>
                      <option value={32}>32</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="pixel_ratio" className={LABEL_CLASS}>
                      Pixel Ratio
                    </label>
                    <select
                      id="pixel_ratio"
                      className={SELECT_CLASS}
                      {...register('pixel_ratio', { valueAsNumber: true })}
                    >
                      <option value={1}>1.0</option>
                      <option value={1.25}>1.25</option>
                      <option value={1.5}>1.5</option>
                      <option value={2}>2.0</option>
                      <option value={3}>3.0</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="webgl_vendor" className={LABEL_CLASS}>
                      WebGL Vendor
                    </label>
                    <input
                      id="webgl_vendor"
                      type="text"
                      readOnly
                      className={`${INPUT_CLASS} cursor-default opacity-60 text-xs font-mono`}
                      {...register('webgl_vendor')}
                    />
                  </div>

                  <div>
                    <label htmlFor="webgl_renderer" className={LABEL_CLASS}>
                      WebGL Renderer
                    </label>
                    <input
                      id="webgl_renderer"
                      type="text"
                      readOnly
                      className={`${INPUT_CLASS} cursor-default opacity-60 text-xs font-mono`}
                      {...register('webgl_renderer')}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="webrtc_policy" className={LABEL_CLASS}>
                    WebRTC Policy
                  </label>
                  <select id="webrtc_policy" className={SELECT_CLASS} {...register('webrtc_policy')}>
                    {WEBRTC_POLICIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={saving} className={BTN_PRIMARY}>
            {saving ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Profile'}
          </button>
          <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
            Cancel
          </button>
          {isEditMode && (
            <button
              type="button"
              onClick={async () => {
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
              }}
              className="ml-auto text-xs text-accent hover:text-accent-dim transition-colors font-medium"
            >
              {templateSaved ? 'Saved!' : 'Save as Template'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
