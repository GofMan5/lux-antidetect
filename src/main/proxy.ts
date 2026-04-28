import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { createConnection, Socket, isIP } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import type { Proxy, ProxyResponse, ProxyInput, ProxyProtocol } from './models'
import { toProxyResponse } from './models'

const MIN_PORT = 1
const MAX_PORT = 65535

const PROXY_TEST_TIMEOUT_MS = 10_000
const PROXY_TEST_TARGET_HOST = 'www.gstatic.com'
const PROXY_TEST_TARGET_PORT = 80
const PROXY_TEST_TARGET_PATH = '/generate_204'
const PROXY_TEST_EXPECTED_STATUS = 204
const HTTP_PROXY_AUTH_REQUIRED = 407
const INTERNAL_CHECK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
const PROXY_PROTOCOLS = new Set<ProxyProtocol>(['http', 'https', 'socks4', 'socks5'])

const SOCKS5_VERSION = 0x05
const SOCKS5_AUTH_NONE = 0x00
const SOCKS5_AUTH_USERPASS = 0x02
const SOCKS5_AUTH_NO_ACCEPTABLE = 0xff
const SOCKS5_CMD_CONNECT = 0x01
const SOCKS5_RSV = 0x00
const SOCKS5_ATYP_IPV4 = 0x01
const SOCKS5_ATYP_DOMAIN = 0x03
const SOCKS5_ATYP_IPV6 = 0x04
const SOCKS5_REP_SUCCESS = 0x00
const SOCKS5_USERPASS_VERSION = 0x01
const SOCKS5_USERPASS_SUCCESS = 0x00

const SOCKS4_VERSION = 0x04
const SOCKS4_CMD_CONNECT = 0x01
const SOCKS4_REP_GRANTED = 0x5a

const CHECK_ERROR = {
  TIMEOUT: 'timeout',
  CONNECT_REFUSED: 'connect_refused',
  CONNECTION_RESET: 'connection_reset',
  DNS_ERROR: 'dns_error',
  AUTH_FAILED: 'auth_failed',
  SOCKS_HANDSHAKE_FAILED: 'socks_handshake_failed',
  SOCKS_AUTH_UNSUPPORTED: 'socks_auth_unsupported',
  UNEXPECTED_STATUS: 'unexpected_status',
  PROTOCOL_ERROR: 'protocol_error',
  CERT_INVALID: 'cert_invalid',
  UNKNOWN: 'unknown_error'
} as const
type CheckErrorCode = typeof CHECK_ERROR[keyof typeof CHECK_ERROR]

interface HealthResult {
  ok: boolean
  latencyMs?: number
  error?: CheckErrorCode
}

export function listProxies(db: Database.Database): ProxyResponse[] {
  const rows = db.prepare('SELECT * FROM proxies ORDER BY created_at DESC').all() as Proxy[]
  return rows.map(toProxyResponse)
}

function normalizeOptional(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function normalizeOptionalStringField(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function normalizeCredentialField(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function normalizeProxyPort(value: unknown): number {
  const port =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN

  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`Port must be an integer between ${MIN_PORT} and ${MAX_PORT}`)
  }
  return port
}

function normalizeProxyInput(input: ProxyInput): ProxyInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Proxy input must be an object')
  }

  const source = input as unknown as Record<string, unknown>
  if (!PROXY_PROTOCOLS.has(source.protocol as ProxyProtocol)) {
    throw new Error('Protocol must be one of: http, https, socks4, socks5')
  }
  if (typeof source.host !== 'string') throw new Error('Host is required')

  let host = source.host.trim()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (!host) throw new Error('Host is required')
  if (/[\s/]/.test(host)) throw new Error('Host contains invalid characters')

  const port = normalizeProxyPort(source.port)
  const name =
    typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : `${host}:${port}`

  return {
    name,
    protocol: source.protocol as ProxyProtocol,
    host,
    port,
    username: normalizeCredentialField(source.username, 'username'),
    password: normalizeCredentialField(source.password, 'password'),
    country: normalizeOptionalStringField(source.country, 'country'),
    group_tag: normalizeOptionalStringField(source.group_tag, 'group_tag')
  }
}

/**
 * Credential tri-state resolver for createProxy.
 *   undefined | '' → null (no value)
 *   null           → null (explicit clear)
 *   non-empty      → trimmed string
 */
function resolveCredentialForCreate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Credential tri-state resolver for updateProxy.
 *   undefined | '' → 'keep'   (do not modify column)
 *   null           → null     (clear to NULL)
 *   non-empty      → trimmed  (set)
 */
function resolveCredentialForUpdate(value: string | null | undefined): string | null | 'keep' {
  if (value === undefined) return 'keep'
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? 'keep' : trimmed
}

