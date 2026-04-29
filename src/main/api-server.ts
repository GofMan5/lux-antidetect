import { app, type BrowserWindow, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync
} from 'fs'
import { promises as fsp } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { URL } from 'node:url'
import { v4 as uuidv4 } from 'uuid'
import { installCrxIntoProfile } from './crx'
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  getProfile,
  listProfiles,
  syncFingerprintsForProxy,
  updateFingerprint,
  updateProfile,
  wipeProfileBrowserData
} from './profile'
import {
  createProxy,
  deleteProxy,
  getProxyGroups,
  listProxies,
  parseProxyLine,
  testProxy,
  updateProxy
} from './proxy'
import { dryRunProxyMetadata, lookupFraudByIp, lookupProxyGeo } from './geoip'
import {
  detectBrowsers,
  exportCookiesCDP,
  importCookiesCDP,
  parseNetscapeCookies,
  toNetscapeCookies,
  captureScreenshot,
  captureScreenshotCDP,
  executeJavaScriptCDP,
  type CdpCookie,
  getActiveBrowserProfileIds,
  getCdpConnectionInfo,
  launchBrowser,
  listCdpPageTargets,
  openUrlInProfile,
  stopBrowser
} from './browser'
import {
  cancelDownload,
  downloadBrowser,
  getAvailableBrowsers,
  listManagedBrowsers,
  removeManagedBrowser
} from './browser-manager'
import { generateDefaultFingerprint } from './fingerprint'
import { generateFingerprintFromPreset, listFingerprintPresets } from './fingerprint-presets'
import { getAllSessions, getSession, getSessionHistory, onSessionEvent } from './sessions'
import {
  createAutomationScript,
  deleteAutomationScript,
  getAutomationScript,
  listAutomationRuns,
  listAutomationScripts,
  runAdHocAutomation,
  runAutomationScript,
  updateAutomationScript
} from './automation'
import { autofixProfileHealth, getProfileHealth, listProfileHealth } from './profile-health'
import { checkForUpdates, clearUpdateErrorState, getUpdateState, installUpdate } from './updater'
import {
  applyAiActions,
  createAiChat,
  deleteAiChat,
  getAiSettings,
  listAiChats,
  listAiMessages,
  listAiModels,
  sendAiMessage,
  setAiSettings
} from './ai'
import type {
  AiProfileAction,
  AiSendMessageInput,
  AutomationScriptInput,
  AutomationStep,
  BrowserType,
  CreateProfileInput,
  Fingerprint,
  Profile,
  ProxyInput,
  ProxyResponse,
  TemplateInput,
  UpdateFingerprintInput,
  UpdateProfileInput
} from './models'

const API_VERSION = 'v1'
const DEFAULT_API_HOST = '127.0.0.1'
const DEFAULT_API_PORT = 17888
const MAX_BODY_BYTES = 1_000_000
const BULK_PROXY_MAX_BYTES = 1_000_000
const BULK_PROXY_MAX_LINES = 10_000
const BULK_TEST_CONCURRENCY = 25
const BULK_TEST_MAX_IDS = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:'])
const BROWSER_TYPES = new Set<BrowserType>(['chromium', 'firefox', 'edge'])
const TRANSLATION_TARGET_LANGS = new Set([
  'en',
  'ru',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'zh-CN',
  'ja',
  'ko',
  'tr',
  'uk',
  'pl'
])
const SETTING_KEYS = new Set([
  'active_theme_id',
  'custom_themes',
  'auto_regenerate_fingerprint',
  'hardware_identity_lockdown',
  'translation_enabled',
  'translation_target_lang',
  'auto_check_updates',
  'minimize_to_tray',
  'max_concurrent_sessions',
  'auto_start_profiles',
  'session_timeout_minutes'
])
const PENDING_IMPORT_DB = 'lux.db.pending-import'
const REQUIRED_DB_TABLES = ['profiles', 'fingerprints', 'proxies', 'settings']
const DATABASE_BACKUP_DIR_NAME = 'Lux Antidetect'
const SAFE_BACKUP_FILENAME_RE = /^[A-Za-z0-9._ -]+\.db$/i
const MANAGED_BROWSER_OVERRIDES = new Set(['chrome', 'chromium', 'firefox'])
const MANAGED_BROWSER_BUILD_ID_RE = /^[A-Za-z0-9._+-]+$/

interface ApiServerConfig {
  enabled: boolean
  host: string
  port: number
  token: string
}

export interface ApiServerStatus {
  enabled: boolean
  running: boolean
  host: string
  port: number
  baseUrl: string
  token: string
}

let server: Server | null = null
let activeConfig: ApiServerConfig | null = null
let activeContext: {
  db: Database.Database
  profilesDir: string
  getMainWindow: () => BrowserWindow
} | null = null
let unsubscribeSessionEvents: (() => void) | null = null
const eventClients = new Set<ServerResponse>()
let eventSeq = 0

interface LocalApiEvent {
  id: number
  type: string
  created_at: string
  data: unknown
}

interface WebhookConfig {
  id: string
  url: string
  secret: string
  events: string[]
  enabled: boolean
  created_at: string
}

interface WebhookDelivery {
  id: string
  webhook_id: string
  event_type: string
  ok: boolean
  status_code: number | null
  error: string | null
  created_at: string
}

const webhookDeliveries: WebhookDelivery[] = []

function getSetting(db: Database.Database, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value) as unknown
  } catch {
    return row.value
  }
}

function setSetting(db: Database.Database, key: string, value: unknown): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    key,
    JSON.stringify(value)
  )
}

function generateApiToken(): string {
  return `lux_${randomBytes(32).toString('base64url')}`
}

function normalizeHost(value: unknown): string {
  if (value === undefined || value === null || value === '') return DEFAULT_API_HOST
  if (typeof value !== 'string') throw new Error('API host must be a string')
  const host = value.trim()
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error('API host must be 127.0.0.1 or localhost')
  }
  return host
}

function normalizePort(value: unknown): number {
  if (value === undefined || value === null || value === '') return DEFAULT_API_PORT
  const port =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('API port must be an integer between 1024 and 65535')
  }
  return port
}

function normalizeEnabled(value: unknown): boolean {
  return value === true
}

function readApiConfig(db: Database.Database): ApiServerConfig {
  let token = getSetting(db, 'api_token')
  if (typeof token !== 'string' || !token.startsWith('lux_') || token.length < 40) {
    token = generateApiToken()
    setSetting(db, 'api_token', token)
  }
  const apiToken = String(token)
  return {
    enabled: normalizeEnabled(getSetting(db, 'api_enabled')),
    host: normalizeHost(getSetting(db, 'api_host')),
    port: normalizePort(getSetting(db, 'api_port')),
    token: apiToken
  }
}

function toStatus(config: ApiServerConfig): ApiServerStatus {
  const hostForUrl = config.host === 'localhost' ? 'localhost' : '127.0.0.1'
  return {
    enabled: config.enabled,
    running: server !== null,
    host: config.host,
    port: config.port,
    baseUrl: `http://${hostForUrl}:${config.port}/api/${API_VERSION}`,
    token: config.token
  }
}

function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new Error('Invalid ID format')
}

function validateHttpUrl(raw: unknown, field = 'url'): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw new Error(`${field} must be a string`)
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`${field} must be a valid URL`)
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`${field} protocol must be http: or https:`)
  }
  return trimmed
}

function sanitizeProfileInput<T extends CreateProfileInput | UpdateProfileInput>(
  raw: T,
  requireName = false
): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Profile input must be an object')
  }

  const source = raw as Record<string, unknown>
  const next = { ...raw } as T

  if (requireName || Object.prototype.hasOwnProperty.call(source, 'name')) {
    if (typeof source.name !== 'string' || !source.name.trim()) {
      throw new Error('Profile name is required')
    }
    ;(next as Record<string, unknown>).name = source.name.trim()
  }

  if (Object.prototype.hasOwnProperty.call(source, 'browser_type')) {
    if (!BROWSER_TYPES.has(source.browser_type as BrowserType)) {
      throw new Error('browser_type must be chromium, firefox, or edge')
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'proxy_id')) {
    const proxyId = source.proxy_id
    if (proxyId !== undefined && proxyId !== null && proxyId !== '') {
      assertUuid(proxyId as string)
    }
  }

  if (Object.prototype.hasOwnProperty.call(source, 'start_url')) {
    ;(next as Record<string, unknown>).start_url =
      validateHttpUrl(source.start_url, 'start_url') ?? ''
  }

  return next
}

function readMaxConcurrentSessions(db: Database.Database): number | null {
  const value = getSetting(db, 'max_concurrent_sessions')
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  return value
}

function assertLaunchCapacity(db: Database.Database, profileId: string): void {
  const maxConcurrent = readMaxConcurrentSessions(db)
  if (maxConcurrent === null) return
  const active = new Set<string>(getActiveBrowserProfileIds())
  for (const session of getAllSessions()) active.add(session.profile_id)
  if (active.has(profileId)) return
  if (active.size >= maxConcurrent) {
    throw new Error(`Max concurrent sessions (${maxConcurrent}) reached`)
  }
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {}
): void {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  })
  res.end(JSON.stringify(payload))
}

function sendOk(res: ServerResponse, data: unknown = null): void {
  sendJson(res, 200, { ok: true, data })
}

function sendError(res: ServerResponse, statusCode: number, message: string): void {
  sendJson(res, statusCode, { ok: false, error: { message } })
}

