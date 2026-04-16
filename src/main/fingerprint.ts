import type Database from 'better-sqlite3'
import type { BrowserType, Fingerprint } from './models'

// ─── Helpers ──────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// ─── Realistic Chrome version pool (Windows / Mac) ───────────────────────

const CHROME_MAJORS = [134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146] as const

function randomChromeVersion(): string {
  const major = pick(CHROME_MAJORS)
  const build = randInt(6900, 7700)
  const patch = randInt(40, 230)
  return `${major}.0.${build}.${patch}`
}

// ─── OS builds ───────────────────────────────────────────────────────────

const MAC_VERSIONS = [
  '10_15_7', '13_0', '13_1', '13_2', '13_3', '13_4', '13_5', '13_6',
  '14_0', '14_1', '14_2', '14_3', '14_4', '14_5', '14_6', '14_7',
  '15_0', '15_1', '15_2', '15_3'
] as const

// ─── Screen resolutions ──────────────────────────────────────────────────

const WINDOWS_SCREENS: [number, number][] = [
  [1920, 1080], [2560, 1440], [1366, 768], [1536, 864], [1440, 900],
  [1280, 720], [1600, 900], [1280, 1024], [1920, 1200], [2560, 1080],
  [3440, 1440], [3840, 2160], [1680, 1050], [1360, 768], [1280, 800]
]

const MAC_SCREENS: [number, number][] = [
  [2560, 1600], [2880, 1800], [1440, 900], [3024, 1964], [3456, 2234],
  [2560, 1440], [1680, 1050], [1920, 1080], [2304, 1440], [1792, 1120]
]

// ─── WebGL configurations (vendor → renderers) ──────────────────────────

interface GpuConfig {
  vendor: string
  renderers: string[]
}

const WINDOWS_GPUS: GpuConfig[] = [
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderers: [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3090 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)'
    ]
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderers: [
      'ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 7900 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 6900 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 5600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon Vega 8 Direct3D11 vs_5_0 ps_5_0, D3D11)'
    ]
  },
  {
    vendor: 'Google Inc. (Intel)',
    renderers: [
      'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 730 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Iris(R) Plus Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) Arc(TM) A770 Direct3D11 vs_5_0 ps_5_0, D3D11)'
    ]
  }
]

const MAC_GPUS: GpuConfig[] = [
  {
    vendor: 'Apple',
    renderers: [
      'Apple M1', 'Apple M1 Pro', 'Apple M1 Max', 'Apple M1 Ultra',
      'Apple M2', 'Apple M2 Pro', 'Apple M2 Max', 'Apple M2 Ultra',
      'Apple M3', 'Apple M3 Pro', 'Apple M3 Max',
      'Apple M4', 'Apple M4 Pro', 'Apple M4 Max',
      'Apple GPU'
    ]
  }
]

// ─── Mobile device configs ───────────────────────────────────────────────

const MOBILE_SCREENS: [number, number][] = [
  [412, 915], [393, 873], [414, 896], [390, 844], [375, 812],
  [360, 800], [428, 926], [430, 932], [384, 854], [360, 780]
]

const ANDROID_DEVICES = [
  { model: 'Pixel 8', brand: 'google' },
  { model: 'Pixel 7', brand: 'google' },
  { model: 'SM-S918B', brand: 'samsung' }, // Galaxy S23 Ultra
  { model: 'SM-S911B', brand: 'samsung' }, // Galaxy S23
  { model: 'SM-A546B', brand: 'samsung' }, // Galaxy A54
  { model: '22101316G', brand: 'xiaomi' }, // 13
  { model: 'CPH2451', brand: 'oppo' }, // Find X6
]

const MOBILE_GPUS: GpuConfig[] = [
  { vendor: 'Qualcomm', renderers: ['Adreno (TM) 740', 'Adreno (TM) 730', 'Adreno (TM) 660', 'Adreno (TM) 650'] },
  { vendor: 'ARM', renderers: ['Mali-G710 MC10', 'Mali-G78 MC20', 'Mali-G77 MC9'] }
]

export const MOBILE_FONTS_POOL = [
  'Roboto', 'Noto Sans', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif',
  'Cutive Mono', 'Coming Soon', 'Dancing Script', 'Carrois Gothic SC'
] as const

// ─── Timezones (weighted by real usage) ──────────────────────────────────

const US_TIMEZONES = [
  'America/New_York', 'America/New_York', 'America/New_York',
  'America/Chicago', 'America/Chicago',
  'America/Denver',
  'America/Los_Angeles', 'America/Los_Angeles', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu'
] as const

const EU_TIMEZONES = [
  'Europe/London', 'Europe/London',
  'Europe/Paris', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Berlin',
  'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
  'Europe/Warsaw', 'Europe/Zurich', 'Europe/Vienna',
  'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen',
  'Europe/Brussels', 'Europe/Lisbon', 'Europe/Dublin',
  'Europe/Prague', 'Europe/Bucharest', 'Europe/Helsinki',
  'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow'
] as const

const ASIA_TIMEZONES = [
  'Asia/Tokyo', 'Asia/Tokyo',
  'Asia/Shanghai', 'Asia/Shanghai',
  'Asia/Kolkata', 'Asia/Kolkata',
  'Asia/Seoul', 'Asia/Singapore', 'Asia/Hong_Kong',
  'Asia/Dubai', 'Asia/Bangkok', 'Asia/Jakarta',
  'Asia/Taipei', 'Asia/Manila'
] as const

const OTHER_TIMEZONES = [
  'Australia/Sydney', 'Australia/Melbourne',
  'Pacific/Auckland', 'America/Sao_Paulo',
  'America/Mexico_City', 'America/Toronto',
  'Africa/Johannesburg', 'Africa/Cairo'
] as const

const ALL_TIMEZONES = [
  ...US_TIMEZONES, ...EU_TIMEZONES, ...ASIA_TIMEZONES, ...OTHER_TIMEZONES
] as const

// ─── Languages by timezone region ────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string[][]> = {
  'America/': [
    ['en-US', 'en'], ['en-US', 'en'], ['en-US', 'en'],
    ['es-MX', 'es', 'en'], ['pt-BR', 'pt', 'en'], ['en-CA', 'en', 'fr'],
    ['es-US', 'es', 'en']
  ],
  'Europe/London': [['en-GB', 'en']],
  'Europe/Dublin': [['en-IE', 'en']],
  'Europe/Paris': [['fr-FR', 'fr', 'en']],
  'Europe/Berlin': [['de-DE', 'de', 'en']],
  'Europe/Vienna': [['de-AT', 'de', 'en']],
  'Europe/Zurich': [['de-CH', 'de', 'fr', 'en']],
  'Europe/Madrid': [['es-ES', 'es', 'en']],
  'Europe/Rome': [['it-IT', 'it', 'en']],
  'Europe/Amsterdam': [['nl-NL', 'nl', 'en']],
  'Europe/Warsaw': [['pl-PL', 'pl', 'en']],
  'Europe/Stockholm': [['sv-SE', 'sv', 'en']],
  'Europe/Oslo': [['nb-NO', 'nb', 'en']],
  'Europe/Copenhagen': [['da-DK', 'da', 'en']],
  'Europe/Brussels': [['nl-BE', 'nl', 'fr', 'en'], ['fr-BE', 'fr', 'nl', 'en']],
  'Europe/Lisbon': [['pt-PT', 'pt', 'en']],
  'Europe/Prague': [['cs-CZ', 'cs', 'en']],
  'Europe/Bucharest': [['ro-RO', 'ro', 'en']],
  'Europe/Helsinki': [['fi-FI', 'fi', 'en']],
  'Europe/Athens': [['el-GR', 'el', 'en']],
  'Europe/Istanbul': [['tr-TR', 'tr', 'en']],
  'Europe/Moscow': [['ru-RU', 'ru', 'en']],
  'Asia/Tokyo': [['ja-JP', 'ja', 'en']],
  'Asia/Shanghai': [['zh-CN', 'zh', 'en']],
  'Asia/Seoul': [['ko-KR', 'ko', 'en']],
  'Asia/Singapore': [['en-SG', 'en', 'zh'], ['zh-SG', 'zh', 'en']],
  'Asia/Hong_Kong': [['zh-HK', 'zh', 'en'], ['en-HK', 'en', 'zh']],
  'Asia/Taipei': [['zh-TW', 'zh', 'en']],
  'Asia/Kolkata': [['hi-IN', 'hi', 'en'], ['en-IN', 'en', 'hi']],
  'Asia/Dubai': [['ar-AE', 'ar', 'en'], ['en-AE', 'en', 'ar']],
  'Asia/Bangkok': [['th-TH', 'th', 'en']],
  'Asia/Jakarta': [['id-ID', 'id', 'en']],
  'Asia/Manila': [['en-PH', 'en', 'fil']],
  'Australia/': [['en-AU', 'en']],
  'Pacific/Auckland': [['en-NZ', 'en']],
  'Africa/Johannesburg': [['en-ZA', 'en']],
  'Africa/Cairo': [['ar-EG', 'ar', 'en']]
}

function getLanguagesForTimezone(tz: string): string[] {
  // Exact match first
  if (LANGUAGE_MAP[tz]) return pick(LANGUAGE_MAP[tz])
  // Prefix match
  for (const prefix of Object.keys(LANGUAGE_MAP)) {
    if (prefix.endsWith('/') && tz.startsWith(prefix)) {
      return pick(LANGUAGE_MAP[prefix])
    }
  }
  return ['en-US', 'en']
}

// ─── Font pools ──────────────────────────────────────────────────────────

export const WIN_FONTS_POOL = [
  'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
  'Trebuchet MS', 'Impact', 'Segoe UI', 'Tahoma', 'Calibri',
  'Cambria', 'Consolas', 'Lucida Console', 'Comic Sans MS',
  'Palatino Linotype', 'Book Antiqua', 'Candara', 'Constantia',
  'Corbel', 'Franklin Gothic Medium', 'Garamond', 'Segoe Print',
  'Segoe Script', 'Sitka Text', 'Sylfaen', 'Ebrima', 'Leelawadee',
  'Microsoft Sans Serif', 'MS Gothic', 'MS PGothic', 'Yu Gothic'
] as const

export const MAC_FONTS_POOL = [
  'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
  'Trebuchet MS', 'Helvetica', 'Helvetica Neue', 'Futura',
  'Menlo', 'Monaco', 'Optima', 'Gill Sans', 'Baskerville',
  'Didot', 'American Typewriter', 'Avenir', 'Avenir Next',
  'Cochin', 'Copperplate', 'Hoefler Text', 'Lucida Grande',
  'Marker Felt', 'Papyrus', 'Phosphate', 'Rockwell',
  'San Francisco', 'Skia', 'Snell Roundhand', 'Zapfino'
] as const

// Linux font pool (used only by preset resolver; desktop normalizer
// on a non-Linux host still filters through WIN/MAC pools).
export const LINUX_FONTS_POOL = [
  'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
  'Liberation Sans', 'Liberation Serif', 'Liberation Mono',
  'Ubuntu', 'Ubuntu Mono', 'Ubuntu Condensed',
  'Noto Sans', 'Noto Serif', 'Noto Mono', 'Noto Color Emoji',
  'FreeSans', 'FreeSerif', 'FreeMono',
  'Cantarell', 'Droid Sans', 'Droid Serif', 'Droid Sans Mono',
  'Bitstream Vera Sans', 'Bitstream Vera Serif', 'Bitstream Vera Sans Mono',
  'Nimbus Sans', 'Nimbus Roman', 'Nimbus Mono PS',
  'URW Gothic', 'URW Bookman', 'Standard Symbols PS'
] as const

function randomFontSubset(pool: readonly string[], minCommon = 5, maxExtra = 10): string[] {
  const common = pool.slice(0, Math.min(minCommon, pool.length))
  const rest = pool.slice(minCommon)
  const shuffled = [...rest].sort(() => Math.random() - 0.5)
  const extraCount = randInt(Math.min(3, rest.length), Math.min(maxExtra, rest.length))
  return [...common, ...shuffled.slice(0, extraCount)]
}

// ─── Hardware configs ────────────────────────────────────────────────────

interface HardwareConfig {
  concurrency: number
  memory: number
  weight: number // probabilistic weight
}

const HARDWARE_CONFIGS: HardwareConfig[] = [
  { concurrency: 4, memory: 4, weight: 10 },
  { concurrency: 4, memory: 8, weight: 15 },
  { concurrency: 6, memory: 8, weight: 10 },
  { concurrency: 8, memory: 8, weight: 25 },
  { concurrency: 8, memory: 16, weight: 20 },
  { concurrency: 12, memory: 16, weight: 10 },
  { concurrency: 16, memory: 16, weight: 5 },
  { concurrency: 16, memory: 32, weight: 3 },
  { concurrency: 24, memory: 32, weight: 2 }
]

function pickWeighted<T extends { weight: number }>(items: readonly T[]): T {
  const total = items.reduce((sum, i) => sum + i.weight, 0)
  let r = Math.random() * total
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item
  }
  return items[items.length - 1]
}

// ─── Media devices ───────────────────────────────────────────────────────

interface MediaConfig {
  video: number
  audioIn: number
  audioOut: number
}

