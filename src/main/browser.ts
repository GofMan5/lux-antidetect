import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, unlinkSync, chmodSync } from 'fs'
import { join } from 'path'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { request as httpRequest } from 'http'
import { randomBytes } from 'crypto'
import type Database from 'better-sqlite3'
import type { BrowserType, Fingerprint, Profile, Proxy } from './models'
import {
  applyProxyGeoToFingerprint as applyProxyGeoToFingerprintImpl,
  buildInjectionScript,
  buildWorkerInjectionScript,
  normalizeFingerprint,
  parseFingerprintLanguages,
  regenerateFingerprint,
  type GeoOverride
} from './fingerprint'
import { addSession, removeSession, getSession, isRunning } from './sessions'
import { getManagedBrowserPath } from './browser-manager'
import { startSocks5Relay, type RelayHandle } from './socks5-relay'

const execFileAsync = promisify(execFile)

const GRACEFUL_BROWSER_CLOSE_TIMEOUT_MS = 8_000


const BROWSER_PATHS: Record<BrowserType, string[]> = {
  chromium: [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ],
  edge: [
    // Windows
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // Linux
    '/usr/bin/microsoft-edge',
    // macOS
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ],
  firefox: [
    // Windows
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe',
    // Linux
    '/usr/bin/firefox',
    '/snap/bin/firefox',
    // macOS
    '/Applications/Firefox.app/Contents/MacOS/firefox'
  ]
}

export function detectBrowsers(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [type, paths] of Object.entries(BROWSER_PATHS)) {
    // Check managed browser first
    const managed = getManagedBrowserPath(type as BrowserType)
    if (managed && existsSync(managed)) {
      result[type] = managed + ' (managed)'
      continue
    }
    for (const p of paths) {
      if (existsSync(p)) {
        result[type] = p
        break
      }
    }
  }
  return result
}

function findBrowserPath(browserType: BrowserType): string {
  // 1. Check managed (downloaded) browsers first
  const managed = getManagedBrowserPath(browserType)
  if (managed && existsSync(managed)) return managed

  // 2. Fallback to system-installed browsers
  const paths = BROWSER_PATHS[browserType]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `Browser not found: ${browserType}. Download it from Settings or install it on your system.`
  )
}

/** Check if Chromium profile dir has an active lock file (browser is running). */
function isChromiumProfileLocked(profileDir: string): boolean {
  const lockPath = join(profileDir, 'lockfile')
  const singletonPath = join(profileDir, 'SingletonLock')
  try {
    if (existsSync(lockPath)) return true
    if (existsSync(singletonPath)) return true
  } catch { /* ignore */ }
  return false
}

/** Check if Firefox profile dir is locked. */
function isFirefoxProfileLocked(profileDir: string): boolean {
  const lockPath = join(profileDir, 'parent.lock')
  try {
    if (existsSync(lockPath)) {
      statSync(lockPath)
      return true
    }
  } catch { /* ignore */ }
  return false
}

/** Check if a browser profile directory is actively in use. */
function isBrowserProfileActive(profileDir: string, isFirefox: boolean): boolean {
  if (isFirefox) return isFirefoxProfileLocked(profileDir)
  return isChromiumProfileLocked(profileDir)
}

/** Find PIDs of processes whose command line includes the given profile directory. (ASYNC) */
async function findBrowserPidsByProfileDir(profileDir: string): Promise<number[]> {
  // Try PowerShell first (reliable), fall back to WMIC
  try {
    // Escape PowerShell special characters in the profile path to prevent injection.
    // Backtick-escape: ` $ " ' and also replace single quotes for -like pattern safety.
    const psEscapedDir = profileDir
      .replace(/`/g, '``')
      .replace(/\$/g, '`$')
      .replace(/"/g, '`"')
      .replace(/'/g, "''")
    const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${psEscapedDir}*' } | Select-Object -ExpandProperty ProcessId`
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', psCmd], {
      timeout: 8000,
      windowsHide: true
    })
    const pids: number[] = []
    for (const line of stdout.trim().split(/\r?\n/)) {
      const pid = parseInt(line.trim(), 10)
      if (pid > 0) pids.push(pid)
    }
    if (pids.length > 0) return pids
  } catch { /* fall through to WMIC */ }

  // Fallback: WMIC (deprecated but still works on most Windows)
  try {
    const wmicDir = profileDir.replace(/\\/g, '\\\\')
    const { stdout } = await execFileAsync(
      'wmic',
      ['process', 'where', `CommandLine like '%${wmicDir}%'`, 'get', 'ProcessId', '/format:list'],
      { timeout: 5000, windowsHide: true }
    )
    const pids: number[] = []
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/ProcessId=(\d+)/)
      if (match) {
        const pid = parseInt(match[1], 10)
        if (pid > 0) pids.push(pid)
      }
    }
    return pids
  } catch {
    return []
  }
}

/** Kill a single PID tree (async). */
async function killPid(pid: number, force = true): Promise<void> {
  try {
    const args = force ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T']
    await execFileAsync('taskkill', args, {
      timeout: 5000,
      windowsHide: true
    })
  } catch {
    // Process may have already exited
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForBrowserExit(profileDir: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if ((await findBrowserPidsByProfileDir(profileDir)).length === 0) return true
    await sleep(300)
  }
  return (await findBrowserPidsByProfileDir(profileDir)).length === 0
}

/** Kill all processes associated with a browser profile directory. (ASYNC) */
async function killBrowserByProfileDir(profileDir: string): Promise<void> {
  const pids = await findBrowserPidsByProfileDir(profileDir)
  await Promise.all(pids.map((pid) => killPid(pid)))

  // Second pass: if PIDs were found but processes are sticky, try again
  if (pids.length > 0) {
    const remaining = await findBrowserPidsByProfileDir(profileDir)
    await Promise.all(remaining.map((pid) => killPid(pid)))
  }
}

async function closeBrowserViaCDP(port: number): Promise<void> {
  try {
    await cdpBrowserCommand(port, 'Browser.close', {})
  } catch {
    // Browser.close often closes the socket before a response frame arrives.
  }
}

/**
 * Close a profile browser in a data-preserving way. Chromium gets a CDP
 * Browser.close first so Cookies/Local Storage/IndexedDB LevelDB state is
 * flushed. If CDP is not available (or Firefox), ask Windows to close the
 * process tree without /F before falling back to force kill.
 */
async function closeBrowserByProfileDir(
  profileDir: string,
  cdpPort?: number
): Promise<void> {
  if (cdpPort) {
    await closeBrowserViaCDP(cdpPort)
    if (await waitForBrowserExit(profileDir, GRACEFUL_BROWSER_CLOSE_TIMEOUT_MS)) return
  }

  const pids = await findBrowserPidsByProfileDir(profileDir)
  if (pids.length > 0) {
    await Promise.all(pids.map((pid) => killPid(pid, false)))
    if (await waitForBrowserExit(profileDir, GRACEFUL_BROWSER_CLOSE_TIMEOUT_MS)) return
  }

  await killBrowserByProfileDir(profileDir)
}


// ─── Chrome profile identity (name + avatar in profile switcher UI) ──────
// Chrome displays a per-profile name and avatar in the top-right profile
// switcher. When launched with --user-data-dir, Chrome creates a "Default"
// profile on first run and uses generic "Person 1" + default avatar. We
// pre-populate `Local State` and `Default/Preferences` so each of our
// profiles shows its own name and a stable pseudo-random built-in avatar.

const CHROME_BUILTIN_AVATAR_COUNT = 26 // IDR_PROFILE_AVATAR_0..25 (stable across Chrome versions)

function avatarIndexForProfile(profileId: string): number {
  let hash = 0
  for (let i = 0; i < profileId.length; i++) {
    hash = ((hash << 5) - hash) + profileId.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % CHROME_BUILTIN_AVATAR_COUNT
}

type JsonObject = Record<string, unknown>

/** Read a JSON file, tolerate corruption by returning {}. */
function readJsonSafe(path: string): JsonObject {
  try {
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as JsonObject) : {}
  } catch {
    return {}
  }
}

/** Get or create a nested object child on `obj[key]`, returning it. */
function ensureObject(obj: JsonObject, key: string): JsonObject {
  const existing = obj[key]
  if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    return existing as JsonObject
  }
  const fresh: JsonObject = {}
  obj[key] = fresh
  return fresh
}

/**
 * Write Chromium `Local State` and `Default/Preferences` so the profile
 * switcher shows the profile's name and a unique avatar. Idempotent:
 * updates only the identity fields and preserves any other keys Chrome
 * may have added on previous runs.
 */
function updateChromeProfileIdentity(
  profileDir: string,
  profileName: string,
  avatarIndex: number
): void {
  const localStatePath = join(profileDir, 'Local State')
  const defaultDir = join(profileDir, 'Default')
  const preferencesPath = join(defaultDir, 'Preferences')

  mkdirSync(defaultDir, { recursive: true })

  const avatarIcon = `chrome://theme/IDR_PROFILE_AVATAR_${avatarIndex}`

  // Local State — drives the profile switcher in the top-right.
  const localState = readJsonSafe(localStatePath)
  const profileSection = ensureObject(localState, 'profile')
  const infoCache = ensureObject(profileSection, 'info_cache')
  const defaultEntry = ensureObject(infoCache, 'Default')
  defaultEntry.name = profileName
  defaultEntry.shortcut_name = profileName
  defaultEntry.avatar_icon = avatarIcon
  defaultEntry.is_using_default_name = false
  defaultEntry.is_using_default_avatar = false
  if (defaultEntry.gaia_name === undefined) defaultEntry.gaia_name = ''
  if (defaultEntry.gaia_given_name === undefined) defaultEntry.gaia_given_name = ''
  if (defaultEntry.gaia_id === undefined) defaultEntry.gaia_id = ''
  if (defaultEntry.user_name === undefined) defaultEntry.user_name = ''
  if (defaultEntry.managed_user_id === undefined) defaultEntry.managed_user_id = ''
  if (defaultEntry.active_time === undefined) defaultEntry.active_time = Date.now() / 1000
  if (profileSection.last_used === undefined) profileSection.last_used = 'Default'

  try {
    writeFileSync(localStatePath, JSON.stringify(localState), { mode: 0o600 })
  } catch { /* directory may not be writable yet — Chrome will recreate */ }

  // Default/Preferences — source of truth for the "Default" profile itself.
  const preferences = readJsonSafe(preferencesPath)
  const prefProfile = ensureObject(preferences, 'profile')
  prefProfile.name = profileName
  prefProfile.avatar_index = avatarIndex
  if (prefProfile.managed_user_id === undefined) prefProfile.managed_user_id = ''

  try {
    writeFileSync(preferencesPath, JSON.stringify(preferences), { mode: 0o600 })
  } catch { /* Chrome will regenerate on launch */ }
}

