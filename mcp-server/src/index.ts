#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool
} from '@modelcontextprotocol/sdk/types.js'

type JsonSchema = Record<string, unknown>

interface LuxApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: { message?: string }
}

interface LuxProfile {
  id: string
  name: string
  browser_type: 'chromium' | 'firefox' | 'edge'
  status: 'ready' | 'starting' | 'running' | 'stopping' | 'error'
  proxy_id: string | null
  start_url?: string
  [key: string]: unknown
}

interface LuxSession {
  profile_id: string
  pid: number
  browser_type: 'chromium' | 'firefox' | 'edge'
  started_at: string
}

interface CdpInfo {
  port: number
  wsEndpoint: string
  httpEndpoint: string
}

interface CdpTarget {
  id: string
  type: string
  title?: string
  url?: string
  attached?: boolean
  webSocketDebuggerUrl?: string
  devtoolsFrontendUrl?: string
}

type ToolDefinition = Tool

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_HOST = process.env.LUX_API_HOST?.trim() || '127.0.0.1'
const DEFAULT_PORT_SCAN = process.env.LUX_API_PORT_SCAN?.trim() || '17888,17889-17920'
const REQUEST_TIMEOUT_MS = readPositiveInt(process.env.LUX_MCP_TIMEOUT_MS, 15_000)
const LOG_FILE = process.env.LUX_MCP_LOG_FILE?.trim()

let cachedBaseUrl: string | null = null

// Читаем числовые env-параметры мягко: неверное значение не валит сервер,
// а откатывается к безопасному дефолту.
function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number(raw) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function log(level: 'info' | 'warn' | 'error', message: string, meta?: unknown): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta === undefined ? {} : { meta })
  })
  // MCP stdio uses stdout for protocol frames, so diagnostic console output must go to stderr.
  console.error(line)
  if (LOG_FILE) {
    try {
      mkdirSync(dirname(resolve(LOG_FILE)), { recursive: true })
      appendFileSync(LOG_FILE, `${line}\n`, 'utf8')
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        message: 'failed to write MCP log file',
        meta: err instanceof Error ? err.message : String(err)
      }))
    }
  }
}

function textResult(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      }
    ]
  }
}

function errorResult(message: string, details?: unknown): CallToolResult {
  const result = textResult({
    ok: false,
    error: {
      message,
      details
    }
  })
  result.isError = true
  return result
}

function asObject(value: unknown, toolName: string): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new McpError(ErrorCode.InvalidParams, `${toolName}: arguments must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new McpError(ErrorCode.InvalidParams, `${key} is required and must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, `${key} must be a string`)
  }
  return value.trim()
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) {
    throw new McpError(ErrorCode.InvalidParams, `${key} must be a number`)
  }
  return parsed
}

function optionalBoolean(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'boolean') {
    throw new McpError(ErrorCode.InvalidParams, `${key} must be a boolean`)
  }
  return value
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Invalid Lux API URL: ${raw}`)
  }
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`
}

function expandPortScan(raw: string): number[] {
  const ports = new Set<number>()
  for (const part of raw.split(',')) {
    const token = part.trim()
    if (!token) continue
    const range = token.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      for (let port = Math.min(start, end); port <= Math.max(start, end); port++) {
        if (port >= 1024 && port <= 65535) ports.add(port)
      }
      continue
    }
    const port = Number(token)
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) ports.add(port)
  }
  return [...ports]
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    const payload = text ? JSON.parse(text) as unknown : null
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === 'object' &&
        'error' in payload &&
        typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
          ? (payload as { error: { message: string } }).error.message
          : `HTTP ${response.status}`
      throw new Error(`${message} (${init.method ?? 'GET'} ${url})`)
    }
    return payload
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Timeout after ${timeoutMs}ms: ${init.method ?? 'GET'} ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// Lux API может быть перенесен на другой localhost-порт из UI. MCP-клиенту
// неудобно гадать порт, поэтому сервер умеет быстро просканировать ожидаемый
// диапазон и закешировать первый корректный /health.
async function discoverBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl
  if (process.env.LUX_API_BASE_URL) {
    cachedBaseUrl = normalizeBaseUrl(process.env.LUX_API_BASE_URL)
    return cachedBaseUrl
  }

  const fixedPort = process.env.LUX_API_PORT?.trim()
  const ports = fixedPort ? [Number(fixedPort)] : expandPortScan(DEFAULT_PORT_SCAN)
  for (const port of ports) {
    if (!Number.isInteger(port)) continue
    const baseUrl = `http://${DEFAULT_HOST}:${port}/api/v1`
    try {
      const health = await fetchJson(`${baseUrl}/health`, { method: 'GET' }, 1500) as LuxApiEnvelope<unknown>
      if (health && typeof health === 'object' && health.ok === true) {
        cachedBaseUrl = baseUrl
        log('info', 'Lux API discovered', { baseUrl })
        return baseUrl
      }
    } catch {
      // Порт может быть занят не Lux или API может быть выключен. Продолжаем сканирование.
    }
  }

  throw new Error(
    `Lux Local API not found. Enable it in Lux Settings and set LUX_API_BASE_URL or LUX_API_PORT. Scanned: ${ports.join(', ')}`
  )
}