const MEDIA_CONFIGS: MediaConfig[] = [
  { video: 0, audioIn: 1, audioOut: 1 },
  { video: 1, audioIn: 1, audioOut: 1 },
  { video: 1, audioIn: 1, audioOut: 2 },
  { video: 1, audioIn: 2, audioOut: 1 },
  { video: 1, audioIn: 2, audioOut: 2 },
  { video: 2, audioIn: 1, audioOut: 1 }
]

type DesktopOsModel = 'windows' | 'mac'
type FingerprintDraft = Omit<Fingerprint, 'id' | 'profile_id'>

function parseStringList(raw: unknown): string[] {
  let values = raw

  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []

    try {
      values = JSON.parse(trimmed)
    } catch {
      values = trimmed.split(',')
    }
  }

  if (!Array.isArray(values)) return []

  return values
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value): value is string => value.length > 0)
}

function normalizeTimezone(timezone?: string): string {
  if (typeof timezone === 'string' && (ALL_TIMEZONES as readonly string[]).includes(timezone)) {
    return timezone
  }

  return pick(ALL_TIMEZONES)
}

export function parseFingerprintLanguages(raw: unknown, fallbackTimezone?: string): string[] {
  const languages = parseStringList(raw)
  if (languages.length > 0) return languages
  return getLanguagesForTimezone(normalizeTimezone(fallbackTimezone))
}

function getHostDesktopOsModel(): DesktopOsModel {
  return process.platform === 'darwin' ? 'mac' : 'windows'
}

function extractChromeVersion(userAgent?: string): string | null {
  return userAgent?.match(/Chrome\/([\d.]+)/)?.[1] ?? null
}

function extractMacVersion(userAgent?: string): string | null {
  return userAgent?.match(/Mac OS X ([\d_]+)/)?.[1] ?? null
}

function extractAndroidModel(userAgent?: string): string | null {
  return userAgent?.match(/Android[^;]*;\s*([^)]+)\)/)?.[1]?.trim() ?? null
}

function buildWindowsUserAgent(chromeVersion: string): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
}

