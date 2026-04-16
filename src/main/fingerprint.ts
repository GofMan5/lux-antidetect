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

const MOBILE_FONTS_POOL = [
  'Roboto', 'Noto Sans', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif',
  'Cutive Mono', 'Coming Soon', 'Dancing Script', 'Carrois Gothic SC'
]

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

const WIN_FONTS_POOL = [
  'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
  'Trebuchet MS', 'Impact', 'Segoe UI', 'Tahoma', 'Calibri',
  'Cambria', 'Consolas', 'Lucida Console', 'Comic Sans MS',
  'Palatino Linotype', 'Book Antiqua', 'Candara', 'Constantia',
  'Corbel', 'Franklin Gothic Medium', 'Garamond', 'Segoe Print',
  'Segoe Script', 'Sitka Text', 'Sylfaen', 'Ebrima', 'Leelawadee',
  'Microsoft Sans Serif', 'MS Gothic', 'MS PGothic', 'Yu Gothic'
] as const

const MAC_FONTS_POOL = [
  'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
  'Trebuchet MS', 'Helvetica', 'Helvetica Neue', 'Futura',
  'Menlo', 'Monaco', 'Optima', 'Gill Sans', 'Baskerville',
  'Didot', 'American Typewriter', 'Avenir', 'Avenir Next',
  'Cochin', 'Copperplate', 'Hoefler Text', 'Lucida Grande',
  'Marker Felt', 'Papyrus', 'Phosphate', 'Rockwell',
  'San Francisco', 'Skia', 'Snell Roundhand', 'Zapfino'
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

  const isWindows = Math.random() > 0.35 // ~65% Windows, ~35% Mac (real-world distribution)

  // OS-specific User-Agent
  const chromeVer = randomChromeVersion()
  let userAgent: string
  let platform: string
  let pixelRatio: number

  if (isWindows) {
    // Chrome UA reduction: always NT 10.0 regardless of actual Windows version
    userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`
    platform = 'Win32'
    pixelRatio = Math.random() > 0.8 ? 1.25 : Math.random() > 0.5 ? 1.5 : 1.0
  } else {
    const macVer = pick(MAC_VERSIONS)
    userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X ${macVer}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`
    platform = 'MacIntel'
    pixelRatio = 2.0
  }

  // Screen
  const screens = isWindows ? WINDOWS_SCREENS : MAC_SCREENS
  const [screenW, screenH] = pick(screens)

  // GPU — consistent with OS
  const gpus = isWindows ? WINDOWS_GPUS : MAC_GPUS
  const gpuConfig = pick(gpus)
  const webglRenderer = pick(gpuConfig.renderers)
  const webglVendor = gpuConfig.vendor

  // Timezone and languages
  const timezone = overrides?.timezone ?? pick(ALL_TIMEZONES)
  const languages = getLanguagesForTimezone(timezone)

  // Hardware
  const hw = pickWeighted(HARDWARE_CONFIGS)

  // Media devices
  const media = pick(MEDIA_CONFIGS)

  // Fonts
  const fonts = randomFontSubset(isWindows ? WIN_FONTS_POOL : MAC_FONTS_POOL)

  // Noise values — always unique per generation
  const canvasNoiseSeed = Math.floor(Math.random() * 2147483647)
  const audioContextNoise = Math.random() * 0.0001

  return {
    user_agent: overrides?.user_agent ?? userAgent,
    platform: overrides?.platform ?? platform,
    hardware_concurrency: overrides?.hardware_concurrency ?? hw.concurrency,
    device_memory: overrides?.device_memory ?? hw.memory,
    languages: overrides?.languages ?? JSON.stringify(languages),
    screen_width: overrides?.screen_width ?? screenW,
    screen_height: overrides?.screen_height ?? screenH,
    color_depth: 24,
    pixel_ratio: pixelRatio,
    timezone,
    canvas_noise_seed: canvasNoiseSeed,
    webgl_vendor: overrides?.webgl_vendor ?? webglVendor,
    webgl_renderer: overrides?.webgl_renderer ?? webglRenderer,
    audio_context_noise: audioContextNoise,
    fonts_list: JSON.stringify(fonts),
    webrtc_policy: overrides?.webrtc_policy ?? 'disable_non_proxied_udp',
    video_inputs: media.video,
    audio_inputs: media.audioIn,
    audio_outputs: media.audioOut,
    device_type: 'desktop'
  }
}