// Единая тонкая обертка над REST API Lux: авторизация, base URL discovery,
// timeout, unwrap стандартного { ok, data, error } envelope и понятные ошибки.
class LuxApiClient {
  async request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const baseUrl = await discoverBaseUrl()
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['content-type'] = 'application/json'
    if (path !== '/health') {
      const token = process.env.LUX_API_TOKEN?.trim()
      if (!token) {
        throw new Error('LUX_API_TOKEN is required. Copy it from Lux Settings -> Local API.')
      }
      headers.authorization = `Bearer ${token}`
    }

    const payload = await fetchJson(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })

    if (path === '/openapi') return payload as T
    const envelope = payload as LuxApiEnvelope<T>
    if (!envelope || envelope.ok !== true) {
      throw new Error(envelope?.error?.message ?? `Lux API returned an invalid response for ${method} ${path}`)
    }
    return envelope.data as T
  }
}

const lux = new LuxApiClient()

async function getSessions(): Promise<LuxSession[]> {
  return lux.request<LuxSession[]>('GET', '/sessions')
}

async function resolveProfileId(args: Record<string, unknown>): Promise<string> {
  const direct = optionalString(args, 'profileId') ?? optionalString(args, 'browserId') ?? optionalString(args, 'launchId')
  if (direct) return direct

  const pid = optionalNumber(args, 'pid')
  if (pid !== undefined) {
    const session = (await getSessions()).find((item) => item.pid === pid)
    if (!session) throw new Error(`No running Lux browser found for pid=${pid}`)
    return session.profile_id
  }

  throw new McpError(ErrorCode.InvalidParams, 'profileId, browserId, launchId, or pid is required')
}

async function getCdpInfo(profileId: string): Promise<CdpInfo> {
  return lux.request<CdpInfo>('GET', `/profiles/${encodeURIComponent(profileId)}/cdp`)
}

async function getCdpTargets(profileId: string): Promise<CdpTarget[]> {
  const cdp = await getCdpInfo(profileId)
  const targets = await fetchJson(`${cdp.httpEndpoint}/json`, { method: 'GET' }) as CdpTarget[]
  return Array.isArray(targets) ? targets.filter((target) => target.type === 'page') : []
}

// В Lux один активный browser process привязан к profileId. Для удобства MCP
// tools принимают browserId/launchId, но внутри они нормализуются к profileId.
function selectTarget(targets: CdpTarget[], args: Record<string, unknown>): CdpTarget {
  const tabId = optionalString(args, 'tabId')
  if (tabId) {
    const target = targets.find((item) => item.id === tabId)
    if (!target) throw new Error(`Tab not found: ${tabId}`)
    return target
  }

  const urlContains = optionalString(args, 'urlContains')
  if (urlContains) {
    const target = targets.find((item) => item.url?.includes(urlContains))
    if (!target) throw new Error(`No tab URL contains: ${urlContains}`)
    return target
  }

  const tabIndex = optionalNumber(args, 'tabIndex')
  if (tabIndex !== undefined) {
    const target = targets[tabIndex]
    if (!target) throw new Error(`No tab at index ${tabIndex}`)
    return target
  }

  const active = targets.find((item) => item.url && !item.url.startsWith('devtools://'))
  if (!active) throw new Error('No page tabs found for this browser')
  return active
}