function buildMacUserAgent(chromeVersion: string, macVersion?: string): string {
  const resolvedMacVersion = macVersion ?? pick(MAC_VERSIONS)
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X ${resolvedMacVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
}

function buildMobileUserAgent(chromeVersion: string, model?: string): string {
  const resolvedModel = model ?? pick(ANDROID_DEVICES).model
  return `Mozilla/5.0 (Linux; Android 14; ${resolvedModel}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

function normalizeCanvasNoiseSeed(value: number | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : Math.floor(Math.random() * 0x7FFFFFFF)
}

function normalizeAudioNoise(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Math.random() * 0.0001
}

function normalizeDesktopPixelRatio(osModel: DesktopOsModel, pixelRatio?: number): number {
  if (osModel === 'mac') return 2.0

  return typeof pixelRatio === 'number' && Number.isFinite(pixelRatio) && pixelRatio >= 1 && pixelRatio <= 3
    ? pixelRatio
    : pick([1.0, 1.25, 1.5, 1.75, 2.0])
}

function normalizeMobilePixelRatio(pixelRatio?: number): number {
  return typeof pixelRatio === 'number' && Number.isFinite(pixelRatio) && pixelRatio >= 1.5 && pixelRatio <= 4
    ? pixelRatio
    : pick([2.0, 2.625, 3.0, 3.5])
}

function resolveScreen(
  width: number | undefined,
  height: number | undefined,
  screens: readonly [number, number][]
): [number, number] {
  if (
    typeof width === 'number' &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === 'number' &&
    Number.isFinite(height) &&
    height > 0
  ) {
    return [Math.round(width), Math.round(height)]
  }

  return pick(screens)
}

function isDesktopGpuCompatible(
  osModel: DesktopOsModel,
  vendor?: string,
  renderer?: string
): boolean {
  if (!vendor || !renderer) return false

  if (osModel === 'windows') {
    return vendor.startsWith('Google Inc. (') && renderer.includes('Direct3D')
  }

  return vendor === 'Apple' && !renderer.includes('Direct3D')
}

function resolveDesktopGpu(
  osModel: DesktopOsModel,
  vendor?: string,
  renderer?: string
): { vendor: string; renderer: string } {
  const resolvedVendor = vendor
  const resolvedRenderer = renderer

  if (
    resolvedVendor &&
    resolvedRenderer &&
    isDesktopGpuCompatible(osModel, resolvedVendor, resolvedRenderer)
  ) {
    return { vendor: resolvedVendor, renderer: resolvedRenderer }
  }

  const gpuConfig = pick(osModel === 'windows' ? WINDOWS_GPUS : MAC_GPUS)
  return {
    vendor: gpuConfig.vendor,
    renderer: pick(gpuConfig.renderers)
  }
}

function isMobileGpuCompatible(vendor?: string, renderer?: string): boolean {
  if (!vendor || !renderer) return false

  return MOBILE_GPUS.some(
    (gpuConfig) => gpuConfig.vendor === vendor && gpuConfig.renderers.includes(renderer)
  )
}

function resolveMobileGpu(vendor?: string, renderer?: string): { vendor: string; renderer: string } {
  const resolvedVendor = vendor
  const resolvedRenderer = renderer

  if (resolvedVendor && resolvedRenderer && isMobileGpuCompatible(resolvedVendor, resolvedRenderer)) {
    return { vendor: resolvedVendor, renderer: resolvedRenderer }
  }

  const gpuConfig = pick(MOBILE_GPUS)
  return {
    vendor: gpuConfig.vendor,
    renderer: pick(gpuConfig.renderers)
  }
}

function normalizeFontList(
  raw: unknown,
  pool: readonly string[],
  minCommon = 5,
  maxExtra = 10
): string[] {
  const allowedFonts = new Set(pool)
  const filtered = Array.from(
    new Set(parseStringList(raw).filter((font) => allowedFonts.has(font)))
  )

  return filtered.length >= Math.min(minCommon, pool.length)
    ? filtered
    : randomFontSubset(pool, minCommon, maxExtra)
}

export function normalizeFingerprintDraft(fingerprint: Partial<Fingerprint>): FingerprintDraft {
  const deviceType = fingerprint.device_type === 'mobile' ? 'mobile' : 'desktop'
  const timezone = normalizeTimezone(fingerprint.timezone)
  const languages = parseFingerprintLanguages(fingerprint.languages, timezone)
  const hardware = pickWeighted(HARDWARE_CONFIGS)

  if (deviceType === 'mobile') {
    const chromeVersion = extractChromeVersion(fingerprint.user_agent) ?? randomChromeVersion()
    const [screenWidth, screenHeight] = resolveScreen(
      fingerprint.screen_width,
      fingerprint.screen_height,
      MOBILE_SCREENS
    )
    const gpu = resolveMobileGpu(fingerprint.webgl_vendor, fingerprint.webgl_renderer)
    const model = extractAndroidModel(fingerprint.user_agent) ?? undefined

    return {
      user_agent: buildMobileUserAgent(chromeVersion, model),
      platform: 'Linux armv81',
      hardware_concurrency: Math.min(
        normalizePositiveInteger(fingerprint.hardware_concurrency, hardware.concurrency),
        8
      ),
      device_memory: Math.min(normalizePositiveInteger(fingerprint.device_memory, hardware.memory), 8),
      languages: JSON.stringify(languages),
      screen_width: screenWidth,
      screen_height: screenHeight,
      color_depth: normalizePositiveInteger(fingerprint.color_depth, 24),
      pixel_ratio: normalizeMobilePixelRatio(fingerprint.pixel_ratio),
      timezone,
      canvas_noise_seed: normalizeCanvasNoiseSeed(fingerprint.canvas_noise_seed),
      webgl_vendor: gpu.vendor,
      webgl_renderer: gpu.renderer,
      audio_context_noise: normalizeAudioNoise(fingerprint.audio_context_noise),
      fonts_list: JSON.stringify(normalizeFontList(fingerprint.fonts_list, MOBILE_FONTS_POOL, 5, 8)),
      webrtc_policy: fingerprint.webrtc_policy ?? 'disable_non_proxied_udp',
      video_inputs: 1,
      audio_inputs: 1,
      audio_outputs: 1,
      device_type: 'mobile'
    }
  }

  const osModel = getHostDesktopOsModel()
  const chromeVersion = extractChromeVersion(fingerprint.user_agent) ?? randomChromeVersion()
  const [screenWidth, screenHeight] = resolveScreen(
    fingerprint.screen_width,
    fingerprint.screen_height,
    osModel === 'windows' ? WINDOWS_SCREENS : MAC_SCREENS
  )
  const gpu = resolveDesktopGpu(osModel, fingerprint.webgl_vendor, fingerprint.webgl_renderer)
  const media = pick(MEDIA_CONFIGS)

  return {
    user_agent:
      osModel === 'windows'
        ? buildWindowsUserAgent(chromeVersion)
        : buildMacUserAgent(chromeVersion, extractMacVersion(fingerprint.user_agent) ?? undefined),
    platform: osModel === 'windows' ? 'Win32' : 'MacIntel',
    hardware_concurrency: normalizePositiveInteger(
      fingerprint.hardware_concurrency,
      hardware.concurrency
    ),
    device_memory: normalizePositiveInteger(fingerprint.device_memory, hardware.memory),
    languages: JSON.stringify(languages),
    screen_width: screenWidth,
    screen_height: screenHeight,
    color_depth: normalizePositiveInteger(fingerprint.color_depth, 24),
    pixel_ratio: normalizeDesktopPixelRatio(osModel, fingerprint.pixel_ratio),
    timezone,
    canvas_noise_seed: normalizeCanvasNoiseSeed(fingerprint.canvas_noise_seed),
    webgl_vendor: gpu.vendor,
    webgl_renderer: gpu.renderer,
    audio_context_noise: normalizeAudioNoise(fingerprint.audio_context_noise),
    fonts_list: JSON.stringify(
      normalizeFontList(
        fingerprint.fonts_list,
        osModel === 'windows' ? WIN_FONTS_POOL : MAC_FONTS_POOL
      )
    ),
    webrtc_policy: fingerprint.webrtc_policy ?? 'disable_non_proxied_udp',
    video_inputs: normalizePositiveInteger(fingerprint.video_inputs, media.video),
    audio_inputs: normalizePositiveInteger(fingerprint.audio_inputs, media.audioIn),
    audio_outputs: normalizePositiveInteger(fingerprint.audio_outputs, media.audioOut),
    device_type: 'desktop'
  }
}

export function normalizeFingerprint(fingerprint: Fingerprint): Fingerprint {
  return {
    ...fingerprint,
    ...normalizeFingerprintDraft(fingerprint)
  }
}

// ─── Main fingerprint generator ──────────────────────────────────────────

export function generateDefaultFingerprint(
  _browserType: BrowserType,
  overrides?: Partial<Fingerprint>
): Omit<Fingerprint, 'id' | 'profile_id'> {
  const deviceType = overrides?.device_type ?? 'desktop'
  const isMobile = deviceType === 'mobile'

  if (isMobile) {
    return generateMobileFingerprint(overrides)
  }

  const osModel = getHostDesktopOsModel()
  const chromeVersion = extractChromeVersion(overrides?.user_agent) ?? randomChromeVersion()
  const [screenWidth, screenHeight] = pick(
    osModel === 'windows' ? WINDOWS_SCREENS : MAC_SCREENS
  )
  const gpuConfig = pick(osModel === 'windows' ? WINDOWS_GPUS : MAC_GPUS)
  const hardware = pickWeighted(HARDWARE_CONFIGS)
  const media = pick(MEDIA_CONFIGS)

  return normalizeFingerprintDraft({
    user_agent:
      overrides?.user_agent ??
      (osModel === 'windows'
        ? buildWindowsUserAgent(chromeVersion)
        : buildMacUserAgent(chromeVersion)),
    platform: overrides?.platform ?? (osModel === 'windows' ? 'Win32' : 'MacIntel'),
    hardware_concurrency: overrides?.hardware_concurrency ?? hardware.concurrency,
    device_memory: overrides?.device_memory ?? hardware.memory,
    languages: overrides?.languages,
    screen_width: overrides?.screen_width ?? screenWidth,
    screen_height: overrides?.screen_height ?? screenHeight,
    color_depth: overrides?.color_depth ?? 24,
    pixel_ratio: overrides?.pixel_ratio,
    timezone: overrides?.timezone,
    canvas_noise_seed: overrides?.canvas_noise_seed,
    webgl_vendor: overrides?.webgl_vendor ?? gpuConfig.vendor,
    webgl_renderer: overrides?.webgl_renderer ?? pick(gpuConfig.renderers),
    audio_context_noise: overrides?.audio_context_noise,
    fonts_list: overrides?.fonts_list,
    webrtc_policy: overrides?.webrtc_policy,
    video_inputs: overrides?.video_inputs ?? media.video,
    audio_inputs: overrides?.audio_inputs ?? media.audioIn,
    audio_outputs: overrides?.audio_outputs ?? media.audioOut,
    device_type: 'desktop'
  })
}

function generateMobileFingerprint(
  overrides?: Partial<Fingerprint>
): Omit<Fingerprint, 'id' | 'profile_id'> {
  const chromeVer = extractChromeVersion(overrides?.user_agent) ?? randomChromeVersion()
  const device = pick(ANDROID_DEVICES)
  const [screenW, screenH] = pick(MOBILE_SCREENS)
  const gpuConfig = pick(MOBILE_GPUS)
  const hw = pickWeighted(HARDWARE_CONFIGS)

  return normalizeFingerprintDraft({
    user_agent: overrides?.user_agent ?? buildMobileUserAgent(chromeVer, device.model),
    platform: overrides?.platform ?? 'Linux armv81',
    hardware_concurrency: overrides?.hardware_concurrency ?? Math.min(hw.concurrency, 8),
    device_memory: overrides?.device_memory ?? Math.min(hw.memory, 8),
    languages: overrides?.languages,
    screen_width: overrides?.screen_width ?? screenW,
    screen_height: overrides?.screen_height ?? screenH,
    color_depth: overrides?.color_depth ?? 24,
    pixel_ratio: overrides?.pixel_ratio,
    timezone: overrides?.timezone,
    canvas_noise_seed: overrides?.canvas_noise_seed,
    webgl_vendor: overrides?.webgl_vendor ?? gpuConfig.vendor,
    webgl_renderer: overrides?.webgl_renderer ?? pick(gpuConfig.renderers),
    audio_context_noise: overrides?.audio_context_noise,
    fonts_list: overrides?.fonts_list,
    webrtc_policy: overrides?.webrtc_policy,
    video_inputs: overrides?.video_inputs ?? 1,
    audio_inputs: overrides?.audio_inputs ?? 1,
    audio_outputs: overrides?.audio_outputs ?? 1,
    device_type: 'mobile'
  })
}

// ─── Platform font allow-lists (used as fallback when profile list is empty) ───

const FONT_LIST_WINDOWS: readonly string[] = [
  'Arial', 'Arial Black', 'Arial Narrow', 'Arial Unicode MS', 'Bahnschrift',
  'Calibri', 'Calibri Light', 'Cambria', 'Cambria Math', 'Candara', 'Cascadia Code',
  'Cascadia Mono', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel',
  'Courier', 'Courier New', 'Ebrima', 'Franklin Gothic Medium', 'Gabriola',
  'Gadugi', 'Georgia', 'HoloLens MDL2 Assets', 'Impact', 'Ink Free',
  'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode',
  'Malgun Gothic', 'Marlett', 'Microsoft Himalaya', 'Microsoft JhengHei',
  'Microsoft JhengHei UI', 'Microsoft New Tai Lue', 'Microsoft PhagsPa',
  'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft YaHei',
  'Microsoft YaHei UI', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti',
  'MS Gothic', 'MS PGothic', 'MS UI Gothic', 'MV Boli', 'Myanmar Text',
  'Nirmala UI', 'Palatino Linotype', 'Segoe Fluent Icons', 'Segoe MDL2 Assets',
  'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Black',
  'Segoe UI Emoji', 'Segoe UI Historic', 'Segoe UI Light', 'Segoe UI Semibold',
  'Segoe UI Semilight', 'Segoe UI Symbol', 'Segoe UI Variable', 'SimSun',
  'Sitka', 'Sylfaen', 'Symbol', 'Tahoma', 'Times New Roman', 'Trebuchet MS',
  'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic', 'Yu Gothic UI'
]

const FONT_LIST_MACOS: readonly string[] = [
  'American Typewriter', 'Andale Mono', 'Apple Chancery', 'Apple Color Emoji',
  'Apple SD Gothic Neo', 'Apple Symbols', 'AppleGothic', 'AppleMyungjo',
  'Arial', 'Arial Black', 'Arial Narrow', 'Arial Rounded MT Bold',
  'Arial Unicode MS', 'Avenir', 'Avenir Next', 'Avenir Next Condensed',
  'Baskerville', 'Big Caslon', 'Bodoni 72', 'Bodoni 72 Oldstyle', 'Bodoni 72 Smallcaps',
  'Bradley Hand', 'Chalkboard', 'Chalkboard SE', 'Chalkduster', 'Charter',
  'Cochin', 'Comic Sans MS', 'Copperplate', 'Courier', 'Courier New',
  'Didot', 'DIN Alternate', 'DIN Condensed', 'Futura', 'Geneva',
  'Georgia', 'Gill Sans', 'Helvetica', 'Helvetica Neue', 'Herculanum',
  'Hiragino Maru Gothic ProN', 'Hiragino Mincho ProN', 'Hiragino Sans',
  'Hoefler Text', 'Impact', 'Kefa', 'Lucida Grande', 'Luminari',
  'Marker Felt', 'Menlo', 'Monaco', 'Noteworthy', 'Optima',
  'Palatino', 'Papyrus', 'Phosphate', 'Rockwell', 'Savoye LET',
  'SF Pro', 'SF Pro Display', 'SF Pro Text', 'SignPainter', 'Skia',
  'Snell Roundhand', 'Symbol', 'Tahoma', 'Times', 'Times New Roman',
  'Trattatello', 'Trebuchet MS', 'Verdana', 'Zapf Dingbats', 'Zapfino'
]

const FONT_LIST_LINUX: readonly string[] = [
  'Bitstream Charter', 'Bitstream Vera Sans', 'Bitstream Vera Sans Mono',
  'Bitstream Vera Serif', 'Cantarell', 'Century Schoolbook L', 'Courier 10 Pitch',
  'DejaVu Math TeX Gyre', 'DejaVu Sans', 'DejaVu Sans Condensed',
  'DejaVu Sans Light', 'DejaVu Sans Mono', 'DejaVu Serif', 'DejaVu Serif Condensed',
  'Dingbats', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif', 'FreeMono',
  'FreeSans', 'FreeSerif', 'Liberation Mono', 'Liberation Sans',
  'Liberation Sans Narrow', 'Liberation Serif', 'Luxi Mono', 'Luxi Sans',
  'Luxi Serif', 'NanumGothic', 'NanumMyeongjo', 'Nimbus Mono L',
  'Nimbus Mono PS', 'Nimbus Roman', 'Nimbus Roman No9 L', 'Nimbus Sans',
  'Nimbus Sans L', 'Nimbus Sans Narrow', 'Noto Color Emoji', 'Noto Mono',
  'Noto Sans', 'Noto Sans CJK JP', 'Noto Sans CJK KR', 'Noto Sans CJK SC',
  'Noto Sans CJK TC', 'Noto Sans Mono', 'Noto Sans Mono CJK JP',
  'Noto Serif', 'Noto Serif CJK JP', 'P052', 'Padauk', 'Piboto',
  'Standard Symbols L', 'Standard Symbols PS', 'Symbola', 'Takao Gothic',
  'Takao Mincho', 'Takao PGothic', 'Takao PMincho', 'Tlwg Mono',
  'Tlwg Typewriter', 'Tlwg Typist', 'Tlwg Typo', 'Ubuntu',
  'Ubuntu Condensed', 'Ubuntu Light', 'Ubuntu Mono', 'URW Bookman',
  'URW Gothic', 'Z003'
]

function defaultFontListFor(platform: string): readonly string[] {
  if (platform === 'MacIntel') return FONT_LIST_MACOS
  if (platform.startsWith('Linux')) return FONT_LIST_LINUX
  return FONT_LIST_WINDOWS
}

// ─── Injection script ────────────────────────────────────────────────────

export function buildInjectionScript(inputFp: Fingerprint): string {
  const fp = normalizeFingerprint(inputFp)
  const languages = parseFingerprintLanguages(fp.languages, fp.timezone)
  const languagesJson = JSON.stringify(languages)

  let fontsJson = fp.fonts_list
  try {
    const parsed: unknown = JSON.parse(fontsJson)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      fontsJson = JSON.stringify(defaultFontListFor(fp.platform))
    }
  } catch {
    fontsJson = JSON.stringify(defaultFontListFor(fp.platform))
  }

  const isChrome = fp.user_agent.includes('Chrome/')

  // Pre-build worker spoofing code (injected into Worker/SharedWorker constructors)
  const workerSpoofCode = JSON.stringify(
    `(function(){try{var n=navigator;var d=Object.defineProperty;var langs=${languagesJson};var tz=${JSON.stringify(fp.timezone)};` +
    `d(n,"language",{get:function(){return ${JSON.stringify(languages[0] || 'en-US')}},configurable:true});` +
    `d(n,"languages",{get:function(){return langs.slice()},configurable:true});` +
    `d(n,"userAgent",{get:function(){return ${JSON.stringify(fp.user_agent)}},configurable:true});` +
    `d(n,"appVersion",{get:function(){return ${JSON.stringify(fp.user_agent.replace('Mozilla/', ''))}},configurable:true});` +
    `d(n,"platform",{get:function(){return ${JSON.stringify(fp.platform)}},configurable:true});` +
    `d(n,"vendor",{get:function(){return "Google Inc."},configurable:true});` +
    `d(n,"maxTouchPoints",{get:function(){return ${fp.device_type === 'mobile' ? 5 : 0}},configurable:true});` +
    `d(n,"hardwareConcurrency",{get:function(){return ${fp.hardware_concurrency}},configurable:true});` +
    `d(n,"deviceMemory",{get:function(){return ${fp.device_memory}},configurable:true});` +
    `var ODTF=Intl.DateTimeFormat;Intl.DateTimeFormat=function(locales,options){if(locales===undefined||locales===null)locales=langs.slice();if(options&&typeof options==="object"){if(!options.timeZone)options.timeZone=tz;}else if(!options){options={timeZone:tz};}return new ODTF(locales,options);};` +
    `Intl.DateTimeFormat.prototype=ODTF.prototype;Intl.DateTimeFormat.supportedLocalesOf=ODTF.supportedLocalesOf.bind(ODTF);` +
    `["toLocaleString","toLocaleDateString","toLocaleTimeString"].forEach(function(name){var orig=Date.prototype[name];Date.prototype[name]=function(locales,options){if(locales===undefined||locales===null)locales=langs.slice();options=options&&typeof options==="object"?options:{};if(!options.timeZone)options.timeZone=tz;return orig.call(this,locales,options);};});` +
    `}catch(e){}})();\n`
  )

  return `(function(){
'use strict';

// ── Seeded PRNG (Mulberry32) ──
var _seed=${fp.canvas_noise_seed};
function _m32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
var _rng=_m32(_seed);

// ── toString cloaking helper ──
var _toStringMap=new WeakMap();
var _origFnToString=Function.prototype.toString;
var _origFnToStringStr=_origFnToString.call(_origFnToString);
function _cloak(obj,name,fn){
  var orig=obj[name];
  obj[name]=fn;
  // Preserve name and length from original
  try{Object.defineProperty(fn,'name',{value:name,configurable:true});}catch(e){}
  if(typeof orig==='function'){
    try{Object.defineProperty(fn,'length',{value:orig.length,configurable:true});}catch(e){}
    try{_toStringMap.set(fn,_origFnToString.call(orig));}catch(e){_toStringMap.set(fn,'function '+name+'() { [native code] }');}
  }else{
    _toStringMap.set(fn,'function '+name+'() { [native code] }');
  }
}
Function.prototype.toString=function toString(){
  if(_toStringMap.has(this))return _toStringMap.get(this);
  return _origFnToString.call(this);
};
_toStringMap.set(Function.prototype.toString,_origFnToStringStr);

// ── Utility: defineProperty shorthand ──
function _defProp(obj,prop,getter){
  try{
    var desc=Object.getOwnPropertyDescriptor(obj,prop);
    var enumerable=desc?!!desc.enumerable:true;
    // Cloak the getter so its toString returns native code
    if(desc&&desc.get){
      try{_toStringMap.set(getter,_origFnToString.call(desc.get));}catch(e){_toStringMap.set(getter,'function get '+prop+'() { [native code] }');}
    }else{
      _toStringMap.set(getter,'function get '+prop+'() { [native code] }');
    }
    Object.defineProperty(obj,prop,{get:getter,configurable:true,enumerable:enumerable});
  }catch(e){}
}

// ═══════════════════════════════════════════
// 1. Navigator overrides
// ═══════════════════════════════════════════
var _navProps={
  userAgent:${JSON.stringify(fp.user_agent)},
  platform:${JSON.stringify(fp.platform)},
  hardwareConcurrency:${fp.hardware_concurrency},
  deviceMemory:${fp.device_memory},
  languages:Object.freeze(${languagesJson}),
  language:${JSON.stringify(languages[0] || 'en-US')},
  maxTouchPoints:${fp.device_type === 'mobile' ? 5 : 0},
  vendor:'Google Inc.',
  appVersion:${JSON.stringify(fp.user_agent.replace('Mozilla/', ''))}
};
for(var _nk in _navProps){
  (function(k,v){_defProp(Navigator.prototype,k,function(){return v;});}(_nk,_navProps[_nk]));
}

// ═══════════════════════════════════════════
// 2. Screen overrides
// ═══════════════════════════════════════════
var _scrProps={
  width:${fp.screen_width},height:${fp.screen_height},
  availWidth:${fp.screen_width},availHeight:${fp.screen_height - 40},
  colorDepth:${fp.color_depth},pixelDepth:${fp.color_depth}
};
for(var _sk in _scrProps){
  (function(k,v){_defProp(Screen.prototype,k,function(){return v;});}(_sk,_scrProps[_sk]));
}
_defProp(window,'devicePixelRatio',function(){return ${fp.pixel_ratio};});
_defProp(window,'outerWidth',function(){return ${fp.screen_width};});
_defProp(window,'outerHeight',function(){return ${fp.screen_height};});

// ═══════════════════════════════════════════
// 3. Canvas fingerprint spoofing (Enhanced)
// ═══════════════════════════════════════════

function _addCanvasNoise(imageData,rng){
  var d=imageData.data,len=d.length;
  for(var i=0;i<len;i+=4){
    if(rng()<0.05){
      d[i]  =(d[i]  +((rng()*5)|0)-2)&0xFF;
      d[i+1]=(d[i+1]+((rng()*5)|0)-2)&0xFF;
      d[i+2]=(d[i+2]+((rng()*5)|0)-2)&0xFF;
    }
  }
  return imageData;
}

function _noisyCanvas(srcCanvas,rng){
  var w=srcCanvas.width,h=srcCanvas.height;
  if(w<=0||h<=0)return null;
  try{
    var tmp=document.createElement('canvas');
    tmp.width=w;tmp.height=h;
    var tc=tmp.getContext('2d');
    if(!tc)return null;
    tc.drawImage(srcCanvas,0,0);
    var id=_origGetImageData.call(tc,0,0,w,h);
    _addCanvasNoise(id,rng);
    tc.putImageData(id,0,0);
    return tmp;
  }catch(e){return null;}
}

// getImageData
var _origGetImageData=CanvasRenderingContext2D.prototype.getImageData;
_cloak(CanvasRenderingContext2D.prototype,'getImageData',function(sx,sy,sw,sh){
  var id=_origGetImageData.call(this,sx,sy,sw,sh);
  var rng=_m32(_seed^(sw*sh&0x7FFFFFFF));
  _addCanvasNoise(id,rng);
  return id;
});

// toDataURL
var _origToDataURL=HTMLCanvasElement.prototype.toDataURL;
_cloak(HTMLCanvasElement.prototype,'toDataURL',function(){
  var rng=_m32(_seed^(this.width*this.height&0x7FFFFFFF));
  var tmp=_noisyCanvas(this,rng);
  if(tmp)return _origToDataURL.apply(tmp,arguments);
  return _origToDataURL.apply(this,arguments);
});

// toBlob
var _origToBlob=HTMLCanvasElement.prototype.toBlob;
_cloak(HTMLCanvasElement.prototype,'toBlob',function(){
  var rng=_m32(_seed^(this.width*this.height&0x7FFFFFFF));
  var tmp=_noisyCanvas(this,rng);
  if(tmp)return _origToBlob.apply(tmp,arguments);
  return _origToBlob.apply(this,arguments);
});

// ═══════════════════════════════════════════
// 4. WebGL fingerprint spoofing (Complete)
// ═══════════════════════════════════════════
var _wglVendor=${JSON.stringify(fp.webgl_vendor)};
var _wglRenderer=${JSON.stringify(fp.webgl_renderer)};
var _isNvidia=_wglVendor.indexOf('NVIDIA')!==-1;
var _isAmd=_wglVendor.indexOf('AMD')!==-1;
var _isIntel=_wglVendor.indexOf('Intel')!==-1;
var _isApple=_wglVendor==='Apple';

var _baseExts=[
  'ANGLE_instanced_arrays','EXT_blend_minmax','EXT_color_buffer_half_float',
  'EXT_disjoint_timer_query','EXT_float_blend','EXT_frag_depth',
  'EXT_shader_texture_lod','EXT_texture_compression_bptc',
  'EXT_texture_compression_rgtc','EXT_texture_filter_anisotropic',
  'EXT_sRGB','KHR_parallel_shader_compile','OES_element_index_uint',
  'OES_fbo_render_mipmap','OES_standard_derivatives','OES_texture_float',
  'OES_texture_float_linear','OES_texture_half_float','OES_texture_half_float_linear',
  'OES_vertex_array_object','WEBGL_color_buffer_float','WEBGL_compressed_texture_s3tc',
  'WEBGL_compressed_texture_s3tc_srgb','WEBGL_debug_renderer_info',
  'WEBGL_debug_shaders','WEBGL_depth_texture','WEBGL_draw_buffers',
  'WEBGL_lose_context','WEBGL_multi_draw'
];
if(_isNvidia||_isAmd)_baseExts.push('WEBGL_compressed_texture_astc','EXT_texture_norm16');
if(_isApple)_baseExts=_baseExts.filter(function(e){return e!=='EXT_disjoint_timer_query'&&e!=='EXT_texture_compression_rgtc';});

// WebGL2 extensions (different from WebGL1 — many WGL1 exts are core in WGL2)
var _gl2Exts=[
  'EXT_color_buffer_float','EXT_color_buffer_half_float',
  'EXT_disjoint_timer_query_webgl2','EXT_float_blend',
  'EXT_texture_compression_bptc','EXT_texture_compression_rgtc',
  'EXT_texture_filter_anisotropic','EXT_texture_norm16',
  'KHR_parallel_shader_compile','OES_draw_buffers_indexed',
  'OES_texture_float_linear','WEBGL_clip_cull_distance',
  'WEBGL_compressed_texture_s3tc','WEBGL_compressed_texture_s3tc_srgb',
  'WEBGL_debug_renderer_info','WEBGL_debug_shaders',
  'WEBGL_lose_context','WEBGL_multi_draw','WEBGL_provoking_vertex'
];
if(_isNvidia||_isAmd)_gl2Exts.push('WEBGL_compressed_texture_astc');
if(_isApple)_gl2Exts=_gl2Exts.filter(function(e){return e!=='EXT_disjoint_timer_query_webgl2'&&e!=='EXT_texture_compression_rgtc';});

// Realistic Chromium/ANGLE parameter values (well-known stable caps for modern desktop GPUs).
// Values chosen to match what Chrome reports on mid-range NVIDIA/AMD/Intel/Apple hardware.
// Array values are pre-baked as typed arrays (Float32/Int32) matching what Chrome
// returns so the getParameter hook becomes a single lookup + clone.
var _wgl1Params={};
_wgl1Params[0x0D33]=16384;                                                     // MAX_TEXTURE_SIZE
_wgl1Params[0x0D3A]=new Int32Array([32767,32767]);                             // MAX_VIEWPORT_DIMS
_wgl1Params[0x84E8]=16384;                                                     // MAX_RENDERBUFFER_SIZE
_wgl1Params[0x8869]=16;                                                        // MAX_VERTEX_ATTRIBS
_wgl1Params[0x8DFB]=_isIntel?1024:4096;                                        // MAX_VERTEX_UNIFORM_VECTORS
_wgl1Params[0x8DFD]=1024;                                                      // MAX_FRAGMENT_UNIFORM_VECTORS
_wgl1Params[0x8DFC]=30;                                                        // MAX_VARYING_VECTORS
_wgl1Params[0x8872]=16;                                                        // MAX_TEXTURE_IMAGE_UNITS
_wgl1Params[0x8B4D]=32;                                                        // MAX_COMBINED_TEXTURE_IMAGE_UNITS
_wgl1Params[0x8B4C]=16;                                                        // MAX_VERTEX_TEXTURE_IMAGE_UNITS
_wgl1Params[0x851C]=16384;                                                     // MAX_CUBE_MAP_TEXTURE_SIZE
_wgl1Params[0x846E]=new Float32Array([1,1]);                                   // ALIASED_LINE_WIDTH_RANGE
_wgl1Params[0x846D]=new Float32Array([1,1024]);                                // ALIASED_POINT_SIZE_RANGE
_wgl1Params[0x8B8C]='WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)';      // SHADING_LANGUAGE_VERSION
_wgl1Params[0x1F02]='WebGL 1.0 (OpenGL ES 2.0 Chromium)';                      // VERSION
// Fold vendor/renderer into the params table so the hook is a single-lookup path.
_wgl1Params[0x9245]=_wglVendor;                                                // UNMASKED_VENDOR_WEBGL
_wgl1Params[0x9246]=_wglRenderer;                                              // UNMASKED_RENDERER_WEBGL
_wgl1Params[0x1F00]=_wglVendor;                                                // VENDOR
_wgl1Params[0x1F01]=_wglRenderer;                                              // RENDERER

var _wgl2Params={};
for(var _wgp1 in _wgl1Params)_wgl2Params[_wgp1]=_wgl1Params[_wgp1];
_wgl2Params[0x8B8C]='WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)';     // SHADING_LANGUAGE_VERSION
_wgl2Params[0x1F02]='WebGL 2.0 (OpenGL ES 3.0 Chromium)';                      // VERSION
_wgl2Params[0x8073]=2048;                                                      // MAX_3D_TEXTURE_SIZE
_wgl2Params[0x8824]=8;                                                         // MAX_DRAW_BUFFERS
_wgl2Params[0x8CDF]=8;                                                         // MAX_COLOR_ATTACHMENTS
_wgl2Params[0x8D57]=_isIntel?4:8;                                              // MAX_SAMPLES
_wgl2Params[0x8D6B]=4294967294;                                                // MAX_ELEMENT_INDEX
_wgl2Params[0x8A2F]=72;                                                        // MAX_UNIFORM_BUFFER_BINDINGS
_wgl2Params[0x8B4A]=(_isIntel?1024:4096)*4;                                    // MAX_VERTEX_UNIFORM_COMPONENTS
_wgl2Params[0x8B49]=4096;                                                      // MAX_FRAGMENT_UNIFORM_COMPONENTS
_wgl2Params[0x9122]=64;                                                        // MAX_VERTEX_OUTPUT_COMPONENTS
_wgl2Params[0x9125]=60;                                                        // MAX_FRAGMENT_INPUT_COMPONENTS
_wgl2Params[0x9111]=1000000000;                                                // MAX_SERVER_WAIT_TIMEOUT (1s in ns)
_wgl2Params[0x8C8A]=64;                                                        // MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS
_wgl2Params[0x8C8B]=4;                                                         // MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS
_wgl2Params[0x8C80]=4;                                                         // MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS

// IEEE-754 single precision is what all modern GPUs report via ANGLE/Chromium.
// Map keyed by (shaderType<<16)|precisionType → [rangeMin,rangeMax,precision].
var _wglPrecisions={};
(function(){
  var VERT=0x8B31,FRAG=0x8B30;
  var FLOATS=[0x8DF0,0x8DF1,0x8DF2]; // LOW_FLOAT, MEDIUM_FLOAT, HIGH_FLOAT
  var INTS=[0x8DF3,0x8DF4,0x8DF5];   // LOW_INT, MEDIUM_INT, HIGH_INT
  for(var _si=0;_si<2;_si++){
    var s=_si?FRAG:VERT;
    for(var _fi=0;_fi<FLOATS.length;_fi++)_wglPrecisions[(s<<16)|FLOATS[_fi]]=[127,127,23];
    for(var _ii=0;_ii<INTS.length;_ii++)_wglPrecisions[(s<<16)|INTS[_ii]]=[31,30,0];
  }
})();

function _hookWebGL(proto,exts,params){
  var origGetParam=proto.getParameter;
  _cloak(proto,'getParameter',function(p){
    if(Object.prototype.hasOwnProperty.call(params,p)){
      var v=params[p];
      // Clone typed arrays so callers can't mutate the shared spoof value.
      if(ArrayBuffer.isView(v))return v.slice();
      return v;
    }
    return origGetParam.call(this,p);
  });

  if(proto.getShaderPrecisionFormat){
    var origGetPrec=proto.getShaderPrecisionFormat;
    _cloak(proto,'getShaderPrecisionFormat',function(shaderType,precisionType){
      var key=(shaderType<<16)|precisionType;
      var v=_wglPrecisions[key];
      if(!v)return origGetPrec.call(this,shaderType,precisionType);
      // Return a fresh plain object so callers can't observe mutation of the
      // real WebGLShaderPrecisionFormat and detect the spoof via identity.
      return{rangeMin:v[0],rangeMax:v[1],precision:v[2]};
    });
  }

  var origGetExt=proto.getExtension;
  _cloak(proto,'getExtension',function(name){
    // Only return extensions that are in our supported list
    if(exts.indexOf(name)===-1)return null;
    // Return the real extension object to preserve prototype chain
    // getParameter is already hooked to return spoofed vendor/renderer
    return origGetExt.call(this,name);
  });

  var origGetSupported=proto.getSupportedExtensions;
  _cloak(proto,'getSupportedExtensions',function(){
    return exts.slice();
  });
}
if(typeof WebGLRenderingContext!=='undefined')_hookWebGL(WebGLRenderingContext.prototype,_baseExts,_wgl1Params);
if(typeof WebGL2RenderingContext!=='undefined')_hookWebGL(WebGL2RenderingContext.prototype,_gl2Exts,_wgl2Params);

// ═══════════════════════════════════════════
// 4b. WebGPU fingerprint spoofing
// ═══════════════════════════════════════════
try{
  if(navigator.gpu&&navigator.gpu.requestAdapter){
    var _origReqAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);
    _cloak(navigator.gpu,'requestAdapter',function(opts){
      return _origReqAdapter(opts).then(function(adapter){
        if(!adapter)return adapter;
        // Override requestAdapterInfo to return spoofed GPU info
        if(adapter.requestAdapterInfo){
          var _origAdapterInfo=adapter.requestAdapterInfo.bind(adapter);
          _cloak(adapter,'requestAdapterInfo',function(){
            return _origAdapterInfo().then(function(info){
              // Create a new object with spoofed values
              var desc=_wglRenderer.match(/NVIDIA|AMD|Intel|Apple/i);
              var spoofedVendor=desc?desc[0]:'';
              var gpuMatch=_wglRenderer.match(/(?:NVIDIA|AMD|Intel|Apple)[^,)]*/);
              var spoofedDesc=gpuMatch?gpuMatch[0].trim():_wglRenderer;
              return{
                vendor:spoofedVendor,
                architecture:info.architecture||'',
                device:spoofedDesc,
                description:spoofedDesc,
                get [Symbol.toStringTag](){return 'GPUAdapterInfo';}
              };
            });
          });
        }
        // Also override the info property if it exists (newer Chrome)
        if(adapter.info){
          try{
            var desc2=_wglRenderer.match(/NVIDIA|AMD|Intel|Apple/i);
            var sv=desc2?desc2[0]:'';
            var gm=_wglRenderer.match(/(?:NVIDIA|AMD|Intel|Apple)[^,)]*/);
            var sd=gm?gm[0].trim():_wglRenderer;
            Object.defineProperty(adapter,'info',{get:function(){
              return{vendor:sv,architecture:'',device:sd,description:sd};
            },configurable:true});
          }catch(e){}
        }
        return adapter;
      });
    });
  }
}catch(e){}

// ═══════════════════════════════════════════
// 5. AudioContext fingerprint spoofing
// ═══════════════════════════════════════════
var _audioNoise=${fp.audio_context_noise};

if(typeof AudioBuffer!=='undefined'){
  var _origGetCD=AudioBuffer.prototype.getChannelData;
  var _noisedBufs=new WeakSet();
  _cloak(AudioBuffer.prototype,'getChannelData',function(ch){
    var data=_origGetCD.call(this,ch);
    // Only add noise once per buffer to prevent accumulation on repeated calls
    if(!_noisedBufs.has(this)){
      _noisedBufs.add(this);
      var rng=_m32(_seed^(this.length&0x7FFFFFFF));
      for(var c=0;c<this.numberOfChannels;c++){
        var d=_origGetCD.call(this,c);
        for(var i=0;i<d.length;i+=100){
          d[i]=d[i]+_audioNoise*(rng()-0.5);
        }
      }
    }
    return data;
  });
}

if(typeof AnalyserNode!=='undefined'){
  var _origGetFFD=AnalyserNode.prototype.getFloatFrequencyData;
  _cloak(AnalyserNode.prototype,'getFloatFrequencyData',function(arr){
    _origGetFFD.call(this,arr);
    var rng=_m32(_seed^0xF10A7);
    for(var i=0;i<arr.length;i+=10){
      arr[i]=arr[i]+_audioNoise*100*(rng()-0.5);
    }
  });

  var _origGetBFD=AnalyserNode.prototype.getByteFrequencyData;
  _cloak(AnalyserNode.prototype,'getByteFrequencyData',function(arr){
    _origGetBFD.call(this,arr);
    var rng=_m32(_seed^0xB17E);
    for(var i=0;i<arr.length;i+=10){
      arr[i]=Math.max(0,Math.min(255,(arr[i]+((rng()*3)|0)-1)));
    }
  });
}

if(typeof OscillatorNode!=='undefined'){
  var _origOscStart=OscillatorNode.prototype.start;
  _cloak(OscillatorNode.prototype,'start',function(when){
    if(this.frequency&&this.detune){
      var d=this.detune.value||0;
      this.detune.value=d+_audioNoise*10;
    }
    return _origOscStart.call(this,when);
  });
}

// Hook OfflineAudioContext.startRendering for audio fingerprint spoofing
if(typeof OfflineAudioContext!=='undefined'){
  var _origStartRendering=OfflineAudioContext.prototype.startRendering;
  _cloak(OfflineAudioContext.prototype,'startRendering',function(){
    return _origStartRendering.call(this).then(function(buf){
      // Mark buffer as already noised so getChannelData hook doesn't double-noise
      if(typeof _noisedBufs!=='undefined')_noisedBufs.add(buf);
      try{
        var rng=_m32(_seed^0xA0D10);
        for(var ch=0;ch<buf.numberOfChannels;ch++){
          var data=_origGetCD.call(buf,ch);
          for(var i=0;i<data.length;i+=100){
            data[i]=data[i]+_audioNoise*(rng()-0.5);
          }
        }
      }catch(e){}
      return buf;
    });
  });
}

// Hook OffscreenCanvas if available (used for canvas fingerprinting in workers)
if(typeof OffscreenCanvas!=='undefined'){
  // Hook OffscreenCanvasRenderingContext2D.getImageData at prototype level
  if(typeof OffscreenCanvasRenderingContext2D!=='undefined'&&OffscreenCanvasRenderingContext2D.prototype.getImageData){
    var _origOSCGetID=OffscreenCanvasRenderingContext2D.prototype.getImageData;
    _cloak(OffscreenCanvasRenderingContext2D.prototype,'getImageData',function(sx,sy,sw,sh){
      var id=_origOSCGetID.call(this,sx,sy,sw,sh);
      var rng=_m32(_seed^(sw*sh&0x7FFFFFFF));
      _addCanvasNoise(id,rng);
      return id;
    });
  }
  if(OffscreenCanvas.prototype.convertToBlob){
    var _origOSCToBlob=OffscreenCanvas.prototype.convertToBlob;
    _cloak(OffscreenCanvas.prototype,'convertToBlob',function(opts){
      var rng=_m32(_seed^(this.width*this.height&0x7FFFFFFF));
      try{
        var ctx=this.getContext('2d');
        if(ctx){
          var id=ctx.getImageData(0,0,this.width,this.height);
          _addCanvasNoise(id,rng);
          ctx.putImageData(id,0,0);
        }
      }catch(e){}
      return _origOSCToBlob.call(this,opts);
    });
  }
}

// ═══════════════════════════════════════════
// 6. Font enumeration protection
// ═══════════════════════════════════════════
var _allowedFonts=new Set(${fontsJson});
// Case-insensitive allow-list so CSS (which is case-insensitive for family names)
// like 'font-family: arial' matches as 'Arial'.
var _allowedFontsLower=new Set();
_allowedFonts.forEach(function(n){_allowedFontsLower.add(String(n).toLowerCase());});
// Null-prototype map to avoid any prototype-pollution surprises.
var _genericFontFamilies=Object.assign(Object.create(null),{'serif':1,'sans-serif':1,'monospace':1,'cursive':1,'fantasy':1,'system-ui':1,'ui-serif':1,'ui-sans-serif':1,'ui-monospace':1,'ui-rounded':1,'math':1,'emoji':1,'fangsong':1,'-apple-system':1,'blinkmacsystemfont':1});

// Snapshot the ORIGINAL FontFaceSet.check so we can ask "did the page actually
// load this font via @font-face?" without triggering our own hook.
var _origFontCheck=(typeof FontFaceSet!=='undefined'&&FontFaceSet.prototype&&FontFaceSet.prototype.check)?FontFaceSet.prototype.check:null;
function _isPageLoadedFont(family){
  if(!_origFontCheck||!document.fonts)return false;
  try{return !!_origFontCheck.call(document.fonts,'12px "'+String(family).replace(/"/g,'\\\\"')+'"');}catch(e){return false;}
}
function _familyAllowed(family){
  var lower=String(family).toLowerCase();
  if(_genericFontFamilies[lower])return true;
  if(_allowedFontsLower.has(lower))return true;
  // Respect web fonts the page actually loaded so Inter/Roboto/etc. aren't neutered.
  if(_isPageLoadedFont(family))return true;
  return false;
}

// Parse a CSS font shorthand and return the ordered family list.
function _parseFontFamilies(fontStr){
  if(typeof fontStr!=='string')return [];
  var m=fontStr.match(/\\d+(?:\\.\\d+)?(?:px|pt|em|rem|%|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pc)\\b/i);
  if(!m||m.index===undefined)return [];
  // Strip the size token (plus optional /line-height) and anything preceding.
  var tail=fontStr.slice(m.index+m[0].length).replace(/^\\s*\\/\\s*\\S+/,'').trim();
  if(!tail)return [];
  var parts=tail.split(',');
  var out=[];
  for(var i=0;i<parts.length;i++){
    var f=parts[i].trim().replace(/^['"]|['"]$/g,'');
    if(f)out.push(f);
  }
  return out;
}

// Bounded FIFO cache so repeated measureText/FontFaceSet.check calls don't
// re-parse+sanitize the same font shorthand.
var _FONT_CACHE_LIMIT=128;
function _makeFontCache(){
  var map=Object.create(null);
  var order=[];
  return{
    get:function(k){return Object.prototype.hasOwnProperty.call(map,k)?map[k]:undefined;},
    has:function(k){return Object.prototype.hasOwnProperty.call(map,k);},
    set:function(k,v){
      if(!Object.prototype.hasOwnProperty.call(map,k)){
        if(order.length>=_FONT_CACHE_LIMIT){
          var evict=order.shift();
          delete map[evict];
        }
        order.push(k);
      }
      map[k]=v;
    }
  };
}
var _sanitizeCache=_makeFontCache();
var _fontCheckCache=_makeFontCache();

// Rewrite the family list to drop any family not in the allow-list so detectors
// that measure a probe font against a generic fallback get identical widths.
function _sanitizeFontString(fontStr){
  if(typeof fontStr==='string'&&_sanitizeCache.has(fontStr))return _sanitizeCache.get(fontStr);
  var result=_computeSanitizedFontString(fontStr);
  if(typeof fontStr==='string')_sanitizeCache.set(fontStr,result);
  return result;
}
function _computeSanitizedFontString(fontStr){
  var families=_parseFontFamilies(fontStr);
  if(!families.length)return null;
  var filtered=[],hasGeneric=false,changed=false;
  for(var i=0;i<families.length;i++){
    var f=families[i];
    var lower=f.toLowerCase();
    if(_genericFontFamilies[lower]){filtered.push(f);hasGeneric=true;continue;}
    if(_familyAllowed(f)){filtered.push(f);continue;}
    changed=true;
  }
  if(!changed)return null;
  if(!hasGeneric)filtered.push('sans-serif');
  var quoted=[];
  for(var j=0;j<filtered.length;j++){
    var g=filtered[j];
    quoted.push(_genericFontFamilies[g.toLowerCase()]?g:('"'+g.replace(/"/g,'\\\\"')+'"'));
  }
  var idx=fontStr.search(/\\d+(?:\\.\\d+)?(?:px|pt|em|rem|%|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pc)\\b/i);
  if(idx<0)return null;
  var sizeMatch=fontStr.slice(idx).match(/^\\S+(?:\\s*\\/\\s*\\S+)?/);
  if(!sizeMatch)return null;
  return fontStr.slice(0,idx)+sizeMatch[0]+' '+quoted.join(', ');
}

if(typeof FontFaceSet!=='undefined'&&document.fonts&&_origFontCheck){
  _cloak(FontFaceSet.prototype,'check',function(font,text){
    var key=typeof font==='string'?font:'';
    if(key&&_fontCheckCache.has(key)){
      var cached=_fontCheckCache.get(key);
      if(cached===false)return false;
      // cached===true → fall through to original.
    }else{
      var families=_parseFontFamilies(font);
      for(var i=0;i<families.length;i++){
        var f=families[i];
        if(_genericFontFamilies[f.toLowerCase()])continue;
        if(!_familyAllowed(f)){
          if(key)_fontCheckCache.set(key,false);
          return false;
        }
      }
      if(key)_fontCheckCache.set(key,true);
    }
    return _origFontCheck.call(this,font,text||'');
  });
}

// measureText is the classic font-enumeration sidechannel: detectors render a
// probe font falling back to a generic, then compare widths. Force the probe
// to resolve to the generic whenever the family is not in the allow-list so
// widths match the fallback exactly.
if(typeof CanvasRenderingContext2D!=='undefined'&&CanvasRenderingContext2D.prototype.measureText){
  var _origMeasureText=CanvasRenderingContext2D.prototype.measureText;
  _cloak(CanvasRenderingContext2D.prototype,'measureText',function(text){
    try{
      var sanitized=_sanitizeFontString(this.font);
      if(sanitized){
        var saved=this.font;
        this.font=sanitized;
        var m=_origMeasureText.call(this,text);
        this.font=saved;
        return m;
      }
    }catch(e){}
    return _origMeasureText.call(this,text);
  });
}
if(typeof OffscreenCanvasRenderingContext2D!=='undefined'&&OffscreenCanvasRenderingContext2D.prototype.measureText){
  var _origOSCMeasureText=OffscreenCanvasRenderingContext2D.prototype.measureText;
  _cloak(OffscreenCanvasRenderingContext2D.prototype,'measureText',function(text){
    try{
      var sanitized=_sanitizeFontString(this.font);
      if(sanitized){
        var saved=this.font;
        this.font=sanitized;
        var m=_origOSCMeasureText.call(this,text);
        this.font=saved;
        return m;
      }
    }catch(e){}
    return _origOSCMeasureText.call(this,text);
  });
}

// ═══════════════════════════════════════════
// 7. ClientRects / DOMRect spoofing
// ═══════════════════════════════════════════
function _rNoise(r){
  // Deterministic noise based on rect values so repeated calls return same results
  var h=((r.x*73856093)^(r.y*19349663)^(r.width*83492791)^(r.height*39916801))>>>0;
  var rng=_m32(_seed^(h|1));
  return(rng()-0.5)*0.002;
}

function _noisyDOMRect(r){
  var n1=_rNoise(r),n2=_rNoise({x:r.y,y:r.x,width:r.height,height:r.width});
  return new DOMRect(r.x+n1,r.y+n2,r.width+_rNoise({x:r.width,y:r.x,width:r.y,height:r.height}),r.height+_rNoise({x:r.height,y:r.y,width:r.x,height:r.width}));
}
function _noisyRectList(origFn,self){
  var rects=origFn.call(self);
  var arr=[];
  for(var i=0;i<rects.length;i++)arr.push(_noisyDOMRect(rects[i]));
  // Return original DOMRectList-like object with noisy values
  var result=Object.create(rects.__proto__||Object.getPrototypeOf(rects)||{});
  for(var j=0;j<arr.length;j++)result[j]=arr[j];
  Object.defineProperty(result,'length',{get:function(){return arr.length;},configurable:true,enumerable:true});
  Object.defineProperty(result,'item',{value:function(idx){return arr[idx]||null;},writable:false,enumerable:false,configurable:true});
  _toStringMap.set(result.item,'function item() { [native code] }');
  if(typeof Symbol!=='undefined'&&Symbol.iterator){
    Object.defineProperty(result,Symbol.iterator,{value:function(){var _i=0;return{next:function(){return _i<arr.length?{value:arr[_i++],done:false}:{value:undefined,done:true};}};},writable:false,enumerable:false,configurable:true});
  }
  return result;
}

var _origElBCR=Element.prototype.getBoundingClientRect;
_cloak(Element.prototype,'getBoundingClientRect',function(){
  return _noisyDOMRect(_origElBCR.call(this));
});

var _origElCR=Element.prototype.getClientRects;
_cloak(Element.prototype,'getClientRects',function(){
  return _noisyRectList(_origElCR,this);
});

if(typeof Range!=='undefined'){
  var _origRgBCR=Range.prototype.getBoundingClientRect;
  _cloak(Range.prototype,'getBoundingClientRect',function(){
    return _noisyDOMRect(_origRgBCR.call(this));
  });

  var _origRgCR=Range.prototype.getClientRects;
  _cloak(Range.prototype,'getClientRects',function(){
    return _noisyRectList(_origRgCR,this);
  });
}

// ═══════════════════════════════════════════
// 8. Timezone override
// ═══════════════════════════════════════════
var _tz=${JSON.stringify(fp.timezone)};
var _OrigDTF=Intl.DateTimeFormat;
try{
  var _now=new Date();
  var _utcStr=_now.toLocaleString('en-US',{timeZone:'UTC'});
  var _localStr=_now.toLocaleString('en-US',{timeZone:_tz});
  var _offset=(new Date(_utcStr)-new Date(_localStr))/60000;
  _cloak(Date.prototype,'getTimezoneOffset',function(){return _offset;});

  // Hook Date string methods to show spoofed timezone
  // Build timezone abbreviation and offset string
  var _tzAbbrDate=new _OrigDTF('en-US',{timeZone:_tz,timeZoneName:'short'});
  var _tzAbbrParts=_tzAbbrDate.formatToParts(new Date());
  var _tzAbbr='';
  for(var _tp=0;_tp<_tzAbbrParts.length;_tp++){if(_tzAbbrParts[_tp].type==='timeZoneName')_tzAbbr=_tzAbbrParts[_tp].value;}
  // Build GMT offset string like "GMT+0300"
  var _offSign=_offset<=0?'+':'-';
  var _offAbs=Math.abs(_offset);
  var _offH=String(Math.floor(_offAbs/60));
  var _offM=String(_offAbs%60);
  if(_offH.length<2)_offH='0'+_offH;
  if(_offM.length<2)_offM='0'+_offM;
  var _gmtStr='GMT'+_offSign+_offH+_offM;

  var _origDateToString=Date.prototype.toString;
  _cloak(Date.prototype,'toString',function(){
    // Reformat: "Day Mon DD YYYY HH:MM:SS GMTxxxx (TZ Name)"
    var d=this;
    try{
      var parts=new _OrigDTF('en-US',{timeZone:_tz,weekday:'short',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(d);
      var p={};for(var i=0;i<parts.length;i++)p[parts[i].type]=parts[i].value;
      return p.weekday+' '+p.month+' '+p.day+' '+p.year+' '+p.hour+':'+p.minute+':'+p.second+' '+_gmtStr+' ('+_tzAbbr+')';
    }catch(e){return _origDateToString.call(this);}
  });

  var _origDateToTimeString=Date.prototype.toTimeString;
  _cloak(Date.prototype,'toTimeString',function(){
    try{
      var parts=new _OrigDTF('en-US',{timeZone:_tz,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(this);
      var p={};for(var i=0;i<parts.length;i++)p[parts[i].type]=parts[i].value;
      return p.hour+':'+p.minute+':'+p.second+' '+_gmtStr+' ('+_tzAbbr+')';
    }catch(e){return _origDateToTimeString.call(this);}
  });

  var _origDateToDateString=Date.prototype.toDateString;
  _cloak(Date.prototype,'toDateString',function(){
    try{
      var parts=new _OrigDTF('en-US',{timeZone:_tz,weekday:'short',year:'numeric',month:'short',day:'2-digit'}).formatToParts(this);
      var p={};for(var i=0;i<parts.length;i++)p[parts[i].type]=parts[i].value;
      return p.weekday+' '+p.month+' '+p.day+' '+p.year;
    }catch(e){return _origDateToDateString.call(this);}
  });

  // Hook toLocaleString/toLocaleDateString/toLocaleTimeString to inject locale+tz
  var _dtLocales=['toLocaleString','toLocaleDateString','toLocaleTimeString'];
  for(var _dli=0;_dli<_dtLocales.length;_dli++){
    (function(mName){
      var orig=Date.prototype[mName];
      _cloak(Date.prototype,mName,function(locales,opts){
        if(locales===undefined||locales===null)locales=_navProps.languages.slice();
        opts=opts||{};
        if(!opts.timeZone)opts.timeZone=_tz;
        return orig.call(this,locales,opts);
      });
    })(_dtLocales[_dli]);
  }
}catch(e){}

// resolvedOptions: no override needed — the constructor hook injects _tz when no timeZone is set

// Also hook Intl.DateTimeFormat constructor to inject timezone AND locale
Intl.DateTimeFormat=function(locales,options){
  if(locales===undefined||locales===null)locales=_navProps.languages.slice();
  if(options&&typeof options==='object'){
    if(!options.timeZone)options.timeZone=_tz;
  }else if(!options){
    options={timeZone:_tz};
  }
  return new _OrigDTF(locales,options);
};
Object.defineProperty(Intl.DateTimeFormat,'name',{value:'DateTimeFormat',configurable:true});
Object.defineProperty(Intl.DateTimeFormat,'length',{value:0,configurable:true});
_toStringMap.set(Intl.DateTimeFormat,_origFnToString.call(_OrigDTF));
Intl.DateTimeFormat.prototype=_OrigDTF.prototype;
Intl.DateTimeFormat.prototype.constructor=Intl.DateTimeFormat;
Intl.DateTimeFormat.supportedLocalesOf=_OrigDTF.supportedLocalesOf;

// ═══════════════════════════════════════════
// 8b. Intl locale override (NumberFormat, PluralRules, etc.)
// ═══════════════════════════════════════════
try{
  var _spoofLangs=_navProps.languages;
  var _intlNames=['NumberFormat','PluralRules','ListFormat','RelativeTimeFormat','Collator','Segmenter','DisplayNames'];
  for(var _ii=0;_ii<_intlNames.length;_ii++){
    (function(name){
      if(!Intl[name])return;
      var Orig=Intl[name];
      Intl[name]=function(locales,opts){
        if(locales===undefined||locales===null)locales=_spoofLangs.slice();
        return new Orig(locales,opts);
      };
      Object.defineProperty(Intl[name],'name',{value:name,configurable:true});
      Object.defineProperty(Intl[name],'length',{value:0,configurable:true});
      _toStringMap.set(Intl[name],_origFnToString.call(Orig));
      Intl[name].prototype=Orig.prototype;
      Intl[name].prototype.constructor=Intl[name];
      if(Orig.supportedLocalesOf)Intl[name].supportedLocalesOf=Orig.supportedLocalesOf.bind(Orig);
    })(_intlNames[_ii]);
  }
}catch(e){}

// ═══════════════════════════════════════════
// 9. MediaDevices spoofing (enhanced)
// ═══════════════════════════════════════════
if(navigator.mediaDevices&&navigator.mediaDevices.enumerateDevices){
  var _vidIn=${fp.video_inputs},_audIn=${fp.audio_inputs},_audOut=${fp.audio_outputs};
  var _devRng=_m32(_seed^0xDEADBEEF);
  function _hexStr(len,rng){
    var h='0123456789abcdef',s='';
    for(var i=0;i<len;i++)s+=h[(rng()*16)|0];
    return s;
  }
  var _mdiProto=(typeof MediaDeviceInfo!=='undefined')?MediaDeviceInfo.prototype:null;
  function _mkDevice(deviceId,groupId,kind,label){
    var d=_mdiProto?Object.create(_mdiProto):{};
    Object.defineProperties(d,{
      deviceId:{get:function(){return deviceId;},enumerable:true,configurable:true},
      groupId:{get:function(){return groupId;},enumerable:true,configurable:true},
      kind:{get:function(){return kind;},enumerable:true,configurable:true},
      label:{get:function(){return label;},enumerable:true,configurable:true}
    });
    d.toJSON=function(){return{deviceId:deviceId,kind:kind,label:label,groupId:groupId};};
    _toStringMap.set(d.toJSON,'function toJSON() { [native code] }');
    return d;
  }
  // Pre-generate deterministic IDs
  var _cachedDevices=[];
  var _gid=_hexStr(32,_devRng);
  for(var _vi=0;_vi<_vidIn;_vi++)_cachedDevices.push(_mkDevice(_hexStr(64,_devRng),_gid,'videoinput',''));
  var _gid2=_hexStr(32,_devRng);
  for(var _ai=0;_ai<_audIn;_ai++)_cachedDevices.push(_mkDevice(_hexStr(64,_devRng),_gid2,'audioinput',''));
  for(var _ao=0;_ao<_audOut;_ao++)_cachedDevices.push(_mkDevice(_hexStr(64,_devRng),_gid2,'audiooutput',''));

  _cloak(navigator.mediaDevices,'enumerateDevices',function(){
    return Promise.resolve(_cachedDevices.slice());
  });
}

// ═══════════════════════════════════════════
// 10. WebRTC IP leak protection
// ═══════════════════════════════════════════
var _rtcPolicy=${JSON.stringify(fp.webrtc_policy)};
if(_rtcPolicy==='disable_non_proxied_udp'){
  var _OrigRTC=window.RTCPeerConnection||window.webkitRTCPeerConnection;
  if(_OrigRTC){
    function _filterSDP(sdp){
      if(!sdp)return sdp;
      return sdp.replace(/a=candidate:[^\\r\\n]*typ\\s+(host|srflx|prflx)[^\\r\\n]*(\\r\\n|\\r|\\n)/g,'');
    }
    function _shouldDropIceCandidate(e){
      if(e.candidate&&e.candidate.candidate){
        var c=e.candidate.candidate;
        if(c.indexOf('host')!==-1||c.indexOf('srflx')!==-1||c.indexOf('prflx')!==-1)return true;
      }
      return false;
    }
    // Hook prototype methods so instances don't have own-property overrides
    var _origCO=_OrigRTC.prototype.createOffer;
    _cloak(_OrigRTC.prototype,'createOffer',function(opts){
      return _origCO.call(this,opts).then(function(o){o.sdp=_filterSDP(o.sdp);return o;});
    });
    var _origCA=_OrigRTC.prototype.createAnswer;
    _cloak(_OrigRTC.prototype,'createAnswer',function(opts){
      return _origCA.call(this,opts).then(function(a){a.sdp=_filterSDP(a.sdp);return a;});
    });
    var _origAEL=_OrigRTC.prototype.addEventListener;
    _cloak(_OrigRTC.prototype,'addEventListener',function(type,fn,opts){
      if(type==='icecandidate'){
        return _origAEL.call(this,type,function(e){
          if(_shouldDropIceCandidate(e))return;
          fn(e);
        },opts);
      }
      return _origAEL.call(this,type,fn,opts);
    });
    // Hook onicecandidate setter on prototype
    var _oicDesc=Object.getOwnPropertyDescriptor(_OrigRTC.prototype,'onicecandidate');
    if(_oicDesc&&_oicDesc.set){
      var _origOicSet=_oicDesc.set;
      var _origOicGet=_oicDesc.get;
      Object.defineProperty(_OrigRTC.prototype,'onicecandidate',{
        set:function(fn){
          _origOicSet.call(this,function(e){
            if(_shouldDropIceCandidate(e))return;
            if(fn)fn(e);
          });
        },
        get:function(){return _origOicGet?_origOicGet.call(this):undefined;},
        configurable:true,enumerable:true
      });
    }
    // Constructor wrapper only enforces config
    var _newRTC=function(config){
      config=config||{};
      config.iceServers=[];
      config.iceTransportPolicy='relay';
      return new _OrigRTC(config);
    };
    _newRTC.prototype=_OrigRTC.prototype;
    _newRTC.generateCertificate=_OrigRTC.generateCertificate;
    Object.defineProperty(_newRTC,'name',{value:'RTCPeerConnection',configurable:true});
    Object.defineProperty(_newRTC,'length',{value:0,configurable:true});
    _toStringMap.set(_newRTC,_origFnToString.call(_OrigRTC));
    window.RTCPeerConnection=_newRTC;
    if(window.webkitRTCPeerConnection)window.webkitRTCPeerConnection=_newRTC;
  }
}else if(_rtcPolicy==='default_public_interface_only'){
  var _OrigRTC2=window.RTCPeerConnection||window.webkitRTCPeerConnection;
  if(_OrigRTC2){
    function _filterRelaySDP(sdp){
      if(!sdp)return sdp;
      return sdp.replace(/a=candidate:[^\\r\\n]*typ\\s+relay[^\\r\\n]*(\\r\\n|\\r|\\n)/g,'');
    }
    var _origCO2=_OrigRTC2.prototype.createOffer;
    _cloak(_OrigRTC2.prototype,'createOffer',function(opts){
      return _origCO2.call(this,opts).then(function(o){o.sdp=_filterRelaySDP(o.sdp);return o;});
    });
    var _origCA2=_OrigRTC2.prototype.createAnswer;
    _cloak(_OrigRTC2.prototype,'createAnswer',function(opts){
      return _origCA2.call(this,opts).then(function(a){a.sdp=_filterRelaySDP(a.sdp);return a;});
    });
    var _newRTC2=function(config){
      config=config||{};
      return new _OrigRTC2(config);
    };
    _newRTC2.prototype=_OrigRTC2.prototype;
    _newRTC2.generateCertificate=_OrigRTC2.generateCertificate;
    Object.defineProperty(_newRTC2,'name',{value:'RTCPeerConnection',configurable:true});
    Object.defineProperty(_newRTC2,'length',{value:0,configurable:true});
    _toStringMap.set(_newRTC2,_origFnToString.call(_OrigRTC2));
    window.RTCPeerConnection=_newRTC2;
    if(window.webkitRTCPeerConnection)window.webkitRTCPeerConnection=_newRTC2;
  }
}

// ═══════════════════════════════════════════
// 11. navigator.connection spoofing
// ═══════════════════════════════════════════
try{
  var _connProps={effectiveType:'4g',downlink:10,rtt:50,saveData:false,type:'wifi'};
  if('connection' in Navigator.prototype||navigator.connection){
    var _connTarget=navigator.connection||{};
    for(var _ck in _connProps){
      (function(k,v){try{Object.defineProperty(_connTarget,k,{get:function(){return v;},configurable:true,enumerable:true});}catch(e){}}(_ck,_connProps[_ck]));
    }
    if(!navigator.connection){
      _defProp(Navigator.prototype,'connection',function(){return _connTarget;});
    }
  }
}catch(e){}

// ═══════════════════════════════════════════
// 12. navigator.plugins & mimeTypes spoofing
// ═══════════════════════════════════════════
try{
  var _pluginData=[
    {name:'PDF Viewer',filename:'internal-pdf-viewer',description:'Portable Document Format',
     mimeTypes:[{type:'application/pdf',suffixes:'pdf',description:'Portable Document Format'}]},
    {name:'Chrome PDF Viewer',filename:'internal-pdf-viewer',description:'Portable Document Format',
     mimeTypes:[{type:'application/pdf',suffixes:'pdf',description:'Portable Document Format'}]},
    {name:'Chromium PDF Viewer',filename:'internal-pdf-viewer',description:'Portable Document Format',
     mimeTypes:[{type:'application/pdf',suffixes:'pdf',description:'Portable Document Format'}]},
    {name:'Microsoft Edge PDF Viewer',filename:'internal-pdf-viewer',description:'Portable Document Format',
     mimeTypes:[{type:'application/pdf',suffixes:'pdf',description:'Portable Document Format'}]},
    {name:'WebKit built-in PDF',filename:'internal-pdf-viewer',description:'Portable Document Format',
     mimeTypes:[{type:'application/pdf',suffixes:'pdf',description:'Portable Document Format'}]}
  ];
  // Build with proper prototypes
  var _paProto=(typeof PluginArray!=='undefined')?PluginArray.prototype:null;
  var _maProto=(typeof MimeTypeArray!=='undefined')?MimeTypeArray.prototype:null;
  var _pProto=(typeof Plugin!=='undefined')?Plugin.prototype:null;
  var _mtProto=(typeof MimeType!=='undefined')?MimeType.prototype:null;
  var _fakePlugins=_paProto?Object.create(_paProto):Object.create(null);
  var _fakeMimes=_maProto?Object.create(_maProto):Object.create(null);
  var _plugCount=0,_mimeCount=0;
  _pluginData.forEach(function(pd){
    var plug=_pProto?Object.create(_pProto):{};
    Object.defineProperties(plug,{
      name:{get:function(){return pd.name;},enumerable:true,configurable:true},
      filename:{get:function(){return pd.filename;},enumerable:true,configurable:true},
      description:{get:function(){return pd.description;},enumerable:true,configurable:true},
      length:{get:function(){return pd.mimeTypes.length;},enumerable:true,configurable:true}
    });
    pd.mimeTypes.forEach(function(mt,idx){
      var mo=_mtProto?Object.create(_mtProto):{};
      Object.defineProperties(mo,{
        type:{get:function(){return mt.type;},enumerable:true,configurable:true},
        suffixes:{get:function(){return mt.suffixes;},enumerable:true,configurable:true},
        description:{get:function(){return mt.description;},enumerable:true,configurable:true},
        enabledPlugin:{get:function(){return plug;},enumerable:true,configurable:true}
      });
      plug[idx]=mo;
      _fakeMimes[_mimeCount++]=mo;
    });
    _fakePlugins[_plugCount++]=plug;
  });
  Object.defineProperty(_fakePlugins,'length',{value:_plugCount,enumerable:false,configurable:true});
  Object.defineProperty(_fakePlugins,'item',{value:function(i){return _fakePlugins[i]||null;},writable:false,enumerable:false,configurable:true});
  Object.defineProperty(_fakePlugins,'namedItem',{value:function(n){for(var i=0;i<_plugCount;i++)if(_fakePlugins[i]&&_fakePlugins[i].name===n)return _fakePlugins[i];return null;},writable:false,enumerable:false,configurable:true});
  Object.defineProperty(_fakePlugins,'refresh',{value:function(){},writable:false,enumerable:false,configurable:true});
  _toStringMap.set(_fakePlugins.item,'function item() { [native code] }');
  _toStringMap.set(_fakePlugins.namedItem,'function namedItem() { [native code] }');
  _toStringMap.set(_fakePlugins.refresh,'function refresh() { [native code] }');
  if(typeof Symbol!=='undefined'&&Symbol.iterator){
    Object.defineProperty(_fakePlugins,Symbol.iterator,{value:function(){var _i=0;var self=_fakePlugins;return{next:function(){return _i<_plugCount?{value:self[_i++],done:false}:{value:undefined,done:true};}};},enumerable:false,configurable:true});
  }

  Object.defineProperty(_fakeMimes,'length',{value:_mimeCount,enumerable:false,configurable:true});
  Object.defineProperty(_fakeMimes,'item',{value:function(i){return _fakeMimes[i]||null;},writable:false,enumerable:false,configurable:true});
  Object.defineProperty(_fakeMimes,'namedItem',{value:function(n){for(var i=0;i<_mimeCount;i++)if(_fakeMimes[i]&&_fakeMimes[i].type===n)return _fakeMimes[i];return null;},writable:false,enumerable:false,configurable:true});
  _toStringMap.set(_fakeMimes.item,'function item() { [native code] }');
  _toStringMap.set(_fakeMimes.namedItem,'function namedItem() { [native code] }');
  if(typeof Symbol!=='undefined'&&Symbol.iterator){
    Object.defineProperty(_fakeMimes,Symbol.iterator,{value:function(){var _i=0;var self=_fakeMimes;return{next:function(){return _i<_mimeCount?{value:self[_i++],done:false}:{value:undefined,done:true};}};},enumerable:false,configurable:true});
  }

  _defProp(Navigator.prototype,'plugins',function(){return _fakePlugins;});
  _defProp(Navigator.prototype,'mimeTypes',function(){return _fakeMimes;});
  _defProp(Navigator.prototype,'pdfViewerEnabled',function(){return true;});
}catch(e){}

// ═══════════════════════════════════════════
// 13. window.chrome object (for Chrome UAs)
// ═══════════════════════════════════════════
${isChrome ? `
try{
  if(!window.chrome){
    window.chrome={};
  }
  if(!window.chrome.runtime){
    window.chrome.runtime={
      connect:function(){},
      sendMessage:function(){},
      id:undefined,
      onMessage:{addListener:function(){},removeListener:function(){},hasListener:function(){return false;}},
      onConnect:{addListener:function(){},removeListener:function(){},hasListener:function(){return false;}}
    };
  }
  if(!window.chrome.csi){
    window.chrome.csi=function(){var o=performance.timeOrigin||Date.now();return{startE:o,onloadT:Date.now(),pageT:Date.now()-o,tran:15};};
    _toStringMap.set(window.chrome.csi,'function csi() { [native code] }');
  }
  if(!window.chrome.loadTimes){
    window.chrome.loadTimes=function(){
      var o=performance.timeOrigin||Date.now();
      var nav=(performance.getEntriesByType&&performance.getEntriesByType('navigation')[0])||{};
      var rs=nav.responseStart?o+nav.responseStart:o;
      var dcl=nav.domContentLoadedEventEnd?o+nav.domContentLoadedEventEnd:o;
      var le=nav.loadEventEnd?o+nav.loadEventEnd:0;
      return{
        commitLoadTime:rs/1000,
        connectionInfo:'h2',
        finishDocumentLoadTime:dcl/1000,
        finishLoadTime:le/1000,
        firstPaintAfterLoadTime:0,
        firstPaintTime:rs/1000,
        navigationType:'Other',
        npnNegotiatedProtocol:'h2',
        requestTime:o/1000,
        startLoadTime:o/1000,
        wasAlternateProtocolAvailable:false,
        wasFetchedViaSpdy:true,
        wasNpnNegotiated:true
      };
    };
    _toStringMap.set(window.chrome.loadTimes,'function loadTimes() { [native code] }');
  }
  if(!window.chrome.app){
    window.chrome.app={isInstalled:false,InstallState:{DISABLED:'disabled',INSTALLED:'installed',NOT_INSTALLED:'not_installed'},RunningState:{CANNOT_RUN:'cannot_run',READY_TO_RUN:'ready_to_run',RUNNING:'running'},getDetails:function(){return null;},getIsInstalled:function(){return false;},installState:function(cb){if(cb)cb('not_installed');}};
  }
}catch(e){}
` : ''}

// ═══════════════════════════════════════════
// 14. Permissions.prototype.query hook
// ═══════════════════════════════════════════
try{
  if(typeof Permissions!=='undefined'&&Permissions.prototype.query){
    var _origPermQuery=Permissions.prototype.query;
    _cloak(Permissions.prototype,'query',function(desc){
      return _origPermQuery.call(this,desc).catch(function(){
        // If the query fails (invalid name, etc.), return a PermissionStatus-like object
        var ps=typeof PermissionStatus!=='undefined'?Object.create(PermissionStatus.prototype):{};
        Object.defineProperties(ps,{
          state:{get:function(){return 'prompt';},enumerable:true,configurable:true},
          status:{get:function(){return 'prompt';},enumerable:true,configurable:true},
          onchange:{value:null,writable:true,enumerable:true,configurable:true}
        });
        ps.addEventListener=function(){};
        ps.removeEventListener=function(){};
        ps.dispatchEvent=function(){return true;};
        return ps;
      });
    });
  }
}catch(e){}

// ═══════════════════════════════════════════
// 15. speechSynthesis spoofing (prototype-level)
// ═══════════════════════════════════════════
try{
  if(typeof SpeechSynthesis!=='undefined'){
    var _lang0=_navProps.language;
    // Build a realistic voice list based on spoofed locale
    // Use SpeechSynthesisVoice prototype from a real voice if available
    var _voiceProto=(typeof SpeechSynthesisVoice!=='undefined')?SpeechSynthesisVoice.prototype:null;
    function _mkVoice(name,lang,local,def){
      var v=_voiceProto?Object.create(_voiceProto):{};
      Object.defineProperties(v,{
        name:{get:function(){return name;},enumerable:true,configurable:true},
        lang:{get:function(){return lang;},enumerable:true,configurable:true},
        localService:{get:function(){return local;},enumerable:true,configurable:true},
        default:{get:function(){return def;},enumerable:true,configurable:true},
        voiceURI:{get:function(){return name;},enumerable:true,configurable:true}
      });
      return v;
    }
    var _fakeVoices=[];
    // Local voices matching the primary language
    if(_lang0.startsWith('de')){_fakeVoices.push(_mkVoice('Microsoft Hedda - German','de-DE',true,true),_mkVoice('Microsoft Katja - German','de-DE',true,false));}
    else if(_lang0.startsWith('fr')){_fakeVoices.push(_mkVoice('Microsoft Hortense - French','fr-FR',true,true),_mkVoice('Microsoft Julie - French','fr-FR',true,false));}
    else if(_lang0.startsWith('es')){_fakeVoices.push(_mkVoice('Microsoft Helena - Spanish (Spain)','es-ES',true,true),_mkVoice('Microsoft Laura - Spanish (Spain)','es-ES',true,false));}
    else if(_lang0.startsWith('ru')){_fakeVoices.push(_mkVoice('Microsoft Irina - Russian','ru-RU',true,true),_mkVoice('Microsoft Pavel - Russian','ru-RU',true,false));_fakeVoices.push(_mkVoice('Microsoft David - English (United States)','en-US',true,false));}
    else if(_lang0.startsWith('ja')){_fakeVoices.push(_mkVoice('Microsoft Haruka - Japanese','ja-JP',true,true),_mkVoice('Microsoft Ichiro - Japanese','ja-JP',true,false));}
    else if(_lang0.startsWith('zh')){_fakeVoices.push(_mkVoice('Microsoft Huihui - Chinese (Simplified)','zh-CN',true,true),_mkVoice('Microsoft Yaoyao - Chinese (Simplified)','zh-CN',true,false));}
    else if(_lang0.startsWith('ko')){_fakeVoices.push(_mkVoice('Microsoft Heami - Korean','ko-KR',true,true));}
    else if(_lang0.startsWith('pt')){_fakeVoices.push(_mkVoice('Microsoft Maria - Portuguese (Brazil)','pt-BR',true,true));}
    else if(_lang0.startsWith('it')){_fakeVoices.push(_mkVoice('Microsoft Elsa - Italian','it-IT',true,true));}
    else{_fakeVoices.push(_mkVoice('Microsoft David - English (United States)','en-US',true,true),_mkVoice('Microsoft Zira - English (United States)','en-US',true,false),_mkVoice('Microsoft Mark - English (United States)','en-US',true,false));}
    // Common Google network voices
    _fakeVoices.push(_mkVoice('Google US English','en-US',false,false));
    _fakeVoices.push(_mkVoice('Google UK English Female','en-GB',false,false));
    _fakeVoices.push(_mkVoice('Google UK English Male','en-GB',false,false));
    Object.freeze(_fakeVoices);
    _cloak(SpeechSynthesis.prototype,'getVoices',function(){return _fakeVoices.slice();});
    // Suppress voiceschanged to prevent re-enumeration with real voices
    var _origAddEv=SpeechSynthesis.prototype.addEventListener;
    _cloak(SpeechSynthesis.prototype,'addEventListener',function(type,fn,opts){
      if(type==='voiceschanged')return;
      return _origAddEv.call(this,type,fn,opts);
    });
    try{Object.defineProperty(speechSynthesis,'onvoiceschanged',{get:function(){return null;},set:function(){},configurable:true});}catch(e){}
  }
}catch(e){}

// ═══════════════════════════════════════════
// 16. Additional hardening
// ═══════════════════════════════════════════

// Prevent WebDriver detection
_defProp(Navigator.prototype,'webdriver',function(){return false;});
// Also override on the instance in case Chrome set an own-property (CDP automation flag)
try{Object.defineProperty(navigator,'webdriver',{get:function(){return false;},configurable:true,enumerable:true});}catch(e){}

// Consistent doNotTrack (null = Chrome default, DNT setting removed in Chrome 120+)
_defProp(Navigator.prototype,'doNotTrack',function(){return null;});

// Battery API — return consistent object
try{
  if(navigator.getBattery){
    var _origGetBattery=Navigator.prototype.getBattery;
    _cloak(Navigator.prototype,'getBattery',function(){
      return _origGetBattery.call(this).then(function(bm){
        // Override values on the real BatteryManager instance to preserve prototype chain
        try{
          var _bmGetters={charging:true,chargingTime:0,dischargingTime:Infinity,level:1.0};
          for(var _bk in _bmGetters){
            (function(k,v){
              var origDesc=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(bm),k);
              var getter=function(){return v;};
              if(origDesc&&origDesc.get){
                try{_toStringMap.set(getter,_origFnToString.call(origDesc.get));}catch(e){_toStringMap.set(getter,'function get '+k+'() { [native code] }');}
              }else{
                _toStringMap.set(getter,'function get '+k+'() { [native code] }');
              }
              Object.defineProperty(bm,k,{get:getter,configurable:true,enumerable:true});
            })(_bk,_bmGetters[_bk]);
          }
        }catch(e){}
        return bm;
      });
    });
  }
}catch(e){}

// Prevent Notification.permission leak (consistent with permissions hook)
try{
  if(typeof Notification!=='undefined'){
    _defProp(Notification,'permission',function(){return 'default';});
  }
}catch(e){}

// Storage quota fingerprint protection
try{
  if(navigator.storage&&navigator.storage.estimate){
    var _origEstimate=navigator.storage.estimate.bind(navigator.storage);
    _cloak(navigator.storage,'estimate',function(){
      return _origEstimate().then(function(est){
        // Round quota to nearest GB to reduce uniqueness
        var roundedQuota=Math.round((est.quota||0)/(1024*1024*1024))*(1024*1024*1024);
        // Round usage to nearest 10MB
        var roundedUsage=Math.round((est.usage||0)/(10*1024*1024))*(10*1024*1024);
        return{quota:roundedQuota,usage:roundedUsage,usageDetails:est.usageDetails};
      });
    });
  }
}catch(e){}

// ═══════════════════════════════════════════
// 17. navigator.userAgentData (Client Hints API)
// ═══════════════════════════════════════════
try{
  var _uaM=_navProps.userAgent.match(/Chrome\\/(\\d+)/);
  var _chrM=_uaM?parseInt(_uaM[1]):120;
  var _uaFull=_navProps.userAgent.match(/Chrome\\/([\\d.]+)/);
  var _fVer=_uaFull?_uaFull[1]:_chrM+'.0.0.0';
  var _isWinUA=_navProps.platform==='Win32';
  var _isMacUA=_navProps.platform==='MacIntel';
  // Not-a-brand rotation based on Chrome major version
  var _nbPool=['Not_A Brand','Not/A)Brand','Not)A;Brand','Not A;Brand'];
  var _nb=_nbPool[_chrM%4];
  var _brands=Object.freeze([
    Object.freeze({brand:'Google Chrome',version:String(_chrM)}),
    Object.freeze({brand:'Chromium',version:String(_chrM)}),
    Object.freeze({brand:_nb,version:'24'})
  ]);
  var _fullBrands=Object.freeze([
    Object.freeze({brand:'Google Chrome',version:_fVer}),
    Object.freeze({brand:'Chromium',version:_fVer}),
    Object.freeze({brand:_nb,version:'24.0.0.0'})
  ]);
  var _uaPlatform=_isWinUA?'Windows':_isMacUA?'macOS':'Linux';
  // Derive platformVersion deterministically from seed (no DB field needed)
  var _isW11=(_seed%4===0);
  var _isMobile=${fp.device_type === 'mobile'};
  var _platVer=_isWinUA?(_isW11?'15.0.0':'10.0.0'):_isMacUA?'14.5.0':_isMobile?'14.0.0':'6.5.0';
  var _uaData={
    brands:_brands,
    mobile:_isMobile,
    platform:_uaPlatform,
    toJSON:function(){return{brands:this.brands,mobile:this.mobile,platform:this.platform};}
  };
  _uaData.getHighEntropyValues=function(hints){
    var r={brands:_brands,mobile:_isMobile,platform:_uaPlatform};
    for(var _hi=0;_hi<hints.length;_hi++){
      var h=hints[_hi];
      if(h==='architecture')r.architecture='x86';
      if(h==='bitness')r.bitness='64';
      if(h==='fullVersionList')r.fullVersionList=_fullBrands;
      if(h==='model')r.model=_isMobile?${JSON.stringify(fp.user_agent.match(/Android[^;]*;\s*([^)]+)\)/)?.[1] ?? '')}:'';
      if(h==='platformVersion')r.platformVersion=_platVer;
      if(h==='uaFullVersion')r.uaFullVersion=_fVer;
      if(h==='wow64')r.wow64=false;
      if(h==='formFactors')r.formFactors=['Desktop'];
    }
    return Promise.resolve(r);
  };
  _toStringMap.set(_uaData.toJSON,'function toJSON() { [native code] }');
  _toStringMap.set(_uaData.getHighEntropyValues,'function getHighEntropyValues() { [native code] }');
  _defProp(Navigator.prototype,'userAgentData',function(){return _uaData;});
}catch(e){}

// ═══════════════════════════════════════════
// 18. Worker/SharedWorker scope spoofing
// ═══════════════════════════════════════════
try{
  var _wkSpoof=${workerSpoofCode};
  var _OW=window.Worker;
  if(_OW){
    var _HookedWorker=function(s,o){
      try{
        if(typeof s==='string'||s instanceof URL){
          var u=''+s;
          try{u=new URL(u,location.href).href;}catch(e){}
          var blobUrl;
          if(o&&o.type==='module'){
            var mb=new Blob([_wkSpoof+'import '+JSON.stringify(u)+';'],{type:'text/javascript'});
            blobUrl=URL.createObjectURL(mb);
          }else{
            var cb=new Blob([_wkSpoof+'importScripts('+JSON.stringify(u)+');'],{type:'text/javascript'});
            blobUrl=URL.createObjectURL(cb);
          }
          var w=new _OW(blobUrl,o);
          // Revoke blob URL after worker has loaded (microtask delay is enough)
          Promise.resolve().then(function(){URL.revokeObjectURL(blobUrl);});
          return w;
        }
      }catch(e){}
      return new _OW(s,o);
    };
    _HookedWorker.prototype=_OW.prototype;
    Object.defineProperty(_HookedWorker,'name',{value:'Worker',configurable:true});
    Object.defineProperty(_HookedWorker,'length',{value:1,configurable:true});
    _toStringMap.set(_HookedWorker,_origFnToString.call(_OW));
    window.Worker=_HookedWorker;
  }
  // SharedWorker hook
  var _OSW=window.SharedWorker;
  if(_OSW){
    var _HookedSW=function(s,o){
      try{
        if(typeof s==='string'||s instanceof URL){
          var u=''+s;
          try{u=new URL(u,location.href).href;}catch(e){}
          var blobUrl;
          if(o&&o.type==='module'){
            var msb=new Blob([_wkSpoof+'import '+JSON.stringify(u)+';'],{type:'text/javascript'});
            blobUrl=URL.createObjectURL(msb);
          }else{
            var sb=new Blob([_wkSpoof+'importScripts('+JSON.stringify(u)+');'],{type:'text/javascript'});
            blobUrl=URL.createObjectURL(sb);
          }
          var sw=new _OSW(blobUrl,o);
          Promise.resolve().then(function(){URL.revokeObjectURL(blobUrl);});
          return sw;
        }
      }catch(e){}
      return new _OSW(s,o);
    };
    _HookedSW.prototype=_OSW.prototype;
    Object.defineProperty(_HookedSW,'name',{value:'SharedWorker',configurable:true});
    Object.defineProperty(_HookedSW,'length',{value:1,configurable:true});
    _toStringMap.set(_HookedSW,_origFnToString.call(_OSW));
    window.SharedWorker=_HookedSW;
  }
}catch(e){}

})();`
}

// ─── Regenerate stored fingerprint ───────────────────────────────────────

export function regenerateFingerprint(
  db: Database.Database,
  profileId: string,
  browserType: BrowserType
): Fingerprint {
  // Preserve existing device_type when regenerating
  const existing = db.prepare('SELECT device_type FROM fingerprints WHERE profile_id = ?').get(profileId) as { device_type?: string } | undefined
  const deviceType = existing?.device_type || 'desktop'
  const newFp = generateDefaultFingerprint(browserType, { device_type: deviceType } as Partial<Fingerprint>)

  db.prepare(`
    UPDATE fingerprints SET
      user_agent = ?, platform = ?, hardware_concurrency = ?, device_memory = ?,
      languages = ?, screen_width = ?, screen_height = ?, color_depth = ?,
      pixel_ratio = ?, timezone = ?, canvas_noise_seed = ?, webgl_vendor = ?,
      webgl_renderer = ?, audio_context_noise = ?, fonts_list = ?,
      webrtc_policy = ?, video_inputs = ?, audio_inputs = ?, audio_outputs = ?,
      device_type = ?
    WHERE profile_id = ?
  `).run(
    newFp.user_agent,
    newFp.platform,
    newFp.hardware_concurrency,
    newFp.device_memory,
    newFp.languages,
    newFp.screen_width,
    newFp.screen_height,
    newFp.color_depth,
    newFp.pixel_ratio,
    newFp.timezone,
    newFp.canvas_noise_seed,
    newFp.webgl_vendor,
    newFp.webgl_renderer,
    newFp.audio_context_noise,
    newFp.fonts_list,
    newFp.webrtc_policy,
    newFp.video_inputs,
    newFp.audio_inputs,
    newFp.audio_outputs,
    newFp.device_type,
    profileId
  )

  return db.prepare('SELECT * FROM fingerprints WHERE profile_id = ?').get(profileId) as Fingerprint
}