export function createProxy(db: Database.Database, input: ProxyInput): ProxyResponse {
  const normalized = normalizeProxyInput(input)

  const id = uuidv4()
  db.prepare(
    `INSERT INTO proxies (id, name, protocol, host, port, username, password, country, group_tag, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    id,
    normalized.name,
    normalized.protocol,
    normalized.host,
    normalized.port,
    resolveCredentialForCreate(normalized.username),
    resolveCredentialForCreate(normalized.password),
    normalizeOptional(normalized.country),
    normalizeOptional(normalized.group_tag)
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

  const normalized = normalizeProxyInput(input)

  // Credential tri-state:
  //   undefined / '' → keep existing column value (no SET clause emitted)
  //   null           → clear column to NULL
  //   non-empty      → set to trimmed value
  const sets: string[] = ['name = ?', 'protocol = ?', 'host = ?', 'port = ?', 'country = ?', 'group_tag = ?']
  const params: (string | number | null)[] = [
    normalized.name,
    normalized.protocol,
    normalized.host,
    normalized.port,
    normalizeOptional(normalized.country),
    normalizeOptional(normalized.group_tag)
  ]

  const nextUsername = resolveCredentialForUpdate(normalized.username)
  if (nextUsername !== 'keep') {
    sets.push('username = ?')
    params.push(nextUsername)
  }
  const nextPassword = resolveCredentialForUpdate(normalized.password)
  if (nextPassword !== 'keep') {
    sets.push('password = ?')
    params.push(nextPassword)
  }
  params.push(proxyId)

  db.prepare(`UPDATE proxies SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  return toProxyResponse(
    db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as Proxy
  )
}

export function deleteProxy(db: Database.Database, proxyId: string): void {
  const existing = db.prepare('SELECT id FROM proxies WHERE id = ?').get(proxyId)
  if (!existing) throw new Error(`Proxy not found: ${proxyId}`)
  db.prepare('DELETE FROM proxies WHERE id = ?').run(proxyId)
}

// ---------------------------------------------------------------------------
// Proxy line parser
// ---------------------------------------------------------------------------

type ParseResult =
  | { ok: true; data: ProxyInput }
  | { ok: false; error: string }

const PROTO_ALIASES: Record<string, ProxyProtocol> = {
  http: 'http',
  https: 'https',
  socks4: 'socks4',
  socks4a: 'socks4',
  socks5: 'socks5',
  socks5h: 'socks5'
}

function toPort(value: string): number {
  if (!/^\d+$/.test(value)) return NaN
  const n = parseInt(value, 10)
  if (n < MIN_PORT || n > MAX_PORT) return NaN
  return n
}

function validatedProxy(
  protocol: ProxyProtocol,
  host: string,
  port: number,
  username: string | undefined,
  password: string | undefined
): ParseResult {
  const trimmedHost = host.trim()
  if (!trimmedHost) return { ok: false, error: 'Missing host' }
  if (!Number.isFinite(port) || port < MIN_PORT || port > MAX_PORT) {
    return { ok: false, error: 'Invalid port' }
  }
  const u = username === undefined || username === '' ? undefined : username
  const p = password === undefined || password === '' ? undefined : password
  return {
    ok: true,
    data: {
      name: `${trimmedHost}:${port}`,
      protocol,
      host: trimmedHost,
      port,
      username: u,
      password: p
    }
  }
}

function splitHostPortBracketed(input: string): { host: string; portStr: string } | null {
  // [ipv6]:port
  if (!input.startsWith('[')) return null
  const end = input.indexOf(']')
  if (end < 0) return null
  const host = input.slice(1, end)
  const after = input.slice(end + 1)
  if (!after.startsWith(':')) return null
  return { host, portStr: after.slice(1) }
}

function parseUrlForm(protocol: ProxyProtocol, rest: string): ParseResult {
  // rest = everything after `proto://`
  // Use WHATWG URL — it handles IPv6 brackets, percent-encoding, optional auth.
  let url: URL
  try {
    // URL requires http(s)-like scheme for auth parsing; wrap in http:// regardless of real scheme.
    url = new URL(`http://${rest}`)
  } catch {
    return { ok: false, error: 'Invalid URL form' }
  }
  if (!url.hostname) return { ok: false, error: 'Missing host' }
  if (!url.port) return { ok: false, error: 'Missing port' }
  const port = toPort(url.port)
  if (!Number.isFinite(port)) return { ok: false, error: 'Invalid port' }

  // URL strips IPv6 brackets when accessing .hostname only for display.
  let host = url.hostname
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)

  let username: string | undefined
  let password: string | undefined
  try {
    username = url.username ? decodeURIComponent(url.username) : undefined
    password = url.password ? decodeURIComponent(url.password) : undefined
  } catch {
    return { ok: false, error: 'Invalid credential encoding' }
  }
  return validatedProxy(protocol, host, port, username, password)
}

