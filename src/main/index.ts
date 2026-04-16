import { app, shell, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
import { initDatabase } from './db'
import { registerIpcHandlers } from './ipc'
import { killAllSessions, initSessionsDb } from './sessions'
import { killAllBrowsers } from './browser'
import { initAutoUpdater } from './updater'
import { initBrowserManager, setMainWindow as setBrowserManagerMainWindow } from './browser-manager'
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

let tray: Tray | null = null
let isQuitting = false
let minimizeToTray = false

function createWindow(): BrowserWindow {
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

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function setupTray(mainWindow: BrowserWindow): void {
  if (tray) return
  // Use a simple icon — in production, use a proper .ico
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVQ4jWNgGAWDEwAAAhAAASVfZGwAAAAASUVORK5CYII=') : icon)
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
    { label: 'Quit', click: () => { isQuitting = true; app.quit() } }
  ]))
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.lux.antidetect')

  app.on('browser-window-created', (_, window) => {
    window.removeMenu()
  })

  const userDataPath = resolveDataPath()
  const profilesDir = join(userDataPath, 'profiles')
  if (!existsSync(profilesDir)) {
    mkdirSync(profilesDir, { recursive: true })
  }

  const db = initDatabase(userDataPath)
  initSessionsDb(db)

  // Crash recovery: reset profiles stuck in non-ready states from a previous crash
  db.prepare("UPDATE profiles SET status = 'ready' WHERE status IN ('running', 'starting', 'stopping', 'error')").run()

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
  initAutoUpdater(mainWindow, db)
  initBrowserManager(userDataPath, mainWindow)

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

  // Database backup/restore
  ipcMain.handle('export-database', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Database Backup',
      defaultPath: `lux-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }]
    })
    if (result.canceled || !result.filePath) return { ok: false }
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
    // Validate it's a SQLite DB
    const header = readFileSync(result.filePaths[0]).subarray(0, 16).toString()
    if (!header.startsWith('SQLite format 3')) {
      return { ok: false, error: 'Not a valid SQLite database' }
    }
    const dbPath = join(userDataPath, 'lux.db')
    // Create backup of current DB first
    copyFileSync(dbPath, dbPath + '.bak')
    copyFileSync(result.filePaths[0], dbPath)
    return { ok: true, requiresRestart: true }
  })

  // Auto-launch profiles after app is ready (delayed to ensure renderer is loaded)
  if (Array.isArray(autoStartProfiles) && autoStartProfiles.length > 0) {
    setTimeout(async () => {
      const { launchBrowser } = await import('./browser')
      for (const profileId of autoStartProfiles) {
        try {
          await launchBrowser(db, profileId, profilesDir, mainWindow)
        } catch { /* skip failed auto-launches */ }
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
    killAllBrowsers().finally(() => {
      killAllSessions()
      app.quit()
    })
  }
})
