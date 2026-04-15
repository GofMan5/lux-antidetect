import type {
  BrowserType,
  CreateProfileInput,
  Fingerprint,
  Profile,
  ProfileDetail,
  ProfileStatus,
  ProxyInput,
  ProxyResponse,
  SessionHistoryEntry,
  SessionInfo,
  Template,
  TemplateInput,
  UpdateFingerprintInput,
  UpdateProfileInput,
  ManagedBrowserResponse,
  AvailableBrowser
} from '../main/models'

// Reuse the canonical session payload to keep preload and main in lockstep.
export type SessionStartedEvent = SessionInfo

type SessionEventProfileId = SessionInfo['profile_id']

export interface SessionStoppedEvent {
  profile_id: SessionEventProfileId
  exit_code: number | null
}

export interface SessionStateEvent {
  profile_id: SessionEventProfileId
  status: ProfileStatus
  error?: string
}

export interface LuxAPI {
  listProfiles(): Promise<Profile[]>
  getProfile(id: string): Promise<ProfileDetail>
  createProfile(input: CreateProfileInput): Promise<Profile>
  updateProfile(id: string, input: UpdateProfileInput): Promise<Profile>
  updateFingerprint(id: string, input: UpdateFingerprintInput): Promise<void>
  deleteProfile(id: string): Promise<void>
  duplicateProfile(id: string): Promise<Profile>

  launchBrowser(profileId: string): Promise<{ pid: number }>
  stopBrowser(profileId: string): Promise<void>
  getRunningSessions(): Promise<SessionInfo[]>
  detectBrowsers(): Promise<Record<string, string>>

  listProxies(): Promise<ProxyResponse[]>
  createProxy(input: ProxyInput): Promise<ProxyResponse>
  updateProxy(id: string, input: ProxyInput): Promise<ProxyResponse>
  deleteProxy(id: string): Promise<void>
  testProxy(id: string): Promise<boolean>
  parseProxyString(raw: string): Promise<{ ok: boolean; data?: ProxyInput; error?: string }[]>
  bulkTestProxies(ids: string[]): Promise<{ id: string; ok: boolean }[]>

  generateFingerprint(browserType: BrowserType): Promise<Omit<Fingerprint, 'id' | 'profile_id'>>

  onSessionStarted(callback: (data: SessionStartedEvent) => void): () => void
  onSessionStopped(callback: (data: SessionStoppedEvent) => void): () => void
  onSessionState(callback: (data: SessionStateEvent) => void): () => void

  getSetting(key: string): Promise<unknown>
  setSetting(key: string, value: unknown): Promise<void>

  listTemplates(): Promise<Template[]>
  getTemplate(id: string): Promise<Template>
  createTemplate(input: TemplateInput): Promise<Template>
  updateTemplate(id: string, input: Partial<TemplateInput>): Promise<Template>
  deleteTemplate(id: string): Promise<void>
  createProfileFromTemplate(templateId: string, name: string): Promise<Profile>

  getSessionHistory(profileId?: string): Promise<SessionHistoryEntry[]>

  bulkLaunch(ids: string[]): Promise<{ id: string; ok: boolean; error?: string }[]>
  bulkStop(ids: string[]): Promise<{ id: string; ok: boolean; error?: string }[]>
  bulkDelete(ids: string[]): Promise<{ id: string; ok: boolean; error?: string }[]>

  exportCookies(profileId: string): Promise<{ path: string; exists: boolean }>
  importCookies(profileId: string, data: string): Promise<{ ok: boolean }>

  checkProcessHealth(): Promise<{ dead: string[] }>
  validateFingerprint(profileId: string): Promise<{ valid: boolean; issues: string[] }>

  // Auto-updates
  checkForUpdates(): Promise<unknown>
  installUpdate(): Promise<void>
  onUpdateAvailable(callback: (data: { version: string }) => void): () => void
  onUpdateDownloaded(callback: (data: { version: string }) => void): () => void
  onUpdateProgress(callback: (data: { percent: number }) => void): () => void
  onUpdateError(callback: (data: { message: string }) => void): () => void

  // Browser management (download / list / remove)
  listManagedBrowsers(): Promise<ManagedBrowserResponse[]>
  getAvailableBrowsers(): Promise<AvailableBrowser[]>
  downloadBrowser(browserType: BrowserType, channel?: string): Promise<ManagedBrowserResponse>
  removeManagedBrowser(browser: string, buildId: string): Promise<void>
  cancelBrowserDownload(browser: string, buildId: string): Promise<boolean>
  onBrowserDownloadProgress(callback: (data: { browser: string; buildId: string; downloadedBytes: number; totalBytes: number; percent: number }) => void): () => void
  onBrowserDownloadComplete(callback: (data: ManagedBrowserResponse) => void): () => void
  onBrowserDownloadError(callback: (data: { browser: string; buildId: string; message: string }) => void): () => void
}