function parseLegacyForm(raw: string): ParseResult {
  // Default protocol when none specified.
  const protocol: ProxyProtocol = 'http'

  // user:pass@host:port  or  user:pass@[ipv6]:port
  const atIdx = raw.lastIndexOf('@')
  if (atIdx !== -1) {
    const auth = raw.slice(0, atIdx)
    const hostPort = raw.slice(atIdx + 1)
    const colon = auth.indexOf(':')
    const username = colon === -1 ? auth : auth.slice(0, colon)
    const password = colon === -1 ? undefined : auth.slice(colon + 1)
    const bracketed = splitHostPortBracketed(hostPort)
    if (bracketed) {
      return validatedProxy(protocol, bracketed.host, toPort(bracketed.portStr), username, password)
    }
    const lastColon = hostPort.lastIndexOf(':')
    if (lastColon === -1) return { ok: false, error: 'Missing port' }
    return validatedProxy(
      protocol,
      hostPort.slice(0, lastColon),
      toPort(hostPort.slice(lastColon + 1)),
      username,
      password
    )
  }

  // [ipv6]:port  or  [ipv6]:port:user:pass
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']')
    if (end < 0) return { ok: false, error: 'Unterminated IPv6 bracket' }
    const host = raw.slice(1, end)
    const after = raw.slice(end + 1)
    if (!after.startsWith(':')) return { ok: false, error: 'Expected :port after ]' }
    const afterColon = after.slice(1)
    const parts = afterColon.split(':')
    if (parts.length === 1) return validatedProxy(protocol, host, toPort(parts[0]), undefined, undefined)
    if (parts.length === 3) return validatedProxy(protocol, host, toPort(parts[0]), parts[1], parts[2])
    return { ok: false, error: 'Invalid IPv6 legacy form' }
  }

  // host:port  or  host:port:user:pass
  const parts = raw.split(':')
  if (parts.length === 2) return validatedProxy(protocol, parts[0], toPort(parts[1]), undefined, undefined)
  if (parts.length === 4) return validatedProxy(protocol, parts[0], toPort(parts[1]), parts[2], parts[3])
  return { ok: false, error: 'Invalid format' }
}

/**
 * Parse a single proxy line in one of the supported formats:
 *   protocol://user:pass@host:port
 *   protocol://host:port
 *   user:pass@host:port       (defaults to http)
 *   host:port                 (defaults to http)
 *   host:port:user:pass       (defaults to http)
 *   IPv6 hosts use [::1] bracket notation in all forms.
 * Protocol aliases: socks4a → socks4, socks5h → socks5.
 */
export function parseProxyLine(raw: string): ParseResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'Empty line' }

  const protoMatch = trimmed.match(/^(socks4a|socks4|socks5h|socks5|https|http):\/\/(.+)$/i)
  if (protoMatch) {
    const alias = protoMatch[1].toLowerCase()
    const proto = PROTO_ALIASES[alias]
    if (!proto) return { ok: false, error: `Unsupported protocol: ${alias}` }
    return parseUrlForm(proto, protoMatch[2])
  }

  return parseLegacyForm(trimmed)
}

// ---------------------------------------------------------------------------
// Proxy health check
// ---------------------------------------------------------------------------

function toCheckError(err: unknown): CheckErrorCode {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code
    switch (code) {
      case 'ECONNREFUSED':
        return CHECK_ERROR.CONNECT_REFUSED
      case 'ECONNRESET':
        return CHECK_ERROR.CONNECTION_RESET
      case 'ENOTFOUND':
      case 'EAI_AGAIN':
        return CHECK_ERROR.DNS_ERROR
      case 'ETIMEDOUT':
        return CHECK_ERROR.TIMEOUT
      case 'CERT_HAS_EXPIRED':
      case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      case 'SELF_SIGNED_CERT_IN_CHAIN':
      case 'ERR_TLS_CERT_ALTNAME_INVALID':
        return CHECK_ERROR.CERT_INVALID
      default:
        if (typeof code === 'string' && code.startsWith('ERR_TLS')) return CHECK_ERROR.CERT_INVALID
    }
  }
  return CHECK_ERROR.UNKNOWN
}

function openProxySocket(proxy: Proxy): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    const onError = (sock: Socket) => (err: Error): void => {
      finish(() => {
        sock.destroy()
        reject(err)
      })
    }
    const onTimeout = (sock: Socket) => (): void => {
      finish(() => {
        sock.destroy()
        const e = new Error('connect_timeout') as NodeJS.ErrnoException
        e.code = 'ETIMEDOUT'
        reject(e)
      })
    }

    if (proxy.protocol === 'https') {
      const sock = tlsConnect({
        host: proxy.host,
        port: proxy.port,
        servername: proxy.host,
        ALPNProtocols: ['http/1.1'],
        rejectUnauthorized: true,
        timeout: PROXY_TEST_TIMEOUT_MS
      })
      sock.once('secureConnect', () => {
        finish(() => {
          sock.setTimeout(0)
          resolve(sock)
        })
      })
      sock.once('error', onError(sock))
      sock.once('timeout', onTimeout(sock))
    } else {
      const sock = createConnection({
        host: proxy.host,
        port: proxy.port,
        timeout: PROXY_TEST_TIMEOUT_MS
      })
      sock.once('connect', () => {
        finish(() => {
          sock.setTimeout(0)
          resolve(sock)
        })
      })
      sock.once('error', onError(sock))
      sock.once('timeout', onTimeout(sock))
    }
  })
}

export class SocketReader {
  private buffer: Buffer = Buffer.alloc(0)
  private waiters: Array<{ check: (buf: Buffer) => number; resolve: (b: Buffer) => void; reject: (e: Error) => void }> = []
  private closed: Error | null = null

