import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import {
  getProfile,
  listProfiles,
  updateFingerprint,
  updateProfile
} from './profile'
import { listProxies } from './proxy'
import type {
  AiActionApplyResult,
  AiChat,
  AiChatMessage,
  AiProfileAction,
  AiSendMessageInput,
  AiSendMessageResult,
  AiSettings,
  Fingerprint,
  Profile,
  ProxyResponse,
  UpdateFingerprintInput,
  UpdateProfileInput
} from './models'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_API_KEY_SETTING = 'groq_api_key'
const GROQ_MODEL_SETTING = 'groq_model'
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile'
const AI_CONTEXT_MESSAGE_LIMIT = 60
const MAX_USER_MESSAGE_CHARS = 8_000
const MAX_ACTIONS = 8
const MAX_CONTEXT_PROFILES = 40
const MAX_CONTEXT_PROXIES = 80

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type GroqRole = 'system' | 'user' | 'assistant'

interface GroqMessage {
  role: GroqRole
  content: string
}

interface StoredMessageRow {
  id: string
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  actions: string | null
  created_at: string
}

function assertUuid(id: string, label = 'ID'): void {
  if (!UUID_RE.test(id)) throw new Error(`Invalid ${label}`)
}

function nowIso(): string {
  return new Date().toISOString()
}

function titleFromMessage(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim()
  return compact.length > 48 ? `${compact.slice(0, 45)}...` : compact || 'New chat'
}

function getSetting(db: Database.Database, key: string): unknown {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row) return null
  try {
    return JSON.parse(row.value)
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

function deleteSetting(db: Database.Database, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

function getGroqApiKey(db: Database.Database): string {
  const stored = getSetting(db, GROQ_API_KEY_SETTING)
  if (typeof stored === 'string' && stored.trim()) return stored.trim()
  return process.env.GROQ_API_KEY?.trim() ?? ''
}

function getGroqModel(db: Database.Database): string {
  const stored = getSetting(db, GROQ_MODEL_SETTING)
  if (typeof stored === 'string' && stored.trim()) return stored.trim()
  return DEFAULT_GROQ_MODEL
}

export function getAiSettings(db: Database.Database): AiSettings {
  return {
    hasApiKey: Boolean(getGroqApiKey(db)),
    model: getGroqModel(db),
    maxContextMessages: AI_CONTEXT_MESSAGE_LIMIT
  }
}

export function setAiSettings(
  db: Database.Database,
  input: { apiKey?: string; model?: string; clearApiKey?: boolean }
): AiSettings {
  if (input.clearApiKey) {
    deleteSetting(db, GROQ_API_KEY_SETTING)
  } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    setSetting(db, GROQ_API_KEY_SETTING, input.apiKey.trim())
  }

  if (typeof input.model === 'string' && input.model.trim()) {
    setSetting(db, GROQ_MODEL_SETTING, input.model.trim())
  }

  return getAiSettings(db)
}

export function listAiChats(db: Database.Database): AiChat[] {
  return db
    .prepare(
      `SELECT id, title, created_at, updated_at
       FROM ai_chats
       ORDER BY updated_at DESC`
    )
    .all() as AiChat[]
}

export function createAiChat(db: Database.Database, title = 'New chat'): AiChat {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO ai_chats (id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, titleFromMessage(title), ts, ts)
  return db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(id) as AiChat
}

export function deleteAiChat(db: Database.Database, chatId: string): void {
  assertUuid(chatId, 'chat ID')
  db.prepare('DELETE FROM ai_chats WHERE id = ?').run(chatId)
}

export function listAiMessages(db: Database.Database, chatId: string): AiChatMessage[] {
  assertUuid(chatId, 'chat ID')
  const rows = db
    .prepare(
      `SELECT id, chat_id, role, content, actions, created_at
       FROM (
         SELECT *
         FROM ai_messages
         WHERE chat_id = ?
         ORDER BY created_at DESC
         LIMIT ?
       )
       ORDER BY created_at ASC`
    )
    .all(chatId, AI_CONTEXT_MESSAGE_LIMIT) as StoredMessageRow[]
  return rows.map(rowToMessage)
}

function getContextMessages(db: Database.Database, chatId: string): AiChatMessage[] {
  return listAiMessages(db, chatId)
}

function rowToMessage(row: StoredMessageRow): AiChatMessage {
  return {
    id: row.id,
    chat_id: row.chat_id,
    role: row.role,
    content: row.content,
    actions: parseActions(row.actions),
    created_at: row.created_at
  }
}

function parseActions(raw: string | null): AiProfileAction[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as AiProfileAction[]) : []
  } catch {
    return []
  }
}

