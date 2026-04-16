import { app, shell, BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { initDatabase } from './db'
import { registerIpcHandlers } from './ipc'
import { killAllSessions, initSessionsDb } from './sessions'
import { killAllBrowsers, setMainWindow as setBrowserMainWindow } from './browser'
import { initAutoUpdater } from './updater'
import { initBrowserManager, setMainWindow as setBrowserManagerMainWindow } from './browser-manager'

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

app.whenReady().then(() => {
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

  let mainWindow = createWindow()

  // Register IPC handlers only once (never re-register on macOS activate)
  registerIpcHandlers(db, profilesDir, () => mainWindow)
  initAutoUpdater(mainWindow)
  initBrowserManager(userDataPath, mainWindow)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      // Update references instead of re-registering
      setBrowserMainWindow(mainWindow)
      setBrowserManagerMainWindow(mainWindow)
      initAutoUpdater(mainWindow)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let isQuitting = false

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
