import { app, shell, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron'
import { join, dirname, normalize } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, mkdirSync, copyFileSync, openSync, readSync, closeSync, rmSync } from 'fs'
import { initDatabase } from './db'
import { registerIpcHandlers } from './ipc'
import { killAllSessions, initSessionsDb } from './sessions'
import { killAllBrowsers, refreshAllProfileIdentities } from './browser'
import { initAutoUpdater } from './updater'
import { initBrowserManager, setMainWindow as setBrowserManagerMainWindow } from './browser-manager'
import { initLogger, installCrashHandlers, logger, getLogFilePath } from './logger'
import {
  initLocalApiServer,
  registerLocalApiIpcHandlers,
  shutdownLocalApiServer
} from './api-server'
import type Database from 'better-sqlite3'

// Portable mode: if a "data" directory exists next to the executable, use it
function resolveDataPath(): string {
  if (app.isPackaged) {
    const exeDir = dirname(app.getPath('exe'))
    const portableDir = join(exeDir, 'data')
    if (existsSync(portableDir)) {
      return portableDir
    }
  }
  return app.getPath('userData')
}

function getSetting(db: Database.Database, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}

const PENDING_IMPORT_DB = 'lux.db.pending-import'
const REQUIRED_DB_TABLES = ['profiles', 'fingerprints', 'proxies', 'settings']

async function validateDatabaseBackup(filePath: string): Promise<string | null> {
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const headerBuf = Buffer.alloc(16)
    readSync(fd, headerBuf, 0, 16, 0)
    closeSync(fd)
    fd = undefined
    if (!headerBuf.toString().startsWith('SQLite format 3')) {
      return 'Not a valid SQLite database'
    }
  } catch (err) {
    if (fd !== undefined) try { closeSync(fd) } catch { /* ignore */ }
    return `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`
  }

  const { default: DatabaseCtor } = await import('better-sqlite3')
  let candidate: Database.Database | null = null
  try {
    candidate = new DatabaseCtor(filePath, { readonly: true, fileMustExist: true })
    const integrity = candidate.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') return 'SQLite integrity check failed'

    const placeholders = REQUIRED_DB_TABLES.map(() => '?').join(',')
    const rows = candidate
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
      .all(...REQUIRED_DB_TABLES) as { name: string }[]
    const present = new Set(rows.map((row) => row.name))
    const missing = REQUIRED_DB_TABLES.filter((name) => !present.has(name))
    if (missing.length > 0) {
      return `Database backup is missing required table(s): ${missing.join(', ')}`
    }

    return null
  } catch (err) {
    return `Failed to validate database: ${err instanceof Error ? err.message : 'Unknown error'}`
  } finally {
    try { candidate?.close() } catch { /* ignore */ }
  }
}

async function applyPendingDatabaseImport(userDataPath: string): Promise<void> {
  const pendingPath = join(userDataPath, PENDING_IMPORT_DB)
  if (!existsSync(pendingPath)) return

  const error = await validateDatabaseBackup(pendingPath)
  if (error) {
    logger.error(`pending database import rejected: ${error}`)
    rmSync(pendingPath, { force: true })
    return
  }

  const dbPath = join(userDataPath, 'lux.db')
  const backupPath = `${dbPath}.bak`
  if (existsSync(dbPath)) {
    copyFileSync(dbPath, backupPath)
  }
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
  copyFileSync(pendingPath, dbPath)
  rmSync(pendingPath, { force: true })
  logger.info(`pending database import applied; previous DB backup: ${backupPath}`)
}

let tray: Tray | null = null
let isQuitting = false
let minimizeToTray = false

function createWindow(): BrowserWindow {
  const devRendererUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  const devRendererOrigin = devRendererUrl ? new URL(devRendererUrl).origin : null
  const packagedRendererPath = join(__dirname, '../renderer/index.html')

  function isAllowedMainNavigation(rawUrl: string): boolean {
    try {
      const url = new URL(rawUrl)
      if (devRendererOrigin && url.origin === devRendererOrigin) return true
      if (!devRendererOrigin && url.protocol === 'file:') {
        return normalize(fileURLToPath(url)) === normalize(packagedRendererPath)
      }
      return false
    } catch {
      return false
    }
  }

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (minimizeToTray && !isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch { /* invalid URL, ignore */ }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedMainNavigation(url)) return
    event.preventDefault()
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        shell.openExternal(url)
      }
    } catch { /* invalid URL, ignore */ }
  })

  if (devRendererUrl) {
    mainWindow.loadURL(devRendererUrl)
  } else {
    mainWindow.loadFile(packagedRendererPath)
  }

  return mainWindow
}

function setupTray(mainWindow: BrowserWindow): void {
  if (tray) return
  // Resolve the app icon: packaged builds have it in resources/, dev uses resources/icon.png
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'resources', 'icon.png')
    : join(__dirname, '../../resources/icon.png')
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4y2P4z8BQz0BAwMDAwMDEQCRgYGBgYCJVMxMDlcCoAaMGjBowasCoAYPOAAA3EgMRLqf/oQAAAABJRU5ErkJggg==')
  tray = new Tray(icon)
  tray.setToolTip('Lux Antidetect')
  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit() } }
  ]))
}