  constructor(sock: Socket) {
    sock.on('data', (chunk: Buffer) => {
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
      this.flush()
    })
    const fail = (err: Error): void => {
      this.closed = err
      const pending = this.waiters.splice(0)
      for (const w of pending) w.reject(err)
    }
    sock.once('error', fail)
    sock.once('end', () => fail(new Error('connection_closed')))
    sock.once('close', () => fail(new Error('connection_closed')))
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      const head = this.waiters[0]
      const size = head.check(this.buffer)
      if (size <= 0) return
      const out = this.buffer.subarray(0, size)
      this.buffer = this.buffer.subarray(size)
      this.waiters.shift()
      head.resolve(out)
    }
  }

  read(n: number): Promise<Buffer> {
    return this.request((buf) => (buf.length >= n ? n : 0))
  }

  readUntil(predicate: (buf: Buffer) => number): Promise<Buffer> {
    return this.request(predicate)
  }

  /** Return any bytes still buffered (not yet consumed by a read). */
  getBuffered(): Buffer {
    return this.buffer
  }

  private request(check: (buf: Buffer) => number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(this.closed)
        return
      }
      this.waiters.push({ check, resolve, reject })
      this.flush()
    })
  }
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
}

function buildHttpProxyRequest(proxy: Proxy): string {
  const lines = [
    `GET http://${PROXY_TEST_TARGET_HOST}${PROXY_TEST_TARGET_PATH} HTTP/1.1`,
    `Host: ${PROXY_TEST_TARGET_HOST}`,
    `User-Agent: ${INTERNAL_CHECK_USER_AGENT}`,
    'Accept: */*',
    'Proxy-Connection: close',
    'Connection: close'
  ]
  if (proxy.username && proxy.password) {
    lines.push(`Proxy-Authorization: ${basicAuthHeader(proxy.username, proxy.password)}`)
  }
  return lines.join('\r\n') + '\r\n\r\n'
}

function buildTunnelledHttpRequest(): string {
  return [
    `GET ${PROXY_TEST_TARGET_PATH} HTTP/1.1`,
    `Host: ${PROXY_TEST_TARGET_HOST}`,
    `User-Agent: ${INTERNAL_CHECK_USER_AGENT}`,
    'Accept: */*',
    'Connection: close'
  ].join('\r\n') + '\r\n\r\n'
}

function parseHttpStatusCode(response: Buffer): number | null {
  // Status line: HTTP/x.y CODE TEXT\r\n
  const end = response.indexOf(0x0a) // LF
  if (end < 0) return null
  const line = response.subarray(0, end).toString('ascii')
  const parts = line.split(' ')
  if (parts.length < 2) return null
  const code = parseInt(parts[1], 10)
  return Number.isFinite(code) ? code : null
}

function findHeaderEndSize(buf: Buffer): number {
  // Returns total bytes up to and including \r\n\r\n, or 0 if not yet complete.
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a && buf[i + 2] === 0x0d && buf[i + 3] === 0x0a) {
      return i + 4
    }
  }
  return 0
}

async function checkHttpProxy(proxy: Proxy, sock: Socket): Promise<HealthResult> {
  const started = Date.now()
  try {
    sock.write(buildHttpProxyRequest(proxy))
    const reader = new SocketReader(sock)
    const header = await reader.readUntil(findHeaderEndSize)
    const status = parseHttpStatusCode(header)
    if (status === null) return { ok: false, error: CHECK_ERROR.PROTOCOL_ERROR }
    if (status === HTTP_PROXY_AUTH_REQUIRED) return { ok: false, error: CHECK_ERROR.AUTH_FAILED }
    if (status !== PROXY_TEST_EXPECTED_STATUS) return { ok: false, error: CHECK_ERROR.UNEXPECTED_STATUS }
    return { ok: true, latencyMs: Date.now() - started }
  } catch (err) {
    return { ok: false, error: toCheckError(err) }
  }
}

export async function performSocks5Handshake(
  sock: Socket,
  reader: SocketReader,
  proxy: Proxy,
  targetHost: string,
  targetPort: number
): Promise<void> {
  const hasAuth = !!(proxy.username && proxy.password)
  const methods = hasAuth
    ? Buffer.from([SOCKS5_VERSION, 0x02, SOCKS5_AUTH_NONE, SOCKS5_AUTH_USERPASS])
    : Buffer.from([SOCKS5_VERSION, 0x01, SOCKS5_AUTH_NONE])
  sock.write(methods)

  const methodResp = await reader.read(2)
  if (methodResp[0] !== SOCKS5_VERSION) throw new Error('socks5_bad_version')
  const chosen = methodResp[1]
  if (chosen === SOCKS5_AUTH_NO_ACCEPTABLE) throw new Error('socks5_no_acceptable_methods')

  if (chosen === SOCKS5_AUTH_USERPASS) {
    if (!hasAuth) throw new Error('socks5_auth_required')
    const user = Buffer.from(proxy.username as string, 'utf8')
    const pass = Buffer.from(proxy.password as string, 'utf8')
    if (user.length > 255 || pass.length > 255) throw new Error('socks5_credentials_too_long')
    const authMsg = Buffer.concat([
      Buffer.from([SOCKS5_USERPASS_VERSION, user.length]),
      user,
      Buffer.from([pass.length]),
      pass
    ])
    sock.write(authMsg)
    const authResp = await reader.read(2)
    if (authResp[0] !== SOCKS5_USERPASS_VERSION || authResp[1] !== SOCKS5_USERPASS_SUCCESS) {
      throw new Error('socks5_auth_failed')
    }
  } else if (chosen !== SOCKS5_AUTH_NONE) {
    throw new Error('socks5_unsupported_method')
  }

  // CONNECT request to target.
  const ipFamily = isIP(targetHost)
  let addrPart: Buffer
  if (ipFamily === 4) {
    const octets = targetHost.split('.').map((v) => parseInt(v, 10))
    addrPart = Buffer.from([SOCKS5_ATYP_IPV4, ...octets])
  } else if (ipFamily === 6) {
    const bytes = ipv6ToBytes(targetHost)
    addrPart = Buffer.concat([Buffer.from([SOCKS5_ATYP_IPV6]), bytes])
  } else {
    const nameBuf = Buffer.from(targetHost, 'ascii')
    addrPart = Buffer.concat([Buffer.from([SOCKS5_ATYP_DOMAIN, nameBuf.length]), nameBuf])
  }
  const portBuf = Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
  const req = Buffer.concat([
    Buffer.from([SOCKS5_VERSION, SOCKS5_CMD_CONNECT, SOCKS5_RSV]),
    addrPart,
    portBuf
  ])
  sock.write(req)

  const head = await reader.read(4)
  if (head[0] !== SOCKS5_VERSION) throw new Error('socks5_bad_version')
  if (head[1] !== SOCKS5_REP_SUCCESS) {
    // RFC 1928 §6 reply codes:
    //   0x01 general failure | 0x02 not allowed by ruleset | 0x03 network unreachable
    //   0x04 host unreachable | 0x05 connection refused    | 0x06 TTL expired
    //   0x07 command not supported | 0x08 address type not supported
    throw new Error(`socks5_connect_failed:0x${head[1].toString(16).padStart(2, '0')}`)
  }
  const atyp = head[3]
  let addrLen: number
  if (atyp === SOCKS5_ATYP_IPV4) addrLen = 4
  else if (atyp === SOCKS5_ATYP_IPV6) addrLen = 16
  else if (atyp === SOCKS5_ATYP_DOMAIN) {
    const lenByte = await reader.read(1)
    addrLen = lenByte[0]
  } else throw new Error('socks5_bad_atyp')
  await reader.read(addrLen + 2) // addr + port, discard
}