/**
 * Walk every profile in the DB and (re)write its Chrome identity files so
 * the profile-switcher avatar + name are guaranteed to be set, including for
 * legacy profiles that were created before the identity feature shipped or
 * for profiles whose Local State was rewritten by Chrome on shutdown.
 *
 * Writes to disk only — no effect on a currently-running Chrome (it holds
 * Local State in memory and overwrites on exit), but guarantees the avatar
 * and name are present on the next launch of every profile.
 */
export function refreshAllProfileIdentities(
  db: Database.Database,
  profilesDir: string
): void {
  let rows: { id: string; name: string; browser_type: BrowserType }[]
  try {
    rows = db.prepare('SELECT id, name, browser_type FROM profiles').all() as typeof rows
  } catch {
    return
  }
  for (const row of rows) {
    if (row.browser_type === 'firefox') continue
    const profileDir = join(profilesDir, row.id)
    if (!existsSync(profileDir)) continue
    try {
      updateChromeProfileIdentity(profileDir, row.name, avatarIndexForProfile(row.id))
    } catch {
      /* best effort — Chrome will still recreate identity on next launch */
    }
  }
}

/**
 * Auto-translate page content via Chrome's built-in Translate. Writes:
 *   - translate.enabled                — master switch
 *   - translate_recent_target          — preferred target language for the
 *     Translate prompt
 *   - translate_blocked_languages      — never offer to translate FROM these
 *   - translate_whitelists             — auto-translate FROM each common
 *     foreign language TO the target without prompting; this is what makes
 *     the feature feel automatic instead of "click Translate every page"
 *
 * Read more: chromium/src/chrome/browser/translate/translate_pref_names.h
 *
 * Caveat: Translate uses translate.googleapis.com under the hood, so it
 * works on system Chrome / Edge but is best-effort on Chromium-for-testing
 * builds where Google service URLs may be missing.
 */
function applyTranslatePreferences(
  profileDir: string,
  enabled: boolean,
  targetLang: string
): void {
  const defaultDir = join(profileDir, 'Default')
  const preferencesPath = join(defaultDir, 'Preferences')
  mkdirSync(defaultDir, { recursive: true })

  const preferences = readJsonSafe(preferencesPath)
  const translate = ensureObject(preferences, 'translate')

  if (enabled) {
    translate.enabled = true
    preferences.translate_recent_target = targetLang
    preferences.translate_blocked_languages = [targetLang]
    // Auto-translate FROM each common foreign language TO the target without
    // showing the bubble. Covers the languages most users encounter; users
    // can still hit "Show original" in the toolbar to bypass per-page.
    const COMMON_SRC = [
      'en', 'ru', 'es', 'fr', 'de', 'it', 'pt', 'zh', 'zh-CN', 'zh-TW',
      'ja', 'ko', 'tr', 'pl', 'nl', 'ar', 'hi', 'vi', 'th', 'id', 'uk', 'sv', 'cs'
    ]
    const whitelist: Record<string, string> = {}
    for (const lang of COMMON_SRC) {
      if (lang === targetLang) continue
      whitelist[lang] = targetLang
    }
    preferences.translate_whitelists = whitelist
  } else {
    // Soft cleanup so toggling off restores Chrome's default Translate
    // behaviour (offer-only, no auto-translate). Leaves user-curated
    // per-site rules alone.
    translate.enabled = true
    delete preferences.translate_recent_target
    delete preferences.translate_blocked_languages
    delete preferences.translate_whitelists
  }

  try {
    writeFileSync(preferencesPath, JSON.stringify(preferences), { mode: 0o600 })
  } catch { /* Chrome will regenerate on launch */ }
}

function writeProxyAuthExtension(extDir: string, proxy: Proxy): string | null {
  if (!proxy.username || !proxy.password) return null

  const authExtDir = join(extDir, '_proxy_auth')
  mkdirSync(authExtDir, { recursive: true, mode: 0o700 })
  try { chmodSync(authExtDir, 0o700) } catch { /* ignore on Windows */ }

  const manifest = {
    manifest_version: 3,
    name: 'Proxy Auth',
    version: '1.0',
    permissions: ['webRequest', 'webRequestAuthProvider'],
    host_permissions: ['<all_urls>'],
    background: {
      service_worker: 'background.js'
    }
  }

  const background = `
chrome.webRequest.onAuthRequired.addListener(
  function(details, callback) {
    callback({
      authCredentials: {
        username: ${JSON.stringify(proxy.username)},
        password: ${JSON.stringify(proxy.password)}
      }
    });
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking']
);
`

  const manifestPath = join(authExtDir, 'manifest.json')
  const backgroundPath = join(authExtDir, 'background.js')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 })
  writeFileSync(backgroundPath, background, { mode: 0o600 })
  try { chmodSync(manifestPath, 0o600) } catch { /* ignore on Windows */ }
  try { chmodSync(backgroundPath, 0o600) } catch { /* ignore on Windows */ }

  return authExtDir
}

// ─── CDP-based fingerprint injection ─────────────────────────────────
// Chrome 137+ removed --load-extension from branded builds. Use CDP
// (Chrome DevTools Protocol) to inject the fingerprint script via
// Page.addScriptToEvaluateOnNewDocument — this runs before any page
// scripts in the MAIN world and works on all Chrome/Edge versions.

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        res.resume() // drain response
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')) })
    req.end()
  })
}

/** Wait for Chrome's DevToolsActivePort file and return the debugging port. */
async function waitForDebugPort(profileDir: string, timeoutMs = 15000): Promise<number> {
  const portFile = join(profileDir, 'DevToolsActivePort')
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 300))
    try {
      if (!existsSync(portFile)) continue
      const content = readFileSync(portFile, 'utf-8').trim()
      const port = parseInt(content.split(/\r?\n/)[0], 10)
      if (port > 0) return port
    } catch { /* file may still be written */ }
  }
  throw new Error('Timed out waiting for Chrome DevTools port')
}

/** Inject fingerprint script into all current pages via CDP. Returns the target IDs that were processed. */
async function injectViaCDP(port: number, script: string, fp: Fingerprint, geoOverride?: GeoOverride): Promise<string[]> {
  // Get the list of targets
  const targetsRaw = await httpGet(`http://127.0.0.1:${port}/json`)
  const targets = JSON.parse(targetsRaw) as { id: string; type: string }[]

  // For each existing page target, inject via HTTP endpoint
  const pageTargets = targets.filter((t) => t.type === 'page')
  const processed: string[] = []

  for (const target of pageTargets) {
    try {
      // Enable Page domain (required for addScriptToEvaluateOnNewDocument)
      await cdpCommand(port, target.id, 'Page.enable', {})
      await applyCdpFingerprintOverrides(port, target.id, fp, geoOverride)
      // Inject for all future navigations in this target
      await cdpCommand(port, target.id, 'Page.addScriptToEvaluateOnNewDocument', {
        source: script,
        runImmediately: true
      })
      // Also inject into the current page right now
      await cdpCommand(port, target.id, 'Runtime.evaluate', {
        expression: script,
        allowUnsafeEvalBlockedByCSP: true
      })
      processed.push(target.id)
    } catch { /* target may have closed */ }
  }

  return processed
}

/** Send a CDP command via minimal WebSocket (no dependencies, uses Node's http upgrade). */
async function cdpCommandAtPath(port: number, path: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64')
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key
      }
    })

    let resolved = false
    const finish = (err: Error | null, result?: unknown): void => {
      if (resolved) return
      resolved = true
      if (err) reject(err)
      else resolve(result)
    }

    req.on('upgrade', (_res, socket) => {
      const payload = JSON.stringify({ id: 1, method, params })
      // Send WebSocket text frame
      const buf = Buffer.from(payload, 'utf-8')
      const mask = randomBytes(4)
      let header: Buffer
      if (buf.length < 126) {
        header = Buffer.alloc(6)
        header[0] = 0x81 // FIN + text
        header[1] = 0x80 | buf.length // MASK + length
        header[2] = mask[0]; header[3] = mask[1]; header[4] = mask[2]; header[5] = mask[3]
      } else if (buf.length < 65536) {
        header = Buffer.alloc(8)
        header[0] = 0x81
        header[1] = 0x80 | 126
        header.writeUInt16BE(buf.length, 2)
        header[4] = mask[0]; header[5] = mask[1]; header[6] = mask[2]; header[7] = mask[3]
      } else {
        header = Buffer.alloc(14)
        header[0] = 0x81
        header[1] = 0x80 | 127
        header.writeBigUInt64BE(BigInt(buf.length), 2)
        header[10] = mask[0]; header[11] = mask[1]; header[12] = mask[2]; header[13] = mask[3]
      }
      const masked = Buffer.alloc(buf.length)
      for (let i = 0; i < buf.length; i++) masked[i] = buf[i] ^ mask[i % 4]
      socket.write(Buffer.concat([header, masked]))

      // Read response frame(s)
      let accum = Buffer.alloc(0)
      socket.on('data', (chunk: Buffer) => {
        accum = Buffer.concat([accum, chunk])
        while (accum.length >= 2) {
          const payloadLen = accum[1] & 0x7f
          let offset = 2
          let msgLen = payloadLen
          if (payloadLen === 126) {
            if (accum.length < 4) break
            msgLen = accum.readUInt16BE(2)
            offset = 4
          } else if (payloadLen === 127) {
            if (accum.length < 10) break
            msgLen = Number(accum.readBigUInt64BE(2))
            offset = 10
          }
          if (accum.length < offset + msgLen) break
          const msgBuf = accum.subarray(offset, offset + msgLen)
          accum = accum.subarray(offset + msgLen)
          try {
            const msg = JSON.parse(msgBuf.toString('utf-8'))
            if (msg.id === 1) {
              socket.destroy()
              if (msg.error) finish(new Error(msg.error.message))
              else finish(null, msg.result)
              return
            }
          } catch { /* partial frame, wait for more */ }
        }
      })
      socket.on('error', (e: Error) => finish(e))
      socket.on('close', () => finish(new Error('socket closed')))
    })

    req.on('error', (e) => finish(e))
    req.setTimeout(5000, () => { req.destroy(); finish(new Error('CDP timeout')) })
    req.end()
  })
}

