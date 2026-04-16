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
import { generateDefaultFingerprint } from './fingerprint'
import { isRunning } from './sessions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function assertUuid(id: string): void {
  if (!UUID_RE.test(id)) throw new Error('Invalid profile ID format')
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
  const tags = JSON.stringify(input.tags ?? [])
  const fp = generateDefaultFingerprint(input.browser_type, input.fingerprint)

  const insertProfile = db.prepare(
    `INSERT INTO profiles (id, name, browser_type, group_name, group_color, tags, notes, status, proxy_id, start_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`
  )
  const insertFingerprint = db.prepare(
    `INSERT INTO fingerprints (id, profile_id, user_agent, platform, hardware_concurrency, device_memory, languages,
     screen_width, screen_height, color_depth, pixel_ratio, timezone, canvas_noise_seed, webgl_vendor, webgl_renderer,
     audio_context_noise, fonts_list, webrtc_policy, video_inputs, audio_inputs, audio_outputs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      fp.audio_outputs
    )
  })
  transaction()

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
  const tags = input.tags !== undefined ? JSON.stringify(input.tags) : existing.tags
  const notes = input.notes ?? existing.notes
  const proxyId = input.proxy_id !== undefined ? input.proxy_id : existing.proxy_id
  const startUrl = input.start_url !== undefined ? input.start_url : existing.start_url
  const now = new Date().toISOString()

  db.prepare(
    `UPDATE profiles SET name = ?, browser_type = ?, group_name = ?, group_color = ?, tags = ?, notes = ?, proxy_id = ?, start_url = ?, updated_at = ? WHERE id = ?`
  ).run(name, browserType, groupName, groupColor, tags, notes, proxyId, startUrl, now, profileId)

  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId) as Profile
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

  const fields: string[] = []
  const values: unknown[] = []

  if (input.user_agent !== undefined) {
    fields.push('user_agent = ?')
    values.push(input.user_agent)
  }
  if (input.platform !== undefined) {
    fields.push('platform = ?')
    values.push(input.platform)
  }
  if (input.hardware_concurrency !== undefined) {
    fields.push('hardware_concurrency = ?')
    values.push(input.hardware_concurrency)
  }
  if (input.device_memory !== undefined) {
    fields.push('device_memory = ?')
    values.push(input.device_memory)
  }
  if (input.languages !== undefined) {
    fields.push('languages = ?')
    values.push(JSON.stringify(input.languages))
  }
  if (input.screen_width !== undefined) {
    fields.push('screen_width = ?')
    values.push(input.screen_width)
  }
  if (input.screen_height !== undefined) {
    fields.push('screen_height = ?')
    values.push(input.screen_height)
  }
  if (input.timezone !== undefined) {
    fields.push('timezone = ?')
    values.push(input.timezone)
  }
  if (input.webgl_vendor !== undefined) {
    fields.push('webgl_vendor = ?')
    values.push(input.webgl_vendor)
  }
  if (input.webgl_renderer !== undefined) {
    fields.push('webgl_renderer = ?')
    values.push(input.webgl_renderer)
  }
  if (input.webrtc_policy !== undefined) {
    fields.push('webrtc_policy = ?')
    values.push(input.webrtc_policy)
  }
  if (input.color_depth !== undefined) {
    fields.push('color_depth = ?')
    values.push(input.color_depth)
  }
  if (input.pixel_ratio !== undefined) {
    fields.push('pixel_ratio = ?')
    values.push(input.pixel_ratio)
  }
  if (input.device_type !== undefined) {
    fields.push('device_type = ?')
    values.push(input.device_type)
  }

  if (fields.length === 0) return

  values.push(profileId)
  db.prepare(`UPDATE fingerprints SET ${fields.join(', ')} WHERE profile_id = ?`).run(...values)
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
       audio_context_noise, fonts_list, webrtc_policy, video_inputs, audio_inputs, audio_outputs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      fp.audio_outputs
    )
  })
  transaction()

  await mkdir(join(profilesDir, newId), { recursive: true })

  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(newId) as Profile
}
