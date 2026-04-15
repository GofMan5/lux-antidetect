import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type Database from 'better-sqlite3'
import type { BrowserType, Fingerprint, Profile, Proxy } from './models'
import { buildInjectionScript, regenerateFingerprint } from './fingerprint'
import { addSession, removeSession, getSession, isRunning } from './sessions'

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

export function launchBrowser(
  db: Database.Database,
  profileId: string,
  profilesDir: string,
  mainWindow: Electron.BrowserWindow | null
): { pid: number } {
  if (isRunning(profileId)) throw new Error('Profile is already running')

  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as
    | Profile
    | undefined
  if (!profile) throw new Error(`Profile not found: ${profileId}`)

  const fingerprint = db.prepare('SELECT * FROM fingerprints WHERE profile_id = ?').get(
    profileId
  ) as Fingerprint | undefined
  if (!fingerprint) throw new Error(`Fingerprint not found for profile: ${profileId}`)

  // Set "starting" state immediately
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
    const profileDir = join(profilesDir, profileId)
    mkdirSync(profileDir, { recursive: true })

    const isFirefox = browserType === 'firefox'
    const args: string[] = []

    if (isFirefox) {
      args.push('-profile', profileDir, '-no-remote')
      writeFirefoxUserJs(profileDir, activeFp, proxy)
    } else {
      args.push(`--user-data-dir=${profileDir}`)
      args.push('--no-first-run')
      args.push('--disable-default-apps')
      args.push('--disable-background-networking')

      // DNS-over-HTTPS
      args.push('--dns-over-https-mode=automatic')

      // TLS fingerprint diversification
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

      // Build extensions list
      const extDirs: string[] = []

      // Fingerprint injection extension
      const fpExtDir = join(profileDir, '_lux_ext')
      writeChromiumExtension(fpExtDir, activeFp)
      extDirs.push(fpExtDir)

      // Proxy auth extension (if proxy has credentials)
      if (proxy?.username && proxy?.password) {
        const authDir = writeProxyAuthExtension(profileDir, proxy)
        if (authDir) extDirs.push(authDir)
      }

      args.push(`--load-extension=${extDirs.join(',')}`)
      args.push(`--disable-extensions-except=${extDirs.join(',')}`)
    }

    // Start URL as last arg
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

    db.prepare(
      `UPDATE profiles SET status = ?, last_used = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).run('running', profileId)

    child.on('exit', (code) => {
      removeSession(profileId, code)
      try {
        db.prepare(
          `UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run('ready', profileId)
      } catch {
        /* db may be closed on app exit */
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:stopped', {
          profile_id: profileId,
          exit_code: code
        })
      }
    })

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session:started', {
        profile_id: profileId,
        pid,
        browser_type: browserType,
        started_at: new Date().toISOString()
      })
    }

    return { pid }
  } catch (err) {
    // Launch failed — set error state
    try {
      db.prepare(
        `UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`
      ).run('error', profileId)
    } catch {
      /* best effort */
    }
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

export function stopBrowser(
  db: Database.Database,
  profileId: string,
  mainWindow: Electron.BrowserWindow | null
): void {
  const session = getSession(profileId)
  if (!session) throw new Error('Profile is not running')

  // Set "stopping" state
  db.prepare(
    `UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run('stopping', profileId)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('session:state', { profile_id: profileId, status: 'stopping' })
  }

  try {
    session.process.kill()
  } catch {
    /* Process may have already exited */
  }

  // Don't set ready here — the exit handler will do it and send session:stopped
}
