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

const CHROME_MAJORS = [122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133] as const

function randomChromeVersion(): string {
  const major = pick(CHROME_MAJORS)
  const build = randInt(6261, 6723)
  const patch = randInt(40, 230)
  return `${major}.0.${build}.${patch}`
}

// ─── OS builds ───────────────────────────────────────────────────────────

const WIN_BUILDS = ['10.0', '10.0', '10.0', '11.0'] as const // weighted toward Win10
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

function randomFontSubset(pool: readonly string[]): string[] {
  // Pick 8-15 fonts from the pool, always including the first 5 (common)
  const common = pool.slice(0, 5)
  const rest = pool.slice(5)
  const shuffled = [...rest].sort(() => Math.random() - 0.5)
  const extraCount = randInt(3, 10)
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
  const isWindows = Math.random() > 0.35 // ~65% Windows, ~35% Mac (real-world distribution)

  // OS-specific User-Agent
  const chromeVer = randomChromeVersion()
  let userAgent: string
  let platform: string
  let pixelRatio: number

  if (isWindows) {
    const winBuild = pick(WIN_BUILDS)
    userAgent = `Mozilla/5.0 (Windows NT ${winBuild}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`
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
    audio_outputs: media.audioOut
  }
}

export function generateFingerprintForApi(browserType: BrowserType): Omit<Fingerprint, 'id' | 'profile_id'> {
  return generateDefaultFingerprint(browserType)
}

// ─── Injection script ────────────────────────────────────────────────────

