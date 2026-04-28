import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { rm, mkdir } from 'fs/promises'
import { join } from 'path'
import type {
  Profile,
  Proxy,
  Fingerprint,
  ProfileDetail,
  ProxyResponse,
  CreateProfileInput,
  UpdateProfileInput,
  UpdateFingerprintInput
} from './models'
import { toProxyResponse } from './models'
import { applyProxyGeoToFingerprint, generateDefaultFingerprint, normalizeFingerprint } from './fingerprint'
import { isRunning } from './sessions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TAG_MAX_LENGTH = 40
const TAG_MAX_COUNT = 20
const TAG_NOISE_RE = /^[\s[\]/\\'",]+$/
function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new Error('Invalid profile ID format')
}

function cleanTag(raw: string): string | null {
  const tag = raw
    .trim()
    .replace(/^[\s[\]"']+/g, '')
    .replace(/[\s[\]"']+$/g, '')
    .trim()
  if (!tag || TAG_NOISE_RE.test(tag)) return null
  return tag.slice(0, TAG_MAX_LENGTH)
}

function normalizeTags(raw: unknown): string[] {
  const tags: string[] = []
  const collect = (value: unknown): void => {
    if (tags.length >= TAG_MAX_COUNT || value === null || value === undefined) return
    if (Array.isArray(value)) {
      for (const item of value) collect(item)
      return
    }
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (!trimmed || TAG_NOISE_RE.test(trimmed)) return
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        collect(parsed)
        return
      }
    } catch { /* plain comma-separated tags */ }
    for (const part of trimmed.split(',')) {
      const tag = cleanTag(part)
      if (tag && !tags.includes(tag)) tags.push(tag)
      if (tags.length >= TAG_MAX_COUNT) return
    }
  }
  collect(raw)
  return tags
}

export function listProfiles(db: Database.Database): Profile[] {
  return db.prepare('SELECT * FROM profiles ORDER BY updated_at DESC').all() as Profile[]
}

export function getProfile(db: Database.Database, profileId: string): ProfileDetail {
  assertUuid(profileId)
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as
    | Profile
    | undefined
  if (!profile) throw new Error(`Profile not found: ${profileId}`)

  const fingerprint = db.prepare('SELECT * FROM fingerprints WHERE profile_id = ?').get(
    profileId
  ) as Fingerprint | undefined
  if (!fingerprint) throw new Error(`Fingerprint not found for profile: ${profileId}`)

  let proxy: ProxyResponse | null = null
  if (profile.proxy_id) {
    const raw = db.prepare('SELECT * FROM proxies WHERE id = ?').get(profile.proxy_id) as
      | Proxy
      | undefined
    if (raw) proxy = toProxyResponse(raw)
  }

  return { profile, fingerprint, proxy }
}

export async function createProfile(
  db: Database.Database,
  input: CreateProfileInput,
  profilesDir: string
): Promise<Profile> {
  const profileId = uuidv4()
  const fingerprintId = uuidv4()
  const now = new Date().toISOString()
  const tags = JSON.stringify(normalizeTags(input.tags ?? []))
  const fp = generateDefaultFingerprint(input.browser_type, input.fingerprint)

  const insertProfile = db.prepare(
    `INSERT INTO profiles (id, name, browser_type, group_name, group_color, tags, notes, status, proxy_id, start_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`
  )
  const insertFingerprint = db.prepare(
    `INSERT INTO fingerprints (id, profile_id, user_agent, platform, hardware_concurrency, device_memory, languages,
     screen_width, screen_height, color_depth, pixel_ratio, timezone, canvas_noise_seed, webgl_vendor, webgl_renderer,
     audio_context_noise, fonts_list, webrtc_policy, video_inputs, audio_inputs, audio_outputs, device_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const transaction = db.transaction(() => {
    insertProfile.run(
      profileId,
      input.name,
      input.browser_type,
      input.group_name ?? null,
      input.group_color ?? null,
      tags,
      input.notes ?? '',
      input.proxy_id ?? null,
      input.start_url ?? '',
      now,
      now
    )
    insertFingerprint.run(
      fingerprintId,
      profileId,
      fp.user_agent,
      fp.platform,
      fp.hardware_concurrency,
      fp.device_memory,
      fp.languages,
      fp.screen_width,
      fp.screen_height,
      fp.color_depth,
      fp.pixel_ratio,
      fp.timezone,
      fp.canvas_noise_seed,
      fp.webgl_vendor,
      fp.webgl_renderer,
      fp.audio_context_noise,
      fp.fonts_list,
      fp.webrtc_policy,
      fp.video_inputs,
      fp.audio_inputs,
      fp.audio_outputs,
      fp.device_type
    )
  })
  transaction()

  // Auto-sync the freshly-generated fingerprint to the proxy's geo (if any).
  // Mirrors the updateProfile path so a freshly created profile + proxy pair
  // already has matching timezone / language without a second save.
  if (input.proxy_id) syncFingerprintToProxy(db, profileId, input.proxy_id)

  await mkdir(join(profilesDir, profileId), { recursive: true })

  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as Profile
}

export function updateProfile(
  db: Database.Database,
  profileId: string,
  input: UpdateProfileInput
): Profile {
  assertUuid(profileId)
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as
    | Profile
    | undefined
  if (!existing) throw new Error(`Profile not found: ${profileId}`)

  const name = input.name ?? existing.name
  const browserType = input.browser_type ?? existing.browser_type
  const groupName = input.group_name !== undefined ? input.group_name : existing.group_name
  const groupColor = input.group_color !== undefined ? input.group_color : existing.group_color
  const tags = input.tags !== undefined ? JSON.stringify(normalizeTags(input.tags)) : existing.tags
  const notes = input.notes ?? existing.notes
  const proxyId = input.proxy_id !== undefined ? input.proxy_id : existing.proxy_id
  const startUrl = input.start_url !== undefined ? input.start_url : existing.start_url
  const now = new Date().toISOString()

  db.prepare(
    `UPDATE profiles SET name = ?, browser_type = ?, group_name = ?, group_color = ?, tags = ?, notes = ?, proxy_id = ?, start_url = ?, updated_at = ? WHERE id = ?`
  ).run(name, browserType, groupName, groupColor, tags, notes, proxyId, startUrl, now, profileId)

  // Auto-sync the fingerprint to the (new) proxy's geo whenever the proxy
  // assignment changes. This keeps the editor honest: timezone + primary
  // language displayed in the editor match what'll actually be injected
  // at launch via applyProxyGeoToFingerprint.
  const proxyChanged = input.proxy_id !== undefined && input.proxy_id !== existing.proxy_id
  if (proxyChanged) syncFingerprintToProxy(db, profileId, proxyId)

  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as Profile
}

/**
 * Overlay the proxy's geo data onto the profile's fingerprint and persist.
 * No-op when the profile has no fingerprint yet (createProfile path), or
 * when the proxy has no resolved geo (lookupProxyGeo hasn't run, or the
 * provider didn't return data).
 */
function syncFingerprintToProxy(
  db: Database.Database,
  profileId: string,
  proxyId: string | null
): void {
  const fp = db.prepare('SELECT * FROM fingerprints WHERE profile_id = ?').get(profileId) as
    | Fingerprint
    | undefined
  if (!fp) return
  const proxy = proxyId
    ? (db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as Proxy | undefined)
    : null
  const merged = applyProxyGeoToFingerprint(fp, proxy ?? null)
  if (merged.timezone === fp.timezone && merged.languages === fp.languages) return
  db.prepare(
    `UPDATE fingerprints SET timezone = ?, languages = ? WHERE profile_id = ?`
  ).run(merged.timezone, merged.languages, profileId)
}

/**
 * Public re-sync entry point — used after a proxy's geo data refreshes
 * (e.g. lookupProxyGeo populated proxy.timezone for the first time) so
 * every profile pinned to that proxy picks up the new region without
 * the user having to reopen and re-save the profile.
 */
export function syncFingerprintsForProxy(
  db: Database.Database,
  proxyId: string
): void {
  const profiles = db
    .prepare('SELECT id FROM profiles WHERE proxy_id = ?')
    .all(proxyId) as { id: string }[]
  for (const p of profiles) syncFingerprintToProxy(db, p.id, proxyId)
}

export function updateFingerprint(
  db: Database.Database,
  profileId: string,
  input: UpdateFingerprintInput
): void {
  assertUuid(profileId)
  const existing = db.prepare('SELECT * FROM fingerprints WHERE profile_id = ?').get(profileId) as
    | Fingerprint
    | undefined
  if (!existing) throw new Error(`Fingerprint not found for profile: ${profileId}`)

  const hasUpdates = Object.values(input).some((value) => value !== undefined)
  if (!hasUpdates) return

  const mergedFingerprint: Fingerprint = {
    ...existing,
    user_agent: input.user_agent ?? existing.user_agent,
    platform: input.platform ?? existing.platform,
    hardware_concurrency: input.hardware_concurrency ?? existing.hardware_concurrency,
    device_memory: input.device_memory ?? existing.device_memory,
    languages:
      input.languages !== undefined ? JSON.stringify(input.languages) : existing.languages,
    screen_width: input.screen_width ?? existing.screen_width,
    screen_height: input.screen_height ?? existing.screen_height,
    color_depth: input.color_depth ?? existing.color_depth,
    pixel_ratio: input.pixel_ratio ?? existing.pixel_ratio,
    timezone: input.timezone ?? existing.timezone,
    canvas_noise_seed: existing.canvas_noise_seed,
    webgl_vendor: input.webgl_vendor ?? existing.webgl_vendor,
    webgl_renderer: input.webgl_renderer ?? existing.webgl_renderer,
    audio_context_noise: existing.audio_context_noise,
    fonts_list: existing.fonts_list,
    webrtc_policy: input.webrtc_policy ?? existing.webrtc_policy,
    video_inputs: existing.video_inputs,
    audio_inputs: existing.audio_inputs,
    audio_outputs: existing.audio_outputs,
    device_type: input.device_type ?? existing.device_type
  }

  if (input.timezone !== undefined && input.languages === undefined) {
    mergedFingerprint.languages = ''
  }

  const normalized = normalizeFingerprint(mergedFingerprint)

  db.prepare(`
    UPDATE fingerprints SET
      user_agent = ?, platform = ?, hardware_concurrency = ?, device_memory = ?,
      languages = ?, screen_width = ?, screen_height = ?, color_depth = ?,
      pixel_ratio = ?, timezone = ?, canvas_noise_seed = ?, webgl_vendor = ?,
      webgl_renderer = ?, audio_context_noise = ?, fonts_list = ?,
      webrtc_policy = ?, video_inputs = ?, audio_inputs = ?, audio_outputs = ?,
      device_type = ?
    WHERE profile_id = ?
  `).run(
    normalized.user_agent,
    normalized.platform,
    normalized.hardware_concurrency,
    normalized.device_memory,
    normalized.languages,
    normalized.screen_width,
    normalized.screen_height,
    normalized.color_depth,
    normalized.pixel_ratio,
    normalized.timezone,
    normalized.canvas_noise_seed,
    normalized.webgl_vendor,
    normalized.webgl_renderer,
    normalized.audio_context_noise,
    normalized.fonts_list,
    normalized.webrtc_policy,
    normalized.video_inputs,
    normalized.audio_inputs,
    normalized.audio_outputs,
    normalized.device_type,
    profileId
  )
}

export async function deleteProfile(
  db: Database.Database,
  profileId: string,
  profilesDir: string
): Promise<void> {
  assertUuid(profileId)
  if (isRunning(profileId)) throw new Error('Cannot delete a running profile. Stop the browser first.')

  const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)
  if (!existing) throw new Error(`Profile not found: ${profileId}`)

  db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId)

  try {
    await rm(join(profilesDir, profileId), { recursive: true, force: true })
  } catch {
    /* dir may not exist */
  }
}

/**
 * Wipe every Chromium-side trace for one profile while keeping the Lux
 * config row intact. Deletes the whole user-data-dir (cookies, localStorage,
 * IndexedDB, cache, history, service workers, login data, autofill, sessions,
 * trust tokens, network state, etc.). On the next launch Chrome rebuilds the
 * directory from scratch and Lux re-applies our identity (Local State name +
 * avatar via updateChromeProfileIdentity) and re-loads the proxy-auth
 * extension, so the profile boots clean without losing its name / group /
 * fingerprint / proxy assignment (those live in SQLite, not in the dir).
 *
 * The profile must be stopped first — Chrome holds file handles while
 * running and a wipe under it would race the writes back into the dir.
 */
export async function wipeProfileBrowserData(
  db: Database.Database,
  profileId: string,
  profilesDir: string
): Promise<void> {
  assertUuid(profileId)
  if (isRunning(profileId)) {
    throw new Error('Cannot wipe a running profile. Stop the browser first.')
  }
  const existing = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)
  if (!existing) throw new Error(`Profile not found: ${profileId}`)

  const dir = join(profilesDir, profileId)
  // Retry once after a short delay — Windows can hold file handles for a
  // moment after the Chrome process exits even though our isRunning() guard
  // already passed. EBUSY / EPERM disappears within ~500ms typically.
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY') {
      await new Promise((resolve) => setTimeout(resolve, 750))
      await rm(dir, { recursive: true, force: true })
    } else {
      throw err
    }
  }
}

export async function duplicateProfile(
  db: Database.Database,
  profileId: string,
  profilesDir: string
): Promise<Profile> {
  assertUuid(profileId)
  const detail = getProfile(db, profileId)
  const newId = uuidv4()
  const fpId = uuidv4()
  const now = new Date().toISOString()
  const fp = detail.fingerprint

  const newCanvasSeed = Math.floor(Math.random() * 2147483647)
  const newAudioNoise = Math.random() * 0.0001

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO profiles (id, name, browser_type, group_name, group_color, tags, notes, status, proxy_id, start_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`
    ).run(
      newId,
      `${detail.profile.name} (copy)`,
      detail.profile.browser_type,
      detail.profile.group_name,
      detail.profile.group_color,
      detail.profile.tags,
      detail.profile.notes,
      detail.profile.proxy_id,
      detail.profile.start_url,
      now,
      now
    )

    db.prepare(
      `INSERT INTO fingerprints (id, profile_id, user_agent, platform, hardware_concurrency, device_memory, languages,
       screen_width, screen_height, color_depth, pixel_ratio, timezone, canvas_noise_seed, webgl_vendor, webgl_renderer,
       audio_context_noise, fonts_list, webrtc_policy, video_inputs, audio_inputs, audio_outputs, device_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fpId,
      newId,
      fp.user_agent,
      fp.platform,
      fp.hardware_concurrency,
      fp.device_memory,
      fp.languages,
      fp.screen_width,
      fp.screen_height,
      fp.color_depth,
      fp.pixel_ratio,
      fp.timezone,
      newCanvasSeed,
      fp.webgl_vendor,
      fp.webgl_renderer,
      newAudioNoise,
      fp.fonts_list,
      fp.webrtc_policy,
      fp.video_inputs,
      fp.audio_inputs,
      fp.audio_outputs,
      fp.device_type
    )
  })
  transaction()

  await mkdir(join(profilesDir, newId), { recursive: true })

  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(newId) as Profile
}
