import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'

let checkInterval: ReturnType<typeof setInterval> | undefined

export function initAutoUpdater(mainWindow: BrowserWindow, db?: Database.Database): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:available', {
        version: info.version,
        releaseNotes: info.releaseNotes
      })
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:download-progress', {
        percent: Math.round(progress.percent)
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:downloaded', {
        version: info.version
      })
    }
  })

  autoUpdater.on('error', (err) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:error', {
        message: err.message
      })
    }
  })

  // Read auto-check setting (default: enabled)
  let autoCheckEnabled = true
  if (db) {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('auto_check_updates') as { value: string } | undefined
      if (row) {
        const parsed = JSON.parse(row.value)
        autoCheckEnabled = parsed !== false
      }
    } catch { /* default enabled */ }
  }

  if (autoCheckEnabled) {
    // Check 3 seconds after launch
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 3000)

    // Re-check every 30 minutes
    checkInterval = setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {})
    }, 30 * 60 * 1000)
  }
}

export function stopAutoUpdateChecks(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = undefined
  }
}

export function checkForUpdates(): Promise<unknown> {
  return autoUpdater.checkForUpdates()
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