async function cdpCommand(port: number, targetId: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return cdpCommandAtPath(port, `/devtools/page/${targetId}`, method, params)
}

async function cdpBrowserCommand(port: number, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const versionRaw = await httpGet(`http://127.0.0.1:${port}/json/version`)
  const versionInfo = JSON.parse(versionRaw) as { webSocketDebuggerUrl?: string }
  if (!versionInfo.webSocketDebuggerUrl) throw new Error('WebSocket debugger URL not available')
  const wsPath = new URL(versionInfo.webSocketDebuggerUrl).pathname
  return cdpCommandAtPath(port, wsPath, method, params)
}

function getFingerprintLocale(fp: Fingerprint): { languages: string[]; primaryLanguage: string } {
  const languages = parseFingerprintLanguages(fp.languages, fp.timezone)
  return {
    languages,
    primaryLanguage: languages[0] || 'en-US'
  }
}

function getUaPlatformLabel(fp: Fingerprint): string {
  if (fp.device_type === 'mobile' && fp.user_agent.includes('Android')) return 'Android'
  if (fp.platform === 'Win32') return 'Windows'
  if (fp.platform === 'MacIntel') return 'macOS'
  return 'Linux'
}

function buildUserAgentMetadata(fp: Fingerprint): Record<string, unknown> {
  const fullVersion = fp.user_agent.match(/Chrome\/([\d.]+)/)?.[1] ?? '120.0.0.0'
  const major = Number.parseInt(fullVersion.split('.')[0] ?? '120', 10) || 120
  const notBrandPool = ['Not_A Brand', 'Not/A)Brand', 'Not)A;Brand', 'Not A;Brand']
  const notBrand = notBrandPool[major % notBrandPool.length]
  const platform = getUaPlatformLabel(fp)
  const isWindows = fp.platform === 'Win32'
  const isMac = fp.platform === 'MacIntel'
  const isMobile = fp.device_type === 'mobile'

  return {
    brands: [
      { brand: 'Google Chrome', version: String(major) },
      { brand: 'Chromium', version: String(major) },
      { brand: notBrand, version: '24' }
    ],
    fullVersionList: [
      { brand: 'Google Chrome', version: fullVersion },
      { brand: 'Chromium', version: fullVersion },
      { brand: notBrand, version: '24.0.0.0' }
    ],
    fullVersion,
    platform,
    platformVersion: isWindows
      ? fp.canvas_noise_seed % 4 === 0
        ? '15.0.0'
        : '10.0.0'
      : isMac
        ? '14.5.0'
        : isMobile
          ? '14.0.0'
          : '6.5.0',
    architecture: isMobile ? 'arm' : 'x86',
    model: isMobile ? fp.user_agent.match(/Android[^;]*;\s*([^)]+)\)/)?.[1]?.trim() ?? '' : '',
    mobile: isMobile,
    bitness: '64',
    wow64: false,
    formFactors: isMobile ? ['Mobile'] : ['Desktop']
  }
}

async function applyCdpFingerprintOverrides(
  port: number,
  targetId: string,
  fp: Fingerprint,
  geoOverride?: GeoOverride
): Promise<void> {
  const { languages, primaryLanguage } = getFingerprintLocale(fp)

  const ops: Promise<unknown>[] = [
    cdpCommand(port, targetId, 'Emulation.setUserAgentOverride', {
      userAgent: fp.user_agent,
      acceptLanguage: languages.join(','),
      platform: fp.platform,
      userAgentMetadata: buildUserAgentMetadata(fp)
    }),
    cdpCommand(port, targetId, 'Emulation.setTimezoneOverride', {
      timezoneId: fp.timezone
    }),
    cdpCommand(port, targetId, 'Emulation.setLocaleOverride', {
      locale: primaryLanguage
    })
  ]
  if (geoOverride) {
    // Native CDP override — hits even in code paths that bypass the JS
    // hook (Chrome's internal geolocation requests). The JS hook in the
    // injection script is a parallel defense for direct API calls.
    ops.push(cdpCommand(port, targetId, 'Emulation.setGeolocationOverride', {
      latitude: geoOverride.latitude,
      longitude: geoOverride.longitude,
      accuracy: geoOverride.accuracy
    }))
  }

  await Promise.allSettled(ops)
}

/** Background task: continuously ensure CDP injection is active for all pages of this profile. */
function startCDPInjection(
  profileId: string,
  profileDir: string,
  script: string,
  workerScript: string,
  fp: Fingerprint,
  proxyCredentials?: { username: string; password: string },
  geoOverride?: GeoOverride
): { stop: () => void } {
  let stopped = false
  let port = 0
  const injectedTargets = new Set<string>()
  const injectingTargets = new Set<string>()
  const authListeners = new Map<string, { stop: () => void }>()

  function attachAuthListener(targetId: string): void {
    if (!proxyCredentials || authListeners.has(targetId)) return
    const listener = startProxyAuthListener(port, targetId, proxyCredentials, () => stopped)
    authListeners.set(targetId, listener)
  }

  async function injectTarget(targetId: string): Promise<void> {
    if (injectedTargets.has(targetId) || injectingTargets.has(targetId)) return
    injectingTargets.add(targetId)
    // Attach auth listener BEFORE any navigation-triggering command so the
    // listener is live when the first page request hits the proxy.
    attachAuthListener(targetId)
    try {
      await cdpCommand(port, targetId, 'Page.enable', {})
      await applyCdpFingerprintOverrides(port, targetId, fp, geoOverride)
      await cdpCommand(port, targetId, 'Page.addScriptToEvaluateOnNewDocument', {
        source: script,
        runImmediately: true
      })
      await cdpCommand(port, targetId, 'Runtime.evaluate', {
        expression: script,
        allowUnsafeEvalBlockedByCSP: true
      })
      injectedTargets.add(targetId)
    } catch { /* target may have been destroyed */ }
    finally {
      injectingTargets.delete(targetId)
    }
  }

  const run = async (): Promise<void> => {
    try {
      port = await waitForDebugPort(profileDir)
      // Store CDP port on the active browser for cookie management etc.
      const ab = activeBrowsers.get(profileId)
      if (ab) ab.cdpPort = port
    } catch {
      return // browser may have been closed before debug port appeared
    }

    // Initial setup for existing tabs: attach proxy auth listeners FIRST
    // (cheap, non-blocking socket open) so the first request hitting
    // --proxy-server gets authed, THEN do the heavier fingerprint injection.
    try {
      const targetsRaw = await httpGet(`http://127.0.0.1:${port}/json`)
      const targets = JSON.parse(targetsRaw) as { id: string; type: string }[]
      for (const t of targets) {
        if (t.type === 'page') {
          attachAuthListener(t.id)
        }
      }
      const processedTargets = await injectViaCDP(port, script, fp, geoOverride)
      for (const targetId of processedTargets) injectedTargets.add(targetId)
    } catch { /* best effort */ }

    // Use browser-level WebSocket to listen for new targets in real-time.
    // This avoids the 2-second polling gap where new tabs are unprotected.
    try {
      const versionRaw = await httpGet(`http://127.0.0.1:${port}/json/version`)
      const versionInfo = JSON.parse(versionRaw) as { webSocketDebuggerUrl?: string }
      const wsUrl = versionInfo.webSocketDebuggerUrl
      if (wsUrl) {
        // Extract path from ws://127.0.0.1:PORT/devtools/browser/UUID
        const wsPath = new URL(wsUrl).pathname
        startBrowserWsListener(port, wsPath, script, workerScript, fp, geoOverride, injectedTargets, injectTarget, () => stopped)
      }
    } catch { /* fall back to polling */ }

    // Fallback polling for new tabs (in case WS listener fails/disconnects)
    const pollNewTabs = async (): Promise<void> => {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, 3000))
        if (stopped) break
        try {
          const targetsRaw = await httpGet(`http://127.0.0.1:${port}/json`)
          const targets = JSON.parse(targetsRaw) as { id: string; type: string }[]
          for (const t of targets) {
            if (t.type === 'page' && !injectedTargets.has(t.id)) {
              await injectTarget(t.id)
            }
          }
        } catch {
          break
        }
      }
    }

    pollNewTabs().catch(() => {})
  }

  run().catch(() => {})

  return {
    stop: () => {
      stopped = true
      for (const listener of authListeners.values()) {
        try { listener.stop() } catch { /* ignore */ }
      }
      authListeners.clear()
    }
  }
}

/**
 * Open a persistent WebSocket to the browser endpoint, listen for new
 * targets, and inject the worker spoof into Worker / SharedWorker /
 * ServiceWorker targets via CDP `Target.setAutoAttach` (flatten mode).
 *
 * Without this, `new Worker(blob)` opens a fresh `WorkerGlobalScope` with
 * native `navigator.userAgent` etc. — CreepJS exploits this directly,
 * which would flag the profile as automation. Page targets keep the
 * existing per-target WS injection path.
 */
