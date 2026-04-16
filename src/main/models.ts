export interface Profile {
  id: string
  name: string
  browser_type: BrowserType
  group_name: string | null
  group_color: string | null
  tags: string // JSON array
  notes: string
  status: ProfileStatus
  proxy_id: string | null
  start_url: string
  created_at: string
  updated_at: string
  last_used: string | null
}

export type BrowserType = 'chromium' | 'firefox' | 'edge'
export type ProfileStatus = 'ready' | 'starting' | 'running' | 'stopping' | 'error'
export type ProxyProtocol = 'http' | 'https' | 'socks4' | 'socks5'

export interface Fingerprint {
  id: string
  profile_id: string
  user_agent: string
  platform: string
  hardware_concurrency: number
  device_memory: number
  languages: string // JSON array
  screen_width: number
  screen_height: number
  color_depth: number
  pixel_ratio: number
  timezone: string
  canvas_noise_seed: number
  webgl_vendor: string
  webgl_renderer: string
  audio_context_noise: number
  fonts_list: string // JSON array
  webrtc_policy: string
  video_inputs: number
  audio_inputs: number
  audio_outputs: number
  device_type: string // 'desktop' | 'mobile'
}

export interface Proxy {
  id: string
  name: string
  protocol: ProxyProtocol
  host: string
  port: number
  username: string | null
  password: string | null
  last_check: string | null
  check_ok: number // 0 or 1 for sqlite
  check_latency_ms: number | null
  country: string | null
  group_tag: string | null
  created_at: string
}

export interface ProxyResponse {
  id: string
  name: string
  protocol: ProxyProtocol
  host: string
  port: number
  username: string | null
  has_password: boolean
  last_check: string | null
  check_ok: boolean
  check_latency_ms: number | null
  country: string | null
  group_tag: string | null
  created_at: string
}

export interface ProfileDetail {
  profile: Profile
  fingerprint: Fingerprint
  proxy: ProxyResponse | null
}

export interface SessionInfo {
  profile_id: string
  pid: number
  browser_type: BrowserType
  started_at: string
}

export interface CreateProfileInput {
  name: string
  browser_type: BrowserType
  group_name?: string | null
  group_color?: string | null
  tags?: string[]
  notes?: string
  proxy_id?: string | null
  start_url?: string
  fingerprint?: Partial<Fingerprint>
}

export interface UpdateProfileInput {
  name?: string
  browser_type?: BrowserType
  group_name?: string | null
  group_color?: string | null
  tags?: string[]
  notes?: string
  proxy_id?: string | null
  start_url?: string
}

export interface UpdateFingerprintInput {
  user_agent?: string
  platform?: string
  hardware_concurrency?: number
  device_memory?: number
  languages?: string[]
  screen_width?: number
  screen_height?: number
  color_depth?: number
  pixel_ratio?: number
  device_type?: string
  timezone?: string
  webgl_vendor?: string
  webgl_renderer?: string
  webrtc_policy?: string
}

export interface ProxyInput {
  name: string
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
  country?: string
  group_tag?: string
}

export interface SessionHistoryEntry {
  id: string
  profile_id: string
  started_at: string
  stopped_at: string | null
  duration_seconds: number | null
  exit_code: number | null
  created_at: string
}

export interface ProfileExtension {
  id: string
  profile_id: string
  name: string
  path: string
  enabled: boolean
  created_at: string
}

export interface Template {
  id: string
  name: string
  description: string
  browser_type: BrowserType
  config: string // JSON
  created_at: string
  updated_at: string
}

export interface TemplateInput {
  name: string
  description?: string
  browser_type: BrowserType
  config: Record<string, unknown>
}

export interface ManagedBrowserResponse {
  browser: string
  buildId: string
  platform: string
  executablePath: string
  tags: string[]
}

export interface AvailableBrowser {
  browserType: BrowserType
  browser: string
  channel: string
  buildId: string
}

export function toProxyResponse(row: Proxy): ProxyResponse {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    username: row.username,
    has_password: !!row.password,
    last_check: row.last_check,
    check_ok: !!row.check_ok,
    check_latency_ms: row.check_latency_ms ?? null,
    country: row.country ?? null,
    group_tag: row.group_tag ?? null,
    created_at: row.created_at
  }
}
