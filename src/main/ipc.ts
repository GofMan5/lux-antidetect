import { ipcMain, BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  updateFingerprint,
  deleteProfile,
  duplicateProfile
} from './profile'
import { listProxies, createProxy, updateProxy, deleteProxy, testProxy, getProxyGroups, parseProxyLine } from './proxy'
import { lookupProxyGeo } from './geoip'
import { launchBrowser, stopBrowser, detectBrowsers, getActiveBrowserProfileIds, exportCookiesCDP, importCookiesCDP, parseNetscapeCookies, toNetscapeCookies, getCdpConnectionInfo, captureScreenshot } from './browser'
import { getAllSessions, getSessionHistory } from './sessions'
import { generateDefaultFingerprint } from './fingerprint'
import { checkForUpdates, installUpdate } from './updater'
import {
  downloadBrowser,
  listManagedBrowsers,
  removeManagedBrowser,
  getAvailableBrowsers,
  cancelDownload
} from './browser-manager'
import { v4 as uuidv4 } from 'uuid'
import type { CreateProfileInput, UpdateProfileInput, UpdateFingerprintInput, ProxyInput, BrowserType, TemplateInput } from './models'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new Error('Invalid ID format')
}

const BULK_TEST_CONCURRENCY = 25
const BULK_TEST_MAX_IDS = 500
const PARSE_PROXY_MAX_BYTES = 1_000_000
const PARSE_PROXY_MAX_LINES = 10_000

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

  // Browser (async — no longer blocks main thread)
  ipcMain.handle('launch-browser', async (_, profileId: string) =>
    launchBrowser(db, profileId, profilesDir, getMainWindow())
  )
  ipcMain.handle('stop-browser', async (_, profileId: string) =>
    stopBrowser(db, profileId, getMainWindow())
  )
  ipcMain.handle('get-running-sessions', () => getAllSessions())
  ipcMain.handle('detect-browsers', () => detectBrowsers())

  // Proxies
  ipcMain.handle('list-proxies', () => listProxies(db))
  ipcMain.handle('create-proxy', (_, input: ProxyInput) => createProxy(db, input))
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
    return lookupProxyGeo(db, proxyId)
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

  ipcMain.handle('add-profile-extension', (_, profileId: string, name: string, extPath: string) => {
    assertUuid(profileId)
    if (!name.trim()) throw new Error('Extension name is required')
    if (!extPath.trim()) throw new Error('Extension path is required')
    const id = uuidv4()
    db.prepare(
      'INSERT INTO profile_extensions (id, profile_id, name, path, enabled) VALUES (?, ?, ?, ?, 1)'
    ).run(id, profileId, name.trim(), extPath.trim())
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
    const imported = await importCookiesCDP(profileId, cookies)
    return { ok: true, imported, total: cookies.length }
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
  ipcMain.handle('download-browser', async (_, browserType: BrowserType, channel?: string) =>
    downloadBrowser(browserType, channel ?? 'stable')
  )
  ipcMain.handle('remove-managed-browser', async (_, browser: string, buildId: string) =>
    removeManagedBrowser(browser, buildId)
  )
  ipcMain.handle('cancel-browser-download', (_, browser: string, buildId: string) =>
    cancelDownload(browser, buildId)
  )
}
