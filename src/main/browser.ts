import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, unlinkSync, chmodSync } from 'fs'
import { join } from 'path'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { request as httpRequest } from 'http'
import { randomBytes } from 'crypto'
import type Database from 'better-sqlite3'
import type { BrowserType, Fingerprint, Profile, Proxy } from './models'
import {
  buildInjectionScript,
  normalizeFingerprint,
  parseFingerprintLanguages,
  regenerateFingerprint
} from './fingerprint'
import { addSession, removeSession, getSession, isRunning } from './sessions'
import { getManagedBrowserPath } from './browser-manager'

const execFileAsync = promisify(execFile)



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
async function killPid(pid: number): Promise<void> {
  try {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      timeout: 5000,
      windowsHide: true
    })
  } catch {
    // Process may have already exited
  }
}

/** Kill all processes associated with a browser profile directory. (ASYNC) */
async function killBrowserByProfileDir(profileDir: string): Promise<void> {
  const pids = await findBrowserPidsByProfileDir(profileDir)
  await Promise.all(pids.map(killPid))

  // Second pass: if PIDs were found but processes are sticky, try again
  if (pids.length > 0) {
    const remaining = await findBrowserPidsByProfileDir(profileDir)
    await Promise.all(remaining.map(killPid))
  }
}


function writeProxyAuthExtension(extDir: string, proxy: Proxy): string | null {
  if (!proxy.username || !proxy.password) return null

  const authExtDir = join(extDir, '_proxy_auth')
  mkdirSync(authExtDir, { recursive: true, mode: 0o700 })
  try { chmodSync(authExtDir, 0o700) } catch { /* ignore on Windows */ }

  const manifest = {
    manifest_version: 3,
    name: 'Lux Proxy Auth',
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

/** Inject fingerprint script into all current and future pages via CDP. */
async function injectViaCDP(port: number, script: string, fp: Fingerprint): Promise<void> {
  // Get the list of targets
  const targetsRaw = await httpGet(`http://127.0.0.1:${port}/json`)
  const targets = JSON.parse(targetsRaw) as { id: string; type: string }[]

  // For each existing page target, inject via HTTP endpoint
  const pageTargets = targets.filter((t) => t.type === 'page')

  for (const target of pageTargets) {
    try {
      // Enable Page domain (required for addScriptToEvaluateOnNewDocument)
      await cdpCommand(port, target.id, 'Page.enable', {})
      await applyCdpFingerprintOverrides(port, target.id, fp)
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
    } catch { /* target may have closed */ }
  }

  // Also set up on any new tabs: listen for new targets via /json/new isn't possible w/o WS,
  // so we use a persistent polling approach on the targets list
}

/** Send a CDP command via minimal WebSocket (no dependencies, uses Node's http upgrade). */
async function cdpCommand(port: number, targetId: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
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
        // Try to parse a complete frame
        if (accum.length < 2) return
        const payloadLen = accum[1] & 0x7f
        let offset = 2
        let msgLen = payloadLen
        if (payloadLen === 126) {
          if (accum.length < 4) return
          msgLen = accum.readUInt16BE(2)
          offset = 4
        } else if (payloadLen === 127) {
          if (accum.length < 10) return
          msgLen = Number(accum.readBigUInt64BE(2))
          offset = 10
        }
        if (accum.length < offset + msgLen) return
        const msgBuf = accum.subarray(offset, offset + msgLen)
        try {
          const msg = JSON.parse(msgBuf.toString('utf-8'))
          if (msg.id === 1) {
            socket.destroy()
            if (msg.error) finish(new Error(msg.error.message))
            else finish(null, msg.result)
          }
        } catch { /* partial frame, wait for more */ }
      })
      socket.on('error', (e: Error) => finish(e))
      socket.on('close', () => finish(new Error('socket closed')))
    })

    req.on('error', (e) => finish(e))
    req.setTimeout(5000, () => { req.destroy(); finish(new Error('CDP timeout')) })
    req.end()
  })
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
    bitness: isMobile ? '' : '64',
    wow64: false
  }
}

async function applyCdpFingerprintOverrides(
  port: number,
  targetId: string,
  fp: Fingerprint
): Promise<void> {
  const { languages, primaryLanguage } = getFingerprintLocale(fp)

  await Promise.allSettled([
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
  ])
}

