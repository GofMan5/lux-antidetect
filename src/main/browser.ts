import { existsSync, mkdirSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import type Database from 'better-sqlite3'
import type { BrowserType, Fingerprint, Profile, Proxy } from './models'
import { buildInjectionScript, regenerateFingerprint } from './fingerprint'
import { addSession, removeSession, getSession, isRunning } from './sessions'

const execFileAsync = promisify(execFile)

const BROWSER_PATHS: Record<BrowserType, string[]> = {
  chromium: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ],
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ],
  firefox: [
    'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
    'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
  ]
}

export function detectBrowsers(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [type, paths] of Object.entries(BROWSER_PATHS)) {
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
  const paths = BROWSER_PATHS[browserType]
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  throw new Error(
    `Browser not found: ${browserType}. Install it or configure the path in settings.`
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
    const escapedDir = profileDir.replace(/\\/g, '\\\\').replace(/'/g, "''")
    const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escapedDir}*' } | Select-Object -ExpandProperty ProcessId`
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

function writeChromiumExtension(extDir: string, fp: Fingerprint): void {
  mkdirSync(extDir, { recursive: true })

  const manifest = {
    manifest_version: 3,
    name: 'Lux Fingerprint',
    version: '1.0',
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['inject.js'],
        run_at: 'document_start',
        all_frames: true,
        world: 'MAIN'
      }
    ]
  }
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(extDir, 'inject.js'), buildInjectionScript(fp))
}

function writeProxyAuthExtension(extDir: string, proxy: Proxy): string | null {
  if (!proxy.username || !proxy.password) return null

  const authExtDir = join(extDir, '_proxy_auth')
  mkdirSync(authExtDir, { recursive: true })

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
  function(details) {
    return {
      authCredentials: {
        username: ${JSON.stringify(proxy.username)},
        password: ${JSON.stringify(proxy.password)}
      }
    };
  },
  { urls: ['<all_urls>'] },
  ['blocking']
);
`

  writeFileSync(join(authExtDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(authExtDir, 'background.js'), background)

  return authExtDir
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

  lines.push(`user_pref("general.useragent.override", ${JSON.stringify(fp.user_agent)});`)
  lines.push(
    `user_pref("intl.accept_languages", ${JSON.stringify((JSON.parse(fp.languages) as string[]).join(','))});`
  )
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
    } else {
      lines.push(`user_pref("network.proxy.http", ${JSON.stringify(proxy.host)});`)
      lines.push(`user_pref("network.proxy.http_port", ${proxy.port});`)
      lines.push(`user_pref("network.proxy.ssl", ${JSON.stringify(proxy.host)});`)
      lines.push(`user_pref("network.proxy.ssl_port", ${proxy.port});`)
    }
  }

  if (fp.webrtc_policy === 'disable_non_proxied_udp') {
    lines.push(`user_pref("media.peerconnection.ice.default_address_only", true);`)
    lines.push(`user_pref("media.peerconnection.ice.proxy_only", true);`)
  }

  writeFileSync(join(profileDir, 'user.js'), lines.join('\n'))
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
  }
  activeBrowsers.clear()
  await Promise.all(kills)
}

export function isProfileBrowserActive(profileId: string): boolean {
  return activeBrowsers.has(profileId)
}

// ─── Launch / Stop ──────────────────────────────────────────────────────

export async function launchBrowser(
  db: Database.Database,
  profileId: string,
  profilesDir: string,
  mainWindow: Electron.BrowserWindow | null
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
      : fingerprint

    let proxy: Proxy | undefined
    if (profile.proxy_id) {
      proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(profile.proxy_id) as
        | Proxy
        | undefined
    }

    const browserType = profile.browser_type
    const exePath = findBrowserPath(browserType)
    mkdirSync(profileDir, { recursive: true })

    const args: string[] = []

    if (isFirefox) {
      args.push('-profile', profileDir, '-no-remote')
      writeFirefoxUserJs(profileDir, activeFp, proxy)
    } else {
      args.push(`--user-data-dir=${profileDir}`)
      args.push('--no-first-run')
      args.push('--disable-default-apps')
      args.push('--disable-background-networking')

      args.push('--dns-over-https-mode=automatic')

      const tlsCiphers = [
        'TLS_AES_128_GCM_SHA256',
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256'
      ]
      const shuffledCiphers = [...tlsCiphers].sort(() => Math.random() - 0.5)
      args.push(`--tls13-ciphers=${shuffledCiphers.join(':')}`)
      args.push('--ssl-version-min=tls1.2')

      args.push(`--lang=${(JSON.parse(activeFp.languages) as string[])[0] || 'en-US'}`)

      if (activeFp.webrtc_policy === 'disable_non_proxied_udp') {
        args.push('--webrtc-ip-handling-policy=disable_non_proxied_udp')
      }

      if (proxy) {
        const proxyUrl = proxy.protocol.startsWith('socks')
          ? `${proxy.protocol}://${proxy.host}:${proxy.port}`
          : `http://${proxy.host}:${proxy.port}`
        args.push(`--proxy-server=${proxyUrl}`)
      }

      const extDirs: string[] = []
      const fpExtDir = join(profileDir, '_lux_ext')
      writeChromiumExtension(fpExtDir, activeFp)
      extDirs.push(fpExtDir)

      if (proxy?.username && proxy?.password) {
        const authDir = writeProxyAuthExtension(profileDir, proxy)
        if (authDir) extDirs.push(authDir)
      }

      args.push(`--load-extension=${extDirs.join(',')}`)
      args.push(`--disable-extensions-except=${extDirs.join(',')}`)
    }

    if (profile.start_url?.trim()) {
      args.push(profile.start_url.trim())
    }

    const child = spawn(exePath, args, {
      detached: true,
      stdio: 'ignore'
    })
    child.unref()

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
