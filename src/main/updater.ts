import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'

export function initAutoUpdater(mainWindow: BrowserWindow): void {
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

  // Check for updates 3 seconds after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 3000)
}

export function checkForUpdates(): Promise<unknown> {
  return autoUpdater.checkForUpdates()
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
