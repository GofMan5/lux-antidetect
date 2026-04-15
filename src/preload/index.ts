import { contextBridge, ipcRenderer } from 'electron'

const api = {
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  getProfile: (id: string) => ipcRenderer.invoke('get-profile', id),
  createProfile: (input: unknown) => ipcRenderer.invoke('create-profile', input),
  updateProfile: (id: string, input: unknown) => ipcRenderer.invoke('update-profile', id, input),
  updateFingerprint: (id: string, input: unknown) =>
    ipcRenderer.invoke('update-fingerprint', id, input),
  deleteProfile: (id: string) => ipcRenderer.invoke('delete-profile', id),
  duplicateProfile: (id: string) => ipcRenderer.invoke('duplicate-profile', id),

  launchBrowser: (profileId: string) => ipcRenderer.invoke('launch-browser', profileId),
  stopBrowser: (profileId: string) => ipcRenderer.invoke('stop-browser', profileId),
  getRunningSessions: () => ipcRenderer.invoke('get-running-sessions'),
  detectBrowsers: () => ipcRenderer.invoke('detect-browsers'),

  listProxies: () => ipcRenderer.invoke('list-proxies'),
  createProxy: (input: unknown) => ipcRenderer.invoke('create-proxy', input),
  updateProxy: (id: string, input: unknown) => ipcRenderer.invoke('update-proxy', id, input),
  deleteProxy: (id: string) => ipcRenderer.invoke('delete-proxy', id),
  testProxy: (id: string) => ipcRenderer.invoke('test-proxy', id),

  generateFingerprint: (browserType: string, osHint?: string) =>
    ipcRenderer.invoke('generate-fingerprint', browserType, osHint),

  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('set-setting', key, value),

  // Templates
  listTemplates: () => ipcRenderer.invoke('list-templates'),
  getTemplate: (id: string) => ipcRenderer.invoke('get-template', id),
  createTemplate: (input: unknown) => ipcRenderer.invoke('create-template', input),
  updateTemplate: (id: string, input: unknown) => ipcRenderer.invoke('update-template', id, input),
  deleteTemplate: (id: string) => ipcRenderer.invoke('delete-template', id),
  createProfileFromTemplate: (templateId: string, name: string) =>
    ipcRenderer.invoke('create-profile-from-template', templateId, name),

  // Session History
  getSessionHistory: (profileId?: string) => ipcRenderer.invoke('get-session-history', profileId),

  // Bulk operations
  bulkLaunch: (ids: string[]) => ipcRenderer.invoke('bulk-launch', ids),
  bulkStop: (ids: string[]) => ipcRenderer.invoke('bulk-stop', ids),
  bulkDelete: (ids: string[]) => ipcRenderer.invoke('bulk-delete', ids),

  // Cookie import/export
  exportCookies: (profileId: string) => ipcRenderer.invoke('export-cookies', profileId),
  importCookies: (profileId: string, data: string) => ipcRenderer.invoke('import-cookies', profileId, data),

  // Health & Validation
  checkProcessHealth: () => ipcRenderer.invoke('check-process-health'),
  validateFingerprint: (profileId: string) => ipcRenderer.invoke('validate-fingerprint', profileId),

  onSessionStarted: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('session:started', handler)
    return () => {
      ipcRenderer.removeListener('session:started', handler)
    }
  },
  onSessionStopped: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('session:stopped', handler)
    return () => {
      ipcRenderer.removeListener('session:stopped', handler)
    }
  },
  onSessionState: (callback: (data: unknown) => void) => {
    const handler = (_: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('session:state', handler)
    return () => {
      ipcRenderer.removeListener('session:state', handler)
    }
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(window as unknown as Record<string, unknown>).api = api
}
