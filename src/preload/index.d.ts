import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  Profile,
  ProfileDetail,
  ProxyResponse,
  Fingerprint,
  SessionInfo,
  SessionHistoryEntry,
  Template,
  TemplateInput,
  CreateProfileInput,
  UpdateProfileInput,
  UpdateFingerprintInput,
  ProxyInput,
  BrowserType
} from '../main/models'

interface LuxAPI {
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

  generateFingerprint(
    browserType: BrowserType,
    osHint?: string
  ): Promise<Omit<Fingerprint, 'id' | 'profile_id'>>

  onSessionStarted(
    callback: (data: { profile_id: string; pid: number; browser_type: string; started_at: string }) => void
  ): () => void
  onSessionStopped(
    callback: (data: { profile_id: string; exit_code: number | null }) => void
  ): () => void
  onSessionState(
    callback: (data: { profile_id: string; status: string; error?: string }) => void
  ): () => void

  getSetting(key: string): Promise<unknown>
  setSetting(key: string, value: unknown): Promise<void>

  // Templates
  listTemplates(): Promise<Template[]>
  getTemplate(id: string): Promise<Template>
  createTemplate(input: TemplateInput): Promise<Template>
  updateTemplate(id: string, input: Partial<TemplateInput>): Promise<Template>
  deleteTemplate(id: string): Promise<void>
  createProfileFromTemplate(templateId: string, name: string): Promise<Profile>

  // Session History
  getSessionHistory(profileId?: string): Promise<SessionHistoryEntry[]>

  // Bulk operations
  bulkLaunch(ids: string[]): Promise<{ id: string; ok: boolean; error?: string }[]>
  bulkStop(ids: string[]): Promise<{ id: string; ok: boolean; error?: string }[]>
  bulkDelete(ids: string[]): Promise<{ id: string; ok: boolean; error?: string }[]>

  // Cookies
  exportCookies(profileId: string): Promise<{ path: string; exists: boolean }>
  importCookies(profileId: string, data: string): Promise<{ ok: boolean }>

  // Health & Validation
  checkProcessHealth(): Promise<{ dead: string[] }>
  validateFingerprint(profileId: string): Promise<{ valid: boolean; issues: string[] }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: LuxAPI
  }
}