// Минимальный CDP-клиент без внешних зависимостей. Он открывает websocket
// конкретной вкладки, выполняет один метод и закрывает соединение.
async function cdpCommand<T>(
  wsEndpoint: string,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  let nextId = 1
  const ws = new WebSocket(wsEndpoint)

  await new Promise<void>((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => rejectOpen(new Error(`CDP websocket open timeout for ${wsEndpoint}`)), REQUEST_TIMEOUT_MS)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolveOpen()
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      rejectOpen(new Error(`CDP websocket error for ${wsEndpoint}`))
    }, { once: true })
  })

  try {
    const id = nextId++
    ws.send(JSON.stringify({ id, method, params }))
    return await new Promise<T>((resolveCommand, rejectCommand) => {
      const timer = setTimeout(() => rejectCommand(new Error(`CDP command timeout: ${method}`)), REQUEST_TIMEOUT_MS)
      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as {
            id?: number
            result?: T
            error?: { message?: string; data?: string }
          }
          if (msg.id !== id) return
          clearTimeout(timer)
          if (msg.error) {
            rejectCommand(new Error(`${msg.error.message ?? 'CDP error'}${msg.error.data ? `: ${msg.error.data}` : ''}`))
            return
          }
          resolveCommand(msg.result as T)
        } catch (err) {
          clearTimeout(timer)
          rejectCommand(err)
        }
      })
      ws.addEventListener('error', () => {
        clearTimeout(timer)
        rejectCommand(new Error(`CDP websocket error during ${method}`))
      }, { once: true })
    })
  } finally {
    ws.close()
  }
}

// Если агент передал новый proxy object, сначала создаем proxy в Lux, затем
// используем его id при create/update/launch profile.
async function createProxyIfNeeded(input: Record<string, unknown>): Promise<string | undefined> {
  const proxyId = optionalString(input, 'proxyId') ?? optionalString(input, 'proxy_id')
  if (proxyId) return proxyId
  const proxy = input.proxy
  if (!proxy || typeof proxy !== 'object' || Array.isArray(proxy)) return undefined
  const created = await lux.request<{ id: string }>('POST', '/proxies', proxy)
  return created.id
}

async function importCookiesIfRequested(profileId: string, input: Record<string, unknown>): Promise<unknown | undefined> {
  const cookies = input.cookies
  if (cookies === undefined || cookies === null) return undefined
  const payload = Array.isArray(cookies) ? { format: 'json', data: cookies } : cookies
  const importAfterLaunch = optionalBoolean(input, 'importCookiesAfterLaunch', false)
  if (!importAfterLaunch) {
    return {
      skipped: true,
      reason: 'Lux imports cookies only into a running browser. Set importCookiesAfterLaunch=true to launch and import.'
    }
  }
  try {
    return await lux.request('POST', `/profiles/${encodeURIComponent(profileId)}/cookies/import`, payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!/not running|CDP port unavailable/i.test(message)) throw err
    await lux.request('POST', `/profiles/${encodeURIComponent(profileId)}/launch`, {
      targetUrl: optionalString(input, 'targetUrl')
    })
    return lux.request('POST', `/profiles/${encodeURIComponent(profileId)}/cookies/import`, payload)
  }
}

const idSchema: JsonSchema = {
  type: 'string',
  minLength: 1,
  description: 'Lux profile id. MCP browserId/launchId map to the same profile id because Lux tracks one active browser per profile.'
}

const fingerprintSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Fingerprint overrides persisted in Lux. Omit fields to let Lux generate coherent defaults.',
  properties: {
    user_agent: { type: 'string', description: 'Full browser user-agent string.' },
    platform: { type: 'string', description: 'navigator.platform value, for example Win32, MacIntel, Linux x86_64.' },
    hardware_concurrency: { type: 'integer', minimum: 1, maximum: 64 },
    device_memory: { type: 'integer', minimum: 1, maximum: 128 },
    languages: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Navigator languages, for example ["en-US","en"].'
    },
    screen_width: { type: 'integer', minimum: 320, maximum: 10000 },
    screen_height: { type: 'integer', minimum: 320, maximum: 10000 },
    color_depth: { type: 'integer', enum: [24, 30, 32] },
    pixel_ratio: { type: 'number', minimum: 0.5, maximum: 8 },
    device_type: { type: 'string', enum: ['desktop', 'mobile'] },
    timezone: { type: 'string', description: 'IANA timezone, for example Europe/Berlin.' },
    canvas_noise_seed: { type: 'integer', description: 'Stable deterministic canvas noise seed.' },
    webgl_vendor: { type: 'string' },
    webgl_renderer: { type: 'string' },
    audio_context_noise: { type: 'number', minimum: 0, maximum: 0.01 },
    fonts_list: {
      type: 'array',
      items: { type: 'string' },
      description: 'Font names to expose. Lux may normalize this field internally.'
    },
    webrtc_policy: {
      type: 'string',
      enum: ['disable_non_proxied_udp', 'default_public_interface_only', 'default'],
      description: 'WebRTC IP handling policy.'
    },
    video_inputs: { type: 'integer', minimum: 0, maximum: 10 },
    audio_inputs: { type: 'integer', minimum: 0, maximum: 10 },
    audio_outputs: { type: 'integer', minimum: 0, maximum: 10 }
  }
}

const proxySchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Optional proxy to create and attach before profile creation/update/launch.',
  properties: {
    name: { type: 'string', description: 'Human-readable proxy name.' },
    protocol: { type: 'string', enum: ['http', 'https', 'socks4', 'socks5'] },
    host: { type: 'string' },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    username: { type: ['string', 'null'] },
    password: { type: ['string', 'null'] },
    country: { type: 'string' },
    group_tag: { type: 'string' },
    timezone: { type: 'string' },
    city: { type: 'string' },
    latitude: { type: 'number' },
    longitude: { type: 'number' },
    locale: { type: 'string' }
  },
  required: ['name', 'protocol', 'host', 'port']
}

const cookiesSchema: JsonSchema = {
  description: 'Cookie import payload for Lux. Use with importCookiesAfterLaunch=true because import requires a running profile.',
  oneOf: [
    {
      type: 'object',
      additionalProperties: true,
      properties: {
        format: { type: 'string', enum: ['json', 'netscape'] },
        data: {
          description: 'JSON cookie array or Netscape cookie file string.',
          anyOf: [{ type: 'array', items: { type: 'object', additionalProperties: true } }, { type: 'string' }]
        }
      },
      required: ['format', 'data']
    },
    {
      type: 'array',
      items: { type: 'object', additionalProperties: true }
    }
  ]
}

const profilePatchSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    browser_type: { type: 'string', enum: ['chromium', 'firefox', 'edge'] },
    group_name: { type: ['string', 'null'] },
    group_color: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
    proxy_id: { type: ['string', 'null'] },
    start_url: { type: 'string', description: 'http/https start URL.' }
  }
}