function startBrowserWsListener(
  port: number,
  wsPath: string,
  mainScript: string,
  workerScript: string,
  fp: Fingerprint,
  geoOverride: GeoOverride | undefined,
  injectedTargets: Set<string>,
  injectTarget: (targetId: string) => Promise<void>,
  isStopped: () => boolean
): void {
  const { languages, primaryLanguage } = getFingerprintLocale(fp)
  const userAgentMetadata = buildUserAgentMetadata(fp)
  const key = randomBytes(16).toString('base64')
  const req = httpRequest({
    hostname: '127.0.0.1',
    port,
    path: wsPath,
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key
    }
  })

  req.on('upgrade', (_res, socket) => {
    let msgId = 1
    // Dedup attached sessions — `Target.attachedToTarget` can fire twice on
    // reconnect / target reuse and we don't want to inject the spoof twice
    // (idempotent in theory but doubles overhead).
    const attachedSessions = new Set<string>()

    function sendWsMsg(method: string, params: Record<string, unknown> = {}, sessionId?: string): void {
      const frame = sessionId
        ? { sessionId, id: msgId++, method, params }
        : { id: msgId++, method, params }
      const payload = JSON.stringify(frame)
      const buf = Buffer.from(payload, 'utf-8')
      const mask = randomBytes(4)
      let header: Buffer
      if (buf.length < 126) {
        header = Buffer.alloc(6)
        header[0] = 0x81
        header[1] = 0x80 | buf.length
        header[2] = mask[0]; header[3] = mask[1]; header[4] = mask[2]; header[5] = mask[3]
      } else if (buf.length < 65536) {
        header = Buffer.alloc(8)
        header[0] = 0x81
        header[1] = 0x80 | 126
        header.writeUInt16BE(buf.length, 2)
        header[4] = mask[0]; header[5] = mask[1]; header[6] = mask[2]; header[7] = mask[3]
      } else {
        header = Buffer.alloc(14)
        header[0] = 0x81
        header[1] = 0x80 | 127
        header.writeBigUInt64BE(BigInt(buf.length), 2)
        header[10] = mask[0]; header[11] = mask[1]; header[12] = mask[2]; header[13] = mask[3]
      }
      const masked = Buffer.alloc(buf.length)
      for (let i = 0; i < buf.length; i++) masked[i] = buf[i] ^ mask[i % 4]
      try { socket.write(Buffer.concat([header, masked])) } catch { /* socket closed */ }
    }

    // Subscribe to target discovery (existing path: page targetCreated → injectTarget).
    sendWsMsg('Target.setDiscoverTargets', { discover: true })

    // Auto-attach all child targets (workers, iframes) with a debugger pause
    // so we can inject the spoof BEFORE any user code runs. flatten=true
    // routes child-session messages on this same WebSocket via `sessionId`.
    sendWsMsg('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })

    // Read frames from browser WebSocket
    let accum = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      if (isStopped()) { socket.destroy(); return }
      accum = Buffer.concat([accum, chunk])

      // Try to parse complete frames
      while (accum.length >= 2) {
        const payloadLen = accum[1] & 0x7f
        let offset = 2
        let msgLen = payloadLen
        if (payloadLen === 126) {
          if (accum.length < 4) break
          msgLen = accum.readUInt16BE(2)
          offset = 4
        } else if (payloadLen === 127) {
          if (accum.length < 10) break
          msgLen = Number(accum.readBigUInt64BE(2))
          offset = 10
        }
        if (accum.length < offset + msgLen) break

        const msgBuf = accum.subarray(offset, offset + msgLen)
        accum = accum.subarray(offset + msgLen)

        try {
          const msg = JSON.parse(msgBuf.toString('utf-8'))
          if (msg.method === 'Target.targetCreated') {
            const info = msg.params?.targetInfo
            if (info && info.type === 'page' && !injectedTargets.has(info.targetId)) {
              injectTarget(info.targetId).catch(() => {})
            }
          } else if (msg.method === 'Target.attachedToTarget') {
            const sessionId: string | undefined = msg.params?.sessionId
            const type: string | undefined = msg.params?.targetInfo?.type
            if (!sessionId || attachedSessions.has(sessionId)) continue
            attachedSessions.add(sessionId)
            if (type === 'worker' || type === 'shared_worker' || type === 'service_worker') {
              // Inject spoof into the worker before its code runs, then resume.
              // CDP commands are FIFO per-session, so the evaluate completes
              // before runIfWaitingForDebugger releases the debugger pause.
              sendWsMsg('Runtime.evaluate', { expression: workerScript }, sessionId)
              sendWsMsg('Runtime.runIfWaitingForDebugger', {}, sessionId)
            } else {
              // For page / iframe / tab / other child targets the existing
              // per-target injection path runs the main-world spoof. Cascade
              // auto-attach into the page session so workers spawned from
              // sub-frames also reach this listener — browser-level
              // setAutoAttach only catches top-level children.
              if (type === 'page' || type === 'iframe' || type === 'tab') {
                sendWsMsg('Target.setAutoAttach', {
                  autoAttach: true,
                  waitForDebuggerOnStart: true,
                  flatten: true
                }, sessionId)
              }
              // Cross-origin iframes are out-of-process (OOPIF) — they own a
              // separate V8 context that does NOT inherit the parent page's
              // `Page.addScriptToEvaluateOnNewDocument`. CreepJS / FingerprintJS
              // embed cross-origin iframes specifically to read native canvas /
              // WebGL / AudioContext from a clean realm. Inject the main-world
              // spoof on the iframe session so canvas / WebGL / audio hooks run
              // inside the OOPIF too.
              //
              // We rely on `runImmediately:true` alone (no `Runtime.evaluate`
              // follow-up): if both fired, the IIFE would run twice in the
              // iframe — the second pass captures the wrapped getImageData /
              // getParameter / getBattery as "originals" and wraps them again,
              // double-noising canvas pixels and freshly allocating
              // `_toStringMap`, which would orphan first-pass cloak entries.
              // The script also self-guards via a `__lux_injected__` sentinel
              // so any future double-evaluate is a no-op.
              //
              // Pages keep per-target WS injection (`injectTarget`) — they're
              // skipped here for the same reason.
              if (type === 'iframe') {
                sendWsMsg('Page.enable', {}, sessionId)
                sendWsMsg('Emulation.setUserAgentOverride', {
                  userAgent: fp.user_agent,
                  acceptLanguage: languages.join(','),
                  platform: fp.platform,
                  userAgentMetadata
                }, sessionId)
                sendWsMsg('Emulation.setTimezoneOverride', {
                  timezoneId: fp.timezone
                }, sessionId)
                sendWsMsg('Emulation.setLocaleOverride', {
                  locale: primaryLanguage
                }, sessionId)
                if (geoOverride) {
                  sendWsMsg('Emulation.setGeolocationOverride', {
                    latitude: geoOverride.latitude,
                    longitude: geoOverride.longitude,
                    accuracy: geoOverride.accuracy
                  }, sessionId)
                }
                sendWsMsg('Page.addScriptToEvaluateOnNewDocument', {
                  source: mainScript,
                  runImmediately: true
                }, sessionId)
              }
              sendWsMsg('Runtime.runIfWaitingForDebugger', {}, sessionId)
            }
          }
        } catch { /* partial/invalid JSON */ }
      }
    })

    socket.on('error', () => { /* silently close */ })
    socket.on('close', () => { /* browser closed or WS dropped */ })
  })

  req.on('error', () => { /* can't connect, polling fallback is active */ })
  req.setTimeout(5000, () => { req.destroy() })
  req.end()
}

/**
 * Open a persistent WebSocket to a single page target and handle proxy auth
 * via Fetch.authRequired. This replaces the `--load-extension` based proxy
 * auth handler that Chrome 137+ no longer supports in branded builds.
 *
 * Enabling Fetch with `handleAuthRequests: true` and no patterns intercepts
 * only auth challenges — request flow is untouched, so regular traffic is
 * unaffected. When an auth challenge arrives we reply with the stored
 * credentials, which matches how Puppeteer/Playwright implement proxy auth.
 */
function startProxyAuthListener(
  port: number,
  targetId: string,
  credentials: { username: string; password: string },
  isStopped: () => boolean
): { stop: () => void } {
  let socketRef: import('net').Socket | null = null
  let stopped = false

  const key = randomBytes(16).toString('base64')
  const req = httpRequest({
    hostname: '127.0.0.1',
    port,
    path: `/devtools/page/${targetId}`,
    headers: {
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key
    }
  })

  req.on('upgrade', (_res, socket) => {
    socketRef = socket
    let msgId = 1

    function sendWsMsg(method: string, params: Record<string, unknown> = {}): void {
      const payload = JSON.stringify({ id: msgId++, method, params })
      const buf = Buffer.from(payload, 'utf-8')
      const mask = randomBytes(4)
      let header: Buffer
      if (buf.length < 126) {
        header = Buffer.alloc(6)
        header[0] = 0x81
        header[1] = 0x80 | buf.length
        header[2] = mask[0]; header[3] = mask[1]; header[4] = mask[2]; header[5] = mask[3]
      } else if (buf.length < 65536) {
        header = Buffer.alloc(8)
        header[0] = 0x81
        header[1] = 0x80 | 126
        header.writeUInt16BE(buf.length, 2)
        header[4] = mask[0]; header[5] = mask[1]; header[6] = mask[2]; header[7] = mask[3]
      } else {
        header = Buffer.alloc(14)
        header[0] = 0x81
        header[1] = 0x80 | 127
        header.writeBigUInt64BE(BigInt(buf.length), 2)
        header[10] = mask[0]; header[11] = mask[1]; header[12] = mask[2]; header[13] = mask[3]
      }
      const masked = Buffer.alloc(buf.length)
      for (let i = 0; i < buf.length; i++) masked[i] = buf[i] ^ mask[i % 4]
      try { socket.write(Buffer.concat([header, masked])) } catch { /* socket closed */ }
    }

    // Auth-only interception. No `patterns` => regular requests are NOT
    // paused. Only `Fetch.authRequired` fires on 407/401 challenges.
    sendWsMsg('Fetch.enable', { handleAuthRequests: true })

    let accum = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      if (stopped || isStopped()) { socket.destroy(); return }
      accum = Buffer.concat([accum, chunk])

      while (accum.length >= 2) {
        const payloadLen = accum[1] & 0x7f
        let offset = 2
        let msgLen = payloadLen
        if (payloadLen === 126) {
          if (accum.length < 4) break
          msgLen = accum.readUInt16BE(2)
          offset = 4
        } else if (payloadLen === 127) {
          if (accum.length < 10) break
          msgLen = Number(accum.readBigUInt64BE(2))
          offset = 10
        }
        if (accum.length < offset + msgLen) break

        const msgBuf = accum.subarray(offset, offset + msgLen)
        accum = accum.subarray(offset + msgLen)

        try {
          const msg = JSON.parse(msgBuf.toString('utf-8'))
          if (msg.method === 'Fetch.authRequired' && msg.params?.requestId) {
            sendWsMsg('Fetch.continueWithAuth', {
              requestId: msg.params.requestId,
              authChallengeResponse: {
                response: 'ProvideCredentials',
                username: credentials.username,
                password: credentials.password
              }
            })
          } else if (msg.method === 'Fetch.requestPaused' && msg.params?.requestId) {
            // Shouldn't happen without `patterns`, but continue defensively
            // so a request never hangs if Chrome fires an unexpected pause.
            sendWsMsg('Fetch.continueRequest', { requestId: msg.params.requestId })
          }
        } catch { /* partial/invalid JSON */ }
      }
    })

    socket.on('error', () => { stopped = true })
    socket.on('close', () => { stopped = true })
  })

  req.on('error', () => { stopped = true })
  req.setTimeout(5000, () => { req.destroy() })
  req.end()

  return {
    stop: () => {
      stopped = true
      if (socketRef) {
        try { socketRef.destroy() } catch { /* already closed */ }
      }
    }
  }
}