function ipv6ToBytes(addr: string): Buffer {
  // Minimal expansion for full or :: compressed forms.
  const parts = addr.split('::')
  const head = parts[0] ? parts[0].split(':') : []
  const tail = parts.length > 1 && parts[1] ? parts[1].split(':') : []
  const missing = 8 - head.length - tail.length
  const groups = [...head, ...Array(missing).fill('0'), ...tail]
  const buf = Buffer.alloc(16)
  for (let i = 0; i < 8; i++) {
    const v = parseInt(groups[i], 16)
    buf[i * 2] = (v >> 8) & 0xff
    buf[i * 2 + 1] = v & 0xff
  }
  return buf
}

export async function performSocks4Handshake(
  sock: Socket,
  reader: SocketReader,
  proxy: Proxy,
  targetHost: string,
  targetPort: number
): Promise<void> {
  const portHi = (targetPort >> 8) & 0xff
  const portLo = targetPort & 0xff
  const userid = Buffer.from(proxy.username ?? '', 'ascii')

  let msg: Buffer
  if (isIP(targetHost) === 4) {
    const octets = targetHost.split('.').map((v) => parseInt(v, 10))
    msg = Buffer.concat([
      Buffer.from([SOCKS4_VERSION, SOCKS4_CMD_CONNECT, portHi, portLo, ...octets]),
      userid,
      Buffer.from([0x00])
    ])
  } else {
    // SOCKS4a: use 0.0.0.x sentinel (x != 0) and append hostname + NUL.
    msg = Buffer.concat([
      Buffer.from([SOCKS4_VERSION, SOCKS4_CMD_CONNECT, portHi, portLo, 0, 0, 0, 1]),
      userid,
      Buffer.from([0x00]),
      Buffer.from(targetHost, 'ascii'),
      Buffer.from([0x00])
    ])
  }
  sock.write(msg)

  const reply = await reader.read(8)
  if (reply[0] !== 0x00) throw new Error('socks4_bad_reply')
  if (reply[1] !== SOCKS4_REP_GRANTED) throw new Error('socks4_connect_failed')
}

async function checkSocksProxy(proxy: Proxy, sock: Socket): Promise<HealthResult> {
  const started = Date.now()
  try {
    const reader = new SocketReader(sock)
    if (proxy.protocol === 'socks5') await performSocks5Handshake(sock, reader, proxy, PROXY_TEST_TARGET_HOST, PROXY_TEST_TARGET_PORT)
    else await performSocks4Handshake(sock, reader, proxy, PROXY_TEST_TARGET_HOST, PROXY_TEST_TARGET_PORT)
    sock.write(buildTunnelledHttpRequest())
    const header = await reader.readUntil(findHeaderEndSize)
    const status = parseHttpStatusCode(header)
    if (status === null) return { ok: false, error: CHECK_ERROR.PROTOCOL_ERROR }
    if (status !== PROXY_TEST_EXPECTED_STATUS) return { ok: false, error: CHECK_ERROR.UNEXPECTED_STATUS }
    return { ok: true, latencyMs: Date.now() - started }
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'socks5_auth_failed' || err.message === 'socks5_auth_required') {
        return { ok: false, error: CHECK_ERROR.AUTH_FAILED }
      }
      if (err.message === 'socks5_no_acceptable_methods' || err.message === 'socks5_unsupported_method') {
        return { ok: false, error: CHECK_ERROR.SOCKS_AUTH_UNSUPPORTED }
      }
      if (err.message.startsWith('socks')) {
        return { ok: false, error: CHECK_ERROR.SOCKS_HANDSHAKE_FAILED }
      }
    }
    return { ok: false, error: toCheckError(err) }
  }
}

