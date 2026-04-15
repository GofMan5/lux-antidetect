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
    `INSERT INTO proxies (id, name, protocol, host, port, username, password, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    id,
    input.name,
    input.protocol,
    input.host.trim(),
    input.port,
    input.username ?? null,
    input.password ?? null
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
      `UPDATE proxies SET name = ?, protocol = ?, host = ?, port = ?, username = ?, password = ? WHERE id = ?`
    ).run(
      input.name,
      input.protocol,
      input.host.trim(),
      input.port,
      input.username ?? null,
      input.password ?? null,
      proxyId
    )
  } else {
    db.prepare(
      `UPDATE proxies SET name = ?, protocol = ?, host = ?, port = ?, username = ? WHERE id = ?`
    ).run(
      input.name,
      input.protocol,
      input.host.trim(),
      input.port,
      input.username ?? null,
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

  return new Promise((resolve) => {
    const socket = createConnection(
      { host: proxy.host, port: proxy.port, timeout: PROXY_TEST_TIMEOUT_MS },
      () => {
        socket.destroy()
        const now = new Date().toISOString()
        db.prepare('UPDATE proxies SET last_check = ?, check_ok = 1 WHERE id = ?').run(
          now,
          proxyId
        )
        resolve(true)
      }
    )
    socket.on('error', () => {
      socket.destroy()
      const now = new Date().toISOString()
      db.prepare('UPDATE proxies SET last_check = ?, check_ok = 0 WHERE id = ?').run(
        now,
        proxyId
      )
      resolve(false)
    })
    socket.on('timeout', () => {
      socket.destroy()
      const now = new Date().toISOString()
      db.prepare('UPDATE proxies SET last_check = ?, check_ok = 0 WHERE id = ?').run(
        now,
        proxyId
      )
      resolve(false)
    })
  })
}