function publishEvent(type: string, data: unknown): void {
  const event: LocalApiEvent = {
    id: ++eventSeq,
    type,
    created_at: new Date().toISOString(),
    data
  }
  const payload = `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  for (const client of eventClients) {
    try {
      client.write(payload)
    } catch {
      eventClients.delete(client)
    }
  }
  deliverWebhooks(event).catch(() => {})
}

function readWebhooks(db: Database.Database): WebhookConfig[] {
  const raw = getSetting(db, 'api_webhooks')
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is WebhookConfig => {
    if (!isObject(item)) return false
    return (
      typeof item.id === 'string' &&
      typeof item.url === 'string' &&
      typeof item.secret === 'string' &&
      Array.isArray(item.events) &&
      typeof item.enabled === 'boolean' &&
      typeof item.created_at === 'string'
    )
  })
}

function writeWebhooks(db: Database.Database, webhooks: WebhookConfig[]): void {
  setSetting(db, 'api_webhooks', webhooks)
}

function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64url')
}

function validateWebhookUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Webhook URL is required')
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new Error('Webhook URL must be valid')
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Webhook URL protocol must be http: or https:')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Webhook URL must not include credentials')
  }
  return parsed.toString()
}

function normalizeWebhookEvents(raw: unknown): string[] {
  if (raw === undefined || raw === null) return ['*']
  if (!Array.isArray(raw)) throw new Error('events must be an array')
  const events = raw
    .filter((event): event is string => typeof event === 'string')
    .map((event) => event.trim())
    .filter(Boolean)
  if (events.length === 0) return ['*']
  if (events.length > 50) throw new Error('Too many webhook event filters')
  return Array.from(new Set(events))
}

function appendWebhookDelivery(delivery: WebhookDelivery): void {
  webhookDeliveries.unshift(delivery)
  webhookDeliveries.splice(200)
}

async function deliverWebhooks(event: LocalApiEvent): Promise<void> {
  const context = activeContext
  if (!activeConfig?.enabled || !server) return
  if (!context) return
  const webhooks = readWebhooks(context.db).filter((webhook) => {
    if (!webhook.enabled) return false
    return webhook.events.includes('*') || webhook.events.includes(event.type)
  })
  await Promise.all(webhooks.map((webhook) => deliverWebhook(webhook, event)))
}

async function deliverWebhook(webhook: WebhookConfig, event: LocalApiEvent): Promise<void> {
  const body = JSON.stringify(event)
  const signature = createHmac('sha256', webhook.secret).update(body).digest('hex')
  const url = new URL(webhook.url)
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest

  await new Promise<void>((resolve) => {
    const req = transport(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        timeout: 5000,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'x-lux-event': event.type,
          'x-lux-delivery': String(event.id),
          'x-lux-signature': `sha256=${signature}`
        }
      },
      (response) => {
        response.resume()
        response.on('end', () => {
          const statusCode = response.statusCode ?? null
          appendWebhookDelivery({
            id: randomBytes(12).toString('hex'),
            webhook_id: webhook.id,
            event_type: event.type,
            ok: !!statusCode && statusCode >= 200 && statusCode < 300,
            status_code: statusCode,
            error: null,
            created_at: new Date().toISOString()
          })
          resolve()
        })
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', (err) => {
      appendWebhookDelivery({
        id: randomBytes(12).toString('hex'),
        webhook_id: webhook.id,
        event_type: event.type,
        ok: false,
        status_code: null,
        error: err.message,
        created_at: new Date().toISOString()
      })
      resolve()
    })
    req.end(body)
  })
}

function registerSessionEventBridge(): void {
  if (unsubscribeSessionEvents) return
  unsubscribeSessionEvents = onSessionEvent((event) => {
    publishEvent(event.type, event.data)
  })
}

function closeEventClients(): void {
  for (const client of eventClients) {
    try {
      client.end()
    } catch {
      /* ignore */
    }
  }
  eventClients.clear()
}

function handleEventStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  eventClients.add(res)
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, created_at: new Date().toISOString() })}\n\n`)
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n')
    } catch {
      clearInterval(heartbeat)
      eventClients.delete(res)
    }
  }, 25_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    eventClients.delete(res)
  })
}

function getRequestPath(req: IncomingMessage): string[] {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] !== 'api' || parts[1] !== API_VERSION) {
    throw new Error('Not found')
  }
  return parts.slice(2)
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'DELETE') return undefined
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new Error(`Request body too large (max ${MAX_BODY_BYTES} bytes)`)
    chunks.push(buf)
  }
  if (chunks.length === 0) return undefined
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return undefined
  return JSON.parse(raw) as unknown
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const headerToken = typeof req.headers['x-lux-token'] === 'string' ? req.headers['x-lux-token'] : ''
  const supplied = bearer || headerToken
  if (!supplied) return false
  const expected = Buffer.from(token)
  const actual = Buffer.from(supplied)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function getBodyObject(body: unknown): Record<string, unknown> {
  if (body === undefined) return {}
  if (!isObject(body)) throw new Error('Request body must be a JSON object')
  return body
}

function validateSettingKey(key: unknown): string {
  if (typeof key !== 'string' || !SETTING_KEYS.has(key)) {
    throw new Error('Unsupported setting key')
  }
  return key
}

function validateProfileIdList(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw)) throw new Error(`${field} must be an array`)
  if (raw.length > 500) throw new Error('Too many profiles (max 500)')
  for (const id of raw) assertUuid(String(id))
  return raw.map(String)
}

function normalizeSettingValue(key: string, value: unknown): unknown {
  switch (key) {
    case 'active_theme_id':
      if (typeof value !== 'string' || !value.trim() || value.length > 120) {
        throw new Error('active_theme_id must be a non-empty string')
      }
      return value.trim()
    case 'custom_themes':
      if (!Array.isArray(value)) throw new Error('custom_themes must be an array')
      if (value.length > 50 || JSON.stringify(value).length > 200_000) {
        throw new Error('custom_themes is too large')
      }
      return value
    case 'auto_regenerate_fingerprint':
    case 'hardware_identity_lockdown':
    case 'translation_enabled':
    case 'auto_check_updates':
    case 'minimize_to_tray':
      if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
      return value
    case 'translation_target_lang':
      if (typeof value !== 'string' || !TRANSLATION_TARGET_LANGS.has(value)) {
        throw new Error('translation_target_lang is invalid')
      }
      return value
    case 'max_concurrent_sessions':
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 500) {
        throw new Error('max_concurrent_sessions must be an integer between 0 and 500')
      }
      return value
    case 'session_timeout_minutes':
      if (value !== null && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10080)) {
        throw new Error('session_timeout_minutes must be null or an integer between 0 and 10080')
      }
      return value
    case 'auto_start_profiles':
      return validateProfileIdList(value, 'auto_start_profiles')
    default:
      throw new Error('Unsupported setting key')
  }
}

const ALLOWED_OVERRIDE_KEYS = [
  'timezone',
  'languages',
  'webrtc_policy',
  'fonts_list',
  'canvas_noise_seed',
  'audio_context_noise'
] as const satisfies readonly (keyof Fingerprint)[]

function sanitizeOverrides(raw: unknown): Partial<Fingerprint> | undefined {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const source = raw as Record<string, unknown>
  const result: Partial<Fingerprint> = Object.create(null)
  let hasKey = false
  for (const key of ALLOWED_OVERRIDE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = source[key]
    if (value === undefined) continue
    ;(result as Record<string, unknown>)[key] = value
    hasKey = true
  }
  return hasKey ? result : undefined
}

function assertLocalExtDir(p: unknown, profilesDir: string, profileId: string): string {
  if (typeof p !== 'string' || p.trim().length === 0) {
    throw new Error('Extension path is required')
  }
  const abs = resolve(p)
  const allowedRoot = resolve(join(profilesDir, profileId))
  if (!(abs + '\\').startsWith(allowedRoot + '\\') && !(abs + '/').startsWith(allowedRoot + '/')) {
    throw new Error('Extension path is outside the profile directory')
  }
  let st
  try {
    st = statSync(abs)
  } catch {
    throw new Error('Extension path does not exist')
  }
  if (!st.isDirectory()) throw new Error('Extension path must be a directory')
  if (!existsSync(join(abs, 'manifest.json'))) {
    throw new Error('Extension directory is missing manifest.json')
  }
  return abs
}

function readManifestNameSync(extDir: string): string | null {
  try {
    const raw = readFileSync(join(extDir, 'manifest.json'), 'utf8')
    const parsed = JSON.parse(raw) as { name?: unknown }
    if (typeof parsed.name === 'string') {
      const name = parsed.name.trim()
      if (name.length > 0 && !name.startsWith('__MSG_')) return name
    }
    return null
  } catch {
    return null
  }
}

function getDbPath(db: Database.Database): string {
  const dbPath = (db as Database.Database & { name?: string }).name
  if (!dbPath || dbPath === ':memory:') throw new Error('Database file path is not available')
  return dbPath
}

function validateManagedBrowserOverride(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (typeof raw !== 'string' || !MANAGED_BROWSER_OVERRIDES.has(raw)) {
    throw new Error('browser must be chrome, chromium, or firefox')
  }
  return raw
}

function validateManagedBrowserBuildId(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (
    typeof raw !== 'string' ||
    raw === '.' ||
    raw === '..' ||
    raw.includes('/') ||
    raw.includes('\\') ||
    !MANAGED_BROWSER_BUILD_ID_RE.test(raw)
  ) {
    throw new Error('Invalid browser buildId')
  }
  return raw
}

function defaultBackupFileName(): string {
  return `lux-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`
}