async function checkProxyHealth(proxy: Proxy): Promise<HealthResult> {
  let sock: Socket
  try {
    sock = await openProxySocket(proxy)
  } catch (err) {
    return { ok: false, error: toCheckError(err) }
  }

  let timer: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<HealthResult>((resolve) => {
    timer = setTimeout(() => {
      sock.destroy()
      resolve({ ok: false, error: CHECK_ERROR.TIMEOUT })
    }, PROXY_TEST_TIMEOUT_MS)
  })

  const work = proxy.protocol === 'socks4' || proxy.protocol === 'socks5'
    ? checkSocksProxy(proxy, sock)
    : checkHttpProxy(proxy, sock)

  try {
    return await Promise.race([work, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
    sock.destroy()
  }
}

export async function testProxy(db: Database.Database, proxyId: string): Promise<boolean> {
  const proxy = db.prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId) as Proxy | undefined
  if (!proxy) throw new Error(`Proxy not found: ${proxyId}`)

  let result: HealthResult
  try {
    result = await checkProxyHealth(proxy)
  } catch (err) {
    console.error('[proxy] health check unexpected failure', err)
    result = { ok: false, error: CHECK_ERROR.UNKNOWN }
  }

  const now = new Date().toISOString()
  if (result.ok) {
    db.prepare(
      'UPDATE proxies SET last_check = ?, check_ok = 1, check_latency_ms = ?, check_error = NULL WHERE id = ?'
    ).run(now, result.latencyMs ?? null, proxyId)
    return true
  }
  db.prepare(
    'UPDATE proxies SET last_check = ?, check_ok = 0, check_latency_ms = NULL, check_error = ? WHERE id = ?'
  ).run(now, result.error ?? CHECK_ERROR.UNKNOWN, proxyId)
  return false
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

// ---------------------------------------------------------------------------
// Generic HTTP GET tunneled through the configured proxy
// ---------------------------------------------------------------------------

const PROXY_HTTP_GET_MAX_BYTES = 256 * 1024

function buildAbsoluteUriGetRequest(
  proxy: Proxy,
  targetHost: string,
  targetPort: number,
  path: string
): string {
  const hostHeader = targetPort === 80 ? targetHost : `${targetHost}:${targetPort}`
  const lines = [
    `GET http://${hostHeader}${path} HTTP/1.0`,
    `Host: ${hostHeader}`,
    `User-Agent: ${INTERNAL_CHECK_USER_AGENT}`,
    'Accept: */*',
    'Connection: close'
  ]
  if (proxy.username && proxy.password) {
    lines.push(`Proxy-Authorization: ${basicAuthHeader(proxy.username, proxy.password)}`)
  }
  return lines.join('\r\n') + '\r\n\r\n'
}

function buildRelativeGetRequest(targetHost: string, targetPort: number, path: string): string {
  const hostHeader = targetPort === 80 ? targetHost : `${targetHost}:${targetPort}`
  return [
    `GET ${path} HTTP/1.0`,
    `Host: ${hostHeader}`,
    `User-Agent: ${INTERNAL_CHECK_USER_AGENT}`,
    'Accept: */*',
    'Connection: close'
  ].join('\r\n') + '\r\n\r\n'
}

function readUntilCloseOrLimit(sock: Socket, maxBytes: number, initialBuffer?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    if (initialBuffer && initialBuffer.length > 0) {
      const slice = initialBuffer.length > maxBytes ? initialBuffer.subarray(0, maxBytes) : initialBuffer
      chunks.push(slice)
      total += slice.length
      if (total >= maxBytes) {
        finish(() => {
          sock.destroy()
          resolve(Buffer.concat(chunks).subarray(0, maxBytes))
        })
        return
      }
    }
    sock.on('data', (chunk: Buffer) => {
      if (settled) return
      chunks.push(chunk)
      total += chunk.length
      if (total >= maxBytes) {
        finish(() => {
          sock.destroy()
          resolve(Buffer.concat(chunks).subarray(0, maxBytes))
        })
      }
    })
    sock.once('end', () => finish(() => resolve(Buffer.concat(chunks))))
    sock.once('close', () => finish(() => resolve(Buffer.concat(chunks))))
    sock.once('error', (err) => finish(() => reject(err)))
  })
}

function parseHttpResponse(buf: Buffer): { status: number; body: string } | null {
  const parsed = parseHttpResponseWithHeaders(buf)
  return parsed ? { status: parsed.status, body: parsed.body.toString('utf8') } : null
}

function parseHttpResponseWithHeaders(buf: Buffer): {
  status: number
  headers: Record<string, string>
  body: Buffer
} | null {
  const headerEnd = findHeaderEndSize(buf)
  if (headerEnd <= 0) return null
  const status = parseHttpStatusCode(buf)
  if (status === null) return null

  const headerText = buf.subarray(0, headerEnd).toString('latin1')
  const headers: Record<string, string> = {}
  for (const line of headerText.split(/\r?\n/).slice(1)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
  }

  let body = buf.subarray(headerEnd)
  if (headers['transfer-encoding']?.toLowerCase().includes('chunked')) {
    body = decodeChunkedBody(body) ?? body
  }
  return { status, headers, body }
}