// Track CDP injection handles so we can stop them when the browser stops
const cdpInjectors = new Map<string, { stop: () => void }>()

// Track local SOCKS5 relays used to proxy auth-required SOCKS upstreams
// (Chromium discards user/pass for SOCKS schemes — see socks5-relay.ts).
const socksRelays = new Map<string, RelayHandle>()

// Profiles whose launch is in flight. Prevents a double-click on the
// "Launch" button (or two parallel bulk-launch entries) from spawning
// two browser processes for the same profile, which would orphan the
// first one's CDP port + relay + injector.
const pendingLaunches = new Set<string>()

/**
 * Override fingerprint timezone + primary language to match the proxy's
 * known geo. Returns a new object — does NOT mutate the persisted
 * fingerprint, since profile identity must stay stable in the DB.
 *
 * Falls back to the fingerprint's own values when the proxy has no geo
 * (e.g., user just added the proxy and geoip lookup hasn't run yet).
 */
// Re-export shim — the implementation moved to fingerprint.ts so both
// browser launch (this module) and profile updates (profile.ts) can apply
// proxy-derived geo without crossing the browser→profile import line.
function applyProxyGeoToFingerprint(fp: Fingerprint, proxy: Proxy | undefined): Fingerprint {
  return applyProxyGeoToFingerprintImpl(fp, proxy)
}

function stopSocksRelay(profileId: string): void {
  const relay = socksRelays.get(profileId)
  if (!relay) return
  socksRelays.delete(profileId)
  relay.stop().catch(() => { /* best effort */ })
}

interface FirefoxProxyConfig {
  protocol: string
  host: string
  port: number
  username?: string | null
}

function writeFirefoxUserJs(
  profileDir: string,
  fp: Fingerprint,
  proxy?: FirefoxProxyConfig
): void {
  const lines: string[] = []
  const { languages, primaryLanguage } = getFingerprintLocale(fp)

  lines.push(`user_pref("general.useragent.override", ${JSON.stringify(fp.user_agent)});`)
  lines.push(`user_pref("intl.accept_languages", ${JSON.stringify(languages.join(','))});`)
  lines.push(`user_pref("intl.locale.requested", ${JSON.stringify(primaryLanguage)});`)
  lines.push(`user_pref("intl.regional_prefs.use_os_locales", false);`)
  lines.push(`user_pref("intl.timezone.override", ${JSON.stringify(fp.timezone)});`)
  lines.push(`user_pref("privacy.resistFingerprinting", false);`)

  if (proxy) {
    lines.push(`user_pref("network.proxy.type", 1);`)
    if (proxy.protocol === 'socks4' || proxy.protocol === 'socks5') {
      lines.push(`user_pref("network.proxy.socks", ${JSON.stringify(proxy.host)});`)
      lines.push(`user_pref("network.proxy.socks_port", ${proxy.port});`)
      lines.push(
        `user_pref("network.proxy.socks_version", ${proxy.protocol === 'socks5' ? 5 : 4});`
      )
      lines.push(`user_pref("network.proxy.socks_remote_dns", true);`)
      // SOCKS5 supports authentication via user.js prefs
      if (proxy.protocol === 'socks5' && proxy.username) {
        lines.push(`user_pref("network.proxy.socks_username", ${JSON.stringify(proxy.username)});`)
        lines.push(`user_pref("network.proxy.socks_password", ${JSON.stringify((proxy as { password?: string }).password || '')});`)
      }
    } else {
      lines.push(`user_pref("network.proxy.http", ${JSON.stringify(proxy.host)});`)
      lines.push(`user_pref("network.proxy.http_port", ${proxy.port});`)
      lines.push(`user_pref("network.proxy.ssl", ${JSON.stringify(proxy.host)});`)
      lines.push(`user_pref("network.proxy.ssl_port", ${proxy.port});`)
      // NOTE: HTTP/HTTPS proxy auth cannot be set via user.js prefs in Firefox.
      // Firefox will show a native authentication popup when the proxy requires credentials.
    }
  }

  if (fp.webrtc_policy === 'disable_non_proxied_udp') {
    lines.push(`user_pref("media.peerconnection.ice.default_address_only", true);`)
    lines.push(`user_pref("media.peerconnection.ice.proxy_only", true);`)
  }

  writeFileSync(join(profileDir, 'user.js'), lines.join('\n'), { mode: 0o600 })
  try { chmodSync(join(profileDir, 'user.js'), 0o600) } catch { /* ignore on Windows */ }
}

// ─── Polling-based browser lifecycle tracking ────────────────────────────
// Chrome's launcher process exits immediately on Windows.
// We poll the lock file + process list to detect when the browser actually stops.

const POLL_INTERVAL_MS = 3000

interface ActiveBrowser {
  profileId: string
  profileDir: string
  isFirefox: boolean
  pollTimer: ReturnType<typeof setInterval>
  cdpPort?: number
}

const activeBrowsers = new Map<string, ActiveBrowser>()