function insertMessage(
  db: Database.Database,
  chatId: string,
  role: 'user' | 'assistant',
  content: string,
  actions: AiProfileAction[] = []
): AiChatMessage {
  const id = randomUUID()
  const ts = nowIso()
  db.prepare(
    `INSERT INTO ai_messages (id, chat_id, role, content, actions, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, chatId, role, content, JSON.stringify(actions), ts)
  db.prepare('UPDATE ai_chats SET updated_at = ? WHERE id = ?').run(ts, chatId)
  return {
    id,
    chat_id: chatId,
    role,
    content,
    actions,
    created_at: ts
  }
}

function ensureChat(db: Database.Database, chatId: string | null | undefined, content: string): AiChat {
  if (chatId) {
    assertUuid(chatId, 'chat ID')
    const existing = db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(chatId) as AiChat | undefined
    if (!existing) throw new Error('Chat not found')
    return existing
  }
  return createAiChat(db, content)
}

export async function sendAiMessage(
  db: Database.Database,
  input: AiSendMessageInput
): Promise<AiSendMessageResult> {
  if (!input || typeof input !== 'object') throw new Error('Invalid input')
  const content = typeof input.content === 'string' ? input.content.trim() : ''
  if (!content) throw new Error('Message is required')
  if (content.length > MAX_USER_MESSAGE_CHARS) {
    throw new Error(`Message is too long (max ${MAX_USER_MESSAGE_CHARS} chars)`)
  }
  if (input.profileId) assertUuid(input.profileId, 'profile ID')

  const apiKey = getGroqApiKey(db)
  if (!apiKey) throw new Error('Groq API key is not configured')

  const chat = ensureChat(db, input.chatId, content)
  insertMessage(db, chat.id, 'user', content)

  const contextMessages = getContextMessages(db, chat.id)
  const modelMessages = buildModelMessages(db, contextMessages, input.profileId ?? null)
  const rawReply = await callGroq(apiKey, getGroqModel(db), modelMessages)
  const extracted = extractActions(rawReply)
  const safeActions = sanitizeActions(db, extracted.actions)
  const assistant = insertMessage(db, chat.id, 'assistant', extracted.content, safeActions)

  return {
    chat: db.prepare('SELECT * FROM ai_chats WHERE id = ?').get(chat.id) as AiChat,
    messages: listAiMessages(db, chat.id),
    assistant
  }
}

function buildModelMessages(
  db: Database.Database,
  messages: AiChatMessage[],
  focusedProfileId: string | null
): GroqMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: buildLuxContext(db, focusedProfileId) },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content
    }))
  ]
}

function buildLuxContext(db: Database.Database, focusedProfileId: string | null): string {
  const allProfiles = listProfiles(db)
  const allProxies = listProxies(db)
  const profiles = prioritizeFocused(allProfiles, focusedProfileId).slice(0, MAX_CONTEXT_PROFILES)
  const proxies = allProxies.slice(0, MAX_CONTEXT_PROXIES)
  const details = profiles.map((profile) => profileSummary(db, profile, focusedProfileId))
  const proxyRows = proxies.map(proxySummary)
  const settings = {
    auto_regenerate_fingerprint: getSetting(db, 'auto_regenerate_fingerprint') !== false,
    hardware_identity_lockdown: getSetting(db, 'hardware_identity_lockdown') !== false,
    translation_enabled: getSetting(db, 'translation_enabled') === true,
    translation_target_lang: getSetting(db, 'translation_target_lang') ?? 'en'
  }

  return JSON.stringify(
    {
      app: 'Lux Antidetect',
      focused_profile_id: focusedProfileId,
      context_message_limit: AI_CONTEXT_MESSAGE_LIMIT,
      safety:
        'Use only legitimate account management, privacy testing, QA, and profile consistency. Do not help abuse, spam, credential attacks, or bypass third-party rules.',
      settings,
      total_profiles: allProfiles.length,
      total_proxies: allProxies.length,
      profiles: details,
      proxies: proxyRows
    },
    null,
    2
  )
}

function prioritizeFocused(profiles: Profile[], focusedProfileId: string | null): Profile[] {
  if (!focusedProfileId) return profiles
  const focused = profiles.find((profile) => profile.id === focusedProfileId)
  if (!focused) return profiles
  return [focused, ...profiles.filter((profile) => profile.id !== focusedProfileId)]
}

function profileSummary(
  db: Database.Database,
  profile: Profile,
  focusedProfileId: string | null
): Record<string, unknown> {
  let fingerprint: Fingerprint | null = null
  let proxy: ProxyResponse | null = null
  try {
    const detail = getProfile(db, profile.id)
    fingerprint = detail.fingerprint
    proxy = detail.proxy
  } catch {
    // Keep the profile visible even if its detail row is temporarily corrupt.
  }

  return {
    focused: profile.id === focusedProfileId,
    id: profile.id,
    name: profile.name,
    browser_type: profile.browser_type,
    status: profile.status,
    group_name: profile.group_name,
    tags: parseJsonArray(profile.tags),
    notes: profile.notes.slice(0, 500),
    proxy_id: profile.proxy_id,
    proxy: proxy
      ? {
          id: proxy.id,
          name: proxy.name,
          protocol: proxy.protocol,
          host: proxy.host,
          port: proxy.port,
          has_username: Boolean(proxy.username),
          has_password: proxy.has_password,
          country: proxy.country,
          city: proxy.city,
          timezone: proxy.timezone,
          locale: proxy.locale,
          external_ip: proxy.external_ip,
          check_ok: proxy.check_ok,
          check_error: proxy.check_error,
          fraud_risk: proxy.fraud_risk,
          fraud_score: proxy.fraud_score,
          asn_type: proxy.asn_type,
          is_mobile: proxy.is_mobile,
          is_datacenter: proxy.is_datacenter,
          is_hosting: proxy.is_hosting
        }
      : null,
    fingerprint: fingerprint
      ? {
          user_agent: fingerprint.user_agent,
          platform: fingerprint.platform,
          device_type: fingerprint.device_type,
          hardware_concurrency: fingerprint.hardware_concurrency,
          device_memory: fingerprint.device_memory,
          languages: parseJsonArray(fingerprint.languages),
          timezone: fingerprint.timezone,
          screen_width: fingerprint.screen_width,
          screen_height: fingerprint.screen_height,
          color_depth: fingerprint.color_depth,
          pixel_ratio: fingerprint.pixel_ratio,
          webgl_vendor: fingerprint.webgl_vendor,
          webgl_renderer: fingerprint.webgl_renderer,
          webrtc_policy: fingerprint.webrtc_policy
        }
      : null
  }
}

function proxySummary(proxy: ProxyResponse): Record<string, unknown> {
  return {
    id: proxy.id,
    name: proxy.name,
    protocol: proxy.protocol,
    host: proxy.host,
    port: proxy.port,
    has_username: Boolean(proxy.username),
    has_password: proxy.has_password,
    country: proxy.country,
    city: proxy.city,
    timezone: proxy.timezone,
    locale: proxy.locale,
    check_ok: proxy.check_ok,
    check_error: proxy.check_error,
    latency_ms: proxy.check_latency_ms,
    fraud_risk: proxy.fraud_risk,
    fraud_score: proxy.fraud_score,
    asn_type: proxy.asn_type,
    is_mobile: proxy.is_mobile,
    is_datacenter: proxy.is_datacenter,
    is_hosting: proxy.is_hosting,
    is_proxy_detected: proxy.is_proxy_detected
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

async function callGroq(apiKey: string, model: string, messages: GroqMessage[]): Promise<string> {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 1600
    })
  })

  if (!response.ok) {
    let detail = ''
    try {
      const parsed = await response.json() as { error?: { message?: string } }
      detail = parsed.error?.message ? `: ${parsed.error.message}` : ''
    } catch {
      detail = ''
    }
    throw new Error(`Groq request failed (${response.status})${detail}`)
  }

  const parsed = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = parsed.choices?.[0]?.message?.content
  if (!content) throw new Error('Groq returned an empty response')
  return content
}

function extractActions(raw: string): { content: string; actions: unknown[] } {
  const match = raw.match(/<lux-actions>\s*([\s\S]*?)\s*<\/lux-actions>/i)
  if (!match) return { content: raw.trim(), actions: [] }

  const cleanContent = raw.replace(match[0], '').trim()
  try {
    const parsed = JSON.parse(match[1]) as unknown
    if (Array.isArray(parsed)) return { content: cleanContent, actions: parsed }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { actions?: unknown }).actions)) {
      return { content: cleanContent, actions: (parsed as { actions: unknown[] }).actions }
    }
  } catch {
    // Ignore malformed model action blocks and keep the conversational answer.
  }
  return { content: cleanContent || raw.trim(), actions: [] }
}

function sanitizeActions(db: Database.Database, rawActions: unknown[]): AiProfileAction[] {
  const actions: AiProfileAction[] = []
  for (const raw of rawActions.slice(0, MAX_ACTIONS)) {
    try {
      if (!raw || typeof raw !== 'object') continue
      const source = raw as Record<string, unknown>
      const profileId = pickString(source.profileId, source.profile_id)
      if (!profileId || !UUID_RE.test(profileId)) continue
      if (!db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)) continue

      const profilePatch = sanitizeProfilePatch(db, pickObject(source.profilePatch, source.profile_patch))
      const fingerprintPatch = sanitizeFingerprintPatch(pickObject(source.fingerprintPatch, source.fingerprint_patch))
      if (!profilePatch && !fingerprintPatch) continue

      actions.push({
        id: typeof source.id === 'string' && source.id.trim() ? source.id.trim().slice(0, 80) : randomUUID(),
        profileId,
        label: (pickString(source.label) ?? 'Apply profile tuning').slice(0, 120),
        reason: (pickString(source.reason) ?? '').slice(0, 500),
        profilePatch,
        fingerprintPatch
      })
    } catch {
      // Drop malformed model-proposed actions instead of failing the chat turn.
    }
  }
  return actions
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) return trimmed
    }
  }
  return undefined
}

function pickObject(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  }
  return undefined
}

function sanitizeProfilePatch(
  db: Database.Database,
  patch: Record<string, unknown> | undefined
): UpdateProfileInput | undefined {
  if (!patch) return undefined
  const out: UpdateProfileInput = {}

  if (typeof patch.name === 'string') out.name = patch.name.trim().slice(0, 100)
  if (patch.group_name === null || patch.groupName === null) out.group_name = null
  else {
    const groupName = pickString(patch.group_name, patch.groupName)
    if (groupName) out.group_name = groupName.slice(0, 80)
  }

  if (patch.group_color === null || patch.groupColor === null) out.group_color = null
  else {
    const groupColor = pickString(patch.group_color, patch.groupColor)
    if (groupColor && /^#[0-9a-f]{6}$/i.test(groupColor)) out.group_color = groupColor
  }

  if (Array.isArray(patch.tags)) {
    out.tags = patch.tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((tag) => tag.slice(0, 40))
  }

  if (typeof patch.notes === 'string') out.notes = patch.notes.slice(0, 2_000)

  const startUrl = pickString(patch.start_url, patch.startUrl)
  if (startUrl !== undefined) {
    const sanitized = sanitizeOptionalHttpUrl(startUrl)
    if (sanitized !== undefined) out.start_url = sanitized
  }

  if (patch.proxy_id === null || patch.proxyId === null) {
    out.proxy_id = null
  } else {
    const proxyId = pickString(patch.proxy_id, patch.proxyId)
    if (proxyId && UUID_RE.test(proxyId) && db.prepare('SELECT id FROM proxies WHERE id = ?').get(proxyId)) {
      out.proxy_id = proxyId
    }
  }

  return Object.keys(out).length > 0 ? out : undefined
}

function sanitizeOptionalHttpUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed.slice(0, 2048)
  } catch {
    // Fall through.
  }
  return undefined
}

function sanitizeFingerprintPatch(
  patch: Record<string, unknown> | undefined
): UpdateFingerprintInput | undefined {
  if (!patch) return undefined
  const out: UpdateFingerprintInput = {}

  const userAgent = pickString(patch.user_agent, patch.userAgent)
  if (userAgent) out.user_agent = userAgent.slice(0, 300)

  const platform = pickString(patch.platform)
  if (platform && ['Win32', 'MacIntel', 'Linux x86_64'].includes(platform)) out.platform = platform

  const deviceType = pickString(patch.device_type, patch.deviceType)
  if (deviceType && ['desktop', 'mobile'].includes(deviceType)) out.device_type = deviceType

  const timezone = pickString(patch.timezone)
  if (timezone) out.timezone = timezone.slice(0, 80)

  if (Array.isArray(patch.languages)) {
    out.languages = patch.languages
      .filter((lang): lang is string => typeof lang === 'string')
      .map((lang) => lang.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((lang) => lang.slice(0, 16))
  }

  const webrtcPolicy = pickString(patch.webrtc_policy, patch.webrtcPolicy)
  if (
    webrtcPolicy &&
    ['default', 'disable_non_proxied_udp', 'proxy_only'].includes(webrtcPolicy)
  ) {
    out.webrtc_policy = webrtcPolicy
  }

  setBoundedInt(out, 'hardware_concurrency', patch.hardware_concurrency ?? patch.hardwareConcurrency, 2, 32)
  setBoundedInt(out, 'device_memory', patch.device_memory ?? patch.deviceMemory, 2, 64)
  setBoundedInt(out, 'screen_width', patch.screen_width ?? patch.screenWidth, 800, 7680)
  setBoundedInt(out, 'screen_height', patch.screen_height ?? patch.screenHeight, 600, 4320)
  setBoundedInt(out, 'color_depth', patch.color_depth ?? patch.colorDepth, 24, 32)

  const pixelRatio = Number(patch.pixel_ratio ?? patch.pixelRatio)
  if (Number.isFinite(pixelRatio) && pixelRatio >= 1 && pixelRatio <= 4) out.pixel_ratio = pixelRatio

  const webglVendor = pickString(patch.webgl_vendor, patch.webglVendor)
  if (webglVendor) out.webgl_vendor = webglVendor.slice(0, 120)

  const webglRenderer = pickString(patch.webgl_renderer, patch.webglRenderer)
  if (webglRenderer) out.webgl_renderer = webglRenderer.slice(0, 160)

  return Object.keys(out).length > 0 ? out : undefined
}

function setBoundedInt<K extends keyof UpdateFingerprintInput>(
  out: UpdateFingerprintInput,
  key: K,
  raw: unknown,
  min: number,
  max: number
): void {
  const value = Number(raw)
  if (Number.isInteger(value) && value >= min && value <= max) {
    ;(out as Record<string, unknown>)[key] = value
  }
}

export function applyAiActions(
  db: Database.Database,
  actions: AiProfileAction[]
): AiActionApplyResult[] {
  if (!Array.isArray(actions)) throw new Error('Actions must be an array')
  const safeActions = sanitizeActions(db, actions)
  const results: AiActionApplyResult[] = []

  for (const action of safeActions) {
    try {
      const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(action.profileId) as
        | Profile
        | undefined
      if (!profile) throw new Error('Profile not found')
      if (profile.status === 'running' || profile.status === 'starting' || profile.status === 'stopping') {
        throw new Error('Stop the profile before applying AI changes')
      }

      if (action.profilePatch) updateProfile(db, action.profileId, action.profilePatch)
      if (action.fingerprintPatch) updateFingerprint(db, action.profileId, action.fingerprintPatch)
      results.push({ actionId: action.id, ok: true })
    } catch (err) {
      results.push({
        actionId: action.id,
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to apply action'
      })
    }
  }

  return results
}

const SYSTEM_PROMPT = `
You are Lux AI, a concise local profile assistant inside Lux Antidetect.

Goals:
- Help the user keep browser profiles internally consistent for legitimate QA, privacy testing, account separation, and troubleshooting.
- Use the provided Lux context. Never invent profile IDs or proxy IDs.
- Prefer conservative changes that match proxy geo, browser type, OS identity, timezone, languages, screen, WebGL, WebRTC policy, and notes.
- Do not ask for proxy credentials. They are intentionally redacted.
- Do not give instructions for abuse, spam, credential attacks, or evading third-party rules. Keep advice focused on legitimate configuration consistency.

When you want Lux to apply changes, include a final machine-readable block:
<lux-actions>
[
  {
    "profileId": "uuid",
    "label": "Short button label",
    "reason": "Why this is useful",
    "profilePatch": {
      "name": "optional",
      "group_name": "optional",
      "group_color": "#3b82f6",
      "tags": ["optional"],
      "notes": "optional",
      "proxy_id": "uuid-or-null",
      "start_url": "https://example.com"
    },
    "fingerprintPatch": {
      "timezone": "Europe/Tallinn",
      "languages": ["et-EE", "et", "en-US", "en"],
      "webrtc_policy": "disable_non_proxied_udp",
      "screen_width": 1920,
      "screen_height": 1080,
      "pixel_ratio": 1,
      "device_type": "desktop"
    }
  }
]
</lux-actions>

Only include fields that should change. Keep normal chat text outside the block.
`.trim()
