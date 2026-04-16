import type { Fingerprint } from './models'
import {
  normalizeFingerprintDraft,
  WIN_FONTS_POOL,
  MAC_FONTS_POOL,
  LINUX_FONTS_POOL,
  MOBILE_FONTS_POOL
} from './fingerprint'

// ─── Public descriptor shape (surfaced via IPC) ──────────────────────────

export type PresetBrowser = 'chrome' | 'firefox'
export type PresetOsFamily = 'windows' | 'macos' | 'linux' | 'android' | 'ios-emu'

export interface PresetDescriptor {
  id: string
  label: string
  browser: PresetBrowser
  os_family: PresetOsFamily
}

// ─── Full internal preset shape ──────────────────────────────────────────

interface Preset extends PresetDescriptor {
  user_agent: string
  platform: string
  hardware_concurrency: number
  device_memory: number
  screen_width: number
  screen_height: number
  color_depth: number
  pixel_ratio: number
  webgl_vendor: string
  webgl_renderer: string
  timezone: string
  device_type: 'desktop' | 'mobile'
}

// ─── Constants ───────────────────────────────────────────────────────────

const DEFAULT_TIMEZONE = 'America/New_York'

// Chrome 139 is the current stable as of generation. All UAs pinned to
// modern stable versions; bump presets when Chrome/Firefox ship a new major.
const UA_WIN_CHROME_139 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const UA_WIN_CHROME_138 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
const UA_MAC_CHROME_139 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const UA_MAC_CHROME_138 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
const UA_LINUX_CHROME_139 =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const UA_WIN_FIREFOX_140 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0'
const UA_MAC_FIREFOX_140 =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0'
const UA_LINUX_FIREFOX_140 =
  'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'
const UA_WIN_EDGE_139 =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
const UA_IOS_CRIOS_139 =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/139.0.7258.0 Mobile/15E148 Safari/604.1'
const UA_ANDROID_CHROME_139_PIXEL =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
const UA_ANDROID_CHROME_139_SAMSUNG =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'

// ─── Preset catalog (immutable, sorted by label at export time) ──────────

