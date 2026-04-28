import { app, type BrowserWindow, ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { URL } from 'node:url'
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  getProfile,
  listProfiles,
  syncFingerprintsForProxy,
  updateFingerprint,
  updateProfile
} from './profile'
import {
  createProxy,
  deleteProxy,
  listProxies,
  parseProxyLine,
  testProxy,
  updateProxy
} from './proxy'
import { lookupProxyGeo } from './geoip'
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
import type {
  AutomationScriptInput,
  AutomationStep,
  BrowserType,
  CreateProfileInput,
  Profile,
  ProxyInput,
  ProxyResponse,
  UpdateFingerprintInput,
  UpdateProfileInput
} from './models'

const API_VERSION = 'v1'
const DEFAULT_API_HOST = '127.0.0.1'
const DEFAULT_API_PORT = 17888
const MAX_BODY_BYTES = 1_000_000
const BULK_PROXY_MAX_BYTES = 1_000_000
const BULK_PROXY_MAX_LINES = 10_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:'])
const BROWSER_TYPES = new Set<BrowserType>(['chromium', 'firefox', 'edge'])

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
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS'
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

  if (proxyId === 'bulk-import' && req.method === 'POST') {
    sendOk(res, await bulkImportProxies(db, getBodyObject(body)))
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
      '/profiles/{id}': {
        get: { summary: 'Get profile detail' },
        patch: { summary: 'Update profile' },
        delete: { summary: 'Delete profile' }
      },
      '/profiles/{id}/status': { get: { summary: 'Get profile lifecycle status' } },
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
      '/profiles/{id}/screenshot': {
        get: { summary: 'Capture profile screenshot' },
        post: { summary: 'Capture selected tab screenshot' }
      },
      '/proxies': { get: { summary: 'List proxies' }, post: { summary: 'Create proxy' } },
      '/proxies/parse': { post: { summary: 'Parse a single proxy line' } },
      '/proxies/bulk-import': { post: { summary: 'Parse and import proxy lines' } },
      '/proxies/{id}': { patch: { summary: 'Update proxy' }, delete: { summary: 'Delete proxy' } },
      '/proxies/{id}/test': { post: { summary: 'Test proxy connectivity' } },
      '/proxies/{id}/lookup-geo': { post: { summary: 'Refresh proxy geo metadata' } },
      '/sessions': { get: { summary: 'List running sessions' } },
      '/session-history': { get: { summary: 'Read session history, optionally filtered by profileId' } },
      '/bulk/launch': { post: { summary: 'Launch profiles' } },
      '/bulk/stop': { post: { summary: 'Stop profiles' } },
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