function decodeChunkedBody(body: Buffer): Buffer | null {
  const chunks: Buffer[] = []
  let offset = 0
  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset, 'latin1')
    if (lineEnd < 0) return null
    const sizeText = body.subarray(offset, lineEnd).toString('latin1').split(';')[0].trim()
    const size = parseInt(sizeText, 16)
    if (!Number.isFinite(size) || size < 0) return null
    offset = lineEnd + 2
    if (size === 0) return Buffer.concat(chunks)
    if (offset + size > body.length) return null
    chunks.push(body.subarray(offset, offset + size))
    offset += size
    if (body.subarray(offset, offset + 2).toString('latin1') !== '\r\n') return null
    offset += 2
  }
  return null
}

/**
 * Perform an HTTP/1.0 GET to (targetHost:targetPort)+path tunneled through the given proxy.
 * Returns null on any error (network, timeout, protocol). Never throws.
 *
 * Note: plain HTTP only (the ip-api geo provider is HTTP-only on the free tier).
 * The request is still safe because it traverses the user's proxy with no secrets.
 */
export async function httpGetThroughProxy(
  proxy: Proxy,
  targetHost: string,
  targetPort: number,
  path: string,
  timeoutMs: number
): Promise<{ status: number; body: string } | null> {
  let sock: Socket
  try {
    sock = await openProxySocket(proxy)
  } catch {
    return null
  }

  let timer: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      sock.destroy()
      resolve(null)
    }, timeoutMs)
  })

  const work = (async (): Promise<{ status: number; body: string } | null> => {
    try {
      let residual: Buffer | undefined
      if (proxy.protocol === 'socks4' || proxy.protocol === 'socks5') {
        const reader = new SocketReader(sock)
        if (proxy.protocol === 'socks5') {
          await performSocks5Handshake(sock, reader, proxy, targetHost, targetPort)
        } else {
          await performSocks4Handshake(sock, reader, proxy, targetHost, targetPort)
        }
        // Capture any bytes already buffered by SocketReader (can happen if
        // the SOCKS handshake reply and the start of the tunneled response
        // arrive in the same TCP segment). These would otherwise be lost
        // when we detach the reader's listeners below.
        residual = reader.getBuffered()
        // After handshake, SocketReader still has a 'data' listener attached.
        // Remove all listeners it registered so readUntilCloseOrLimit sees fresh events.
        sock.removeAllListeners('data')
        sock.removeAllListeners('end')
        sock.removeAllListeners('close')
        sock.removeAllListeners('error')
        sock.write(buildRelativeGetRequest(targetHost, targetPort, path))
      } else {
        sock.write(buildAbsoluteUriGetRequest(proxy, targetHost, targetPort, path))
      }
      const raw = await readUntilCloseOrLimit(sock, PROXY_HTTP_GET_MAX_BYTES, residual)
      return parseHttpResponse(raw)
    } catch {
      return null
    }
  })()

  try {
    return await Promise.race([work, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
    sock.destroy()
  }
}

// ---------------------------------------------------------------------------
// HTTPS GET tunneled through the proxy
// ---------------------------------------------------------------------------

function buildConnectRequest(proxy: Proxy, targetHost: string, targetPort: number): string {
  const hostHeader = `${targetHost}:${targetPort}`
  const lines = [
    `CONNECT ${hostHeader} HTTP/1.1`,
    `Host: ${hostHeader}`,
    `User-Agent: ${INTERNAL_CHECK_USER_AGENT}`,
    'Proxy-Connection: close'
  ]
  if (proxy.username && proxy.password) {
    lines.push(`Proxy-Authorization: ${basicAuthHeader(proxy.username, proxy.password)}`)
  }
  return lines.join('\r\n') + '\r\n\r\n'
}

/**
 * Perform an HTTPS GET to (targetHost:443)+path tunneled through the given
 * proxy. Required for fraud providers that don't expose a plain-HTTP endpoint
 * (e.g. ipapi.is) — without TLS, a hostile upstream proxy can MITM the
 * verdict. Returns null on any error. Never throws.
 *
 * Pipeline:
 *   1. Open TCP/TLS to proxy.host:proxy.port (openProxySocket)
 *   2. Establish a tunnel:
 *        SOCKS4/5 → handshake to targetHost:443
 *        HTTP/HTTPS → CONNECT targetHost:443 (with Proxy-Authorization)
 *   3. Wrap the tunnelled socket in TLS (servername = targetHost)
 *   4. Send HTTP/1.0 GET path + Host header
 *   5. Read response until close or PROXY_HTTP_GET_MAX_BYTES
 */
export async function httpsGetThroughProxy(
  proxy: Proxy,
  targetHost: string,
  path: string,
  timeoutMs: number
): Promise<{ status: number; body: string } | null> {
  const TARGET_PORT = 443
  let sock: Socket
  try {
    sock = await openProxySocket(proxy)
  } catch {
    return null
  }

  let timer: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      sock.destroy()
      resolve(null)
    }, timeoutMs)
  })

  // TLSSocket extends net.Socket, but we declare the slot wide as
  // `Socket | null` and reassign inside the IIFE. The outer finally needs
  // a runtime guard plus explicit narrowing for TypeScript.
  const tlsHolder: { sock: Socket | null } = { sock: null }

  const work = (async (): Promise<{ status: number; body: string } | null> => {
    try {
      // ── Tunnel setup ──
      if (proxy.protocol === 'socks4' || proxy.protocol === 'socks5') {
        const reader = new SocketReader(sock)
        if (proxy.protocol === 'socks5') {
          await performSocks5Handshake(sock, reader, proxy, targetHost, TARGET_PORT)
        } else {
          await performSocks4Handshake(sock, reader, proxy, targetHost, TARGET_PORT)
        }
        sock.removeAllListeners('data')
        sock.removeAllListeners('end')
        sock.removeAllListeners('close')
        sock.removeAllListeners('error')
      } else {
        // HTTP / HTTPS proxy: CONNECT method
        sock.write(buildConnectRequest(proxy, targetHost, TARGET_PORT))
        const reader = new SocketReader(sock)
        const header = await reader.readUntil(findHeaderEndSize)
        const status = parseHttpStatusCode(header)
        if (status !== 200) return null
        sock.removeAllListeners('data')
        sock.removeAllListeners('end')
        sock.removeAllListeners('close')
        sock.removeAllListeners('error')
      }

      // ── TLS wrap on the tunnelled socket ──
      const tls = tlsConnect({
        socket: sock,
        servername: targetHost,
        ALPNProtocols: ['http/1.1'],
        rejectUnauthorized: true
      })
      tlsHolder.sock = tls
      await new Promise<void>((resolve, reject) => {
        tls.once('secureConnect', () => resolve())
        tls.once('error', reject)
      })

      // ── HTTP/1.0 GET over TLS ──
      const req = [
        `GET ${path} HTTP/1.0`,
        `Host: ${targetHost}`,
        `User-Agent: ${INTERNAL_CHECK_USER_AGENT}`,
        'Accept: */*',
        'Connection: close'
      ].join('\r\n') + '\r\n\r\n'
      tls.write(req)

      const raw = await readUntilCloseOrLimit(tls, PROXY_HTTP_GET_MAX_BYTES)
      return parseHttpResponse(raw)
    } catch {
      return null
    }
  })()

  try {
    return await Promise.race([work, timeoutPromise])
  } finally {
    if (timer) clearTimeout(timer)
    if (tlsHolder.sock) tlsHolder.sock.destroy()
    sock.destroy()
  }
}