function generateMobileFingerprint(
  overrides?: Partial<Fingerprint>
): Omit<Fingerprint, 'id' | 'profile_id'> {
  const chromeVer = randomChromeVersion()
  const device = pick(ANDROID_DEVICES)
  const [screenW, screenH] = pick(MOBILE_SCREENS)
  const gpuConfig = pick(MOBILE_GPUS)

  const userAgent = `Mozilla/5.0 (Linux; Android 14; ${device.model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Mobile Safari/537.36`
  const platform = 'Linux armv81'

  const timezone = overrides?.timezone ?? pick(ALL_TIMEZONES)
  const languages = getLanguagesForTimezone(timezone)
  const hw = pickWeighted(HARDWARE_CONFIGS)
  const fonts = randomFontSubset(MOBILE_FONTS_POOL, 5, 8)

  return {
    user_agent: overrides?.user_agent ?? userAgent,
    platform: overrides?.platform ?? platform,
    hardware_concurrency: overrides?.hardware_concurrency ?? Math.min(hw.concurrency, 8),
    device_memory: overrides?.device_memory ?? Math.min(hw.memory, 8),
    languages: overrides?.languages ?? JSON.stringify(languages),
    screen_width: overrides?.screen_width ?? screenW,
    screen_height: overrides?.screen_height ?? screenH,
    color_depth: 24,
    pixel_ratio: pick([2.0, 2.625, 3.0, 3.5]),
    timezone,
    canvas_noise_seed: Math.floor(Math.random() * 2147483647),
    webgl_vendor: overrides?.webgl_vendor ?? gpuConfig.vendor,
    webgl_renderer: overrides?.webgl_renderer ?? pick(gpuConfig.renderers),
    audio_context_noise: Math.random() * 0.0001,
    fonts_list: JSON.stringify(fonts),
    webrtc_policy: overrides?.webrtc_policy ?? 'disable_non_proxied_udp',
    video_inputs: 1,
    audio_inputs: 1,
    audio_outputs: 1,
    device_type: 'mobile'
  }
}

export function generateFingerprintForApi(browserType: BrowserType): Omit<Fingerprint, 'id' | 'profile_id'> {
  return generateDefaultFingerprint(browserType)
}

// ─── Injection script ────────────────────────────────────────────────────

export function buildInjectionScript(fp: Fingerprint): string {
  let languages: string[]
  try {
    languages = JSON.parse(fp.languages)
    if (!Array.isArray(languages)) languages = ['en-US', 'en']
  } catch {
    languages = ['en-US', 'en']
  }
  const languagesJson = JSON.stringify(languages)

  let fontsJson = fp.fonts_list
  try {
    JSON.parse(fontsJson) // validate
  } catch {
    fontsJson = '[]'
  }

  const isChrome = fp.user_agent.includes('Chrome/')

  // Pre-build worker spoofing code (injected into Worker/SharedWorker constructors)
  const workerSpoofCode = JSON.stringify(
    `(function(){try{var n=navigator;var d=Object.defineProperty;` +
    `d(n,"language",{get:function(){return ${JSON.stringify(languages[0] || 'en-US')}},configurable:true});` +
    `d(n,"languages",{get:function(){return ${languagesJson}},configurable:true});` +
    `d(n,"userAgent",{get:function(){return ${JSON.stringify(fp.user_agent)}},configurable:true});` +
    `d(n,"platform",{get:function(){return ${JSON.stringify(fp.platform)}},configurable:true});` +
    `d(n,"hardwareConcurrency",{get:function(){return ${fp.hardware_concurrency}},configurable:true});` +
    `d(n,"deviceMemory",{get:function(){return ${fp.device_memory}},configurable:true});` +
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

function _hookWebGL(proto,exts){
  var origGetParam=proto.getParameter;
  _cloak(proto,'getParameter',function(p){
    if(p===0x9245)return _wglVendor;
    if(p===0x9246)return _wglRenderer;
    if(p===0x1F01)return _wglRenderer;
    if(p===0x1F00)return _wglVendor;
    return origGetParam.call(this,p);
  });

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
if(typeof WebGLRenderingContext!=='undefined')_hookWebGL(WebGLRenderingContext.prototype,_baseExts);
if(typeof WebGL2RenderingContext!=='undefined')_hookWebGL(WebGL2RenderingContext.prototype,_gl2Exts);

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

if(typeof FontFaceSet!=='undefined'&&document.fonts){
  var _origFontCheck=FontFaceSet.prototype.check;
  _cloak(FontFaceSet.prototype,'check',function(font,text){
    var m=font.match(/\\d+(?:px|pt|em|rem|%)\\s+['"]*([^'",$]+)/i);
    if(m){
      var fName=m[1].trim();
      if(fName&&!_allowedFonts.has(fName)){
        var generic=['serif','sans-serif','monospace','cursive','fantasy','system-ui'];
        if(generic.indexOf(fName)===-1)return false;
      }
    }
    return _origFontCheck.call(this,font,text||'');
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
    function _filterIceCandidate(e){
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
          if(_filterIceCandidate(e))return;
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
            if(_filterIceCandidate(e))return;
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