export function buildInjectionScript(fp: Fingerprint): string {
  const languages: string[] = JSON.parse(fp.languages)
  const languagesJson = JSON.stringify(languages)
  const fontsJson = fp.fonts_list
  const isChrome = fp.user_agent.includes('Chrome/')

  return `(function(){
'use strict';

// ── Seeded PRNG (Mulberry32) ──
var _seed=${fp.canvas_noise_seed};
function _m32(a){return function(){a|=0;a=a+0x6D2B79F5|0;var t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
var _rng=_m32(_seed);

// ── toString cloaking helper ──
var _nativeToString=Function.prototype.toString;
var _patched=new WeakSet();
function _cloak(obj,name,fn){
  var orig=obj[name];
  obj[name]=fn;
  _patched.add(fn);
  if(orig&&!_patched.has(orig)){
    var src;try{src=_nativeToString.call(orig);}catch(e){src='function '+name+'() { [native code] }';}
    var _map=_cloak._m||(_cloak._m=new WeakMap());
    _map.set(fn,src);
  }
}
var _origFnToString=Function.prototype.toString;
Function.prototype.toString=function(){
  var m=_cloak._m;
  if(m&&m.has(this))return m.get(this);
  return _origFnToString.call(this);
};
_patched.add(Function.prototype.toString);
if(_cloak._m)_cloak._m.set(Function.prototype.toString,_origFnToString.call(_origFnToString));

// ── Utility: defineProperty shorthand ──
function _defProp(obj,prop,getter){
  try{Object.defineProperty(obj,prop,{get:getter,configurable:true,enumerable:true});}catch(e){}
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
  maxTouchPoints:0,
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
_defProp(window,'innerWidth',function(){return ${fp.screen_width};});
_defProp(window,'innerHeight',function(){return ${fp.screen_height - 80};});

// ═══════════════════════════════════════════
// 3. Canvas fingerprint spoofing (Enhanced)
// ═══════════════════════════════════════════
var _canvasRng=_m32(_seed);

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

function _hookWebGL(proto){
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
    if(name==='WEBGL_debug_renderer_info'){
      return{UNMASKED_VENDOR_WEBGL:0x9245,UNMASKED_RENDERER_WEBGL:0x9246};
    }
    return origGetExt.call(this,name);
  });

  var origGetSupported=proto.getSupportedExtensions;
  _cloak(proto,'getSupportedExtensions',function(){
    return _baseExts.slice();
  });

  var origGetSPF=proto.getShaderPrecisionFormat;
  _cloak(proto,'getShaderPrecisionFormat',function(shaderType,precisionType){
    var r=origGetSPF.call(this,shaderType,precisionType);
    if(!r)return r;
    var rangeMin=r.rangeMin,rangeMax=r.rangeMax,prec=r.precision;
    if(_isApple){rangeMin=127;rangeMax=127;prec=23;}
    else if(_isNvidia||_isAmd){rangeMin=127;rangeMax=127;prec=23;}
    else{rangeMin=r.rangeMin;rangeMax=r.rangeMax;prec=r.precision;}
    return{rangeMin:rangeMin,rangeMax:rangeMax,precision:prec};
  });
}
if(typeof WebGLRenderingContext!=='undefined')_hookWebGL(WebGLRenderingContext.prototype);
if(typeof WebGL2RenderingContext!=='undefined')_hookWebGL(WebGL2RenderingContext.prototype);

// ═══════════════════════════════════════════
// 5. AudioContext fingerprint spoofing
// ═══════════════════════════════════════════
var _audioNoise=${fp.audio_context_noise};
var _audioRng=_m32(_seed^0xABCD1234);

if(typeof AudioBuffer!=='undefined'){
  var _origGetCD=AudioBuffer.prototype.getChannelData;
  _cloak(AudioBuffer.prototype,'getChannelData',function(ch){
    var data=_origGetCD.call(this,ch);
    for(var i=0;i<data.length;i+=100){
      data[i]=data[i]+_audioNoise*(_audioRng()-0.5);
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
var _rectRng=_m32(_seed^0x1337);
function _rNoise(){return(_rectRng()-0.5)*0.002;}

function _noisyDOMRect(r){
  return new DOMRect(r.x+_rNoise(),r.y+_rNoise(),r.width+_rNoise(),r.height+_rNoise());
}
function _noisyRectList(origFn,self){
  var rects=origFn.call(self);
  var arr=[];
  for(var i=0;i<rects.length;i++)arr.push(_noisyDOMRect(rects[i]));
  arr.item=function(idx){return this[idx]||null;};
  Object.defineProperty(arr,'length',{get:function(){return rects.length;},configurable:true});
  return arr;
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
try{
  var _now=new Date();
  var _utcStr=_now.toLocaleString('en-US',{timeZone:'UTC'});
  var _localStr=_now.toLocaleString('en-US',{timeZone:_tz});
  var _offset=(new Date(_utcStr)-new Date(_localStr))/60000;
  _cloak(Date.prototype,'getTimezoneOffset',function(){return _offset;});
}catch(e){}

var _origResolvedOpts=Intl.DateTimeFormat.prototype.resolvedOptions;
_cloak(Intl.DateTimeFormat.prototype,'resolvedOptions',function(){
  var r=_origResolvedOpts.call(this);
  r.timeZone=_tz;
  return r;
});

// Also hook Intl.DateTimeFormat constructor to inject timezone
var _OrigDTF=Intl.DateTimeFormat;
Intl.DateTimeFormat=function(locales,options){
  if(options&&typeof options==='object'){
    if(!options.timeZone)options.timeZone=_tz;
  }else if(!options){
    options={timeZone:_tz};
  }
  return new _OrigDTF(locales,options);
};
Intl.DateTimeFormat.prototype=_OrigDTF.prototype;
Intl.DateTimeFormat.supportedLocalesOf=_OrigDTF.supportedLocalesOf;

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
  // Pre-generate deterministic IDs
  var _cachedDevices=[];
  var _gid=_hexStr(32,_devRng);
  for(var _vi=0;_vi<_vidIn;_vi++)_cachedDevices.push({deviceId:_hexStr(64,_devRng),groupId:_gid,kind:'videoinput',label:''});
  var _gid2=_hexStr(32,_devRng);
  for(var _ai=0;_ai<_audIn;_ai++)_cachedDevices.push({deviceId:_hexStr(64,_devRng),groupId:_gid2,kind:'audioinput',label:''});
  for(var _ao=0;_ao<_audOut;_ao++)_cachedDevices.push({deviceId:_hexStr(64,_devRng),groupId:_gid2,kind:'audiooutput',label:''});

  _cloak(navigator.mediaDevices,'enumerateDevices',function(){
    return Promise.resolve(_cachedDevices.map(function(d){return Object.assign({},d);}));
  });
}

// ═══════════════════════════════════════════
// 10. WebRTC IP leak protection
// ═══════════════════════════════════════════
var _rtcPolicy=${JSON.stringify(fp.webrtc_policy)};
if(_rtcPolicy==='disable_non_proxied_udp'){
  var _OrigRTC=window.RTCPeerConnection||window.webkitRTCPeerConnection;
  if(_OrigRTC){
    var _newRTC=function(config){
      config=config||{};
      config.iceServers=[];
      config.iceTransportPolicy='relay';
      var pc=new _OrigRTC(config);
      // Filter SDP
      function _filterSDP(sdp){
        if(!sdp)return sdp;
        return sdp.replace(/a=candidate:[^\\r\\n]*typ\\s+(srflx|prflx|relay)[^\\r\\n]*(\\r\\n|\\r|\\n)/g,'');
      }
      var origCreateOffer=pc.createOffer.bind(pc);
      pc.createOffer=function(opts){
        return origCreateOffer(opts).then(function(o){o.sdp=_filterSDP(o.sdp);return o;});
      };
      var origCreateAnswer=pc.createAnswer.bind(pc);
      pc.createAnswer=function(opts){
        return origCreateAnswer(opts).then(function(a){a.sdp=_filterSDP(a.sdp);return a;});
      };
      // Filter ICE candidates via event
      var _origAddEvent=pc.addEventListener.bind(pc);
      pc.addEventListener=function(type,fn,opts){
        if(type==='icecandidate'){
          return _origAddEvent(type,function(e){
            if(e.candidate&&e.candidate.candidate){
              var c=e.candidate.candidate;
              if(c.indexOf('srflx')!==-1||c.indexOf('prflx')!==-1||c.indexOf('relay')!==-1)return;
            }
            fn(e);
          },opts);
        }
        return _origAddEvent(type,fn,opts);
      };
      // Also intercept onicecandidate setter
      var _oicDesc=Object.getOwnPropertyDescriptor(RTCPeerConnection.prototype,'onicecandidate');
      if(_oicDesc&&_oicDesc.set){
        var _origOicSet=_oicDesc.set;
        Object.defineProperty(pc,'onicecandidate',{
          set:function(fn){
            _origOicSet.call(this,function(e){
              if(e.candidate&&e.candidate.candidate){
                var c=e.candidate.candidate;
                if(c.indexOf('srflx')!==-1||c.indexOf('prflx')!==-1||c.indexOf('relay')!==-1)return;
              }
              if(fn)fn(e);
            });
          },
          get:function(){return _oicDesc.get?_oicDesc.get.call(this):undefined;},
          configurable:true
        });
      }
      return pc;
    };
    _newRTC.prototype=_OrigRTC.prototype;
    _newRTC.generateCertificate=_OrigRTC.generateCertificate;
    window.RTCPeerConnection=_newRTC;
    if(window.webkitRTCPeerConnection)window.webkitRTCPeerConnection=_newRTC;
  }
}else if(_rtcPolicy==='default_public_interface_only'){
  var _OrigRTC2=window.RTCPeerConnection||window.webkitRTCPeerConnection;
  if(_OrigRTC2){
    var _newRTC2=function(config){
      config=config||{};
      var pc=new _OrigRTC2(config);
      function _filterRelaySDP(sdp){
        if(!sdp)return sdp;
        return sdp.replace(/a=candidate:[^\\r\\n]*typ\\s+relay[^\\r\\n]*(\\r\\n|\\r|\\n)/g,'');
      }
      var origCO2=pc.createOffer.bind(pc);
      pc.createOffer=function(opts){return origCO2(opts).then(function(o){o.sdp=_filterRelaySDP(o.sdp);return o;});};
      var origCA2=pc.createAnswer.bind(pc);
      pc.createAnswer=function(opts){return origCA2(opts).then(function(a){a.sdp=_filterRelaySDP(a.sdp);return a;});};
      return pc;
    };
    _newRTC2.prototype=_OrigRTC2.prototype;
    _newRTC2.generateCertificate=_OrigRTC2.generateCertificate;
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
  var _fakePlugins=[];
  var _fakeMimes=[];
  _pluginData.forEach(function(pd){
    var plug={name:pd.name,filename:pd.filename,description:pd.description,length:pd.mimeTypes.length};
    pd.mimeTypes.forEach(function(mt,idx){
      var mo={type:mt.type,suffixes:mt.suffixes,description:mt.description,enabledPlugin:plug};
      plug[idx]=mo;
      _fakeMimes.push(mo);
    });
    _fakePlugins.push(plug);
  });
  _fakePlugins.item=function(i){return this[i]||null;};
  _fakePlugins.namedItem=function(n){for(var i=0;i<this.length;i++)if(this[i]&&this[i].name===n)return this[i];return null;};
  _fakePlugins.refresh=function(){};
  _fakeMimes.item=function(i){return this[i]||null;};
  _fakeMimes.namedItem=function(n){for(var i=0;i<this.length;i++)if(this[i]&&this[i].type===n)return this[i];return null;};

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
    window.chrome.csi=function(){return{startE:Date.now(),onloadT:Date.now(),pageT:Date.now()-performance.timing.navigationStart,tran:15};};
  }
  if(!window.chrome.loadTimes){
    window.chrome.loadTimes=function(){
      return{
        commitLoadTime:performance.timing.responseStart/1000,
        connectionInfo:'h2',
        finishDocumentLoadTime:performance.timing.domContentLoadedEventEnd/1000,
        finishLoadTime:performance.timing.loadEventEnd/1000,
        firstPaintAfterLoadTime:0,
        firstPaintTime:performance.timing.responseStart/1000,
        navigationType:'Other',
        npnNegotiatedProtocol:'h2',
        requestTime:performance.timing.navigationStart/1000,
        startLoadTime:performance.timing.navigationStart/1000,
        wasAlternateProtocolAvailable:false,
        wasFetchedViaSpdy:true,
        wasNpnNegotiated:true
      };
    };
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
      var name=desc&&desc.name;
      // Return consistent results for commonly queried permissions
      if(name==='notifications')return Promise.resolve({state:'prompt',onchange:null});
      if(name==='push')return Promise.resolve({state:'prompt',onchange:null});
      if(name==='midi')return Promise.resolve({state:'prompt',onchange:null});
      if(name==='camera')return Promise.resolve({state:'prompt',onchange:null});
      if(name==='microphone')return Promise.resolve({state:'prompt',onchange:null});
      if(name==='background-sync')return Promise.resolve({state:'granted',onchange:null});
      if(name==='accelerometer'||name==='gyroscope'||name==='magnetometer')return Promise.resolve({state:'granted',onchange:null});
      if(name==='clipboard-read'||name==='clipboard-write')return Promise.resolve({state:'prompt',onchange:null});
      return _origPermQuery.call(this,desc);
    });
  }
}catch(e){}

// ═══════════════════════════════════════════
// 15. speechSynthesis.getVoices() hook
// ═══════════════════════════════════════════
try{
  if(typeof speechSynthesis!=='undefined'&&speechSynthesis.getVoices){
    _cloak(speechSynthesis,'getVoices',function(){
      return[];
    });
  }
}catch(e){}

// ═══════════════════════════════════════════
// 16. Additional hardening
// ═══════════════════════════════════════════

// Prevent WebDriver detection
_defProp(Navigator.prototype,'webdriver',function(){return false;});
try{delete navigator.__proto__.webdriver;}catch(e){}

// Consistent doNotTrack
_defProp(Navigator.prototype,'doNotTrack',function(){return '1';});

// Battery API — return consistent object
try{
  if(navigator.getBattery){
    _cloak(Navigator.prototype,'getBattery',function(){
      return Promise.resolve({
        charging:true,chargingTime:0,dischargingTime:Infinity,level:1.0,
        addEventListener:function(){},removeEventListener:function(){},
        onchargingchange:null,onchargingtimechange:null,ondischargingtimechange:null,onlevelchange:null
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

})();`
}

// ─── Regenerate stored fingerprint ───────────────────────────────────────

export function regenerateFingerprint(
  db: Database.Database,
  profileId: string,
  browserType: BrowserType
): Fingerprint {
  const newFp = generateDefaultFingerprint(browserType)

  db.prepare(`
    UPDATE fingerprints SET
      user_agent = ?, platform = ?, hardware_concurrency = ?, device_memory = ?,
      languages = ?, screen_width = ?, screen_height = ?, color_depth = ?,
      pixel_ratio = ?, timezone = ?, canvas_noise_seed = ?, webgl_vendor = ?,
      webgl_renderer = ?, audio_context_noise = ?, fonts_list = ?,
      webrtc_policy = ?, video_inputs = ?, audio_inputs = ?, audio_outputs = ?
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
    profileId
  )

  return db.prepare('SELECT * FROM fingerprints WHERE profile_id = ?').get(profileId) as Fingerprint
}