// ---------------------------------------------------------------------------
// Direct HTTP / HTTPS GET (no proxy — used by the standalone IP-check tool)
// ---------------------------------------------------------------------------

/**
 * Direct HTTPS GET from the Lux host. Used only by the standalone "check
 * any IP" tool — this leaks Lux's real IP to the provider, which is a
 * privacy regression vs the tunneled lookups, but the user has explicitly
 * asked to investigate an arbitrary IP they're not yet routing through.
 *
 * Returns null on any error. Never throws.
 */
export async function httpsGetDirect(
  targetHost: string,
  path: string,
  timeoutMs: number
): Promise<{ status: number; body: string } | null> {
  let sock: Socket | null = null
  let timer: NodeJS.Timeout | null = null
  try {
    sock = tlsConnect({
      host: targetHost,
      port: 443,
      servername: targetHost,
      ALPNProtocols: ['http/1.1'],
      rejectUnauthorized: true
    })
    const connected = new Promise<void>((resolve, reject) => {
      sock!.once('secureConnect', () => resolve())
      sock!.once('error', reject)
    })
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
    })
    await Promise.race([connected, timeoutPromise])

    const req = [
      `GET ${path} HTTP/1.0`,
      `Host: ${targetHost}`,
      'User-Agent: lux-antidetect-fraud/1',
      'Accept: */*',
      'Connection: close'
    ].join('\r\n') + '\r\n\r\n'
    sock.write(req)

    const raw = await readUntilCloseOrLimit(sock, PROXY_HTTP_GET_MAX_BYTES)
    return parseHttpResponse(raw)
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
    if (sock) sock.destroy()
  }
}

/**
 * Direct HTTP GET (port 80, no TLS). Used for the ip-api.com side of the
 * standalone IP-check tool — that provider is HTTP-only on the free tier.
 */
export async function httpGetDirect(
  targetHost: string,
  targetPort: number,
  path: string,
  timeoutMs: number
): Promise<{ status: number; body: string } | null> {
  let sock: Socket | null = null
  try {
    sock = createConnection({
      host: targetHost,
      port: targetPort,
      timeout: timeoutMs
    })
    await new Promise<void>((resolve, reject) => {
      sock!.once('connect', () => {
        sock!.setTimeout(0)
        resolve()
      })
      sock!.once('error', reject)
      sock!.once('timeout', () => reject(new Error('timeout')))
    })

    const req = [
      `GET ${path} HTTP/1.0`,
      `Host: ${targetHost}`,
      'User-Agent: lux-antidetect-fraud/1',
      'Accept: */*',
      'Connection: close'
    ].join('\r\n') + '\r\n\r\n'
    sock.write(req)

    const raw = await readUntilCloseOrLimit(sock, PROXY_HTTP_GET_MAX_BYTES)
    return parseHttpResponse(raw)
  } catch {
    return null
  } finally {
    if (sock) sock.destroy()
  }
}