function resolveDatabaseExportPath(rawPath: unknown, overwrite: boolean): string {
  const backupDir = join(app.getPath('documents'), DATABASE_BACKUP_DIR_NAME)
  const rawName = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : defaultBackupFileName()
  if (isAbsolute(rawName) || rawName.includes('/') || rawName.includes('\\')) {
    throw new Error(`Database export path must be a filename inside ${backupDir}`)
  }
  const fileName = rawName.toLowerCase().endsWith('.db') ? rawName : `${rawName}.db`
  if (!SAFE_BACKUP_FILENAME_RE.test(fileName)) {
    throw new Error('Database export filename may only contain letters, numbers, spaces, dot, underscore, and dash')
  }
  const targetPath = join(backupDir, fileName)
  if (existsSync(targetPath) && !overwrite) {
    throw new Error('Database export target already exists; pass overwrite=true to replace it')
  }
  return targetPath
}

async function validateDatabaseBackup(filePath: string): Promise<string | null> {
  let fd: number | undefined
  try {
    fd = openSync(filePath, 'r')
    const headerBuf = Buffer.alloc(16)
    readSync(fd, headerBuf, 0, 16, 0)
    closeSync(fd)
    fd = undefined
    if (!headerBuf.toString().startsWith('SQLite format 3')) {
      return 'Not a valid SQLite database'
    }
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
    return `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`
  }

  const { default: DatabaseCtor } = await import('better-sqlite3')
  let candidate: Database.Database | null = null
  try {
    candidate = new DatabaseCtor(filePath, { readonly: true, fileMustExist: true })
    const integrity = candidate.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') return 'SQLite integrity check failed'

    const placeholders = REQUIRED_DB_TABLES.map(() => '?').join(',')
    const rows = candidate
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
      .all(...REQUIRED_DB_TABLES) as { name: string }[]
    const present = new Set(rows.map((row) => row.name))
    const missing = REQUIRED_DB_TABLES.filter((name) => !present.has(name))
    if (missing.length > 0) {
      return `Database backup is missing required table(s): ${missing.join(', ')}`
    }
    return null
  } catch (err) {
    return `Failed to validate database: ${err instanceof Error ? err.message : 'Unknown error'}`
  } finally {
    try {
      candidate?.close()
    } catch {
      /* ignore */
    }
  }
}

function getProfileStatus(db: Database.Database, profileId: string): Record<string, unknown> {
  const detail = getProfile(db, profileId)
  const session = getSession(profileId)
  const activeBrowserIds = getActiveBrowserProfileIds()
  return {
    profile_id: profileId,
    status: detail.profile.status,
    browser_type: detail.profile.browser_type,
    running: !!session,
    active_browser: activeBrowserIds.has(profileId),
    session: session
      ? {
          profile_id: session.profile_id,
          pid: session.pid,
          browser_type: session.browser_type,
          started_at: session.started_at
        }
      : null,
    cdp_supported: detail.profile.browser_type !== 'firefox'
  }
}

function normalizeCookieImport(body: Record<string, unknown>): {
  cookies: unknown[]
  accepted: CdpCookie[]
  rejected: number
} {
  const format = typeof body.format === 'string' ? body.format : 'json'
  if (format !== 'json' && format !== 'netscape') {
    throw new Error('Cookie format must be json or netscape')
  }
  const rawData = body.data
  const cookies =
    format === 'netscape'
      ? parseNetscapeCookies(typeof rawData === 'string' ? rawData : '')
      : Array.isArray(rawData)
        ? rawData
        : JSON.parse(typeof rawData === 'string' ? rawData : '[]') as unknown
  if (!Array.isArray(cookies)) throw new Error('Invalid cookie data')
  if (cookies.length > 10_000) throw new Error('Too many cookies (max 10000)')
  const isCookieShape = (cookie: unknown): boolean =>
    !!cookie &&
    typeof cookie === 'object' &&
    typeof (cookie as { name?: unknown }).name === 'string' &&
    ((cookie as { name: string }).name).length <= 4096 &&
    typeof (cookie as { value?: unknown }).value === 'string' &&
    ((cookie as { value: string }).value).length <= 8192 &&
    typeof (cookie as { domain?: unknown }).domain === 'string' &&
    ((cookie as { domain: string }).domain).length <= 253
  const accepted = cookies.filter(isCookieShape) as CdpCookie[]
  return { cookies, accepted, rejected: cookies.length - accepted.length }
}