const PRESETS: readonly Preset[] = [
  {
    id: 'win11-chrome-139',
    label: 'Windows 11 · Chrome 139',
    browser: 'chrome',
    os_family: 'windows',
    user_agent: UA_WIN_CHROME_139,
    platform: 'Win32',
    hardware_concurrency: 8,
    device_memory: 16,
    screen_width: 1920,
    screen_height: 1080,
    color_depth: 24,
    pixel_ratio: 1,
    webgl_vendor: 'Google Inc. (NVIDIA)',
    webgl_renderer:
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'win11-chrome-138-amd',
    label: 'Windows 11 · Chrome 138 (AMD)',
    browser: 'chrome',
    os_family: 'windows',
    user_agent: UA_WIN_CHROME_138,
    platform: 'Win32',
    hardware_concurrency: 12,
    device_memory: 16,
    screen_width: 2560,
    screen_height: 1440,
    color_depth: 24,
    pixel_ratio: 1,
    webgl_vendor: 'Google Inc. (AMD)',
    webgl_renderer:
      'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'win10-chrome-139',
    label: 'Windows 10 · Chrome 139',
    browser: 'chrome',
    os_family: 'windows',
    user_agent: UA_WIN_CHROME_139,
    platform: 'Win32',
    hardware_concurrency: 4,
    device_memory: 8,
    screen_width: 1366,
    screen_height: 768,
    color_depth: 24,
    pixel_ratio: 1,
    webgl_vendor: 'Google Inc. (Intel)',
    webgl_renderer:
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'mac-arm-chrome-139',
    label: 'macOS 14 · Chrome 139 (Apple Silicon)',
    browser: 'chrome',
    os_family: 'macos',
    user_agent: UA_MAC_CHROME_139,
    platform: 'MacIntel',
    hardware_concurrency: 8,
    device_memory: 16,
    screen_width: 2560,
    screen_height: 1600,
    color_depth: 30,
    pixel_ratio: 2,
    webgl_vendor: 'Google Inc. (Apple)',
    webgl_renderer:
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'mac-arm-chrome-138-m3',
    label: 'macOS 14 · Chrome 138 (M3 Pro)',
    browser: 'chrome',
    os_family: 'macos',
    user_agent: UA_MAC_CHROME_138,
    platform: 'MacIntel',
    hardware_concurrency: 12,
    device_memory: 32,
    screen_width: 3024,
    screen_height: 1964,
    color_depth: 30,
    pixel_ratio: 2,
    webgl_vendor: 'Google Inc. (Apple)',
    webgl_renderer:
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'mac-intel-chrome-139',
    label: 'macOS 13 · Chrome 139 (Intel)',
    browser: 'chrome',
    os_family: 'macos',
    user_agent: UA_MAC_CHROME_139,
    platform: 'MacIntel',
    hardware_concurrency: 4,
    device_memory: 16,
    screen_width: 1680,
    screen_height: 1050,
    color_depth: 24,
    pixel_ratio: 2,
    webgl_vendor: 'Google Inc. (Intel)',
    webgl_renderer:
      'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'linux-chrome-139',
    label: 'Linux · Chrome 139',
    browser: 'chrome',
    os_family: 'linux',
    user_agent: UA_LINUX_CHROME_139,
    platform: 'Linux x86_64',
    hardware_concurrency: 8,
    device_memory: 16,
    screen_width: 1920,
    screen_height: 1080,
    color_depth: 24,
    pixel_ratio: 1,
    webgl_vendor: 'Google Inc. (NVIDIA)',
    webgl_renderer:
      'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 4060/PCIe/SSE2, OpenGL 4.5)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'win11-firefox-140',
    label: 'Windows 11 · Firefox 140',
    browser: 'firefox',
    os_family: 'windows',
    user_agent: UA_WIN_FIREFOX_140,
    platform: 'Win32',
    hardware_concurrency: 8,
    device_memory: 16,
    screen_width: 1920,
    screen_height: 1080,
    color_depth: 24,
    pixel_ratio: 1,
    webgl_vendor: 'Mozilla',
    webgl_renderer: 'Mozilla',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'mac-firefox-140',
    label: 'macOS 14 · Firefox 140',
    browser: 'firefox',
    os_family: 'macos',
    user_agent: UA_MAC_FIREFOX_140,
    platform: 'MacIntel',
    hardware_concurrency: 8,
    device_memory: 16,
    screen_width: 2560,
    screen_height: 1600,
    color_depth: 30,
    pixel_ratio: 2,
    webgl_vendor: 'Mozilla',
    webgl_renderer: 'Mozilla',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'linux-firefox-140',
    label: 'Linux · Firefox 140',
    browser: 'firefox',
    os_family: 'linux',
    user_agent: UA_LINUX_FIREFOX_140,
    platform: 'Linux x86_64',
    hardware_concurrency: 8,
    device_memory: 16,
    screen_width: 1920,
    screen_height: 1080,
    color_depth: 24,
    pixel_ratio: 1,
    webgl_vendor: 'Mozilla',
    webgl_renderer: 'Mozilla',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'win11-edge-139',
    label: 'Windows 11 · Edge 139',
    browser: 'chrome',
    os_family: 'windows',
    user_agent: UA_WIN_EDGE_139,
    platform: 'Win32',
    hardware_concurrency: 8,
    device_memory: 16,
    screen_width: 1920,
    screen_height: 1080,
    color_depth: 24,
    pixel_ratio: 1,
    webgl_vendor: 'Google Inc. (Intel)',
    webgl_renderer:
      'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'desktop'
  },
  {
    id: 'ios-emu-chrome-139-iphone',
    label: 'iOS 17 (emu) · Chrome 139 (iPhone)',
    browser: 'chrome',
    os_family: 'ios-emu',
    user_agent: UA_IOS_CRIOS_139,
    platform: 'iPhone',
    hardware_concurrency: 6,
    device_memory: 4,
    screen_width: 390,
    screen_height: 844,
    color_depth: 32,
    pixel_ratio: 3,
    webgl_vendor: 'Apple Inc.',
    webgl_renderer: 'Apple GPU',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'mobile'
  },
  {
    id: 'android-chrome-139-pixel',
    label: 'Android 14 · Chrome 139 (Pixel 8)',
    browser: 'chrome',
    os_family: 'android',
    user_agent: UA_ANDROID_CHROME_139_PIXEL,
    platform: 'Linux armv8l',
    hardware_concurrency: 8,
    device_memory: 8,
    screen_width: 412,
    screen_height: 915,
    color_depth: 24,
    pixel_ratio: 2.625,
    webgl_vendor: 'Google Inc. (Qualcomm)',
    webgl_renderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'mobile'
  },
  {
    id: 'android-chrome-139-samsung-s23',
    label: 'Android 14 · Chrome 139 (Galaxy S23)',
    browser: 'chrome',
    os_family: 'android',
    user_agent: UA_ANDROID_CHROME_139_SAMSUNG,
    platform: 'Linux armv8l',
    hardware_concurrency: 8,
    device_memory: 8,
    screen_width: 360,
    screen_height: 780,
    color_depth: 24,
    pixel_ratio: 3,
    webgl_vendor: 'Google Inc. (Qualcomm)',
    webgl_renderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
    timezone: DEFAULT_TIMEZONE,
    device_type: 'mobile'
  }
] as const