/** Background task: continuously ensure CDP injection is active for all pages of this profile. */
function startCDPInjection(
  profileId: string,
  profileDir: string,
  script: string,
  fp: Fingerprint
): { stop: () => void } {
  let stopped = false
  let port = 0
  const injectedTargets = new Set<string>()

  async function injectTarget(targetId: string): Promise<void> {
    if (injectedTargets.has(targetId)) return
    injectedTargets.add(targetId)
    try {
      await cdpCommand(port, targetId, 'Page.enable', {})
      await applyCdpFingerprintOverrides(port, targetId, fp)
      await cdpCommand(port, targetId, 'Page.addScriptToEvaluateOnNewDocument', {
        source: script,
        runImmediately: true
      })
      await cdpCommand(port, targetId, 'Runtime.evaluate', {
        expression: script,
        allowUnsafeEvalBlockedByCSP: true
      })
    } catch { /* target may have been destroyed */ }
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

    // Initial injection for existing tabs
    try {
      await injectViaCDP(port, script, fp)
      const targetsRaw = await httpGet(`http://127.0.0.1:${port}/json`)
      const targets = JSON.parse(targetsRaw) as { id: string; type: string }[]
      for (const t of targets) {
        if (t.type === 'page') injectedTargets.add(t.id)
      }
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
        startBrowserWsListener(port, wsPath, script, injectedTargets, injectTarget, () => stopped)
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
    stop: () => { stopped = true }
  }
}

/** Open a persistent WebSocket to the browser endpoint and listen for Target.targetCreated events. */
function startBrowserWsListener(
  port: number,
  wsPath: string,
  _script: string,
  injectedTargets: Set<string>,
  injectTarget: (targetId: string) => Promise<void>,
  isStopped: () => boolean
): void {
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

    // Subscribe to target discovery
    sendWsMsg('Target.setDiscoverTargets', { discover: true })

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

// Track CDP injection handles so we can stop them when the browser stops
const cdpInjectors = new Map<string, { stop: () => void }>()

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
                markStopped()
                await killBrowserByProfileDir(profileDir)
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
  for (const [profileId, active] of activeBrowsers) {
    clearInterval(active.pollTimer)
    kills.push(killBrowserByProfileDir(active.profileDir))
    removeSession(profileId, null)
    const injector = cdpInjectors.get(profileId)
    if (injector) injector.stop()
  }
  activeBrowsers.clear()
  cdpInjectors.clear()
  await Promise.all(kills)
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
  if (isRunning(profileId) || isProfileBrowserActive(profileId)) {
    throw new Error('Profile is already running')
  }

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
    const activeFp = shouldRegenerate
      ? regenerateFingerprint(db, profileId, profile.browser_type)
      : normalizeFingerprint(fingerprint)

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

      args.push(`--user-data-dir=${profileDir}`)
      args.push('--no-first-run')
      args.push('--disable-default-apps')
      args.push('--disable-background-networking')
      args.push('--disable-search-engine-choice-screen')
      args.push('--remote-debugging-port=0')
      args.push(`--user-agent=${activeFp.user_agent}`)

      args.push('--dns-over-https-mode=automatic')

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

      if (activeFp.webrtc_policy === 'disable_non_proxied_udp') {
        args.push('--webrtc-ip-handling-policy=disable_non_proxied_udp')
      }

      if (proxy) {
        const proxyUrl = `${proxy.protocol}://${proxy.host}:${proxy.port}`
        args.push(`--proxy-server=${proxyUrl}`)
      }

      // Proxy auth still needs an extension (CDP can't intercept onAuthRequired)
      const extDirs: string[] = []
      if (proxy?.username && proxy?.password) {
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

      // Build the fingerprint injection script for CDP injection after launch
      injectionScript = buildInjectionScript(activeFp)
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

    // WARNING: Chrome 137+ removed --load-extension from branded Chrome/Edge builds (Sept 2025).
    // Proxy auth still uses an extension via --load-extension as a best-effort fallback because
    // CDP cannot intercept webRequest.onAuthRequired. If the extension fails to load on newer
    // Chrome builds, proxy authentication will not work automatically — the user will see a
    // native auth popup instead. See also: writeProxyAuthExtension().
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

    // Start CDP-based fingerprint injection for Chromium browsers (async, non-blocking)
    if (injectionScript) {
      const injector = startCDPInjection(profileId, profileDir, injectionScript, activeFp)
      cdpInjectors.set(profileId, injector)
    }

    return { pid }
  } catch (err) {
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

  // Kill by profile directory (finds real browser PIDs) — ASYNC, no longer blocks main thread
  if (activeBrowser) {
    await killBrowserByProfileDir(activeBrowser.profileDir)
  }

  // Also try killing via ChildProcess handle (launcher PID — may already be dead)
  const session = getSession(profileId)
  if (session) {
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
