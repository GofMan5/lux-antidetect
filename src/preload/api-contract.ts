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
  AvailableBrowser,
  AiActionApplyResult,
  AiChat,
  AiChatMessage,
  AiModel,
  AiProfileAction,
  AiSendMessageInput,
  AiSendMessageResult,
  AiSettings
} from '../main/models'
import type { ProxyGeoBundle, IpFraudReport } from '../main/geoip'
import type { PresetDescriptor } from '../main/fingerprint-presets'

export type { PresetDescriptor } from '../main/fingerprint-presets'

// Canonical IPC shape for profile extensions. Stored as integer in SQLite, so `enabled` is `0 | 1`.
export interface ProfileExtension {
  id: string
  profile_id: string
  name: string
  path: string
  enabled: number
  created_at: string
}

export interface LocalApiServerStatus {
  enabled: boolean
  running: boolean
  host: string
  port: number
  baseUrl: string
  token: string
}

export interface McpServerInfo {
  available: boolean
  command: string
  args: string[]
  serverPath: string
  packagePath: string
  readmePath: string
  installHint: string
}

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

export interface ProfileExtension {
  id: string
  profile_id: string
  name: string
  path: string
  enabled: number
  created_at: string
}

export interface LuxAPI {
  listProfiles(): Promise<Profile[]>
  getProfile(id: string): Promise<ProfileDetail>
  createProfile(input: CreateProfileInput): Promise<Profile>
  updateProfile(id: string, input: UpdateProfileInput): Promise<Profile>
  updateFingerprint(id: string, input: UpdateFingerprintInput): Promise<void>
  deleteProfile(id: string): Promise<void>
  wipeProfileData(id: string): Promise<void>
  duplicateProfile(id: string): Promise<Profile>
  revealProfileDir(id: string): Promise<void>
  getProxyConnectionString(proxyId: string): Promise<string>

  launchBrowser(profileId: string, opts?: { targetUrl?: string }): Promise<{ pid: number }>
  stopBrowser(profileId: string): Promise<void>
  openUrlInProfile(
    profileId: string,
    targetUrl: string
  ): Promise<{ opened: 'cdp' | 'launched'; pid?: number }>
  getRunningSessions(): Promise<SessionInfo[]>
  detectBrowsers(): Promise<Record<string, string>>

  listProxies(): Promise<ProxyResponse[]>
  createProxy(input: ProxyInput): Promise<ProxyResponse>
  updateProxy(id: string, input: ProxyInput): Promise<ProxyResponse>
  deleteProxy(id: string): Promise<void>
  testProxy(id: string): Promise<boolean>
  getProxyGroups(): Promise<string[]>
  lookupProxyCountry(id: string): Promise<string | null>
  lookupProxyGeo(id: string): Promise<ProxyGeoBundle | null>
  // Dry-run reputation check — same bundle as lookupProxyGeo but for an
  // un-persisted ProxyInput. Used by the bulk-import filter.
  dryRunFraudCheck(input: ProxyInput): Promise<ProxyGeoBundle | null>
  // Standalone IP fraud check — investigate an arbitrary IP without binding
  // to a proxy. Direct query (Lux host visible to the providers).
  lookupFraudByIp(ip: string): Promise<IpFraudReport | null>
  parseProxyString(raw: string): Promise<{ ok: boolean; data?: ProxyInput; error?: string; line: string }[]>
  bulkTestProxies(ids: string[]): Promise<{ id: string; ok: boolean }[]>

  generateFingerprint(browserType: BrowserType): Promise<Omit<Fingerprint, 'id' | 'profile_id'>>

  listFingerprintPresets(): Promise<PresetDescriptor[]>
  generateFingerprintFromPreset(
    presetId: string,
    overrides?: Partial<Fingerprint>
  ): Promise<Omit<Fingerprint, 'id' | 'profile_id'>>

