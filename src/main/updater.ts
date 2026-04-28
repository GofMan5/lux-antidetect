import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { logger } from './logger'

export type UpdateState =
  | { stage: 'idle' }
  | { stage: 'downloading'; version: string; percent: number; releaseNotes?: unknown }
  | { stage: 'ready'; version: string }
  | { stage: 'error'; message: string }

let checkInterval: ReturnType<typeof setInterval> | undefined
let initialized = false
let updateWindow: BrowserWindow | null = null
let currentUpdateState: UpdateState = { stage: 'idle' }

function sendToUpdateWindow(channel: string, payload: unknown): void {
  if (!updateWindow || updateWindow.isDestroyed() || updateWindow.webContents.isDestroyed()) return
  updateWindow.webContents.send(channel, payload)
}

function emitUpdateState(state: UpdateState): void {
  currentUpdateState = state

  switch (state.stage) {
    case 'downloading':
      sendToUpdateWindow('update:available', {
        version: state.version,
        releaseNotes: state.releaseNotes
      })
      sendToUpdateWindow('update:download-progress', {
        percent: state.percent
      })
      break
    case 'ready':
      sendToUpdateWindow('update:downloaded', {
        version: state.version
      })
      break
    case 'error':
      sendToUpdateWindow('update:error', {
        message: state.message
      })
      break
    case 'idle':
      break
  }
}

function emitDownloadProgress(percent: number): void {
  const roundedPercent = Math.round(percent)
  if (currentUpdateState.stage === 'downloading') {
    currentUpdateState = { ...currentUpdateState, percent: roundedPercent }
  }

  sendToUpdateWindow('update:download-progress', {
    percent: roundedPercent
  })
}

function clearTransientUpdateState(): void {
  if (currentUpdateState.stage !== 'ready') {
    currentUpdateState = { stage: 'idle' }
  }
}

export function initAutoUpdater(mainWindow: BrowserWindow, db?: Database.Database): void {
  updateWindow = mainWindow

  // Prevent duplicate listener registration (e.g. on macOS activate)
  if (initialized) return
  initialized = true
  autoUpdater.logger = logger
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    clearTransientUpdateState()
    logger.info('autoUpdater: checking for update')
  })

  autoUpdater.on('update-not-available', (info) => {
    clearTransientUpdateState()
    logger.info(`autoUpdater: up-to-date (current ${info?.version ?? 'unknown'})`)
  })

  autoUpdater.on('update-available', (info) => {
    logger.info(`autoUpdater: update available v${info.version}`)
    emitUpdateState({
      stage: 'downloading',
      version: info.version,
      percent: 0,
      releaseNotes: info.releaseNotes
    })
  })

  let lastProgressSend = 0

  autoUpdater.on('download-progress', (progress) => {
    const now = Date.now()
    if (now - lastProgressSend < 500 && progress.percent < 100) return
    lastProgressSend = now
    emitDownloadProgress(progress.percent)
  })

  autoUpdater.on('update-downloaded', (info) => {
    logger.info(`autoUpdater: update downloaded v${info.version}`)
    emitUpdateState({
      stage: 'ready',
      version: info.version
    })
  })

  autoUpdater.on('error', (err) => {
    logger.warn('autoUpdater: error', err)
    emitUpdateState({
      stage: 'error',
      message: err.message
    })
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
    // Check 3 seconds after launch (down from 10) so the update prompt
    // appears soon after the window paints rather than feeling like the
    // app forgot to look for updates.
    setTimeout(() => {
      checkForUpdates().catch(() => {})
    }, 3_000)

    // Re-check every 30 minutes.
    checkInterval = setInterval(() => {
      checkForUpdates().catch(() => {})
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
  if (!app.isPackaged) {
    logger.info('autoUpdater: skipped update check in development')
    return Promise.resolve(null)
  }
  return autoUpdater.checkForUpdates()
}

export function getUpdateState(): UpdateState {
  return currentUpdateState
}

export function clearUpdateErrorState(): UpdateState {
  if (currentUpdateState.stage === 'error') {
    currentUpdateState = { stage: 'idle' }
  }
  return currentUpdateState
}

export function installUpdate(): void {
  // (isSilent, isForceRunAfter)
  //   isSilent=true        -> pass `/S` to NSIS, no UI dialogs / prompts
  //   isForceRunAfter=true -> relaunch the app after install completes
  autoUpdater.quitAndInstall(true, true)
}
