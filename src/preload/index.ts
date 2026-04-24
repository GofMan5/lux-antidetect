import { contextBridge, ipcRenderer } from 'electron'
import type { LuxAPI, SessionStartedEvent, SessionStateEvent, SessionStoppedEvent } from './api-contract'

type CreateProfileInput = Parameters<LuxAPI['createProfile']>[0]
type UpdateProfileInput = Parameters<LuxAPI['updateProfile']>[1]
type UpdateFingerprintInput = Parameters<LuxAPI['updateFingerprint']>[1]
type CreateProxyInput = Parameters<LuxAPI['createProxy']>[0]
type UpdateProxyInput = Parameters<LuxAPI['updateProxy']>[1]
type GenerateFingerprintBrowserType = Parameters<LuxAPI['generateFingerprint']>[0]
type CreateTemplateInput = Parameters<LuxAPI['createTemplate']>[0]
type UpdateTemplateInput = Parameters<LuxAPI['updateTemplate']>[1]

const api: LuxAPI = {
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  getProfile: (id: string) => ipcRenderer.invoke('get-profile', id),
  createProfile: (input: CreateProfileInput) => ipcRenderer.invoke('create-profile', input),
  updateProfile: (id: string, input: UpdateProfileInput) => ipcRenderer.invoke('update-profile', id, input),
  updateFingerprint: (id: string, input: UpdateFingerprintInput) =>
    ipcRenderer.invoke('update-fingerprint', id, input),
  deleteProfile: (id: string) => ipcRenderer.invoke('delete-profile', id),
  duplicateProfile: (id: string) => ipcRenderer.invoke('duplicate-profile', id),
  revealProfileDir: (id: string) => ipcRenderer.invoke('reveal-profile-dir', id),
  getProxyConnectionString: (proxyId: string) =>
    ipcRenderer.invoke('get-proxy-connection-string', proxyId) as Promise<string>,

  launchBrowser: (profileId: string, opts?: { targetUrl?: string }) =>
    ipcRenderer.invoke('launch-browser', profileId, opts),
  stopBrowser: (profileId: string) => ipcRenderer.invoke('stop-browser', profileId),
  openUrlInProfile: (profileId: string, targetUrl: string) =>
    ipcRenderer.invoke('open-url-in-profile', profileId, targetUrl),
  getRunningSessions: () => ipcRenderer.invoke('get-running-sessions'),
  detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),

  listProxies: () => ipcRenderer.invoke('list-proxies'),
  createProxy: (input: CreateProxyInput) => ipcRenderer.invoke('create-proxy', input),
  updateProxy: (id: string, input: UpdateProxyInput) => ipcRenderer.invoke('update-proxy', id, input),
  deleteProxy: (id: string) => ipcRenderer.invoke('delete-proxy', id),
  testProxy: (id: string) => ipcRenderer.invoke('test-proxy', id),
  getProxyGroups: () => ipcRenderer.invoke('proxy-groups'),
  lookupProxyCountry: (id: string) => ipcRenderer.invoke('lookup-proxy-country', id),
  lookupProxyGeo: (id: string) => ipcRenderer.invoke('lookup-proxy-geo', id),
  parseProxyString: (raw: string) => ipcRenderer.invoke('parse-proxy-string', raw),
  bulkTestProxies: (ids: string[]) => ipcRenderer.invoke('bulk-test-proxies', ids),

  generateFingerprint: (browserType: GenerateFingerprintBrowserType) =>
    ipcRenderer.invoke('generate-fingerprint', browserType),

  listFingerprintPresets: () => ipcRenderer.invoke('list-fingerprint-presets'),
  generateFingerprintFromPreset: (presetId, overrides) =>
    ipcRenderer.invoke('generate-fingerprint-from-preset', presetId, overrides),

  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('set-setting', key, value),

  // Templates
  listTemplates: () => ipcRenderer.invoke('list-templates'),
  getTemplate: (id: string) => ipcRenderer.invoke('get-template', id),
  createTemplate: (input: CreateTemplateInput) => ipcRenderer.invoke('create-template', input),
  updateTemplate: (id: string, input: UpdateTemplateInput) => ipcRenderer.invoke('update-template', id, input),
  deleteTemplate: (id: string) => ipcRenderer.invoke('delete-template', id),
  createProfileFromTemplate: (templateId: string, name: string) =>
    ipcRenderer.invoke('create-profile-from-template', templateId, name),

  // Session History
  getSessionHistory: (profileId?: string) => ipcRenderer.invoke('get-session-history', profileId),

  // Bulk operations
  bulkLaunch: (ids: string[]) => ipcRenderer.invoke('bulk-launch', ids),
  bulkStop: (ids: string[]) => ipcRenderer.invoke('bulk-stop', ids),
  bulkDelete: (ids: string[]) => ipcRenderer.invoke('bulk-delete', ids),

  // Cookie import/export (browser must be running)
  exportCookies: (profileId: string, format?: string) => ipcRenderer.invoke('export-cookies', profileId, format || 'json'),
  importCookies: (profileId: string, data: string, format?: string) => ipcRenderer.invoke('import-cookies', profileId, data, format || 'json'),

  // Automation API
  getCdpInfo: (profileId: string) => ipcRenderer.invoke('get-cdp-info', profileId),

  // Profile Extensions
  listProfileExtensions: (profileId: string) => ipcRenderer.invoke('list-profile-extensions', profileId),
  addProfileExtension: (profileId: string, path: string) => ipcRenderer.invoke('add-profile-extension', profileId, path),
  toggleProfileExtension: (extId: string, enabled: boolean) => ipcRenderer.invoke('toggle-profile-extension', extId, enabled),
  removeProfileExtension: (extId: string) => ipcRenderer.invoke('remove-profile-extension', extId),
  installCrxFromFile: (profileId: string, crxPath: string) =>
    ipcRenderer.invoke('install-crx-from-file', { profileId, crxPath }),

  // File dialogs
  dialogOpenCrx: () => ipcRenderer.invoke('dialog-open-crx'),

  // Screenshots
  captureScreenshot: (profileId: string) => ipcRenderer.invoke('capture-screenshot', profileId),

  // Profile Bookmarks
  listBookmarks: (profileId: string) => ipcRenderer.invoke('list-bookmarks', profileId),
  addBookmark: (profileId: string, title: string, url: string) => ipcRenderer.invoke('add-bookmark', profileId, title, url),
  removeBookmark: (bookmarkId: string) => ipcRenderer.invoke('remove-bookmark', bookmarkId),

  // Health & Validation
  checkProcessHealth: () => ipcRenderer.invoke('check-process-health'),
  validateFingerprint: (profileId: string) => ipcRenderer.invoke('validate-fingerprint', profileId),

  // Auto-updates
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (callback: (data: { version: string }) => void) => {
    const handler = (_: unknown, data: { version: string }): void => callback(data)
    ipcRenderer.on('update:available', handler)
    return () => { ipcRenderer.removeListener('update:available', handler) }
  },
  onUpdateDownloaded: (callback: (data: { version: string }) => void) => {
    const handler = (_: unknown, data: { version: string }): void => callback(data)
    ipcRenderer.on('update:downloaded', handler)
    return () => { ipcRenderer.removeListener('update:downloaded', handler) }
  },
  onUpdateProgress: (callback: (data: { percent: number }) => void) => {
    const handler = (_: unknown, data: { percent: number }): void => callback(data)
    ipcRenderer.on('update:download-progress', handler)
    return () => { ipcRenderer.removeListener('update:download-progress', handler) }
  },
  onUpdateError: (callback: (data: { message: string }) => void) => {
    const handler = (_: unknown, data: { message: string }): void => callback(data)
    ipcRenderer.on('update:error', handler)
    return () => { ipcRenderer.removeListener('update:error', handler) }
  },

  onSessionStarted: (callback: (data: SessionStartedEvent) => void) => {
    const handler = (_: unknown, data: SessionStartedEvent): void => callback(data)
    ipcRenderer.on('session:started', handler)
    return () => {
      ipcRenderer.removeListener('session:started', handler)
    }
  },
  onSessionStopped: (callback: (data: SessionStoppedEvent) => void) => {
    const handler = (_: unknown, data: SessionStoppedEvent): void => callback(data)
    ipcRenderer.on('session:stopped', handler)
    return () => {
      ipcRenderer.removeListener('session:stopped', handler)
    }
  },
  onSessionState: (callback: (data: SessionStateEvent) => void) => {
    const handler = (_: unknown, data: SessionStateEvent): void => callback(data)
    ipcRenderer.on('session:state', handler)
    return () => {
      ipcRenderer.removeListener('session:state', handler)
    }
  },

  // Browser management
  listManagedBrowsers: () => ipcRenderer.invoke('list-managed-browsers'),
  getAvailableBrowsers: () => ipcRenderer.invoke('get-available-browsers'),
  downloadBrowser: (
    browserType: string,
    channel?: string,
    browserOverride?: string,
    buildIdOverride?: string
  ) =>
    ipcRenderer.invoke(
      'download-browser',
      browserType,
      channel,
      browserOverride,
      buildIdOverride
    ),
  removeManagedBrowser: (browser: string, buildId: string) =>
    ipcRenderer.invoke('remove-managed-browser', browser, buildId),
  cancelBrowserDownload: (browser: string, buildId: string) =>
    ipcRenderer.invoke('cancel-browser-download', browser, buildId),
  onBrowserDownloadProgress: (callback: (data: { browser: string; buildId: string; downloadedBytes: number; totalBytes: number; percent: number }) => void) => {
    const handler = (_: unknown, data: { browser: string; buildId: string; downloadedBytes: number; totalBytes: number; percent: number }): void => callback(data)
    ipcRenderer.on('browser-download:progress', handler)
    return () => { ipcRenderer.removeListener('browser-download:progress', handler) }
  },
  onBrowserDownloadComplete: (callback: (data: { browser: string; buildId: string; platform: string; executablePath: string; tags: string[] }) => void) => {
    const handler = (_: unknown, data: { browser: string; buildId: string; platform: string; executablePath: string; tags: string[] }): void => callback(data)
    ipcRenderer.on('browser-download:complete', handler)
    return () => { ipcRenderer.removeListener('browser-download:complete', handler) }
  },
  onBrowserDownloadError: (callback: (data: { browser: string; buildId: string; message: string }) => void) => {
    const handler = (_: unknown, data: { browser: string; buildId: string; message: string }): void => callback(data)
    ipcRenderer.on('browser-download:error', handler)
    return () => { ipcRenderer.removeListener('browser-download:error', handler) }
  },

  // System settings
  getAutostart: () => ipcRenderer.invoke('get-autostart'),
  setAutostart: (enabled: boolean) => ipcRenderer.invoke('set-autostart', enabled),
  setMinimizeToTray: (enabled: boolean) => ipcRenderer.invoke('set-minimize-to-tray', enabled),

  // Database backup/restore
  exportDatabase: () => ipcRenderer.invoke('export-database'),
  importDatabase: () => ipcRenderer.invoke('import-database')
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  Object.assign(window, { api })
}
