import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { createConnection } from 'net'
import type { Proxy, ProxyResponse, ProxyInput } from './models'
import { toProxyResponse } from './models'

const MIN_PORT = 1
const MAX_PORT = 65535

export function listProxies(db: Database.Database): ProxyResponse[] {
  const rows = db.prepare('SELECT * FROM proxies ORDER BY created_at DESC').all() as Proxy[]
  return rows.map(toProxyResponse)
}

export function createProxy(db: Database.Database, input: ProxyInput): ProxyResponse {
  if (input.port < MIN_PORT || input.port > MAX_PORT)
    throw new Error(`Port must be between ${MIN_PORT} and ${MAX_PORT}`)
  if (!input.host.trim()) throw new Error('Host is required')

  const id = uuidv4()
  db.prepare(
    `INSERT INTO proxies (id, name, protocol, host, port, username, password, country, group_tag, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    id,
    input.name,
    input.protocol,
    input.host.trim(),
    input.port,
    input.username ?? null,
    input.password ?? null,
    input.country ?? null,
    input.group_tag ?? null
  )

  return toProxyResponse(
    db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) as Proxy
  )
}

export function updateProxy(
  db: Database.Database,
  proxyId: string,
  input: ProxyInput
): ProxyResponse {
  const existing = db.prepare('SELECT id FROM proxies WHERE id = ?').get(proxyId)
  if (!existing) throw new Error(`Proxy not found: ${proxyId}`)

  if (input.port < MIN_PORT || input.port > MAX_PORT)
    throw new Error(`Port must be between ${MIN_PORT} and ${MAX_PORT}`)
  if (!input.host.trim()) throw new Error('Host is required')

  if (input.password !== undefined) {
    db.prepare(
      `UPDATE proxies SET name = ?, protocol = ?, host = ?, port = ?, username = ?, password = ?, country = ?, group_tag = ? WHERE id = ?`
    ).run(
      input.name,
      input.protocol,
      input.host.trim(),
      input.port,
      input.username ?? null,
      input.password ?? null,
      input.country ?? null,
      input.group_tag ?? null,
      proxyId
    )
  } else {
    db.prepare(
      `UPDATE proxies SET name = ?, protocol = ?, host = ?, port = ?, username = ?, country = ?, group_tag = ? WHERE id = ?`
    ).run(
      input.name,
      input.protocol,
      input.host.trim(),
      input.port,
      input.username ?? null,
      input.country ?? null,
      input.group_tag ?? null,
      proxyId
    )
  }

  return toProxyResponse(
    db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as Proxy
  )
}

export function deleteProxy(db: Database.Database, proxyId: string): void {
  const existing = db.prepare('SELECT id FROM proxies WHERE id = ?').get(proxyId)
  if (!existing) throw new Error(`Proxy not found: ${proxyId}`)
  db.prepare('DELETE FROM proxies WHERE id = ?').run(proxyId)
}

const PROXY_TEST_TIMEOUT_MS = 5000

export function testProxy(db: Database.Database, proxyId: string): Promise<boolean> {
  const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as Proxy | undefined
  if (!proxy) throw new Error(`Proxy not found: ${proxyId}`)

  const startTime = Date.now()

  return new Promise((resolve) => {
    const socket = createConnection(
      { host: proxy.host, port: proxy.port, timeout: PROXY_TEST_TIMEOUT_MS },
      () => {
        const latency = Date.now() - startTime
        socket.destroy()
        const now = new Date().toISOString()
        db.prepare('UPDATE proxies SET last_check = ?, check_ok = 1, check_latency_ms = ? WHERE id = ?').run(
          now,
          latency,
          proxyId
        )
        resolve(true)
      }
    )
    socket.on('error', () => {
      socket.destroy()
      const now = new Date().toISOString()
      db.prepare('UPDATE proxies SET last_check = ?, check_ok = 0, check_latency_ms = NULL WHERE id = ?').run(
        now,
        proxyId
      )
      resolve(false)
    })
    socket.on('timeout', () => {
      socket.destroy()
      const now = new Date().toISOString()
      db.prepare('UPDATE proxies SET last_check = ?, check_ok = 0, check_latency_ms = NULL WHERE id = ?').run(
        now,
        proxyId
      )
      resolve(false)
    })
  })
}

/** Pick a random proxy from a group (for proxy rotation). */
export function getRandomProxyFromGroup(db: Database.Database, groupTag: string): Proxy | null {
  const proxies = db.prepare(
    'SELECT * FROM proxies WHERE group_tag = ? AND check_ok = 1'
  ).all(groupTag) as Proxy[]
  if (proxies.length === 0) {
    // Fall back to all proxies in the group regardless of check status
    const all = db.prepare('SELECT * FROM proxies WHERE group_tag = ?').all(groupTag) as Proxy[]
    if (all.length === 0) return null
    return all[Math.floor(Math.random() * all.length)]
  }
  return proxies[Math.floor(Math.random() * proxies.length)]
}

/** Get all unique proxy group tags. */
export function getProxyGroups(db: Database.Database): string[] {
  const rows = db.prepare(
    'SELECT DISTINCT group_tag FROM proxies WHERE group_tag IS NOT NULL AND group_tag != \'\' ORDER BY group_tag'
  ).all() as { group_tag: string }[]
  return rows.map(r => r.group_tag)
}

/** Lookup country for a proxy host using ip-api.com (free, no key). */
export async function lookupProxyCountry(host: string): Promise<string | null> {
  try {
    const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(host)}?fields=countryCode`)
    if (!resp.ok) return null
    const data = await resp.json() as { countryCode?: string }
    return data.countryCode ?? null
  } catch {
    return null
  }
}

/** Update proxy country after geo-lookup. */
export async function updateProxyCountry(db: Database.Database, proxyId: string): Promise<string | null> {
  const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as Proxy | undefined
  if (!proxy) return null
  const country = await lookupProxyCountry(proxy.host)
  if (country) {
    db.prepare('UPDATE proxies SET country = ? WHERE id = ?').run(country, proxyId)
  }
  return country
}