// ─── Lookups ─────────────────────────────────────────────────────────────

const PRESETS_BY_ID: ReadonlyMap<string, Preset> = new Map(
  PRESETS.map((p) => [p.id, p])
)

export function listFingerprintPresets(): PresetDescriptor[] {
  return PRESETS
    .map(({ id, label, browser, os_family }) => ({ id, label, browser, os_family }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function getFingerprintPreset(id: string): Preset {
  const preset = PRESETS_BY_ID.get(id)
  if (!preset) throw new Error(`Unknown fingerprint preset: ${id}`)
  return preset
}

// ─── Resolver ────────────────────────────────────────────────────────────

type FingerprintDraft = Omit<Fingerprint, 'id' | 'profile_id'>

// Only genuine OS identity fields are re-applied from the draft after
// normalization. Fields like hardware_concurrency, device_memory, oscpu,
// vendor, languages, webrtc_policy, fonts_list etc. always take the
// normalizer's value so caller-provided overrides cannot bypass clamps.
const PRESERVED_KEYS = [
  'user_agent',
  'platform',
  'webgl_vendor',
  'webgl_renderer',
  'screen_width',
  'screen_height',
  'color_depth',
  'pixel_ratio',
  'timezone',
  'device_type'
] as const satisfies readonly (keyof FingerprintDraft)[]

function fontsPoolForOs(os: PresetOsFamily): readonly string[] {
  switch (os) {
    case 'windows':
      return WIN_FONTS_POOL
    case 'macos':
      return MAC_FONTS_POOL
    case 'linux':
      return LINUX_FONTS_POOL
    case 'android':
    case 'ios-emu':
      // No dedicated iOS pool — mobile pool is a reasonable approximation
      // for both iOS emu and Android presets.
      return MOBILE_FONTS_POOL
  }
}

// FNV-1a 32-bit hash — used as a stable seed keyed on preset id so the
// same preset always yields the same font subset regardless of host OS.
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function deterministicFontSubset(pool: readonly string[], seed: string): string[] {
  let state = hashString(seed) || 1
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
  const arr = pool.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  // Pool sizes here are ~9–30; take a deterministic ~10–15 subset so the
  // stored list looks like a realistic enumeration result. Clamped to
  // pool length for tiny pools (mobile).
  const minSize = Math.min(10, arr.length)
  const maxSize = Math.min(15, arr.length)
  const size = minSize + Math.floor(next() * (maxSize - minSize + 1))
  return arr.slice(0, size).sort()
}

/**
 * Resolve a preset to a full fingerprint draft.
 *
 * Strategy: run the preset-derived fields through `normalizeFingerprintDraft`
 * so non-critical fields (canvas_noise_seed, audio_context_noise, languages,
 * webrtc_policy, media-device counts) get their usual defaults, then
 * re-apply only the preset's OS identity-critical fields on top so the
 * preset is not clobbered by host-OS-driven normalization (which would
 * otherwise overwrite Linux/Firefox/mobile UAs with host-Chrome values).
 * fonts_list is replaced with a deterministic subset picked from the pool
 * matching `preset.os_family`, not the host OS.
 */
export function generateFingerprintFromPreset(
  presetId: string,
  overrides?: Partial<Fingerprint>
): FingerprintDraft {
  const preset = getFingerprintPreset(presetId)
  const safeOverrides = overrides ?? {}

  const presetIdentity: Partial<Fingerprint> = {
    user_agent: preset.user_agent,
    platform: preset.platform,
    hardware_concurrency: preset.hardware_concurrency,
    device_memory: preset.device_memory,
    screen_width: preset.screen_width,
    screen_height: preset.screen_height,
    color_depth: preset.color_depth,
    pixel_ratio: preset.pixel_ratio,
    timezone: safeOverrides.timezone ?? preset.timezone,
    webgl_vendor: preset.webgl_vendor,
    webgl_renderer: preset.webgl_renderer,
    device_type: preset.device_type
  }

  // Null-prototype base so a malicious `__proto__` override (if one slipped
  // past the IPC sanitizer) cannot poison `Object.prototype`.
  const draft = Object.assign(
    Object.create(null) as Partial<Fingerprint>,
    presetIdentity,
    safeOverrides
  )

  const normalized = normalizeFingerprintDraft(draft)

  const result: FingerprintDraft = { ...normalized }
  for (const key of PRESERVED_KEYS) {
    const value = draft[key]
    if (value !== undefined) {
      ;(result as Record<string, unknown>)[key] = value
    }
  }

  result.fonts_list = JSON.stringify(
    deterministicFontSubset(fontsPoolForOs(preset.os_family), preset.id)
  )

  return result
}