function startBrowserPolling(
  profileId: string,
  profileDir: string,
  isFirefox: boolean,
  db: Database.Database,
  mainWindow: Electron.BrowserWindow | null
): void {
  let stabilityChecks = 0
  const graceChecks = 4 // ~12 seconds grace period for browser to start
  let polling = false

  function markStopped(): void {
    clearInterval(pollTimer)
    activeBrowsers.delete(profileId)
    removeSession(profileId, 0)

    // Stop CDP injection polling
    const injector = cdpInjectors.get(profileId)
    if (injector) { injector.stop(); cdpInjectors.delete(profileId) }

    // Stop SOCKS auth relay if one was started for this profile
    stopSocksRelay(profileId)

    try {
      db.prepare(
        `UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run('ready', profileId)
    } catch { /* db may be closed on app exit */ }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:stopped', {
        profile_id: profileId,
        exit_code: 0
      })
    }
  }

  const pollTimer = setInterval(async () => {
    stabilityChecks++
    if (stabilityChecks <= graceChecks) return

    // Skip if previous poll is still running
    if (polling) return
    polling = true

    try {
      // Quick check: if lock file is gone, browser is definitely stopped
      if (!isBrowserProfileActive(profileDir, isFirefox)) {
        markStopped()
        return
      }

      // Check session timeout
      try {
        const timeoutRow = db.prepare("SELECT value FROM settings WHERE key = 'session_timeout_minutes'").get() as { value: string } | undefined
        if (timeoutRow) {
          const timeoutMinutes = JSON.parse(timeoutRow.value)
          if (typeof timeoutMinutes === 'number' && timeoutMinutes > 0) {
            const session = getSession(profileId)
            if (session) {
              const elapsed = (Date.now() - new Date(session.started_at).getTime()) / 60000
              if (elapsed >= timeoutMinutes) {
                const cdpPort = activeBrowsers.get(profileId)?.cdpPort
                await closeBrowserByProfileDir(profileDir, cdpPort)
                markStopped()
                return
              }
            }
          }
        }
      } catch { /* best effort */ }

      // Lock file still exists (can be stale on Windows) — check actual processes
      const pids = await findBrowserPidsByProfileDir(profileDir)
      if (pids.length === 0) {
        markStopped()
      }
    } finally {
      polling = false
    }
  }, POLL_INTERVAL_MS)

  activeBrowsers.set(profileId, { profileId, profileDir, isFirefox, pollTimer })
}

function stopBrowserPolling(profileId: string): void {
  const active = activeBrowsers.get(profileId)
  if (active) {
    clearInterval(active.pollTimer)
    activeBrowsers.delete(profileId)
  }
}

export async function killAllBrowsers(): Promise<void> {
  const kills: Promise<void>[] = []
  const relayStops: Promise<void>[] = []
  for (const [profileId, active] of activeBrowsers) {
    clearInterval(active.pollTimer)
    kills.push(closeBrowserByProfileDir(active.profileDir, active.cdpPort))
    removeSession(profileId, null)
    const injector = cdpInjectors.get(profileId)
    if (injector) injector.stop()
    const relay = socksRelays.get(profileId)
    if (relay) relayStops.push(relay.stop().catch(() => { /* best effort */ }))
  }
  activeBrowsers.clear()
  cdpInjectors.clear()
  socksRelays.clear()
  await Promise.all([...kills, ...relayStops])
}

export function isProfileBrowserActive(profileId: string): boolean {
  return activeBrowsers.has(profileId)
}

/** Return the set of profile IDs that have active browser polling. */
export function getActiveBrowserProfileIds(): Set<string> {
  return new Set(activeBrowsers.keys())
}

// ─── Cookie Management via CDP ───────────────────────────────────────────

export interface CdpCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  size: number
  httpOnly: boolean
  secure: boolean
  session: boolean
  sameSite: string
}

/** Export all cookies from a running browser via CDP. */
export async function exportCookiesCDP(profileId: string): Promise<CdpCookie[]> {
  const ab = activeBrowsers.get(profileId)
  if (!ab || !ab.cdpPort) throw new Error('Browser is not running or CDP port unavailable')

  const targetsRaw = await httpGet(`http://127.0.0.1:${ab.cdpPort}/json`)
  const targets = JSON.parse(targetsRaw) as { id: string; type: string }[]
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No page targets found')

  await cdpCommand(ab.cdpPort, page.id, 'Network.enable', {})
  const result = await cdpCommand(ab.cdpPort, page.id, 'Network.getAllCookies', {}) as { cookies: CdpCookie[] }
  return result.cookies
}

/** Import cookies into a running browser via CDP. */
export async function importCookiesCDP(profileId: string, cookies: CdpCookie[]): Promise<number> {
  const ab = activeBrowsers.get(profileId)
  if (!ab || !ab.cdpPort) throw new Error('Browser is not running or CDP port unavailable')

  const targetsRaw = await httpGet(`http://127.0.0.1:${ab.cdpPort}/json`)
  const targets = JSON.parse(targetsRaw) as { id: string; type: string }[]
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No page targets found')

  await cdpCommand(ab.cdpPort, page.id, 'Network.enable', {})
  let imported = 0
  for (const cookie of cookies) {
    try {
      await cdpCommand(ab.cdpPort, page.id, 'Network.setCookie', {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure ?? false,
        httpOnly: cookie.httpOnly ?? false,
        sameSite: cookie.sameSite || 'Lax',
        expires: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined
      })
      imported++
    } catch { /* skip invalid cookies */ }
  }
  return imported
}

/** Convert Netscape cookie format string to CdpCookie array. */
export function parseNetscapeCookies(text: string): CdpCookie[] {
  const cookies: CdpCookie[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parts = trimmed.split('\t')
    if (parts.length < 7) continue
    cookies.push({
      domain: parts[0],
      path: parts[2],
      secure: parts[3].toUpperCase() === 'TRUE',
      expires: parseInt(parts[4], 10) || 0,
      name: parts[5],
      value: parts[6],
      httpOnly: parts[0].startsWith('#HttpOnly_'),
      size: parts[5].length + parts[6].length,
      session: parseInt(parts[4], 10) === 0,
      sameSite: 'Lax'
    })
  }
  return cookies
}

/** Convert CdpCookie array to Netscape format string. */
export function toNetscapeCookies(cookies: CdpCookie[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# https://curl.se/docs/http-cookies.html', '']
  for (const c of cookies) {
    const httpOnlyPrefix = c.httpOnly ? '#HttpOnly_' : ''
    const domain = httpOnlyPrefix + c.domain
    const flag = c.domain.startsWith('.') ? 'TRUE' : 'FALSE'
    const secure = c.secure ? 'TRUE' : 'FALSE'
    const expires = c.session ? '0' : String(Math.round(c.expires))
    lines.push(`${domain}\t${flag}\t${c.path}\t${secure}\t${expires}\t${c.name}\t${c.value}`)
  }
  return lines.join('\n')
}

// ─── Automation API (CDP connection info) ────────────────────────────────

export interface CdpConnectionInfo {
  port: number
  wsEndpoint: string
  httpEndpoint: string
}

/** Get CDP connection info for a running browser, so external tools (Playwright/Puppeteer) can connect. */
export async function getCdpConnectionInfo(profileId: string): Promise<CdpConnectionInfo> {
  const ab = activeBrowsers.get(profileId)
  if (!ab || !ab.cdpPort) throw new Error('Browser is not running or CDP port unavailable')
  if (ab.isFirefox) throw new Error('CDP automation is only supported for Chromium-based browsers')

  const versionRaw = await httpGet(`http://127.0.0.1:${ab.cdpPort}/json/version`)
  const versionInfo = JSON.parse(versionRaw) as { webSocketDebuggerUrl?: string }
  if (!versionInfo.webSocketDebuggerUrl) throw new Error('WebSocket debugger URL not available')

  return {
    port: ab.cdpPort,
    wsEndpoint: versionInfo.webSocketDebuggerUrl,
    httpEndpoint: `http://127.0.0.1:${ab.cdpPort}`
  }
}

// ─── Open URL in Profile ─────────────────────────────────────────────────
// Chromium/Edge: if the profile is already running and CDP is reachable,
// open a new tab via the /json/new HTTP endpoint (no WS handshake needed).
// Otherwise (profile stopped, Firefox, or CDP unreachable): cold-launch the
// browser with targetUrl, which works for all three browser types and also
// attaches to an existing Firefox instance because Firefox dedupes on
// profile path.

const CDP_PING_TIMEOUT_MS = 1500

/** Open `url` on `http://127.0.0.1:<port>` with a bounded timeout. Returns the status code or rejects on timeout/error. */
function httpOpenUrl(
  port: number,
  path: string,
  method: 'GET' | 'PUT',
  timeoutMs: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, method },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.end()
  })
}

/** Ping /json/version. Returns true iff the endpoint responds with 2xx within the timeout. */
async function isCdpReachable(port: number): Promise<boolean> {
  try {
    const status = await httpOpenUrl(port, '/json/version', 'GET', CDP_PING_TIMEOUT_MS)
    return status >= 200 && status < 300
  } catch {
    return false
  }
}

/**
 * Open a URL inside the running browser for a profile (via CDP) when possible,
 * otherwise cold-launch the browser with the URL as the landing page.
 *
 * CDP path is used only for Chromium/Edge profiles that are currently running
 * AND whose CDP endpoint is reachable. Firefox always goes through launchBrowser.
 */
export async function openUrlInProfile(
  db: Database.Database,
  profileId: string,
  targetUrl: string,
  profilesDir: string,
  mainWindow: Electron.BrowserWindow | null
): Promise<{ opened: 'cdp' | 'launched'; pid?: number }> {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as
    | Profile
    | undefined
  if (!profile) throw new Error(`Profile not found: ${profileId}`)

  const isChromiumFamily =
    profile.browser_type === 'chromium' || profile.browser_type === 'edge'

  if (isChromiumFamily) {
    const active = activeBrowsers.get(profileId)
    const cdpPort = active?.cdpPort
    if (cdpPort) {
      // Chromium's legacy /json/new endpoint accepts PUT and creates a new
      // page target pointing at the given URL. It is simpler than opening a
      // WebSocket to send Target.createTarget and is stable across Chrome
      // versions currently supported by this app.
      if (await isCdpReachable(cdpPort)) {
        const newTabPath = `/json/new?${encodeURIComponent(targetUrl)}`
        try {
          const status = await httpOpenUrl(cdpPort, newTabPath, 'PUT', CDP_PING_TIMEOUT_MS)
          if (status >= 200 && status < 300) {
            return { opened: 'cdp' }
          }
        } catch {
          // fall through to stale teardown + cold-launch
        }
      }

      // Profile is registered as active but CDP is dead (browser crashed,
      // hung, or the /json/new PUT failed). The launchBrowser active-guard
      // will throw "Profile is already running" unless we clear the stale
      // state here. Helpers below are tolerant of missing entries.
      teardownStaleBrowserState(profileId)
    }
  }

  const { pid } = await launchBrowser(db, profileId, profilesDir, mainWindow, {
    targetUrl
  })
  return { opened: 'launched', pid }
}

/**
 * Clear all in-process state that marks `profileId` as active, used when the
 * browser is registered active but CDP is unreachable (stale). Tolerant of
 * double-removal: every underlying helper is a no-op when the entry is gone.
 */
function teardownStaleBrowserState(profileId: string): void {
  stopBrowserPolling(profileId)
  removeSession(profileId, null)
  const injector = cdpInjectors.get(profileId)
  if (injector) { injector.stop(); cdpInjectors.delete(profileId) }
  stopSocksRelay(profileId)
}

/** Capture a screenshot of the active tab via CDP. Returns base64-encoded PNG. */
export async function captureScreenshot(profileId: string): Promise<string> {
  const ab = activeBrowsers.get(profileId)
  if (!ab || !ab.cdpPort) throw new Error('Browser is not running or CDP port unavailable')

  const targetsRaw = await httpGet(`http://127.0.0.1:${ab.cdpPort}/json`)
  const targets = JSON.parse(targetsRaw) as { id: string; type: string }[]
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('No page targets found')

  const result = await cdpCommand(ab.cdpPort, page.id, 'Page.captureScreenshot', {
    format: 'png',
    quality: 80
  }) as { data: string }
  return result.data
}

// ─── Launch / Stop ──────────────────────────────────────────────────────

export async function launchBrowser(
  db: Database.Database,
  profileId: string,
  profilesDir: string,
  mainWindow: Electron.BrowserWindow | null,
  opts?: { targetUrl?: string }
): Promise<{ pid: number }> {
  if (pendingLaunches.has(profileId)) {
    throw new Error('Profile launch already in progress')
  }
  if (isRunning(profileId) || isProfileBrowserActive(profileId)) {
    throw new Error('Profile is already running')
  }
  pendingLaunches.add(profileId)
  try {
    return await launchBrowserInner(db, profileId, profilesDir, mainWindow, opts)
  } finally {
    pendingLaunches.delete(profileId)
  }
}

async function launchBrowserInner(
  db: Database.Database,
  profileId: string,
  profilesDir: string,
  mainWindow: Electron.BrowserWindow | null,
  opts?: { targetUrl?: string }
): Promise<{ pid: number }> {

  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as
    | Profile
    | undefined
  if (!profile) throw new Error(`Profile not found: ${profileId}`)

  const fingerprint = db.prepare('SELECT * FROM fingerprints WHERE profile_id = ?').get(
    profileId
  ) as Fingerprint | undefined
  if (!fingerprint) throw new Error(`Fingerprint not found for profile: ${profileId}`)

  const profileDir = join(profilesDir, profileId)
  const isFirefox = profile.browser_type === 'firefox'

  // Check if another browser is already using this profile dir
  if (isBrowserProfileActive(profileDir, isFirefox)) {
    throw new Error('Browser profile directory is already in use by another process')
  }

  // Set "starting" state
  db.prepare(
    `UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run('starting', profileId)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session:state', { profile_id: profileId, status: 'starting' })
  }

  try {
    // Auto-regenerate fingerprint on each launch (unless disabled)
    const autoRegenRow = db
      .prepare("SELECT value FROM settings WHERE key = 'auto_regenerate_fingerprint'")
      .get() as { value: string } | undefined
    const shouldRegenerate = autoRegenRow ? JSON.parse(autoRegenRow.value) !== false : true
    const baseFp = shouldRegenerate
      ? regenerateFingerprint(db, profileId, profile.browser_type)
      : normalizeFingerprint(fingerprint)

    // Hardware identity lockdown — default ON. Master switch for the JS-side
    // injection (fingerprint.ts section 19) and the Chromium feature-disable
    // flag below. Covers WebAuthn passkeys, Digital Credentials, DBSC,
    // PaymentRequest probes, Topics, and console-probe CDP detection.
    // Browser integrity surfaces used by Microsoft/Azure CAPTCHA (FedCM,
    // WebOTP, Storage Access, Private State Tokens) intentionally stay in
    // Chrome's native shape.
    const lockdownRow = db
      .prepare("SELECT value FROM settings WHERE key = 'hardware_identity_lockdown'")
      .get() as { value: string } | undefined
    const blockWebAuthn = lockdownRow ? JSON.parse(lockdownRow.value) !== false : true

    let proxy: Proxy | undefined
    if (profile.proxy_id) {
      const assignedProxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(profile.proxy_id) as
        | Proxy
        | undefined
      // Proxy rotation: if the assigned proxy belongs to a group, pick a random one from the group
      if (assignedProxy?.group_tag) {
        const { getRandomProxyFromGroup } = await import('./proxy')
        const rotated = getRandomProxyFromGroup(db, assignedProxy.group_tag)
        proxy = rotated ?? assignedProxy
      } else {
        proxy = assignedProxy
      }
    }
    const isSocksProxy = proxy?.protocol === 'socks4' || proxy?.protocol === 'socks5'

    // When the proxy has known geo (from geoip lookup), force the
    // fingerprint's timezone + primary language to match. Anti-bot vendors
    // cross-check `Intl.DateTimeFormat().resolvedOptions().timeZone` against
    // the IP's expected timezone — a mismatch flips match=no even if every
    // other surface is perfect.
    const activeFp = applyProxyGeoToFingerprint(baseFp, proxy)

    // Geolocation override: when the proxy has lat/lon, spoof the
    // navigator.geolocation API + CDP-level Emulation.setGeolocationOverride
    // so a permission-granted site receives coordinates consistent with
    // the proxy IP rather than the real machine.
    const geoOverride: GeoOverride | undefined =
      proxy && typeof proxy.latitude === 'number' && typeof proxy.longitude === 'number'
        ? {
            latitude: proxy.latitude,
            longitude: proxy.longitude,
            accuracy: proxy.accuracy_radius ?? 25_000
          }
        : undefined

    const browserType = profile.browser_type
    const exePath = findBrowserPath(browserType)
    mkdirSync(profileDir, { recursive: true })

    const args: string[] = []
    let injectionScript: string | null = null

    if (isFirefox) {
      args.push('-profile', profileDir, '-no-remote')
      writeFirefoxUserJs(profileDir, activeFp, proxy)
    } else {
      const { primaryLanguage } = getFingerprintLocale(activeFp)

      // Give the browser a per-profile name + avatar so the profile switcher
      // UI (top-right circle) shows a distinct identity per window rather than
      // the generic "Person 1" / default colour.
      updateChromeProfileIdentity(
        profileDir,
        profile.name,
        avatarIndexForProfile(profileId)
      )

      // Auto-translate target language. Both keys are app-wide settings (not
      // per-profile) — the user picks one target globally and it applies to
      // every Chromium profile they launch. Defaults: enabled=false (opt-in),
      // target='en'. Reads + applies before launch so Chrome reads the values
      // when it cold-starts the renderer process.
      const translateEnabledRow = db
        .prepare("SELECT value FROM settings WHERE key = 'translation_enabled'")
        .get() as { value: string } | undefined
      const translateEnabled = translateEnabledRow
        ? JSON.parse(translateEnabledRow.value) === true
        : false
      const translateTargetRow = db
        .prepare("SELECT value FROM settings WHERE key = 'translation_target_lang'")
        .get() as { value: string } | undefined
      const translateTarget =
        translateTargetRow && typeof JSON.parse(translateTargetRow.value) === 'string'
          ? (JSON.parse(translateTargetRow.value) as string)
          : 'en'
      applyTranslatePreferences(profileDir, translateEnabled, translateTarget)

      args.push(`--user-data-dir=${profileDir}`)
      args.push('--no-first-run')
      args.push('--disable-default-apps')
      args.push('--disable-background-networking')
      args.push('--disable-search-engine-choice-screen')
      args.push('--remote-debugging-port=0')
      args.push(`--user-agent=${activeFp.user_agent}`)

      // Hide automation signals: removes `navigator.webdriver` and silences
      // the "Chrome is being controlled by automated test software" infobar
      // that Chromium shows once a CDP client connects to
      // --remote-debugging-port.
      args.push('--disable-blink-features=AutomationControlled')
      args.push('--no-default-browser-check')

      // NOTE: `--test-type=webdriver` was previously added to silence the
      // Chromium 137+ "unsupported command line flag" yellow infobar, but
      // it activates internal test-mode handling that disables CDP
      // `Fetch.authRequired` — the path Lux uses for HTTP/HTTPS proxy auth
      // on Chrome 137+ where `--load-extension` is ignored. Result: HTTP
      // proxies with username/password silently fail to authenticate, no
      // page traffic loads. The infobar is cosmetic; broken proxies are
      // not. Flag stays out until we replace `--host-resolver-rules` with
      // a different DNS-leak-prevention mechanism that isn't on
      // Chromium's bad-flags list.

      // ─── DNS hardening ──────────────────────────────────────────────
      //
      // With ANY proxy (HTTP/HTTPS/SOCKS), force the local resolver to
      // return NOTFOUND for every hostname. Chrome then has no choice
      // but to resolve through the proxy:
      //   - HTTPS via HTTP proxy: CONNECT host:port (proxy resolves)
      //   - HTTP via HTTP proxy:  absolute-form GET (proxy resolves)
      //   - SOCKS5: ATYP=domain (proxy resolves)
      //
      // The previous \`--dns-over-https-mode=off\`-only path for HTTP
      // proxies was insufficient: even with DoH off, Chrome still ran
      // \`prefetchDNS\` / \`HostResolver\` lookups against the system
      // resolver for hover hints, navigation prediction, and
      // \`<link rel=dns-prefetch>\` tags. Each lookup leaked the real
      // client IP to the ISP DNS server with the queried hostname,
      // and ISPs that forward to (or are operated by) Google then
      // gave Google a separate signal — real-IP wanted google.com a
      // moment before the proxy IP fetched it. Result: two distinct
      // IPs visible to Google in the same session.
      //
      // The EXCLUDE list contains every host Chrome must still be able
      // to resolve to reach the proxy itself:
      //   - 127.0.0.1 — SOCKS5 relay binding (and dev-loopback)
      //   - proxy.host — when Chrome connects directly (HTTP/HTTPS, or
      //     SOCKS without auth). Without this, MAP * ~NOTFOUND blocks
      //     the proxy hostname too and every navigation aborts with
      //     ERR_PROXY_CONNECTION_FAILED.
      // Without proxy, leave DoH on automatic for ISP privacy.
      const willUseSocksRelay = !!(proxy && isSocksProxy && proxy.username)
      if (proxy) {
        const excludeHosts = new Set<string>(['127.0.0.1'])
        if (!willUseSocksRelay) excludeHosts.add(proxy.host)
        const rules = ['MAP * ~NOTFOUND', ...[...excludeHosts].map((h) => `EXCLUDE ${h}`)].join(' , ')
        args.push(`--host-resolver-rules=${rules}`)
      } else {
        args.push('--dns-over-https-mode=automatic')
      }

      // ─── Anti-correlation kill-switch ───────────────────────────────
      //
      // Chromium ships several services that may issue requests outside
      // \`--proxy-server\`'s scope or carry information that Google's
      // backend can join with a proxied web session by cookie / device
      // fingerprint. Each of these flags shuts one channel:
      //
      //   --disable-component-update           Component updater (Widevine,
      //                                        Subresource Filter rules, etc.)
      //                                        polls clients2.google.com.
      //   --disable-domain-reliability         Domain Reliability beacons
      //                                        report network failures back
      //                                        to Google with the real IP.
      //   --no-pings                           <a ping="..."> beacons.
      //   --disable-client-side-phishing-detection  Sends visited URLs to
      //                                        Google's classifier.
      //   --safebrowsing-disable-auto-update   Prevents SafeBrowsing model
      //                                        / list refresh which goes
      //                                        through proxy but generates
      //                                        a known-Chrome traffic shape.
      //
      // These are unconditional (not gated by hardware-identity lockdown)
      // because they are core IP-leak prevention, not optional identity
      // hardening. \`--disable-background-networking\` (set above) covers
      // some overlap but doesn't shut all of these.
      args.push('--disable-component-update')
      args.push('--disable-domain-reliability')
      args.push('--no-pings')
      args.push('--disable-client-side-phishing-detection')
      args.push('--safebrowsing-disable-auto-update')

      // ─── Consolidated --disable-features ─────────────────────────────
      //
      // Chrome only honors the LAST --disable-features flag, so every
      // disable goes through this single array. Two tiers:
      //   1. Always-on: anti-telemetry / anti-correlation features that
      //      could carry the real IP outside the proxy or generate a
      //      stable Chrome-only traffic signature.
      //   2. Hardware-identity lockdown: gated by the user toggle. JS
      //      API surfaces in fingerprint.ts section 19 are belt-and-
      //      braces alongside these engine-level disables; some surfaces
      //      (DBSC headers, Topics HTTP requests) are reachable only at
      //      the engine level.
      const disableFeatures: string[] = [
        // Tier 1 — always on
        'Reporting',                          // Reporting API beacons
        'NetworkErrorLogging',                // NEL crash/error beacons
        'OptimizationHints',                  // OptimizationGuide model fetch
        'OptimizationHintsFetching',
        'Translate',                          // Google Translate ranker fetch
        'AutofillServerCommunication',        // Autofill server upload
        'AutofillEnableAccountWalletStorage', // Google Pay autofill sync
        'CertificateTransparencyComponentUpdater',
        'InterestFeedContentSuggestions',     // NTP feed
        'CalculateNativeWinOcclusion',        // can hit network in some flows
        'MediaRouter',                        // Cast / DIAL discovery
        'DialMediaRouteProvider'
      ]
      if (blockWebAuthn) {
        disableFeatures.push(
          // Tier 2 — Hardware identity lockdown (matches fingerprint.ts §19)
          // Device-Bound Session Credentials (TPM-backed session keys)
          'DeviceBoundSessionCredentials',
          // Digital Credentials API (mDL / EU eID / wallet tokens)
          'DigitalCredentials',
          'WebIdentityDigitalCredentials',
          // Privacy Sandbox Topics — umbrella + JS API + HTTP surfaces.
          // BrowsingTopicsDocumentAPI is the actual JS-API gate; the
          // umbrella alone leaves document.browsingTopics() reachable
          // on some Chromium milestones.
          'BrowsingTopics',
          'BrowsingTopicsDocumentAPI',
          'BrowsingTopicsParameters',
          'BrowsingTopicsXHR',
          'BrowsingTopicsBypassIPIsPubliclyRoutableCheck',
          // Other Privacy Sandbox cross-site identifiers
          'AttributionReporting',               // Conversion measurement
          'AttributionReportingCrossAppWeb',
          'PrivateAggregationApi',
          'Fledge',                             // Protected Audience
          'FledgeBiddingAndAuctionServer',
          'InterestGroupStorage',
          'PrivacySandboxAdsAPIs',
          'PrivacySandboxSettings4'
        )
      }
      args.push(`--disable-features=${disableFeatures.join(',')}`)

      // TLS fingerprint masking (JA3/JA4): shuffle cipher order and randomize TLS extensions
      const tlsCiphers = [
        'TLS_AES_128_GCM_SHA256',
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256'
      ]
      const shuffledCiphers = [...tlsCiphers].sort(() => Math.random() - 0.5)
      args.push(`--tls13-ciphers=${shuffledCiphers.join(':')}`)
      args.push('--ssl-version-min=tls1.2')
      // Permute TLS extension order to randomize JA3/JA4 fingerprints (Chrome 110+)
      args.push('--enable-features=PermuteTLSExtensions')

      args.push(`--lang=${primaryLanguage}`)

      // Mobile emulation via Chrome flags
      if (activeFp.device_type === 'mobile') {
        args.push(`--window-size=${activeFp.screen_width},${activeFp.screen_height}`)
        args.push('--enable-touch-events')
      }

      // SOCKS proxies with credentials need a local unauthenticated SOCKS5
      // relay because Chromium silently drops user/pass from --proxy-server
      // for SOCKS schemes (Chromium issue 256785) and neither CDP
      // Fetch.authRequired nor webRequest.onAuthRequired fires for SOCKS
      // (both are HTTP-layer hooks). HTTP/HTTPS proxies keep the direct
      // path — their auth flows through CDP / the proxy-auth extension.
      // Aliased to willUseSocksRelay (declared earlier for the DNS rules).
      const needsSocksRelay = willUseSocksRelay
      if (proxy) {
        if (needsSocksRelay) {
          const relay = await startSocks5Relay(proxy)
          socksRelays.set(profileId, relay)
          args.push(`--proxy-server=socks5://127.0.0.1:${relay.port}`)
        } else {
          args.push(`--proxy-server=${proxy.protocol}://${proxy.host}:${proxy.port}`)
        }
      }

      // ─── IP leak hardening when any proxy is configured ─────────────
      //
      // QUIC/HTTP3 runs over UDP. Chrome's --proxy-server only routes
      // TCP-tunneled HTTP(S) — UDP packets escape the proxy entirely,
      // exposing the real IP to any QUIC-enabled endpoint (Google, YT,
      // Cloudflare, many CDNs). Disable QUIC + the QUIC feature flag
      // unconditionally when a proxy is set so the destination is always
      // reached over TCP via the proxy.
      //
      // WebRTC ICE candidates also go over UDP and historically have
      // been the #1 IP leak vector for proxied browsers. Force the most
      // restrictive routing policy (disable_non_proxied_udp) whenever
      // any proxy is in use, regardless of the fingerprint setting —
      // user-visible IP privacy outranks fingerprint variance.
      if (proxy) {
        args.push('--disable-quic')
        args.push('--webrtc-ip-handling-policy=disable_non_proxied_udp')
      } else if (activeFp.webrtc_policy === 'disable_non_proxied_udp') {
        args.push('--webrtc-ip-handling-policy=disable_non_proxied_udp')
      }

      // Proxy auth extension (HTTP/HTTPS only). On pre-137 Chromium it
      // closes the race between the first request and CDP's auth listener;
      // on 137+ --load-extension is silently ignored and CDP is the sole
      // auth path. SOCKS proxies are excluded — their auth happens before
      // any HTTP layer, so webRequestAuthProvider never sees a challenge.
      const extDirs: string[] = []
      if (proxy?.username && proxy?.password && !isSocksProxy) {
        const authDir = writeProxyAuthExtension(profileDir, proxy)
        if (authDir) extDirs.push(authDir)
      }

      // Load per-profile extensions
      const profileExts = db.prepare(
        'SELECT path FROM profile_extensions WHERE profile_id = ? AND enabled = 1'
      ).all(profileId) as { path: string }[]
      for (const ext of profileExts) {
        if (existsSync(ext.path)) extDirs.push(ext.path)
      }

      if (extDirs.length > 0) {
        args.push(`--load-extension=${extDirs.join(',')}`)
        args.push(`--disable-extensions-except=${extDirs.join(',')}`)
      }

      // Build the fingerprint injection scripts for CDP injection after launch.
      // Main-world script covers window/document/navigator + iframes (via
      // Page.addScriptToEvaluateOnNewDocument). The worker variant runs
      // inside Worker / SharedWorker / ServiceWorker scopes via the
      // Target.setAutoAttach path in startBrowserWsListener.
      injectionScript = buildInjectionScript(activeFp, geoOverride, { blockWebAuthn })
    }

    // Caller-provided targetUrl (e.g. "open test site in this profile") wins
    // over the profile's default start_url. Works for both Chromium (trailing
    // positional arg) and Firefox (`-profile <dir> <url>` positional form).
    const effectiveUrl = (opts?.targetUrl ?? profile.start_url ?? '').trim()
    if (effectiveUrl) {
      // Prevent the URL from being interpreted as a browser flag (e.g. "--remote-debugging-port=...")
      if (!effectiveUrl.startsWith('-')) {
        args.push(effectiveUrl)
      }
    }

    // Delete stale DevToolsActivePort before spawning (avoid race condition)
    if (injectionScript) {
      try { unlinkSync(join(profileDir, 'DevToolsActivePort')) } catch { /* ignore */ }
    }

    const child = spawn(exePath, args, {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()

    // Chrome 137+ ignores --load-extension on branded builds (Sept 2025).
    // Proxy auth therefore falls back to CDP Fetch.authRequired, attached
    // per-target in startCDPInjection/injectTarget. The auth extension below
    // (writeProxyAuthExtension) is kept as a race-free fast path for older
    // Chromium builds where it still loads before the first request hits
    // the proxy.
    const pid = child.pid
    if (!pid) throw new Error('Failed to get browser process ID')

    addSession(profileId, pid, browserType, child)

    // IMPORTANT: Don't rely on child.on('exit') — Chrome launcher exits immediately on Windows.
    // The polling mechanism (startBrowserPolling) handles lifecycle tracking instead.
    child.on('exit', () => {
      // No-op: polling handles this
    })

    // Set running — the browser process has been spawned
    db.prepare(
      `UPDATE profiles SET status = ?, last_used = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run('running', profileId)

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:started', {
        profile_id: profileId,
        pid,
        browser_type: browserType,
        started_at: new Date().toISOString()
      })
    }

    // Start polling for browser exit detection
    startBrowserPolling(profileId, profileDir, isFirefox, db, mainWindow)

    // Start CDP-based fingerprint injection + proxy auth for Chromium browsers (async, non-blocking)
    if (injectionScript) {
      // For SOCKS+auth, the local relay supplies the credentials; CDP
      // Fetch.authRequired never fires for SOCKS handshakes, so passing
      // creds here would just register a dead listener.
      const proxyCredentials =
        proxy?.username && proxy?.password && !isSocksProxy
          ? { username: proxy.username, password: proxy.password }
          : undefined
      const workerScript = buildWorkerInjectionScript(activeFp, { blockWebAuthn })
      const injector = startCDPInjection(
        profileId,
        profileDir,
        injectionScript,
        workerScript,
        activeFp,
        proxyCredentials,
        geoOverride
      )
      cdpInjectors.set(profileId, injector)
    }

    return { pid }
  } catch (err) {
    // Tear down any SOCKS relay started for this launch so it doesn't leak.
    stopSocksRelay(profileId)
    try {
      db.prepare(
        `UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run('error', profileId)
    } catch { /* best effort */ }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:state', {
        profile_id: profileId,
        status: 'error',
        error: err instanceof Error ? err.message : 'Launch failed'
      })
    }
    throw err
  }
}