function getQuery(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: ApiServerConfig,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, null, {
      'access-control-allow-origin': 'http://127.0.0.1',
      'access-control-allow-headers': 'authorization,content-type,x-lux-token',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    })
    return
  }

  const parts = getRequestPath(req)
  if (parts[0] === 'health' && req.method === 'GET') {
    sendOk(res, {
      app: 'Lux Antidetect',
      version: app.getVersion(),
      apiVersion: API_VERSION,
      running: true
    })
    return
  }

  if (!isAuthorized(req, config.token)) {
    sendError(res, 401, 'Unauthorized')
    return
  }

  if (parts[0] === 'events' && req.method === 'GET') {
    handleEventStream(req, res)
    return
  }

  const body = await readJsonBody(req)
  const { db, profilesDir, getMainWindow } = context

  if (parts[0] === 'openapi' && req.method === 'GET') {
    sendJson(res, 200, buildOpenApi(config))
    return
  }

  if (parts[0] === 'browsers' && parts[1] === 'detect' && req.method === 'GET') {
    sendOk(res, detectBrowsers())
    return
  }

  if (parts[0] === 'sessions' && req.method === 'GET') {
    sendOk(res, getAllSessions())
    return
  }

  if (parts[0] === 'session-history' && req.method === 'GET') {
    const profileId = getQuery(req).get('profileId') ?? undefined
    if (profileId) assertUuid(profileId)
    sendOk(res, getSessionHistory(profileId))
    return
  }

  if (parts[0] === 'profiles') {
    await handleProfiles(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'proxies') {
    await handleProxies(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'fingerprints') {
    await handleFingerprints(req, res, parts.slice(1), body)
    return
  }

  if (parts[0] === 'settings') {
    await handleSettings(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'templates') {
    await handleTemplates(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'ai') {
    await handleAi(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'bulk') {
    await handleBulk(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'automation') {
    await handleAutomation(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'webhooks') {
    await handleWebhooks(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'managed-browsers') {
    await handleManagedBrowsers(req, res, parts.slice(1), body)
    return
  }

  if (parts[0] === 'updates') {
    await handleUpdates(req, res, parts.slice(1))
    return
  }

  if (parts[0] === 'database') {
    await handleDatabase(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'system') {
    await handleSystem(req, res, parts.slice(1), body, context)
    return
  }

  if (parts[0] === 'kill-switch') {
    await handleKillSwitch(req, res, body, context)
    return
  }

  void db
  void profilesDir
  void getMainWindow
  sendError(res, 404, 'Not found')
}

async function handleProfiles(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db, profilesDir, getMainWindow } = context
  const profileId = parts[0]

  if (!profileId) {
    if (req.method === 'GET') {
      sendOk(res, listProfiles(db))
      return
    }
    if (req.method === 'POST') {
      const input = sanitizeProfileInput(getBodyObject(body) as unknown as CreateProfileInput, true)
      const profile = await createProfile(db, input, profilesDir)
      publishEvent('profile.created', { profile_id: profile.id, profile })
      sendOk(res, profile)
      return
    }
  }

  if (profileId === 'health' && req.method === 'GET') {
    sendOk(res, listProfileHealth(db))
    return
  }

  assertUuid(profileId)

  if (parts.length === 1) {
    if (req.method === 'GET') {
      sendOk(res, getProfile(db, profileId))
      return
    }
    if (req.method === 'PATCH') {
      const input = sanitizeProfileInput(getBodyObject(body) as unknown as UpdateProfileInput)
      const profile = updateProfile(db, profileId, input)
      publishEvent('profile.updated', { profile_id: profileId, profile })
      sendOk(res, profile)
      return
    }
    if (req.method === 'DELETE') {
      await deleteProfile(db, profileId, profilesDir)
      publishEvent('profile.deleted', { profile_id: profileId })
      sendOk(res)
      return
    }
  }

  const action = parts[1]
  if (req.method === 'GET' && action === 'status') {
    sendOk(res, getProfileStatus(db, profileId))
    return
  }
  if (req.method === 'POST' && action === 'duplicate') {
    const profile = await duplicateProfile(db, profileId, profilesDir)
    publishEvent('profile.created', { profile_id: profile.id, source_profile_id: profileId, profile })
    sendOk(res, profile)
    return
  }
  if (req.method === 'POST' && action === 'proxy') {
    const payload = getBodyObject(body)
    const proxyId = payload.proxyId ?? payload.proxy_id ?? null
    if (proxyId !== null) assertUuid(String(proxyId))
    const profile = updateProfile(db, profileId, { proxy_id: proxyId === null ? null : String(proxyId) })
    publishEvent('profile.proxy.updated', { profile_id: profileId, proxy_id: profile.proxy_id })
    sendOk(res, profile)
    return
  }
  if (req.method === 'POST' && action === 'launch') {
    const payload = getBodyObject(body)
    const targetUrl = validateHttpUrl(payload.targetUrl, 'targetUrl')
    assertLaunchCapacity(db, profileId)
    const result = await launchBrowser(db, profileId, profilesDir, getMainWindow(), { targetUrl })
    publishEvent('profile.launched', { profile_id: profileId, ...result })
    sendOk(res, result)
    return
  }
  if (req.method === 'POST' && action === 'stop') {
    await stopBrowser(db, profileId, getMainWindow())
    publishEvent('profile.stopped', { profile_id: profileId })
    sendOk(res)
    return
  }
  if (req.method === 'POST' && action === 'open-url') {
    const payload = getBodyObject(body)
    const targetUrl = validateHttpUrl(payload.url ?? payload.targetUrl, 'url')
    if (!targetUrl) throw new Error('url is required')
    assertLaunchCapacity(db, profileId)
    const result = await openUrlInProfile(db, profileId, targetUrl, profilesDir, getMainWindow())
    publishEvent('profile.url.opened', { profile_id: profileId, url: targetUrl, ...result })
    sendOk(res, result)
    return
  }
  if (req.method === 'GET' && action === 'cdp') {
    sendOk(res, await getCdpConnectionInfo(profileId))
    return
  }
  if (req.method === 'GET' && action === 'tabs') {
    sendOk(res, await listCdpPageTargets(profileId))
    return
  }
  if (req.method === 'POST' && action === 'execute-js') {
    const payload = getBodyObject(body)
    if (typeof payload.script !== 'string' || !payload.script.trim()) {
      throw new Error('script is required')
    }
    const result = await executeJavaScriptCDP(profileId, payload.script, {
      tabId: typeof payload.tabId === 'string' ? payload.tabId : undefined,
      tabIndex: typeof payload.tabIndex === 'number' ? payload.tabIndex : undefined,
      urlContains: typeof payload.urlContains === 'string' ? payload.urlContains : undefined,
      awaitPromise: payload.awaitPromise !== false,
      returnByValue: payload.returnByValue !== false
    })
    sendOk(res, result)
    return
  }
  if (req.method === 'GET' && action === 'screenshot') {
    sendOk(res, await captureScreenshot(profileId))
    return
  }
  if (req.method === 'POST' && action === 'screenshot') {
    const payload = getBodyObject(body)
    sendOk(res, await captureScreenshotCDP(profileId, {
      tabId: typeof payload.tabId === 'string' ? payload.tabId : undefined,
      tabIndex: typeof payload.tabIndex === 'number' ? payload.tabIndex : undefined,
      urlContains: typeof payload.urlContains === 'string' ? payload.urlContains : undefined,
      format: payload.format === 'jpeg' ? 'jpeg' : 'png',
      quality: typeof payload.quality === 'number' ? payload.quality : undefined,
      fullPage: payload.fullPage === true
    }))
    return
  }
  if (req.method === 'GET' && action === 'cookies') {
    const format = getQuery(req).get('format') ?? 'json'
    const cookies = await exportCookiesCDP(profileId)
    if (format === 'netscape') {
      sendOk(res, { data: toNetscapeCookies(cookies), count: cookies.length, format })
      return
    }
    sendOk(res, { data: cookies, count: cookies.length, format: 'json' })
    return
  }
  if (req.method === 'POST' && action === 'cookies' && parts[2] === 'import') {
    const { cookies, accepted, rejected } = normalizeCookieImport(getBodyObject(body))
    const imported = accepted.length > 0 ? await importCookiesCDP(profileId, accepted) : 0
    publishEvent('profile.cookies.imported', {
      profile_id: profileId,
      imported,
      accepted: accepted.length,
      rejected
    })
    sendOk(res, { imported, accepted: accepted.length, rejected, total: cookies.length })
    return
  }
  if (req.method === 'PATCH' && action === 'fingerprint') {
    updateFingerprint(db, profileId, getBodyObject(body) as unknown as UpdateFingerprintInput)
    publishEvent('profile.fingerprint.updated', { profile_id: profileId })
    sendOk(res)
    return
  }
  if (req.method === 'GET' && action === 'health') {
    sendOk(res, getProfileHealth(db, profileId))
    return
  }
  if (req.method === 'POST' && action === 'health' && parts[2] === 'autofix') {
    const result = autofixProfileHealth(db, profileId)
    publishEvent('profile.health.autofixed', { profile_id: profileId, applied: result.applied })
    sendOk(res, result)
    return
  }
  if (req.method === 'POST' && action === 'wipe-data') {
    await wipeProfileBrowserData(db, profileId, profilesDir)
    publishEvent('profile.data.wiped', { profile_id: profileId })
    sendOk(res)
    return
  }
  if (action === 'bookmarks') {
    await handleProfileBookmarks(req, res, profileId, parts.slice(2), body, context)
    return
  }
  if (action === 'extensions') {
    await handleProfileExtensions(req, res, profileId, parts.slice(2), body, context)
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleProfileBookmarks(
  req: IncomingMessage,
  res: ServerResponse,
  profileId: string,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db } = context
  const bookmarkId = parts[0]

  if (!bookmarkId) {
    if (req.method === 'GET') {
      sendOk(
        res,
        db.prepare('SELECT * FROM profile_bookmarks WHERE profile_id = ? ORDER BY created_at DESC').all(profileId)
      )
      return
    }
    if (req.method === 'POST') {
      const payload = getBodyObject(body)
      const validatedUrl = validateHttpUrl(payload.url, 'url')
      if (validatedUrl === undefined) throw new Error('url is required')
      const id = uuidv4()
      const title = typeof payload.title === 'string' && payload.title.trim()
        ? payload.title.trim()
        : validatedUrl
      db.prepare('INSERT INTO profile_bookmarks (id, profile_id, title, url) VALUES (?, ?, ?, ?)')
        .run(id, profileId, title, validatedUrl)
      publishEvent('profile.bookmark.created', { profile_id: profileId, bookmark_id: id })
      sendOk(res, db.prepare('SELECT * FROM profile_bookmarks WHERE id = ?').get(id))
      return
    }
    sendError(res, 404, 'Not found')
    return
  }

  assertUuid(bookmarkId)
  if (req.method === 'DELETE') {
    db.prepare('DELETE FROM profile_bookmarks WHERE id = ? AND profile_id = ?').run(bookmarkId, profileId)
    publishEvent('profile.bookmark.deleted', { profile_id: profileId, bookmark_id: bookmarkId })
    sendOk(res)
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleProfileExtensions(
  req: IncomingMessage,
  res: ServerResponse,
  profileId: string,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db, profilesDir } = context
  const extId = parts[0]

  if (!extId) {
    if (req.method === 'GET') {
      sendOk(
        res,
        db.prepare('SELECT * FROM profile_extensions WHERE profile_id = ? ORDER BY created_at DESC').all(profileId)
      )
      return
    }
    if (req.method === 'POST') {
      const payload = getBodyObject(body)
      const normalizedPath = assertLocalExtDir(payload.path ?? payload.extPath, profilesDir, profileId)
      const name = readManifestNameSync(normalizedPath) ?? normalizedPath.split(/[\\/]/).pop() ?? 'Extension'
      const id = uuidv4()
      db.prepare(
        'INSERT INTO profile_extensions (id, profile_id, name, path, enabled) VALUES (?, ?, ?, ?, 1)'
      ).run(id, profileId, name, normalizedPath)
      publishEvent('profile.extension.added', { profile_id: profileId, extension_id: id })
      sendOk(res, db.prepare('SELECT * FROM profile_extensions WHERE id = ?').get(id))
      return
    }
    sendError(res, 404, 'Not found')
    return
  }

  if (extId === 'install-crx' && req.method === 'POST') {
    const payload = getBodyObject(body)
    const crxPath = typeof payload.crxPath === 'string' ? payload.crxPath.trim() : ''
    if (!crxPath) throw new Error('crxPath is required')
    if (!crxPath.toLowerCase().endsWith('.crx')) throw new Error('File must have .crx extension')
    const profileRow = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)
    if (!profileRow) throw new Error('Profile not found')
    const installed = await installCrxIntoProfile(crxPath, profileId, profilesDir)
    const id = uuidv4()
    try {
      db.prepare(
        'INSERT INTO profile_extensions (id, profile_id, name, path, enabled) VALUES (?, ?, ?, ?, 1)'
      ).run(id, profileId, installed.extensionName, installed.extensionDir)
    } catch (err) {
      await fsp.rm(installed.extensionDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
    publishEvent('profile.extension.installed', { profile_id: profileId, extension_id: id })
    sendOk(res, db.prepare('SELECT * FROM profile_extensions WHERE id = ?').get(id))
    return
  }

  assertUuid(extId)
  if (req.method === 'PATCH') {
    const payload = getBodyObject(body)
    const enabled = payload.enabled === true
    db.prepare('UPDATE profile_extensions SET enabled = ? WHERE id = ? AND profile_id = ?')
      .run(enabled ? 1 : 0, extId, profileId)
    publishEvent('profile.extension.updated', { profile_id: profileId, extension_id: extId, enabled })
    sendOk(res, { ok: true })
    return
  }
  if (req.method === 'DELETE') {
    db.prepare('DELETE FROM profile_extensions WHERE id = ? AND profile_id = ?').run(extId, profileId)
    publishEvent('profile.extension.removed', { profile_id: profileId, extension_id: extId })
    sendOk(res)
    return
  }

  sendError(res, 404, 'Not found')
}

async function bulkImportProxies(
  db: Database.Database,
  payload: Record<string, unknown>
): Promise<{
  imported: number
  failed: number
  results: { line: string; ok: boolean; proxy?: ProxyResponse; error?: string }[]
}> {
  const rawLines =
    typeof payload.text === 'string'
      ? payload.text.split(/\r?\n/)
      : Array.isArray(payload.lines)
        ? payload.lines.map((line) => String(line))
        : []
  if (rawLines.length === 0) throw new Error('text or lines is required')
  if (rawLines.length > BULK_PROXY_MAX_LINES) {
    throw new Error(`Too many proxy lines (max ${BULK_PROXY_MAX_LINES})`)
  }
  const rawSize = rawLines.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf8'), 0)
  if (rawSize > BULK_PROXY_MAX_BYTES) {
    throw new Error(`Proxy import is too large (max ${BULK_PROXY_MAX_BYTES} bytes)`)
  }

  const groupTag = typeof payload.group_tag === 'string' ? payload.group_tag.trim() : ''
  const testAfterImport = payload.test === true
  const results: { line: string; ok: boolean; proxy?: ProxyResponse; error?: string }[] = []

  for (const rawLine of rawLines) {
    const line = rawLine.trim()
    if (!line) continue
    const parsed = parseProxyLine(line)
    if (!parsed.ok) {
      results.push({ line, ok: false, error: parsed.error })
      continue
    }
    try {
      const input: ProxyInput = {
        ...parsed.data,
        group_tag: groupTag || parsed.data.group_tag
      }
      const proxy = createProxy(db, input)
      if (testAfterImport) {
        const ok = await testProxy(db, proxy.id)
        publishEvent('proxy.test.done', { proxy_id: proxy.id, ok })
      }
      results.push({ line, ok: true, proxy })
      publishEvent('proxy.created', { proxy_id: proxy.id, proxy })
    } catch (err) {
      results.push({ line, ok: false, error: err instanceof Error ? err.message : 'Failed' })
    }
  }

  return {
    imported: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results
  }
}

async function handleProxies(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db } = context
  const proxyId = parts[0]

  if (!proxyId) {
    if (req.method === 'GET') {
      sendOk(res, listProxies(db))
      return
    }
    if (req.method === 'POST') {
      const created = createProxy(db, getBodyObject(body) as unknown as ProxyInput)
      publishEvent('proxy.created', { proxy_id: created.id, proxy: created })
      lookupProxyGeo(db, created.id)
        .then((bundle) => {
          if (bundle) syncFingerprintsForProxy(db, created.id)
          publishEvent('proxy.geo.updated', { proxy_id: created.id, geo: bundle })
        })
        .catch(() => {})
      sendOk(res, created)
      return
    }
  }

  if (proxyId === 'parse' && req.method === 'POST') {
    const payload = getBodyObject(body)
    if (typeof payload.line !== 'string') throw new Error('line is required')
    sendOk(res, parseProxyLine(payload.line))
    return
  }

  if (proxyId === 'groups' && req.method === 'GET') {
    sendOk(res, getProxyGroups(db))
    return
  }

  if (proxyId === 'bulk-import' && req.method === 'POST') {
    sendOk(res, await bulkImportProxies(db, getBodyObject(body)))
    return
  }

  if (proxyId === 'bulk-test' && req.method === 'POST') {
    const payload = getBodyObject(body)
    if (!Array.isArray(payload.proxyIds)) throw new Error('proxyIds must be an array')
    const proxyIds = payload.proxyIds.map((id) => String(id))
    if (proxyIds.length > BULK_TEST_MAX_IDS) {
      throw new Error(`Too many proxies (max ${BULK_TEST_MAX_IDS})`)
    }
    const results: { id: string; ok: boolean }[] = new Array(proxyIds.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const index = next++
        if (index >= proxyIds.length) return
        const id = proxyIds[index]
        try {
          assertUuid(id)
          results[index] = { id, ok: await testProxy(db, id) }
        } catch {
          results[index] = { id, ok: false }
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(BULK_TEST_CONCURRENCY, proxyIds.length) }, () => worker())
    )
    sendOk(res, results)
    return
  }

  if (proxyId === 'dry-run-fraud-check' && req.method === 'POST') {
    sendOk(res, await dryRunProxyMetadata(getBodyObject(body) as unknown as ProxyInput))
    return
  }

  if (proxyId === 'lookup-fraud-by-ip' && req.method === 'POST') {
    const payload = getBodyObject(body)
    if (typeof payload.ip !== 'string') throw new Error('ip is required')
    if (payload.ip.length > 64) throw new Error('IP string too long')
    sendOk(res, await lookupFraudByIp(payload.ip))
    return
  }

  assertUuid(proxyId)

  if (req.method === 'PATCH' && parts.length === 1) {
    const proxy = updateProxy(db, proxyId, getBodyObject(body) as unknown as ProxyInput)
    publishEvent('proxy.updated', { proxy_id: proxyId, proxy })
    sendOk(res, proxy)
    return
  }
  if (req.method === 'DELETE' && parts.length === 1) {
    deleteProxy(db, proxyId)
    publishEvent('proxy.deleted', { proxy_id: proxyId })
    sendOk(res)
    return
  }
  if (req.method === 'POST' && parts[1] === 'test') {
    const ok = await testProxy(db, proxyId)
    publishEvent('proxy.test.done', { proxy_id: proxyId, ok })
    sendOk(res, ok)
    return
  }
  if (req.method === 'POST' && parts[1] === 'lookup-geo') {
    const bundle = await lookupProxyGeo(db, proxyId)
    if (bundle) syncFingerprintsForProxy(db, proxyId)
    publishEvent('proxy.geo.updated', { proxy_id: proxyId, geo: bundle })
    sendOk(res, bundle)
    return
  }
  if (req.method === 'GET' && parts[1] === 'connection-string') {
    const row = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as
      | { protocol: string; host: string; port: number; username: string | null; password: string | null }
      | undefined
    if (!row) throw new Error('Proxy not found')
    const auth =
      row.username || row.password
        ? `${encodeURIComponent(row.username ?? '')}:${encodeURIComponent(row.password ?? '')}@`
        : ''
    sendOk(res, `${row.protocol}://${auth}${row.host}:${row.port}`)
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleFingerprints(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown
): Promise<void> {
  if (parts[0] === 'presets') {
    if (parts.length === 1 && req.method === 'GET') {
      sendOk(res, listFingerprintPresets())
      return
    }
    if (parts[1] && parts[2] === 'generate' && req.method === 'POST') {
      sendOk(res, generateFingerprintFromPreset(parts[1], sanitizeOverrides(getBodyObject(body).overrides)))
      return
    }
  }

  if (parts[0] === 'generate' && req.method === 'POST') {
    const payload = getBodyObject(body)
    const browserType = payload.browserType ?? payload.browser_type
    if (!BROWSER_TYPES.has(browserType as BrowserType)) {
      throw new Error('browser_type must be chromium, firefox, or edge')
    }
    sendOk(res, generateDefaultFingerprint(browserType as BrowserType))
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleSettings(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const key = parts[0]
  if (!key) {
    if (req.method === 'GET') {
      sendOk(
        res,
        Object.fromEntries([...SETTING_KEYS].map((settingKey) => [settingKey, getSetting(context.db, settingKey)]))
      )
      return
    }
    sendError(res, 404, 'Not found')
    return
  }

  const validatedKey = validateSettingKey(key)
  if (req.method === 'GET') {
    sendOk(res, getSetting(context.db, validatedKey))
    return
  }
  if (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'POST') {
    const payload = getBodyObject(body)
    const normalized = normalizeSettingValue(validatedKey, payload.value)
    setSetting(context.db, validatedKey, normalized)
    publishEvent('setting.updated', { key: validatedKey })
    sendOk(res, { key: validatedKey, value: normalized })
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleTemplates(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db, profilesDir } = context
  const templateId = parts[0]

  if (!templateId) {
    if (req.method === 'GET') {
      sendOk(res, db.prepare('SELECT * FROM templates ORDER BY updated_at DESC').all())
      return
    }
    if (req.method === 'POST') {
      const input = getBodyObject(body) as unknown as TemplateInput
      if (!input.name || typeof input.name !== 'string') throw new Error('Template name is required')
      if (!BROWSER_TYPES.has(input.browser_type)) {
        throw new Error('browser_type must be chromium, firefox, or edge')
      }
      const id = uuidv4()
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO templates (id, name, description, browser_type, config, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, input.name, input.description ?? '', input.browser_type, JSON.stringify(input.config ?? {}), now, now)
      publishEvent('template.created', { template_id: id })
      sendOk(res, db.prepare('SELECT * FROM templates WHERE id = ?').get(id))
      return
    }
    sendError(res, 404, 'Not found')
    return
  }

  assertUuid(templateId)
  const existing = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId) as
    | Record<string, unknown>
    | undefined
  if (!existing) throw new Error(`Template not found: ${templateId}`)

  if (req.method === 'GET' && parts.length === 1) {
    sendOk(res, existing)
    return
  }
  if (req.method === 'PATCH' && parts.length === 1) {
    const input = getBodyObject(body) as Partial<TemplateInput>
    if (input.browser_type !== undefined && !BROWSER_TYPES.has(input.browser_type)) {
      throw new Error('browser_type must be chromium, firefox, or edge')
    }
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE templates SET name = ?, description = ?, browser_type = ?, config = ?, updated_at = ? WHERE id = ?`
    ).run(
      input.name ?? existing.name,
      input.description ?? existing.description,
      input.browser_type ?? existing.browser_type,
      input.config ? JSON.stringify(input.config) : existing.config,
      now,
      templateId
    )
    publishEvent('template.updated', { template_id: templateId })
    sendOk(res, db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId))
    return
  }
  if (req.method === 'DELETE' && parts.length === 1) {
    db.prepare('DELETE FROM templates WHERE id = ?').run(templateId)
    publishEvent('template.deleted', { template_id: templateId })
    sendOk(res)
    return
  }
  if (req.method === 'POST' && parts[1] === 'create-profile') {
    const payload = getBodyObject(body)
    if (typeof payload.name !== 'string' || !payload.name.trim()) {
      throw new Error('Profile name is required')
    }
    const config = JSON.parse(String(existing.config ?? '{}')) as Record<string, unknown>
    const input: CreateProfileInput = {
      name: payload.name.trim(),
      browser_type: existing.browser_type as BrowserType,
      group_name: config.group_name as string | undefined,
      group_color: config.group_color as string | undefined,
      notes: config.notes as string | undefined,
      proxy_id: config.proxy_id as string | undefined,
      start_url: config.start_url as string | undefined,
      fingerprint: config.fingerprint as Partial<Record<string, unknown>> | undefined
    }
    const profile = await createProfile(db, sanitizeProfileInput(input, true), profilesDir)
    publishEvent('profile.created', { profile_id: profile.id, template_id: templateId, profile })
    sendOk(res, profile)
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleAi(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db } = context
  if (parts[0] === 'settings') {
    if (req.method === 'GET') {
      sendOk(res, getAiSettings(db))
      return
    }
    if (req.method === 'PATCH' || req.method === 'POST') {
      sendOk(
        res,
        setAiSettings(
          db,
          getBodyObject(body) as {
            apiKey?: string
            model?: string
            proxyId?: string | null
            clearApiKey?: boolean
          }
        )
      )
      return
    }
  }

  if (parts[0] === 'models' && req.method === 'GET') {
    sendOk(res, await listAiModels(db))
    return
  }

  if (parts[0] === 'chats') {
    const chatId = parts[1]
    if (!chatId) {
      if (req.method === 'GET') {
        sendOk(res, listAiChats(db))
        return
      }
      if (req.method === 'POST') {
        const payload = getBodyObject(body)
        sendOk(res, createAiChat(db, typeof payload.title === 'string' ? payload.title : undefined))
        return
      }
      sendError(res, 404, 'Not found')
      return
    }
    assertUuid(chatId)
    if (req.method === 'DELETE' && parts.length === 2) {
      deleteAiChat(db, chatId)
      sendOk(res)
      return
    }
    if (req.method === 'GET' && parts[2] === 'messages') {
      sendOk(res, listAiMessages(db, chatId))
      return
    }
  }

  if (parts[0] === 'messages' && req.method === 'POST') {
    sendOk(res, await sendAiMessage(db, getBodyObject(body) as unknown as AiSendMessageInput))
    return
  }

  if (parts[0] === 'actions' && parts[1] === 'apply' && req.method === 'POST') {
    const payload = getBodyObject(body)
    const actions = Array.isArray(payload.actions) ? payload.actions : payload
    sendOk(res, applyAiActions(db, actions as AiProfileAction[]))
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleManagedBrowsers(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown
): Promise<void> {
  if (!parts[0] && req.method === 'GET') {
    sendOk(res, await listManagedBrowsers())
    return
  }
  if (parts[0] === 'available' && req.method === 'GET') {
    sendOk(res, await getAvailableBrowsers())
    return
  }
  if (parts[0] === 'download' && req.method === 'POST') {
    const payload = getBodyObject(body)
    const browserType = payload.browserType ?? payload.browser_type
    if (!BROWSER_TYPES.has(browserType as BrowserType)) {
      throw new Error('browser_type must be chromium, firefox, or edge')
    }
    sendOk(
      res,
      await downloadBrowser(
        browserType as BrowserType,
        typeof payload.channel === 'string' ? payload.channel : 'stable',
        validateManagedBrowserOverride(payload.browser),
        validateManagedBrowserBuildId(payload.buildId)
      )
    )
    return
  }
  if (parts[0] === 'cancel' && req.method === 'POST') {
    const payload = getBodyObject(body)
    const browser = validateManagedBrowserOverride(payload.browser)
    const buildId = validateManagedBrowserBuildId(payload.buildId)
    if (!browser || !buildId) {
      throw new Error('browser and buildId are required')
    }
    sendOk(res, cancelDownload(browser, buildId))
    return
  }
  if (parts[0] && parts[1] && req.method === 'DELETE') {
    await removeManagedBrowser(decodeURIComponent(parts[0]), decodeURIComponent(parts[1]))
    sendOk(res)
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleUpdates(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[]
): Promise<void> {
  if (parts[0] === 'state' && req.method === 'GET') {
    sendOk(res, getUpdateState())
    return
  }
  if (parts[0] === 'check' && req.method === 'POST') {
    try {
      await checkForUpdates()
      sendOk(res, { success: true })
    } catch (err) {
      sendOk(res, { success: false, error: err instanceof Error ? err.message : 'Update check failed' })
    }
    return
  }
  if (parts[0] === 'clear-error' && (req.method === 'POST' || req.method === 'DELETE')) {
    sendOk(res, clearUpdateErrorState())
    return
  }
  if (parts[0] === 'install' && req.method === 'POST') {
    installUpdate()
    sendOk(res)
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleDatabase(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db } = context
  if (parts[0] === 'export' && req.method === 'POST') {
    const payload = getBodyObject(body)
    const targetPath = resolveDatabaseExportPath(payload.path ?? payload.fileName, payload.overwrite === true)
    mkdirSync(dirname(targetPath), { recursive: true })
    try {
      db.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      /* best effort */
    }
    copyFileSync(getDbPath(db), targetPath)
    sendOk(res, { path: targetPath })
    return
  }

  if (parts[0] === 'import' && req.method === 'POST') {
    const payload = getBodyObject(body)
    const sourcePath = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (!sourcePath) throw new Error('path is required')
    const absoluteSource = isAbsolute(sourcePath) ? sourcePath : resolve(app.getPath('documents'), sourcePath)
    const validationError = await validateDatabaseBackup(absoluteSource)
    if (validationError) {
      sendError(res, 400, validationError)
      return
    }
    const pendingPath = join(dirname(getDbPath(db)), PENDING_IMPORT_DB)
    copyFileSync(absoluteSource, pendingPath)
    publishEvent('database.import.pending', { path: pendingPath })
    sendOk(res, { requiresRestart: true, path: pendingPath })
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleSystem(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  if (parts[0] === 'autostart') {
    if (req.method === 'GET') {
      sendOk(res, app.getLoginItemSettings().openAtLogin)
      return
    }
    if (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'POST') {
      const enabled = getBodyObject(body).enabled === true
      app.setLoginItemSettings({ openAtLogin: enabled })
      sendOk(res, app.getLoginItemSettings().openAtLogin)
      return
    }
  }

  if (parts[0] === 'minimize-to-tray' && (req.method === 'PUT' || req.method === 'PATCH' || req.method === 'POST')) {
    const enabled = getBodyObject(body).enabled === true
    setSetting(context.db, 'minimize_to_tray', enabled)
    publishEvent('setting.updated', { key: 'minimize_to_tray' })
    sendOk(res, enabled)
    return
  }

  if (parts[0] === 'api' && req.method === 'GET') {
    sendOk(res, getLocalApiStatus(context.db))
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleBulk(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 404, 'Not found')
    return
  }
  const payload = getBodyObject(body)
  if (!Array.isArray(payload.profileIds)) throw new Error('profileIds must be an array')
  const profileIds = payload.profileIds as unknown[]
  if (profileIds.length > 500) throw new Error('Too many profiles (max 500)')
  for (const id of profileIds) assertUuid(String(id))

  const results: { id: string; ok: boolean; error?: string }[] = []
  if (parts[0] === 'launch') {
    for (const id of profileIds as string[]) {
      try {
        assertLaunchCapacity(context.db, id)
        await launchBrowser(context.db, id, context.profilesDir, context.getMainWindow())
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' })
      }
    }
    sendOk(res, results)
    return
  }
  if (parts[0] === 'stop') {
    for (const id of profileIds as string[]) {
      try {
        await stopBrowser(context.db, id, context.getMainWindow())
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' })
      }
    }
    sendOk(res, results)
    return
  }
  if (parts[0] === 'delete') {
    for (const id of profileIds as string[]) {
      try {
        await deleteProfile(context.db, id, context.profilesDir)
        publishEvent('profile.deleted', { profile_id: id })
        results.push({ id, ok: true })
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Failed' })
      }
    }
    sendOk(res, results)
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleAutomation(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db, profilesDir, getMainWindow } = context

  if (parts[0] === 'scripts') {
    const scriptId = parts[1]

    if (!scriptId) {
      if (req.method === 'GET') {
        sendOk(res, listAutomationScripts(db))
        return
      }
      if (req.method === 'POST') {
        const script = createAutomationScript(db, getBodyObject(body) as unknown as AutomationScriptInput)
        publishEvent('automation.script.created', { script_id: script.id, script })
        sendOk(res, script)
        return
      }
    }

    if (scriptId) {
      assertUuid(scriptId)
      if (req.method === 'GET' && parts.length === 2) {
        sendOk(res, getAutomationScript(db, scriptId))
        return
      }
      if (req.method === 'PATCH' && parts.length === 2) {
        const script = updateAutomationScript(
          db,
          scriptId,
          getBodyObject(body) as unknown as Partial<AutomationScriptInput>
        )
        publishEvent('automation.script.updated', { script_id: script.id, script })
        sendOk(res, script)
        return
      }
      if (req.method === 'DELETE' && parts.length === 2) {
        deleteAutomationScript(db, scriptId)
        publishEvent('automation.script.deleted', { script_id: scriptId })
        sendOk(res)
        return
      }
      if (req.method === 'POST' && parts[2] === 'run') {
        const payload = getBodyObject(body)
        const profileId =
          typeof payload.profileId === 'string'
            ? payload.profileId
            : typeof payload.profile_id === 'string'
              ? payload.profile_id
              : undefined
        if (profileId) assertUuid(profileId)
        const result = await runAutomationScript(
          db,
          scriptId,
          profilesDir,
          getMainWindow(),
          profileId
        )
        publishEvent('automation.run.finished', {
          run_id: result.run.id,
          script_id: scriptId,
          status: result.run.status
        })
        sendOk(res, result)
        return
      }
    }
  }

  if (parts[0] === 'runs' && req.method === 'GET') {
    const scriptId = getQuery(req).get('scriptId') ?? undefined
    sendOk(res, listAutomationRuns(db, scriptId))
    return
  }

  if (parts[0] === 'run' && req.method === 'POST') {
    const payload = getBodyObject(body)
    const profileId =
      typeof payload.profileId === 'string'
        ? payload.profileId
        : typeof payload.profile_id === 'string'
          ? payload.profile_id
          : ''
    if (!profileId) throw new Error('profileId is required')
    assertUuid(profileId)
    const result = await runAdHocAutomation(
      db,
      { profile_id: profileId, steps: payload.steps as AutomationStep[] },
      profilesDir,
      getMainWindow()
    )
    publishEvent('automation.run.finished', { run_id: result.run.id, status: result.run.status })
    sendOk(res, result)
    return
  }

  if (req.method !== 'POST' || parts[0] !== 'profile-session') {
    sendError(res, 404, 'Not found')
    return
  }

  const payload = getBodyObject(body)
  const targetUrl = validateHttpUrl(payload.targetUrl ?? payload.url, 'targetUrl')

  let proxy: ProxyResponse | null = null
  let proxyId =
    typeof payload.proxyId === 'string'
      ? payload.proxyId
      : typeof payload.proxy_id === 'string'
        ? payload.proxy_id
        : null
  if (proxyId) assertUuid(proxyId)

  if (isObject(payload.proxy)) {
    proxy = createProxy(db, payload.proxy as unknown as ProxyInput)
    proxyId = proxy.id
    publishEvent('proxy.created', { proxy_id: proxy.id, proxy })
  }

  let profile: Profile
  const existingProfileId =
    typeof payload.profileId === 'string'
      ? payload.profileId
      : typeof payload.profile_id === 'string'
        ? payload.profile_id
        : null
  if (existingProfileId) {
    assertUuid(existingProfileId)
    const patch = isObject(payload.profile)
      ? sanitizeProfileInput(payload.profile as unknown as UpdateProfileInput)
      : {}
    profile = updateProfile(db, existingProfileId, {
      ...patch,
      ...(proxyId ? { proxy_id: proxyId } : {})
    })
    publishEvent('profile.updated', { profile_id: profile.id, profile })
  } else {
    const profileInput = sanitizeProfileInput(
      {
        ...(isObject(payload.profile) ? payload.profile : {}),
        name:
          isObject(payload.profile) && typeof payload.profile.name === 'string'
            ? payload.profile.name
            : `API Profile ${new Date().toISOString().slice(0, 19)}`,
        browser_type:
          isObject(payload.profile) && BROWSER_TYPES.has(payload.profile.browser_type as BrowserType)
            ? payload.profile.browser_type
            : 'chromium',
        ...(proxyId ? { proxy_id: proxyId } : {}),
        ...(targetUrl ? { start_url: targetUrl } : {})
      } as CreateProfileInput,
      true
    )
    profile = await createProfile(db, profileInput, profilesDir)
    publishEvent('profile.created', { profile_id: profile.id, profile })
  }

  assertLaunchCapacity(db, profile.id)
  const launch = await launchBrowser(db, profile.id, profilesDir, getMainWindow(), { targetUrl })
  publishEvent('profile.launched', { profile_id: profile.id, ...launch })

  let cdp: unknown = null
  try {
    cdp = await getCdpConnectionInfo(profile.id)
  } catch {
    cdp = null
  }

  sendOk(res, {
    profile,
    proxy,
    launch,
    cdp,
    session: getProfileStatus(db, profile.id)
  })
}

async function handleWebhooks(
  req: IncomingMessage,
  res: ServerResponse,
  parts: string[],
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  const { db } = context
  const webhooks = readWebhooks(db)
  const webhookId = parts[0]

  if (!webhookId) {
    if (req.method === 'GET') {
      sendOk(res, webhooks)
      return
    }
    if (req.method === 'POST') {
      const payload = getBodyObject(body)
      const webhook: WebhookConfig = {
        id: randomBytes(12).toString('hex'),
        url: validateWebhookUrl(payload.url),
        secret:
          typeof payload.secret === 'string' && payload.secret.length >= 16
            ? payload.secret
            : generateWebhookSecret(),
        events: normalizeWebhookEvents(payload.events),
        enabled: payload.enabled !== false,
        created_at: new Date().toISOString()
      }
      const next = [webhook, ...webhooks].slice(0, 50)
      writeWebhooks(db, next)
      sendOk(res, webhook)
      return
    }
  }

  if (webhookId === 'deliveries' && req.method === 'GET') {
    sendOk(res, webhookDeliveries.slice(0, 100))
    return
  }

  const existing = webhooks.find((webhook) => webhook.id === webhookId)
  if (!existing) {
    sendError(res, 404, 'Webhook not found')
    return
  }

  if (req.method === 'PATCH') {
    const payload = getBodyObject(body)
    const updated: WebhookConfig = {
      ...existing,
      url: payload.url === undefined ? existing.url : validateWebhookUrl(payload.url),
      events: payload.events === undefined ? existing.events : normalizeWebhookEvents(payload.events),
      enabled: payload.enabled === undefined ? existing.enabled : payload.enabled === true,
      secret:
        payload.rotateSecret === true
          ? generateWebhookSecret()
          : typeof payload.secret === 'string' && payload.secret.length >= 16
            ? payload.secret
            : existing.secret
    }
    writeWebhooks(db, webhooks.map((webhook) => (webhook.id === webhookId ? updated : webhook)))
    sendOk(res, updated)
    return
  }

  if (req.method === 'DELETE') {
    writeWebhooks(db, webhooks.filter((webhook) => webhook.id !== webhookId))
    sendOk(res)
    return
  }

  sendError(res, 404, 'Not found')
}

async function handleKillSwitch(
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown,
  context: NonNullable<typeof activeContext>
): Promise<void> {
  if (req.method !== 'POST') {
    sendError(res, 404, 'Not found')
    return
  }
  const payload = getBodyObject(body)
  const stopSessions = payload.stopSessions !== false
  const rotateToken = payload.rotateToken !== false
  const disableApi = payload.disableApi !== false
  const stopped: { id: string; ok: boolean; error?: string }[] = []

  if (stopSessions) {
    for (const session of getAllSessions()) {
      try {
        await stopBrowser(context.db, session.profile_id, context.getMainWindow())
        stopped.push({ id: session.profile_id, ok: true })
      } catch (err) {
        stopped.push({
          id: session.profile_id,
          ok: false,
          error: err instanceof Error ? err.message : 'Failed'
        })
      }
    }
  }

  if (rotateToken) {
    setSetting(context.db, 'api_token', generateApiToken())
  }
  if (disableApi) {
    setSetting(context.db, 'api_enabled', false)
  } else if (rotateToken) {
    const next = readApiConfig(context.db)
    activeConfig = next
  }
  publishEvent('api.kill_switch', { stopSessions, rotateToken, disableApi, stopped })
  sendOk(res, { stopped, api_disabled: disableApi, token_rotated: rotateToken })

  if (disableApi) {
    setTimeout(() => {
      stopApiServer().catch(() => {})
    }, 50)
  }
}

function buildOpenApi(config: ApiServerConfig): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Lux Antidetect Local API',
      version: API_VERSION
    },
    servers: [{ url: `http://${config.host}:${config.port}/api/${API_VERSION}` }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': { get: { security: [], summary: 'API health check' } },
      '/events': { get: { summary: 'Server-sent event stream' } },
      '/kill-switch': { post: { summary: 'Stop sessions, rotate token, and disable local API' } },
      '/profiles': { get: { summary: 'List profiles' }, post: { summary: 'Create profile' } },
      '/profiles/health': { get: { summary: 'List profile coherence and health scores' } },
      '/profiles/{id}': {
        get: { summary: 'Get profile detail' },
        patch: { summary: 'Update profile' },
        delete: { summary: 'Delete profile' }
      },
      '/profiles/{id}/status': { get: { summary: 'Get profile lifecycle status' } },
      '/profiles/{id}/health': { get: { summary: 'Get profile coherence and health score' } },
      '/profiles/{id}/health/autofix': { post: { summary: 'Auto-fix safe profile coherence issues' } },
      '/profiles/{id}/wipe-data': { post: { summary: 'Wipe stopped profile browser data' } },
      '/profiles/{id}/proxy': { post: { summary: 'Bind or clear profile proxy' } },
      '/profiles/{id}/duplicate': { post: { summary: 'Duplicate profile' } },
      '/profiles/{id}/launch': { post: { summary: 'Launch profile browser' } },
      '/profiles/{id}/stop': { post: { summary: 'Stop profile browser' } },
      '/profiles/{id}/open-url': { post: { summary: 'Open URL in profile context' } },
      '/profiles/{id}/cdp': { get: { summary: 'Get CDP connection info' } },
      '/profiles/{id}/tabs': { get: { summary: 'List active CDP page tabs' } },
      '/profiles/{id}/execute-js': { post: { summary: 'Execute JavaScript in a profile tab' } },
      '/profiles/{id}/cookies': { get: { summary: 'Export cookies from a running profile' } },
      '/profiles/{id}/cookies/import': { post: { summary: 'Import cookies into a running profile' } },
      '/profiles/{id}/bookmarks': { get: { summary: 'List profile bookmarks' }, post: { summary: 'Add profile bookmark' } },
      '/profiles/{id}/bookmarks/{bookmarkId}': { delete: { summary: 'Remove profile bookmark' } },
      '/profiles/{id}/extensions': { get: { summary: 'List profile extensions' }, post: { summary: 'Register unpacked profile extension' } },
      '/profiles/{id}/extensions/install-crx': { post: { summary: 'Install CRX into profile' } },
      '/profiles/{id}/extensions/{extensionId}': {
        patch: { summary: 'Toggle profile extension' },
        delete: { summary: 'Remove profile extension registration' }
      },
      '/profiles/{id}/screenshot': {
        get: { summary: 'Capture profile screenshot' },
        post: { summary: 'Capture selected tab screenshot' }
      },
      '/fingerprints/generate': { post: { summary: 'Generate a default fingerprint draft' } },
      '/fingerprints/presets': { get: { summary: 'List fingerprint presets' } },
      '/fingerprints/presets/{id}/generate': { post: { summary: 'Generate a fingerprint from a preset' } },
      '/proxies': { get: { summary: 'List proxies' }, post: { summary: 'Create proxy' } },
      '/proxies/groups': { get: { summary: 'List proxy group tags' } },
      '/proxies/parse': { post: { summary: 'Parse a single proxy line' } },
      '/proxies/bulk-import': { post: { summary: 'Parse and import proxy lines' } },
      '/proxies/bulk-test': { post: { summary: 'Test many proxies concurrently' } },
      '/proxies/dry-run-fraud-check': { post: { summary: 'Check unpersisted proxy geo and fraud metadata' } },
      '/proxies/lookup-fraud-by-ip': { post: { summary: 'Check fraud metadata for an arbitrary IP' } },
      '/proxies/{id}': { patch: { summary: 'Update proxy' }, delete: { summary: 'Delete proxy' } },
      '/proxies/{id}/connection-string': { get: { summary: 'Return proxy connection string including credentials' } },
      '/proxies/{id}/test': { post: { summary: 'Test proxy connectivity' } },
      '/proxies/{id}/lookup-geo': { post: { summary: 'Refresh proxy geo metadata' } },
      '/settings': { get: { summary: 'List supported settings and current values' } },
      '/settings/{key}': {
        get: { summary: 'Read a supported setting' },
        put: { summary: 'Update a supported setting' },
        patch: { summary: 'Update a supported setting' }
      },
      '/templates': { get: { summary: 'List templates' }, post: { summary: 'Create template' } },
      '/templates/{id}': {
        get: { summary: 'Get template' },
        patch: { summary: 'Update template' },
        delete: { summary: 'Delete template' }
      },
      '/templates/{id}/create-profile': { post: { summary: 'Create profile from template' } },
      '/ai/settings': { get: { summary: 'Read AI settings' }, patch: { summary: 'Update AI settings' } },
      '/ai/models': { get: { summary: 'List AI models' } },
      '/ai/chats': { get: { summary: 'List AI chats' }, post: { summary: 'Create AI chat' } },
      '/ai/chats/{id}': { delete: { summary: 'Delete AI chat' } },
      '/ai/chats/{id}/messages': { get: { summary: 'List AI chat messages' } },
      '/ai/messages': { post: { summary: 'Send AI message' } },
      '/ai/actions/apply': { post: { summary: 'Apply AI-proposed profile actions' } },
      '/sessions': { get: { summary: 'List running sessions' } },
      '/session-history': { get: { summary: 'Read session history, optionally filtered by profileId' } },
      '/bulk/launch': { post: { summary: 'Launch profiles' } },
      '/bulk/stop': { post: { summary: 'Stop profiles' } },
      '/bulk/delete': { post: { summary: 'Delete stopped profiles' } },
      '/automation/scripts': { get: { summary: 'List automation scripts' }, post: { summary: 'Create automation script' } },
      '/automation/scripts/{id}': {
        get: { summary: 'Get automation script' },
        patch: { summary: 'Update automation script' },
        delete: { summary: 'Delete automation script' }
      },
      '/automation/scripts/{id}/run': { post: { summary: 'Run saved automation script' } },
      '/automation/runs': { get: { summary: 'List automation run history' } },
      '/automation/run': { post: { summary: 'Run ad-hoc automation steps' } },
      '/automation/profile-session': {
        post: { summary: 'Create/update profile, optionally create proxy, launch, and return CDP info' }
      },
      '/browsers/detect': { get: { summary: 'Detect installed browsers' } },
      '/managed-browsers': { get: { summary: 'List installed managed browsers' } },
      '/managed-browsers/available': { get: { summary: 'List downloadable managed browser builds' } },
      '/managed-browsers/download': { post: { summary: 'Download a managed browser build' } },
      '/managed-browsers/cancel': { post: { summary: 'Cancel an active managed browser download' } },
      '/managed-browsers/{browser}/{buildId}': { delete: { summary: 'Remove a managed browser build' } },
      '/updates/state': { get: { summary: 'Get update state' } },
      '/updates/check': { post: { summary: 'Check for updates' } },
      '/updates/clear-error': { post: { summary: 'Clear update error state' }, delete: { summary: 'Clear update error state' } },
      '/updates/install': { post: { summary: 'Install downloaded update and restart' } },
      '/database/export': { post: { summary: 'Export SQLite database backup into the Lux backups folder' } },
      '/database/import': { post: { summary: 'Stage SQLite database backup import for next restart' } },
      '/system/autostart': { get: { summary: 'Read OS autostart state' }, put: { summary: 'Set OS autostart state' } },
      '/system/minimize-to-tray': { put: { summary: 'Persist minimize-to-tray setting' } },
      '/system/api': { get: { summary: 'Read Local API status' } },
      '/webhooks': { get: { summary: 'List webhooks' }, post: { summary: 'Create webhook' } },
      '/webhooks/{id}': { patch: { summary: 'Update webhook' }, delete: { summary: 'Delete webhook' } },
      '/webhooks/deliveries': { get: { summary: 'Recent webhook delivery attempts' } }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' }
      }
    }
  }
}

async function stopApiServer(): Promise<void> {
  closeEventClients()
  if (unsubscribeSessionEvents) {
    unsubscribeSessionEvents()
    unsubscribeSessionEvents = null
  }
  activeContext = null
  if (!server) return
  const closingServer = server
  server = null
  await new Promise<void>((resolve, reject) => {
    closingServer.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
  activeConfig = null
}

async function startApiServer(
  db: Database.Database,
  profilesDir: string,
  getMainWindow: () => BrowserWindow,
  config: ApiServerConfig
): Promise<void> {
  await stopApiServer()
  activeConfig = config
  if (!config.enabled) {
    return
  }

  activeContext = { db, profilesDir, getMainWindow }
  registerSessionEventBridge()
  const nextServer = createServer((req, res) => {
    void (async () => {
      try {
        if (!activeContext) throw new Error('API context is not initialized')
        await handleApiRequest(req, res, activeConfig ?? config, activeContext)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error'
        sendError(res, message === 'Not found' ? 404 : 400, message)
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    nextServer.once('error', reject)
    nextServer.listen(config.port, config.host, () => {
      nextServer.off('error', reject)
      resolve()
    })
  }).catch((err) => {
    closeEventClients()
    if (unsubscribeSessionEvents) {
      unsubscribeSessionEvents()
      unsubscribeSessionEvents = null
    }
    activeContext = null
    nextServer.close()
    throw err
  })
  server = nextServer
}

export async function initLocalApiServer(
  db: Database.Database,
  profilesDir: string,
  getMainWindow: () => BrowserWindow
): Promise<ApiServerStatus> {
  const config = readApiConfig(db)
  await startApiServer(db, profilesDir, getMainWindow, config)
  return toStatus(config)
}

export async function shutdownLocalApiServer(): Promise<void> {
  await stopApiServer()
}

export function getLocalApiStatus(db: Database.Database): ApiServerStatus {
  const config = activeConfig ?? readApiConfig(db)
  return toStatus(config)
}

export async function updateLocalApiConfig(
  db: Database.Database,
  profilesDir: string,
  getMainWindow: () => BrowserWindow,
  input: { enabled?: boolean; host?: string; port?: number | string }
): Promise<ApiServerStatus> {
  const current = readApiConfig(db)
  const next: ApiServerConfig = {
    enabled: input.enabled === undefined ? current.enabled : input.enabled === true,
    host: input.host === undefined ? current.host : normalizeHost(input.host),
    port: input.port === undefined ? current.port : normalizePort(input.port),
    token: current.token
  }
  setSetting(db, 'api_enabled', next.enabled)
  setSetting(db, 'api_host', next.host)
  setSetting(db, 'api_port', next.port)
  await startApiServer(db, profilesDir, getMainWindow, next)
  return toStatus(next)
}

export async function regenerateLocalApiToken(
  db: Database.Database,
  profilesDir: string,
  getMainWindow: () => BrowserWindow
): Promise<ApiServerStatus> {
  const next = { ...readApiConfig(db), token: generateApiToken() }
  setSetting(db, 'api_token', next.token)
  await startApiServer(db, profilesDir, getMainWindow, next)
  return toStatus(next)
}

export function registerLocalApiIpcHandlers(
  db: Database.Database,
  profilesDir: string,
  getMainWindow: () => BrowserWindow
): void {
  ipcMain.handle('api-server-status', () => getLocalApiStatus(db))
  ipcMain.handle('api-server-configure', (_, input: { enabled?: boolean; host?: string; port?: number | string }) =>
    updateLocalApiConfig(db, profilesDir, getMainWindow, input)
  )
  ipcMain.handle('api-server-regenerate-token', () =>
    regenerateLocalApiToken(db, profilesDir, getMainWindow)
  )
}