// Crash handlers can be installed before ready — they catch errors thrown
// during the rest of bootstrap. The file logger must wait until the app
// path is available.
installCrashHandlers()

app.whenReady().then(async () => {
  app.setAppUserModelId('com.lux.antidetect')

  initLogger(app.getPath('logs'))
  logger.info(`app starting v${app.getVersion()} ${process.platform}/${process.arch}`)

  app.on('browser-window-created', (_, window) => {
    window.removeMenu()
  })

  const userDataPath = resolveDataPath()
  const profilesDir = join(userDataPath, 'profiles')
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true })
  }
  await applyPendingDatabaseImport(userDataPath)

  const db = initDatabase(userDataPath)
  initSessionsDb(db)

  // Crash recovery: close session_history rows left open by a previous process.
  const crashStoppedAt = new Date().toISOString()
  db.prepare(
    `UPDATE session_history
     SET stopped_at = ?,
         duration_seconds = max(0, CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER)),
         exit_code = COALESCE(exit_code, -1)
     WHERE stopped_at IS NULL`
  ).run(crashStoppedAt, crashStoppedAt)

  // Crash recovery: reset profiles stuck in non-ready states from a previous crash
  db.prepare("UPDATE profiles SET status = 'ready' WHERE status IN ('running', 'starting', 'stopping', 'error')").run()

  // Make sure every Chrome-based profile on disk has its identity files
  // (Local State + Default/Preferences) populated with the per-profile name
  // and avatar. Covers legacy profiles created before the feature shipped
  // and any profile whose identity was clobbered by Chrome on a prior exit.
  refreshAllProfileIdentities(db, profilesDir)

  // Read settings
  minimizeToTray = getSetting(db, 'minimize_to_tray') === true
  const autoStartProfiles = getSetting(db, 'auto_start_profiles') as string[] | null

  let mainWindow = createWindow()

  // Setup tray if minimize-to-tray is enabled
  if (minimizeToTray) {
    setupTray(mainWindow)
  }

  // Register IPC handlers only once (never re-register on macOS activate)
  registerIpcHandlers(db, profilesDir, () => mainWindow)
  registerLocalApiIpcHandlers(db, profilesDir, () => mainWindow)
  initAutoUpdater(mainWindow, db)
  initBrowserManager(userDataPath, mainWindow)
  initLocalApiServer(db, profilesDir, () => mainWindow)
    .then((status) => {
      if (status.running) logger.info(`local API listening on ${status.baseUrl}`)
    })
    .catch((err) => {
      logger.warn('local API failed to start', err)
    })

  // IPC: autostart toggle
  const { ipcMain } = await import('electron')

  ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('set-autostart', (_, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('set-minimize-to-tray', (_, enabled: boolean) => {
    minimizeToTray = enabled
    if (enabled) setupTray(mainWindow)
    else if (tray) { tray.destroy(); tray = null }
  })

  // Expose logs folder so users can attach main.log to bug reports.
  ipcMain.handle('open-logs-folder', () => {
    const path = getLogFilePath()
    if (!path) return { ok: false, error: 'logger not initialized' }
    shell.showItemInFolder(path)
    return { ok: true, path }
  })

  // Database backup/restore
  ipcMain.handle('export-database', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Database Backup',
      defaultPath: `lux-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
    // Checkpoint WAL to ensure all recent writes are in the main DB file
    try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* best effort */ }
    const dbPath = join(userDataPath, 'lux.db')
    copyFileSync(dbPath, result.filePath)
    return { ok: true, path: result.filePath }
  })

  ipcMain.handle('import-database', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Database Backup',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false }
    const validationError = await validateDatabaseBackup(result.filePaths[0])
    if (validationError) return { ok: false, error: validationError }

    const pendingPath = join(userDataPath, PENDING_IMPORT_DB)
    copyFileSync(result.filePaths[0], pendingPath)
    return { ok: true, requiresRestart: true }
  })

  // Auto-launch profiles after app is ready (delayed to ensure renderer is loaded)
  if (Array.isArray(autoStartProfiles) && autoStartProfiles.length > 0) {
    setTimeout(async () => {
      const { launchBrowser } = await import('./browser')
      for (const profileId of autoStartProfiles) {
        try {
          await launchBrowser(db, profileId, profilesDir, mainWindow)
        } catch (err) {
          logger.warn('auto-launch failed', { profileId }, err)
        }
      }
    }, 3000)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      setBrowserManagerMainWindow(mainWindow)
      initAutoUpdater(mainWindow, db)
      if (minimizeToTray) setupTray(mainWindow)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !minimizeToTray) {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (!isQuitting) {
    isQuitting = true
    event.preventDefault()
    Promise.resolve()
      .then(() => shutdownLocalApiServer())
      .catch((err) => logger.warn('local API shutdown failed', err))
      .then(() => killAllBrowsers())
      .finally(() => {
        killAllSessions()
        app.quit()
      })
  }
})
