import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import type Database from 'better-sqlite3'
import { promises as fsp } from 'fs'
import * as fs from 'fs'
import * as path from 'path'
import { installCrxIntoProfile } from './crx'
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  updateFingerprint,
  deleteProfile,
  wipeProfileBrowserData,
  duplicateProfile,
  syncFingerprintsForProxy
} from './profile'
import { listProxies, createProxy, updateProxy, deleteProxy, testProxy, getProxyGroups, parseProxyLine } from './proxy'
import { lookupProxyGeo, dryRunProxyMetadata, lookupFraudByIp } from './geoip'
import { launchBrowser, stopBrowser, detectBrowsers, getActiveBrowserProfileIds, exportCookiesCDP, importCookiesCDP, parseNetscapeCookies, toNetscapeCookies, getCdpConnectionInfo, captureScreenshot, openUrlInProfile } from './browser'
import { getAllSessions, getSessionHistory } from './sessions'
import { generateDefaultFingerprint } from './fingerprint'
import { listFingerprintPresets, generateFingerprintFromPreset } from './fingerprint-presets'
import { checkForUpdates, installUpdate } from './updater'
import {
  downloadBrowser,
  listManagedBrowsers,
  removeManagedBrowser,
  getAvailableBrowsers,
  cancelDownload
} from './browser-manager'
import { v4 as uuidv4 } from 'uuid'
import type { CreateProfileInput, UpdateProfileInput, UpdateFingerprintInput, ProxyInput, BrowserType, TemplateInput, Fingerprint } from './models'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new Error('Invalid ID format')
}

// Only http(s) URLs may cross the IPC boundary as a navigation target.
// Rejects javascript:, file:, data:, chrome://, about:, etc. A compromised
// renderer must not be able to coerce the main process into loading a
// privileged or local scheme inside a profile.
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:'])

function validateHttpUrl(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new Error('targetUrl must be a string')
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('targetUrl must be a valid URL')
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('targetUrl protocol must be http: or https:')
  }
  return trimmed
}

function assertLocalExtDir(p: unknown, profilesDir: string, profileId: string): string {
  if (typeof p !== 'string' || p.trim().length === 0) {
    throw new Error('Extension path is required')
  }
  const abs = path.resolve(p)
  const allowedRoot = path.resolve(path.join(profilesDir, profileId))
  if (!(abs + path.sep).startsWith(allowedRoot + path.sep)) {
    throw new Error('Extension path is outside the profile directory')
  }
  let st: fs.Stats
  try {
    st = fs.statSync(abs)
  } catch {
    throw new Error('Extension path does not exist')
  }
  if (!st.isDirectory()) {
    throw new Error('Extension path must be a directory')
  }
  if (!fs.existsSync(path.join(abs, 'manifest.json'))) {
    throw new Error('Extension directory is missing manifest.json')
  }
  return abs
}

function readManifestNameSync(extDir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown }
    if (typeof parsed.name === 'string') {
      const name = parsed.name.trim()
      if (name.length > 0 && !name.startsWith('__MSG_')) return name
    }
    return null
  } catch {
    return null
  }
}

const BULK_TEST_CONCURRENCY = 25
const BULK_TEST_MAX_IDS = 500
const PARSE_PROXY_MAX_BYTES = 1_000_000
const PARSE_PROXY_MAX_LINES = 10_000

// Whitelist of fields the renderer is allowed to pass through as preset
// overrides. Identity fields (user_agent, platform, screen_*, hardware_*,
// webgl_*, device_type, etc.) are driven by the preset itself and must
// not be settable by the caller.
const ALLOWED_OVERRIDE_KEYS = [
  'timezone',
  'languages',
  'webrtc_policy',
  'fonts_list',
  'canvas_noise_seed',
  'audio_context_noise'
] as const satisfies readonly (keyof Fingerprint)[]