const tools: ToolDefinition[] = [
  {
    name: 'list_profiles',
    description: 'Получить список всех Lux профилей. Можно запросить полную детализацию каждого профиля.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        includeDetails: {
          type: 'boolean',
          default: false,
          description: 'Если true, дополнительно загрузить fingerprint и proxy detail для каждого профиля.'
        }
      }
    }
  },
  {
    name: 'get_profile',
    description: 'Получить полную информацию о профиле по ID: metadata, fingerprint, proxy.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { profileId: idSchema },
      required: ['profileId']
    }
  },
  {
    name: 'create_profile',
    description: 'Создать профиль Lux с широкими параметрами fingerprint/proxy/cookies. Cookies импортируются только при importCookiesAfterLaunch=true.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        browser_type: { type: 'string', enum: ['chromium', 'firefox', 'edge'] },
        group_name: { type: ['string', 'null'] },
        group_color: { type: ['string', 'null'] },
        tags: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
        start_url: { type: 'string', description: 'http/https URL.' },
        proxyId: { type: 'string', description: 'Existing proxy id to attach.' },
        proxy_id: { type: 'string', description: 'Existing proxy id to attach.' },
        proxy: proxySchema,
        fingerprint: fingerprintSchema,
        cookies: cookiesSchema,
        importCookiesAfterLaunch: { type: 'boolean', default: false },
        targetUrl: { type: 'string', description: 'Optional URL used if cookie import launches the browser.' }
      },
      required: ['name', 'browser_type']
    }
  },
  {
    name: 'update_profile',
    description: 'Обновить любые поддерживаемые настройки профиля: metadata, proxy, fingerprint, cookies.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: idSchema,
        profile: profilePatchSchema,
        fingerprint: fingerprintSchema,
        proxyId: { type: ['string', 'null'], description: 'Existing proxy id to bind, or null to clear.' },
        proxy_id: { type: ['string', 'null'], description: 'Existing proxy id to bind, or null to clear.' },
        proxy: proxySchema,
        cookies: cookiesSchema,
        importCookiesAfterLaunch: { type: 'boolean', default: false },
        targetUrl: { type: 'string' }
      },
      required: ['profileId']
    }
  },
  {
    name: 'delete_profile',
    description: 'Удалить остановленный Lux профиль по ID.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { profileId: idSchema },
      required: ['profileId']
    }
  },
  {
    name: 'launch_browser',
    description: 'Запустить браузер по ID профиля. Перед запуском можно применить profile/fingerprint/proxy overrides.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: idSchema,
        targetUrl: { type: 'string', description: 'Optional http/https URL to open on launch.' },
        profile: profilePatchSchema,
        fingerprint: fingerprintSchema,
        proxyId: { type: ['string', 'null'] },
        proxy_id: { type: ['string', 'null'] },
        proxy: proxySchema,
        waitForCdp: {
          type: 'boolean',
          default: true,
          description: 'After launch, try to return CDP endpoint for Chromium/Edge profiles.'
        }
      },
      required: ['profileId']
    }
  },
  {
    name: 'list_running_browsers',
    description: 'Получить список всех запущенных Lux браузеров с profileId, PID, browser type, status and CDP info when available.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} }
  },
  {
    name: 'get_browser_status',
    description: 'Получить детальный статус запущенного браузера по profileId/browserId/launchId или PID.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: idSchema,
        browserId: idSchema,
        launchId: idSchema,
        pid: { type: 'integer', minimum: 1 }
      }
    }
  },
  {
    name: 'stop_browser',
    description: 'Остановить запущенный браузер по profileId/browserId/launchId или PID.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: idSchema,
        browserId: idSchema,
        launchId: idSchema,
        pid: { type: 'integer', minimum: 1 }
      }
    }
  },
  {
    name: 'close_all_browsers',
    description: 'Закрыть все запущенные Lux браузеры через Local API.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        continueOnError: {
          type: 'boolean',
          default: true,
          description: 'Continue stopping remaining browsers if one stop call fails.'
        }
      }
    }
  },
  {
    name: 'execute_js',
    description: 'Выполнить JavaScript в выбранной вкладке запущенного Chromium/Edge профиля через CDP Runtime.evaluate.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: idSchema,
        browserId: idSchema,
        tabId: { type: 'string', description: 'CDP target id from get_active_tabs.' },
        tabIndex: { type: 'integer', minimum: 0 },
        urlContains: { type: 'string', description: 'Select first tab whose URL contains this substring.' },
        script: { type: 'string', minLength: 1, description: 'JavaScript expression or async function body to evaluate.' },
        awaitPromise: { type: 'boolean', default: true },
        returnByValue: { type: 'boolean', default: true }
      },
      required: ['script']
    }
  },
  {
    name: 'take_screenshot',
    description: 'Сделать screenshot текущей или выбранной вкладки. Возвращает base64 PNG или сохраняет файл на диск.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: idSchema,
        browserId: idSchema,
        tabId: { type: 'string' },
        tabIndex: { type: 'integer', minimum: 0 },
        urlContains: { type: 'string' },
        output: { type: 'string', enum: ['base64', 'file'], default: 'base64' },
        outputPath: { type: 'string', description: 'Required when output=file.' },
        fullPage: { type: 'boolean', default: false },
        quality: { type: 'integer', minimum: 0, maximum: 100, description: 'JPEG quality; PNG ignores it.' },
        format: { type: 'string', enum: ['png', 'jpeg'], default: 'png' }
      }
    }
  },
  {
    name: 'get_active_tabs',
    description: 'Получить список открытых вкладок в запущенном Chromium/Edge профиле через CDP /json.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        profileId: idSchema,
        browserId: idSchema
      }
    }
  }
]

