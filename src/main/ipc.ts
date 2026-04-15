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
import { listProxies, createProxy, updateProxy, deleteProxy, testProxy } from './proxy'
import { launchBrowser, stopBrowser, detectBrowsers } from './browser'
import { getAllSessions, getSessionHistory, checkProcessHealth } from './sessions'
import { generateFingerprintForApi } from './fingerprint'
import { checkForUpdates, installUpdate } from './updater'
import { v4 as uuidv4 } from 'uuid'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { CreateProfileInput, UpdateProfileInput, UpdateFingerprintInput, ProxyInput, BrowserType, TemplateInput } from './models'

export function registerIpcHandlers(
  db: Database.Database,
  profilesDir: string,
  mainWindow: BrowserWindow
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
    launchBrowser(db, profileId, profilesDir, mainWindow)
  )
  ipcMain.handle('stop-browser', async (_, profileId: string) =>
    stopBrowser(db, profileId, mainWindow)
  )
  ipcMain.handle('get-running-sessions', () => getAllSessions())
  ipcMain.handle('detect-browsers', () => detectBrowsers())

  // Proxies
  ipcMain.handle('list-proxies', () => listProxies(db))
  ipcMain.handle('create-proxy', (_, input: ProxyInput) => createProxy(db, input))
  ipcMain.handle('update-proxy', (_, proxyId: string, input: ProxyInput) =>
    updateProxy(db, proxyId, input)
  )
  ipcMain.handle('delete-proxy', (_, proxyId: string) => deleteProxy(db, proxyId))
  ipcMain.handle('test-proxy', (_, proxyId: string) => testProxy(db, proxyId))

  // Fingerprint
  ipcMain.handle('generate-fingerprint', (_, browserType: BrowserType) =>
    generateFingerprintForApi(browserType)
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
    for (const id of profileIds) {
      try {
        await launchBrowser(db, id, profilesDir, mainWindow)
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' })
      }
    }
    return results
  })

  ipcMain.handle('bulk-stop', async (_, profileIds: string[]) => {
    const results: { id: string; ok: boolean; error?: string }[] = []
    for (const id of profileIds) {
      try {
        await stopBrowser(db, id, mainWindow)
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

  // Cookie import/export
  ipcMain.handle('export-cookies', (_, profileId: string) => {
    const profileDir = join(profilesDir, profileId)
    // Chromium: try to read Cookies file (it's an SQLite DB, but we'll export a summary)
    const cookiePaths = [
      join(profileDir, 'Default', 'Cookies'),
      join(profileDir, 'Default', 'Network', 'Cookies'),
      join(profileDir, 'cookies.sqlite') // Firefox
    ]
    for (const cp of cookiePaths) {
      if (existsSync(cp)) {
        return { path: cp, exists: true }
      }
    }
    return { path: '', exists: false }
  })

  ipcMain.handle('import-cookies', (_, profileId: string, cookieData: string) => {
    const profileDir = join(profilesDir, profileId)
    const targetDir = join(profileDir, 'Default')
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }
    // Save Netscape format cookie data for later import
    writeFileSync(join(targetDir, 'imported_cookies.txt'), cookieData)
    return { ok: true }
  })

  // Process health
  ipcMain.handle('check-process-health', () => checkProcessHealth())

  // Fingerprint validation
  ipcMain.handle('validate-fingerprint', (_, profileId: string) => {
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
  ipcMain.handle('check-for-updates', () => checkForUpdates())
  ipcMain.handle('install-update', () => installUpdate())
}