  onSessionStarted(callback: (data: SessionStartedEvent) => void): () => void
  onSessionStopped(callback: (data: SessionStoppedEvent) => void): () => void
  onSessionState(callback: (data: SessionStateEvent) => void): () => void

  getSetting(key: string): Promise<unknown>
  setSetting(key: string, value: unknown): Promise<void>
  getApiServerStatus(): Promise<LocalApiServerStatus>
  configureApiServer(input: {
    enabled?: boolean
    host?: string
    port?: number | string
  }): Promise<LocalApiServerStatus>
  regenerateApiServerToken(): Promise<LocalApiServerStatus>
  getMcpServerInfo(): Promise<McpServerInfo>
  revealMcpServer(): Promise<void>

  aiGetSettings(): Promise<AiSettings>
  aiSetSettings(input: {
    apiKey?: string
    model?: string
    proxyId?: string | null
    clearApiKey?: boolean
  }): Promise<AiSettings>
  aiListChats(): Promise<AiChat[]>
  aiListModels(): Promise<AiModel[]>
  aiCreateChat(title?: string): Promise<AiChat>
  aiDeleteChat(chatId: string): Promise<void>
  aiListMessages(chatId: string): Promise<AiChatMessage[]>
  aiSendMessage(input: AiSendMessageInput): Promise<AiSendMessageResult>
  aiApplyActions(actions: AiProfileAction[]): Promise<AiActionApplyResult[]>

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

  exportCookies(profileId: string, format?: string): Promise<{ data: string; count: number; format: string }>
  importCookies(profileId: string, data: string, format?: string): Promise<{ ok: boolean; imported: number; total: number }>

  getCdpInfo(profileId: string): Promise<{ port: number; wsEndpoint: string; httpEndpoint: string }>

  listProfileExtensions(profileId: string): Promise<ProfileExtension[]>
  addProfileExtension(profileId: string, path: string): Promise<ProfileExtension>
  toggleProfileExtension(extId: string, enabled: boolean): Promise<{ ok: boolean }>
  removeProfileExtension(extId: string): Promise<{ ok: boolean }>
  installCrxFromFile(
    profileId: string,
    crxPath: string
  ): Promise<ProfileExtension>

  dialogOpenCrx(): Promise<{ canceled: boolean; filePath: string | null }>

  captureScreenshot(profileId: string): Promise<string>

  listBookmarks(profileId: string): Promise<Array<{ id: string; profile_id: string; title: string; url: string; created_at: string }>>
  addBookmark(profileId: string, title: string, url: string): Promise<{ id: string; profile_id: string; title: string; url: string }>
  removeBookmark(bookmarkId: string): Promise<{ ok: boolean }>

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
  downloadBrowser(
    browserType: BrowserType,
    channel?: string,
    browserOverride?: string,
    buildIdOverride?: string
  ): Promise<ManagedBrowserResponse>
  removeManagedBrowser(browser: string, buildId: string): Promise<void>
  cancelBrowserDownload(browser: string, buildId: string): Promise<boolean>
  onBrowserDownloadProgress(callback: (data: { browser: string; buildId: string; downloadedBytes: number; totalBytes: number; percent: number }) => void): () => void
  onBrowserDownloadComplete(callback: (data: ManagedBrowserResponse) => void): () => void
  onBrowserDownloadError(callback: (data: { browser: string; buildId: string; message: string }) => void): () => void
  onProxyMetadataUpdated(callback: (data: { proxy_id: string }) => void): () => void
  onProxyMetadataChecking(callback: (data: { proxy_id: string }) => void): () => void

  // System settings
  getAutostart(): Promise<boolean>
  setAutostart(enabled: boolean): Promise<boolean>
  setMinimizeToTray(enabled: boolean): Promise<void>

  // Database backup/restore
  exportDatabase(): Promise<{ ok: boolean; path?: string }>
  importDatabase(): Promise<{ ok: boolean; error?: string; requiresRestart?: boolean }>
}