async function handleTool(name: string, rawArgs: unknown): Promise<CallToolResult> {
  const args = asObject(rawArgs, name)
  log('info', 'tool call', { name })

  switch (name) {
    case 'list_profiles': {
      const profiles = await lux.request<LuxProfile[]>('GET', '/profiles')
      if (!optionalBoolean(args, 'includeDetails', false)) return textResult({ ok: true, data: profiles })
      const detailed = await Promise.all(
        profiles.map((profile) =>
          lux.request('GET', `/profiles/${encodeURIComponent(profile.id)}`).catch((err) => ({
            profile,
            detail_error: err instanceof Error ? err.message : String(err)
          }))
        )
      )
      return textResult({ ok: true, data: detailed })
    }

    case 'get_profile': {
      const profileId = requireString(args, 'profileId')
      return textResult({ ok: true, data: await lux.request('GET', `/profiles/${encodeURIComponent(profileId)}`) })
    }

    case 'create_profile': {
      const proxyId = await createProxyIfNeeded(args)
      const input = {
        name: requireString(args, 'name'),
        browser_type: requireString(args, 'browser_type'),
        group_name: args.group_name,
        group_color: args.group_color,
        tags: args.tags,
        notes: args.notes,
        start_url: args.start_url,
        proxy_id: proxyId,
        fingerprint: args.fingerprint
      }
      const profile = await lux.request<LuxProfile>('POST', '/profiles', input)
      const cookieImport = await importCookiesIfRequested(profile.id, args)
      return textResult({ ok: true, data: { profile, cookieImport } })
    }

    case 'update_profile': {
      const profileId = requireString(args, 'profileId')
      const result: Record<string, unknown> = {}
      const proxyId = await createProxyIfNeeded(args)
      const profilePatch = typeof args.profile === 'object' && args.profile !== null && !Array.isArray(args.profile)
        ? { ...(args.profile as Record<string, unknown>) }
        : {}
      if (proxyId !== undefined) profilePatch.proxy_id = proxyId
      if (proxyId === undefined && (args.proxyId === null || args.proxy_id === null)) profilePatch.proxy_id = null
      if (Object.keys(profilePatch).length > 0) {
        result.profile = await lux.request('PATCH', `/profiles/${encodeURIComponent(profileId)}`, profilePatch)
      }
      if (args.fingerprint && typeof args.fingerprint === 'object' && !Array.isArray(args.fingerprint)) {
        result.fingerprint = await lux.request('PATCH', `/profiles/${encodeURIComponent(profileId)}/fingerprint`, args.fingerprint)
      }
      result.cookieImport = await importCookiesIfRequested(profileId, args)
      return textResult({ ok: true, data: result })
    }

    case 'delete_profile': {
      const profileId = requireString(args, 'profileId')
      return textResult({ ok: true, data: await lux.request('DELETE', `/profiles/${encodeURIComponent(profileId)}`) })
    }

    case 'launch_browser': {
      const profileId = requireString(args, 'profileId')
      const preflight: Record<string, unknown> = {}
      if (args.profile || args.fingerprint || args.proxy || args.proxyId || args.proxy_id) {
        preflight.update = await handleTool('update_profile', { ...args, profileId })
      }
      const launch = await lux.request('POST', `/profiles/${encodeURIComponent(profileId)}/launch`, {
        targetUrl: optionalString(args, 'targetUrl')
      })
      let cdp: CdpInfo | null = null
      if (optionalBoolean(args, 'waitForCdp', true)) {
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            cdp = await getCdpInfo(profileId)
            break
          } catch {
            await new Promise((resolveWait) => setTimeout(resolveWait, 300))
          }
        }
      }
      return textResult({ ok: true, data: { browserId: profileId, launchId: profileId, launch, cdp, preflight } })
    }

    case 'list_running_browsers': {
      const sessions = await getSessions()
      const data = await Promise.all(sessions.map(async (session) => {
        const status = await lux.request('GET', `/profiles/${encodeURIComponent(session.profile_id)}/status`).catch((err) => ({
          error: err instanceof Error ? err.message : String(err)
        }))
        const cdp = await getCdpInfo(session.profile_id).catch(() => null)
        return {
          browserId: session.profile_id,
          launchId: session.profile_id,
          profileId: session.profile_id,
          pid: session.pid,
          browserType: session.browser_type,
          startedAt: session.started_at,
          debugPort: cdp?.port ?? null,
          wsEndpoint: cdp?.wsEndpoint ?? null,
          status
        }
      }))
      return textResult({ ok: true, data })
    }

    case 'get_browser_status': {
      const profileId = await resolveProfileId(args)
      const status = await lux.request('GET', `/profiles/${encodeURIComponent(profileId)}/status`)
      const cdp = await getCdpInfo(profileId).catch(() => null)
      const tabs = cdp ? await getCdpTargets(profileId).catch(() => []) : []
      return textResult({ ok: true, data: { browserId: profileId, launchId: profileId, profileId, status, cdp, tabs } })
    }

    case 'stop_browser': {
      const profileId = await resolveProfileId(args)
      return textResult({ ok: true, data: await lux.request('POST', `/profiles/${encodeURIComponent(profileId)}/stop`) })
    }

    case 'close_all_browsers': {
      const continueOnError = optionalBoolean(args, 'continueOnError', true)
      const sessions = await getSessions()
      const results: unknown[] = []
      for (const session of sessions) {
        try {
          const stopped = await lux.request('POST', `/profiles/${encodeURIComponent(session.profile_id)}/stop`)
          results.push({ profileId: session.profile_id, pid: session.pid, ok: true, data: stopped })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          results.push({ profileId: session.profile_id, pid: session.pid, ok: false, error: message })
          if (!continueOnError) throw err
        }
      }
      return textResult({ ok: true, data: results })
    }

    case 'get_active_tabs': {
      const profileId = await resolveProfileId(args)
      const tabs = await getCdpTargets(profileId)
      return textResult({ ok: true, data: { browserId: profileId, profileId, tabs } })
    }

    case 'execute_js': {
      const profileId = await resolveProfileId(args)
      const script = requireString(args, 'script')
      const target = selectTarget(await getCdpTargets(profileId), args)
      if (!target.webSocketDebuggerUrl) throw new Error(`Tab has no websocket debugger URL: ${target.id}`)
      const evaluation = await cdpCommand(target.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: script,
        awaitPromise: optionalBoolean(args, 'awaitPromise', true),
        returnByValue: optionalBoolean(args, 'returnByValue', true),
        userGesture: true
      })
      return textResult({ ok: true, data: { browserId: profileId, profileId, tab: target, evaluation } })
    }

    case 'take_screenshot': {
      const profileId = await resolveProfileId(args)
      const output = optionalString(args, 'output') ?? 'base64'
      const target = selectTarget(await getCdpTargets(profileId), args)
      if (!target.webSocketDebuggerUrl) throw new Error(`Tab has no websocket debugger URL: ${target.id}`)
      const result = await cdpCommand<{ data: string }>(target.webSocketDebuggerUrl, 'Page.captureScreenshot', {
        format: optionalString(args, 'format') ?? 'png',
        quality: optionalNumber(args, 'quality'),
        captureBeyondViewport: optionalBoolean(args, 'fullPage', false)
      })
      if (output === 'file') {
        const outputPath = optionalString(args, 'outputPath')
        if (!outputPath) throw new McpError(ErrorCode.InvalidParams, 'outputPath is required when output=file')
        const absolutePath = resolve(outputPath)
        mkdirSync(dirname(absolutePath), { recursive: true })
        writeFileSync(absolutePath, Buffer.from(result.data, 'base64'))
        return textResult({ ok: true, data: { browserId: profileId, profileId, tab: target, path: absolutePath } })
      }
      return textResult({ ok: true, data: { browserId: profileId, profileId, tab: target, base64: result.data } })
    }

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`)
  }
}

const server = new Server(
  {
    name: 'lux-antidetect-mcp',
    version: '1.0.75'
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await handleTool(request.params.name, request.params.arguments)
  } catch (err) {
    if (err instanceof McpError) throw err
    const message = err instanceof Error ? err.message : String(err)
    log('error', 'tool failed', { tool: request.params.name, message })
    return errorResult(message)
  }
})

async function main(): Promise<void> {
  log('info', 'starting Lux Antidetect MCP server', {
    sdk: '@modelcontextprotocol/sdk',
    apiBaseUrl: process.env.LUX_API_BASE_URL ?? null,
    apiHost: DEFAULT_HOST,
    portScan: DEFAULT_PORT_SCAN,
    cwd: process.cwd(),
    scriptDir: __dirname
  })
  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  log('error', 'fatal MCP server error', err instanceof Error ? err.stack ?? err.message : String(err))
  process.exit(1)
})