export async function stopBrowser(
  db: Database.Database,
  profileId: string,
  mainWindow: Electron.BrowserWindow | null
): Promise<void> {
  const activeBrowser = activeBrowsers.get(profileId)
  if (!activeBrowser && !isRunning(profileId)) {
    throw new Error('Profile is not running')
  }

  // Set "stopping" state
  db.prepare(
    `UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run('stopping', profileId)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session:state', { profile_id: profileId, status: 'stopping' })
  }

  // Stop polling first
  stopBrowserPolling(profileId)

  // Stop CDP injection
  const injector = cdpInjectors.get(profileId)
  if (injector) { injector.stop(); cdpInjectors.delete(profileId) }

  // Stop SOCKS auth relay if one was started for this profile
  stopSocksRelay(profileId)

  // Close by profile directory (finds real browser PIDs) — ASYNC, no longer blocks main thread.
  // Prefer graceful close so Chromium has time to flush cookies/storage.
  if (activeBrowser) {
    await closeBrowserByProfileDir(activeBrowser.profileDir, activeBrowser.cdpPort)
  }

  // Also try killing via ChildProcess handle (launcher PID — may already be dead)
  const session = getSession(profileId)
  if (session && !activeBrowser) {
    try { session.process.kill() } catch { /* already exited */ }
    // Also try taskkill on the original PID's process tree
    await killPid(session.pid)
  }

  removeSession(profileId, 0)

  // Set ready immediately — we've killed everything
  db.prepare(
    `UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run('ready', profileId)

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session:stopped', {
      profile_id: profileId,
      exit_code: 0
    })
  }
}