function sanitizeOverrides(raw: unknown): Partial<Fingerprint> | undefined {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const source = raw as Record<string, unknown>
  const result: Partial<Fingerprint> = Object.create(null)
  let hasKey = false
  for (const key of ALLOWED_OVERRIDE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = source[key]
    if (value === undefined) continue
    ;(result as Record<string, unknown>)[key] = value
    hasKey = true
  }
  return hasKey ? result : undefined
}

export function registerIpcHandlers(
  db: Database.Database,
  profilesDir: string,
  getMainWindow: () => BrowserWindow
): void {
  // Profiles
  ipcMain.handle('list-profiles', () => listProfiles(db))
  ipcMain.handle('get-profile', (_, profileId: string) => getProfile(db, profileId))
  ipcMain.handle('create-profile', (_, input: CreateProfileInput) =>
    createProfile(db, input, profilesDir)
  )
  ipcMain.handle('update-profile', (_, profileId: string, input: UpdateProfileInput) =>
    updateProfile(db, profileId, input)
  )
  ipcMain.handle('update-fingerprint', (_, profileId: string, input: UpdateFingerprintInput) =>
    updateFingerprint(db, profileId, input)
  )
  ipcMain.handle('delete-profile', (_, profileId: string) =>
    deleteProfile(db, profileId, profilesDir)
  )
  ipcMain.handle('duplicate-profile', (_, profileId: string) =>
    duplicateProfile(db, profileId, profilesDir)
  )
  // Wipe every Chromium-side trace (cookies, localStorage, IndexedDB, cache,
  // history, login data, sessions...) but keep the Lux config row. Profile
  // must be stopped — wipeProfileBrowserData throws otherwise. The Lux
  // identity (name, group, fingerprint, proxy) lives in SQLite so it
  // survives; on the next launch Chrome rebuilds a fresh user-data-dir.
  ipcMain.handle('wipe-profile-data', (_, profileId: string) =>
    wipeProfileBrowserData(db, profileId, profilesDir)
  )

  // Reveal a profile's on-disk data directory in the OS file manager.
  // Scoped under profilesDir so a compromised renderer can't reveal
  // arbitrary paths.
  ipcMain.handle('reveal-profile-dir', async (_, profileId: string) => {
    assertUuid(profileId)
    const profileDir = path.resolve(path.join(profilesDir, profileId))
    const allowedRoot = path.resolve(profilesDir)
    if (!profileDir.startsWith(allowedRoot + path.sep)) {
      throw new Error('Invalid profile directory')
    }
    if (!fs.existsSync(profileDir)) {
      throw new Error('Profile directory does not exist (try launching the profile once)')
    }
    await shell.openPath(profileDir)
  })

  // Browser (async — no longer blocks main thread)
  ipcMain.handle('launch-browser', async (_, profileId: string, opts?: { targetUrl?: string }) => {
    assertUuid(profileId)
    // Validate the renderer-supplied URL at the IPC boundary. The downstream
    // launchBrowser only guards against argv-injection (leading "-"); it does
    // not enforce a scheme allow-list, so we must reject non-http(s) here.
    const targetUrl = validateHttpUrl(opts?.targetUrl)
    return launchBrowser(db, profileId, profilesDir, getMainWindow(), { targetUrl })
  })
  ipcMain.handle('stop-browser', async (_, profileId: string) =>
    stopBrowser(db, profileId, getMainWindow())
  )
  // Open an arbitrary URL inside a profile's browser context. Uses CDP when
  // the profile is already running (Chromium/Edge) and cold-launches otherwise.
  ipcMain.handle('open-url-in-profile', async (_, profileId: string, targetUrl: string) => {
    assertUuid(profileId)
    const validated = validateHttpUrl(targetUrl)
    if (validated === undefined) throw new Error('targetUrl is required')
    return openUrlInProfile(db, profileId, validated, profilesDir, getMainWindow())
  })
  ipcMain.handle('get-running-sessions', () => getAllSessions())
  ipcMain.handle('detect-browsers', () => detectBrowsers())

  // Proxies
  ipcMain.handle('list-proxies', () => listProxies(db))
  ipcMain.handle('create-proxy', async (_, input: ProxyInput) => {
    const created = createProxy(db, input)
    // Fire-and-forget reputation lookup — persisted to DB by lookupProxyGeo.
    // We notify the renderer twice: first ('checking') so the row can show
    // an in-flight spinner alongside the freshly-added proxy, and again
    // ('updated') after the lookup persists. Failures are silent so that
    // a flaky proxy can still be added; the user can re-trigger via the
    // "Recheck reputation" row action.
    const win = getMainWindow()
    if (!win.isDestroyed()) {
      win.webContents.send('proxy:metadata-checking', { proxy_id: created.id })
    }
    lookupProxyGeo(db, created.id)
      .then((bundle) => {
        // Propagate freshly-discovered geo to any profile already pinned to
        // this proxy. Rare on createProxy (proxy is brand new — usually
        // attached by the user later), but harmless when no profile is
        // dependent yet, and correct when the user races the auto-check by
        // attaching the proxy before it completes.
        if (bundle) syncFingerprintsForProxy(db, created.id)
        const w = getMainWindow()
        if (!w.isDestroyed() && !w.webContents.isDestroyed()) {
          w.webContents.send('proxy:metadata-updated', { proxy_id: created.id })
        }
      })
      .catch(() => {
        const w = getMainWindow()
        if (!w.isDestroyed() && !w.webContents.isDestroyed()) {
          w.webContents.send('proxy:metadata-updated', { proxy_id: created.id })
        }
      })
    return created
  })

  // Build a shareable connection string for a single proxy. We include the
  // credentials here because the caller explicitly asked for them — the
  // ProxyResponse exposed by list-proxies strips the password for general
  // reads, so this is the one path where it crosses the IPC boundary.
  ipcMain.handle('get-proxy-connection-string', (_, proxyId: string) => {
    assertUuid(proxyId)
    const row = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as
      | { protocol: string; host: string; port: number; username: string | null; password: string | null }
      | undefined
    if (!row) throw new Error('Proxy not found')
    const auth =
      row.username || row.password
        ? `${encodeURIComponent(row.username ?? '')}:${encodeURIComponent(row.password ?? '')}@`
        : ''
    return `${row.protocol}://${auth}${row.host}:${row.port}`
  })
  ipcMain.handle('update-proxy', (_, proxyId: string, input: ProxyInput) => {
    assertUuid(proxyId)
    return updateProxy(db, proxyId, input)
  })
  ipcMain.handle('delete-proxy', (_, proxyId: string) => {
    assertUuid(proxyId)
    return deleteProxy(db, proxyId)
  })

  // Parse proxy strings — supports legacy colon forms and protocol://user:pass@host:port.
  ipcMain.handle('parse-proxy-string', (_, raw: string) => {
    if (typeof raw !== 'string') throw new Error('Input must be a string')
    if (raw.length > PARSE_PROXY_MAX_BYTES) {
      throw new Error(`Input too large (max ${PARSE_PROXY_MAX_BYTES} chars)`)
    }
    const results: { ok: boolean; data?: ProxyInput; error?: string; line: string }[] = []
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, PARSE_PROXY_MAX_LINES)
    for (const line of lines) {
      const parsed = parseProxyLine(line)
      if (parsed.ok) results.push({ ok: true, data: parsed.data, line })
      else results.push({ ok: false, error: parsed.error, line })
    }
    return results
  })

  ipcMain.handle('test-proxy', (_, proxyId: string) => {
    assertUuid(proxyId)
    return testProxy(db, proxyId)
  })

  ipcMain.handle('proxy-groups', () => getProxyGroups(db))

  ipcMain.handle('lookup-proxy-country', async (_, proxyId: string) => {
    assertUuid(proxyId)
    // Only use the proxy-tunneled geo probe — never fall back to an untunneled
    // fetch that would leak the real IP.
    const bundle = await lookupProxyGeo(db, proxyId)
    return bundle?.country_code ?? null
  })

  ipcMain.handle('lookup-proxy-geo', async (_, proxyId: string) => {
    assertUuid(proxyId)
    const bundle = await lookupProxyGeo(db, proxyId)
    // Propagate the refreshed geo to every profile pinned to this proxy so
    // their fingerprints' timezone / primary language stay in sync without
    // the user re-saving each profile manually.
    if (bundle) syncFingerprintsForProxy(db, proxyId)
    return bundle
  })

  // Dry-run reputation check — used by the bulk-import flow to filter out
  // datacenter / known-proxy IPs before persisting them. The input is a
  // ProxyInput shape; nothing is written to the DB. Returns the same bundle
  // shape as lookup-proxy-geo or null on any failure.
  ipcMain.handle('dry-run-fraud-check', async (_, input: ProxyInput) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid input')
    if (typeof input.host !== 'string' || !input.host.trim()) throw new Error('Missing host')
    if (typeof input.port !== 'number' || input.port < 1 || input.port > 65535) {
      throw new Error('Invalid port')
    }
    return dryRunProxyMetadata({
      protocol: input.protocol,
      host: input.host,
      port: input.port,
      username: input.username ?? null,
      password: input.password ?? null
    })
  })

  // Standalone IP fraud check — investigate an arbitrary IP without binding
  // to a proxy in the DB. Both providers are queried directly from the Lux
  // host. Privacy tradeoff: Lux's real IP is visible in their logs alongside
  // the IP under investigation. Returns null on bad input or no provider data.
  ipcMain.handle('lookup-fraud-by-ip', async (_, ip: string) => {
    if (typeof ip !== 'string') throw new Error('IP must be a string')
    if (ip.length > 64) throw new Error('IP string too long')
    return lookupFraudByIp(ip)
  })

  // Bulk proxy test — bounded concurrency pool with per-id UUID validation.
  ipcMain.handle('bulk-test-proxies', async (_, proxyIds: string[]) => {
    if (!Array.isArray(proxyIds)) throw new Error('proxyIds must be an array')
    if (proxyIds.length > BULK_TEST_MAX_IDS) {
      throw new Error(`Too many proxies (max ${BULK_TEST_MAX_IDS})`)
    }

    const results: { id: string; ok: boolean }[] = new Array(proxyIds.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const i = next++
        if (i >= proxyIds.length) return
        const id = proxyIds[i]
        try {
          assertUuid(id)
          const ok = await testProxy(db, id)
          results[i] = { id, ok }
        } catch {
          results[i] = { id, ok: false }
        }
      }
    }

    const poolSize = Math.min(BULK_TEST_CONCURRENCY, proxyIds.length)
    await Promise.all(Array.from({ length: poolSize }, () => worker()))
    return results
  })

  // Fingerprint
  ipcMain.handle('generate-fingerprint', (_, browserType: BrowserType) =>
    generateDefaultFingerprint(browserType)
  )

  ipcMain.handle('list-fingerprint-presets', () => listFingerprintPresets())

  ipcMain.handle(
    'generate-fingerprint-from-preset',
    (_, presetId: string, overrides?: unknown) => {
      if (typeof presetId !== 'string' || !presetId.trim()) {
        throw new Error('presetId is required')
      }
      return generateFingerprintFromPreset(presetId, sanitizeOverrides(overrides))
    }
  )

  // Settings
  ipcMain.handle('get-setting', (_, key: string) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value)
    } catch {
      return row.value
    }
  })
  ipcMain.handle('set-setting', (_, key: string, value: unknown) => {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      key,
      JSON.stringify(value)
    )
  })

  // Profile Extensions
  ipcMain.handle('list-profile-extensions', (_, profileId: string) => {
    assertUuid(profileId)
    return db.prepare('SELECT * FROM profile_extensions WHERE profile_id = ? ORDER BY created_at DESC').all(profileId)
  })

  ipcMain.handle('add-profile-extension', (_, profileId: string, extPath: string) => {
    assertUuid(profileId)
    const normalizedPath = assertLocalExtDir(extPath, profilesDir, profileId)
    const name = readManifestNameSync(normalizedPath) ?? path.basename(normalizedPath)
    const id = uuidv4()
    db.prepare(
      'INSERT INTO profile_extensions (id, profile_id, name, path, enabled) VALUES (?, ?, ?, ?, 1)'
    ).run(id, profileId, name, normalizedPath)
    return db.prepare('SELECT * FROM profile_extensions WHERE id = ?').get(id)
  })

  ipcMain.handle('toggle-profile-extension', (_, extId: string, enabled: boolean) => {
    assertUuid(extId)
    db.prepare('UPDATE profile_extensions SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, extId)
    return { ok: true }
  })

  ipcMain.handle('remove-profile-extension', (_, extId: string) => {
    assertUuid(extId)
    db.prepare('DELETE FROM profile_extensions WHERE id = ?').run(extId)
    return { ok: true }
  })

  ipcMain.handle('install-crx-from-file', async (_, payload: { profileId: string; crxPath: string }) => {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid payload')
    const { profileId, crxPath } = payload
    assertUuid(profileId)
    if (typeof crxPath !== 'string' || crxPath.trim().length === 0) {
      throw new Error('CRX path is required')
    }
    if (!crxPath.toLowerCase().endsWith('.crx')) {
      throw new Error('File must have .crx extension')
    }
    const profileRow = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)
    if (!profileRow) throw new Error('Profile not found')
    const installed = await installCrxIntoProfile(crxPath, profileId, profilesDir)
    const id = uuidv4()
    try {
      db.prepare(
        'INSERT INTO profile_extensions (id, profile_id, name, path, enabled) VALUES (?, ?, ?, ?, 1)'
      ).run(id, profileId, installed.extensionName, installed.extensionDir)
    } catch (err) {
      await fsp.rm(installed.extensionDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
    return db.prepare('SELECT * FROM profile_extensions WHERE id = ?').get(id)
  })

  // File dialogs
  ipcMain.handle('dialog-open-crx', async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? getMainWindow()
    const result = await dialog.showOpenDialog(parent, {
      title: 'Select Chrome extension (.crx)',
      properties: ['openFile'],
      filters: [{ name: 'Chrome Extensions', extensions: ['crx'] }]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, filePath: null }
    }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  // Screenshot
  ipcMain.handle('capture-screenshot', async (_, profileId: string) => {
    assertUuid(profileId)
    return captureScreenshot(profileId)
  })

  // Profile Bookmarks
  ipcMain.handle('list-bookmarks', (_, profileId: string) => {
    assertUuid(profileId)
    return db.prepare('SELECT * FROM profile_bookmarks WHERE profile_id = ? ORDER BY created_at DESC').all(profileId)
  })

  ipcMain.handle('add-bookmark', (_, profileId: string, title: string, url: string) => {
    assertUuid(profileId)
    if (!url.trim()) throw new Error('URL is required')
    const id = uuidv4()
    db.prepare('INSERT INTO profile_bookmarks (id, profile_id, title, url) VALUES (?, ?, ?, ?)').run(id, profileId, title.trim() || url.trim(), url.trim())
    return db.prepare('SELECT * FROM profile_bookmarks WHERE id = ?').get(id)
  })

  ipcMain.handle('remove-bookmark', (_, bookmarkId: string) => {
    assertUuid(bookmarkId)
    db.prepare('DELETE FROM profile_bookmarks WHERE id = ?').run(bookmarkId)
    return { ok: true }
  })

  // Templates
  ipcMain.handle('list-templates', () => {
    return db.prepare('SELECT * FROM templates ORDER BY updated_at DESC').all()
  })

  ipcMain.handle('get-template', (_, id: string) => {
    const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(id)
    if (!tmpl) throw new Error(`Template not found: ${id}`)
    return tmpl
  })

  ipcMain.handle('create-template', (_, input: TemplateInput) => {
    const id = uuidv4()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO templates (id, name, description, browser_type, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.name, input.description ?? '', input.browser_type, JSON.stringify(input.config), now, now)
    return db.prepare('SELECT * FROM templates WHERE id = ?').get(id)
  })

  ipcMain.handle('update-template', (_, id: string, input: Partial<TemplateInput>) => {
    const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!existing) throw new Error(`Template not found: ${id}`)
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE templates SET name = ?, description = ?, browser_type = ?, config = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.name ?? existing.name,
      input.description ?? existing.description,
      input.browser_type ?? existing.browser_type,
      input.config ? JSON.stringify(input.config) : existing.config,
      now,
      id
    )
    return db.prepare('SELECT * FROM templates WHERE id = ?').get(id)
  })

  ipcMain.handle('delete-template', (_, id: string) => {
    db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  })

  ipcMain.handle('create-profile-from-template', (_, templateId: string, name: string) => {
    const tmpl = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId) as Record<string, unknown> | undefined
    if (!tmpl) throw new Error(`Template not found: ${templateId}`)
    const config = JSON.parse(tmpl.config as string) as Record<string, unknown>
    const input: CreateProfileInput = {
      name,
      browser_type: tmpl.browser_type as BrowserType,
      group_name: config.group_name as string | undefined,
      notes: config.notes as string | undefined,
      proxy_id: config.proxy_id as string | undefined,
      start_url: config.start_url as string | undefined,
      fingerprint: config.fingerprint as Partial<Record<string, unknown>> | undefined
    }
    return createProfile(db, input, profilesDir)
  })

  // Session History
  ipcMain.handle('get-session-history', (_, profileId?: string) =>
    getSessionHistory(profileId)
  )

  // Bulk operations (async — each op yields the main thread between iterations)
  ipcMain.handle('bulk-launch', async (_, profileIds: string[]) => {
    const results: { id: string; ok: boolean; error?: string }[] = []
    const concurrency = 3
    let idx = 0

    async function runNext(): Promise<void> {
      while (idx < profileIds.length) {
        const i = idx++
        const id = profileIds[i]
        try {
          await launchBrowser(db, id, profilesDir, getMainWindow())
          results.push({ id, ok: true })
        } catch (err) {
          results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' })
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, profileIds.length) }, () => runNext())
    await Promise.all(workers)
    return results
  })

  ipcMain.handle('bulk-stop', async (_, profileIds: string[]) => {
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of profileIds) {
      try {
        await stopBrowser(db, id, getMainWindow())
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' })
      }
    }
    return results
  })

  ipcMain.handle('bulk-delete', async (_, profileIds: string[]) => {
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of profileIds) {
      try {
        await deleteProfile(db, id, profilesDir)
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' })
      }
    }
    return results
  })

  // Cookie import/export via CDP (browser must be running)
  ipcMain.handle('export-cookies', async (_, profileId: string, format: string = 'json') => {
    assertUuid(profileId)
    const cookies = await exportCookiesCDP(profileId)
    if (format === 'netscape') {
      return { data: toNetscapeCookies(cookies), count: cookies.length, format: 'netscape' }
    }
    return { data: JSON.stringify(cookies, null, 2), count: cookies.length, format: 'json' }
  })

  ipcMain.handle('import-cookies', async (_, profileId: string, cookieData: string, format: string = 'json') => {
    assertUuid(profileId)
    if (cookieData.length > 5 * 1024 * 1024) {
      throw new Error('Cookie data too large (max 5MB)')
    }
    let cookies
    if (format === 'netscape') {
      cookies = parseNetscapeCookies(cookieData)
    } else {
      cookies = JSON.parse(cookieData)
    }
    if (!Array.isArray(cookies)) throw new Error('Invalid cookie data: expected array')
    const MAX_COOKIE_COUNT = 10_000
    if (cookies.length > MAX_COOKIE_COUNT) {
      throw new Error(`Too many cookies (max ${MAX_COOKIE_COUNT})`)
    }
    const isCookieShape = (c: unknown): boolean =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as { name?: unknown }).name === 'string' &&
      ((c as { name: string }).name).length <= 4096 &&
      typeof (c as { value?: unknown }).value === 'string' &&
      ((c as { value: string }).value).length <= 8192 &&
      typeof (c as { domain?: unknown }).domain === 'string' &&
      ((c as { domain: string }).domain).length <= 253
    const valid = cookies.filter(isCookieShape)
    const imported = await importCookiesCDP(profileId, valid)
    return { ok: true, imported, total: valid.length }
  })

  // Automation API — get CDP connection info for external tools (Playwright/Puppeteer)
  ipcMain.handle('get-cdp-info', async (_, profileId: string) => {
    assertUuid(profileId)
    return getCdpConnectionInfo(profileId)
  })

  // Process health — check which sessions have lost their browser process
  ipcMain.handle('check-process-health', () => {
    const activeBrowserIds = getActiveBrowserProfileIds()
    const sessions = getAllSessions()
    const dead: string[] = []
    for (const s of sessions) {
      if (!activeBrowserIds.has(s.profile_id)) {
        dead.push(s.profile_id)
      }
    }
    return { dead }
  })

  // Fingerprint validation
  ipcMain.handle('validate-fingerprint', (_, profileId: string) => {
    assertUuid(profileId)
    const fp = db.prepare('SELECT * FROM fingerprints WHERE profile_id = ?').get(profileId) as Record<string, unknown> | undefined
    if (!fp) throw new Error('Fingerprint not found')
    const issues: string[] = []

    // Check UA consistency
    const ua = fp.user_agent as string
    const platform = fp.platform as string
    if (ua.includes('Windows') && platform !== 'Win32') issues.push('UA says Windows but platform is not Win32')
    if (ua.includes('Macintosh') && platform !== 'MacIntel') issues.push('UA says Mac but platform is not MacIntel')

    // Check WebGL vendor/renderer consistency
    const vendor = fp.webgl_vendor as string
    const webglRenderer = fp.webgl_renderer as string
    if (ua.includes('Macintosh') && vendor.includes('NVIDIA')) issues.push('Mac UA with NVIDIA GPU is suspicious')
    if (ua.includes('Windows') && vendor === 'Apple') issues.push('Windows UA with Apple GPU is impossible')
    if (webglRenderer.includes('Direct3D') && ua.includes('Macintosh')) issues.push('Direct3D renderer with Mac UA')

    // Check screen/pixel ratio consistency
    const pixelRatio = fp.pixel_ratio as number
    if (ua.includes('Macintosh') && pixelRatio === 1.0) issues.push('Mac typically has pixel ratio 2.0')

    return { valid: issues.length === 0, issues }
  })

  // Auto-updates
  ipcMain.handle('check-for-updates', async () => {
    try {
      await checkForUpdates()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Update check failed' }
    }
  })
  ipcMain.handle('install-update', () => installUpdate())

  // Browser management (download / list / remove)
  ipcMain.handle('list-managed-browsers', () => listManagedBrowsers())
  ipcMain.handle('get-available-browsers', () => getAvailableBrowsers())
  ipcMain.handle(
    'download-browser',
    async (
      _,
      browserType: BrowserType,
      channel?: string,
      browserOverride?: string,
      buildIdOverride?: string
    ) =>
      downloadBrowser(browserType, channel ?? 'stable', browserOverride, buildIdOverride)
  )
  ipcMain.handle('remove-managed-browser', async (_, browser: string, buildId: string) =>
    removeManagedBrowser(browser, buildId)
  )
  ipcMain.handle('cancel-browser-download', (_, browser: string, buildId: string) =>
    cancelDownload(browser, buildId)
  )
}
