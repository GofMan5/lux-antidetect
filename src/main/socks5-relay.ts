// Local SOCKS5 listener that re-handshakes outbound through an
// authenticated SOCKS4/SOCKS5 upstream.
//
// Why: Chromium silently discards user/pass in `--proxy-server=socks5://...`
// (Chromium issue 256785, since 2013). Both fallback auth paths are HTTP-
// layer hooks: CDP `Fetch.authRequired` only fires on HTTP 407, and
// `chrome.webRequest.onAuthRequired` is the same. SOCKS user/password
// (RFC 1929) is negotiated below the HTTP layer, so neither hook ever
// fires. The standard workaround (used by Multilogin / GoLogin / Dolphin /
// AdsPower) is to expose an unauthenticated SOCKS5 endpoint to Chrome on
// 127.0.0.1 and forward each connection through the real proxy with
// credentials supplied by the relay.
//
// DNS leakage: domain ATYP is preserved end-to-end (Chrome → relay →
// upstream), so DNS resolution happens at the upstream proxy. Local
// resolver is never consulted.
//
// Hardening: the listener is loopback-only, has a per-handshake byte cap
// and idle timeout, a global concurrency limit, and a wall-clock timeout
// around the upstream handshake — all to contain a hostile localhost peer
// or a hung upstream from exhausting the relay.

import { createConnection, createServer, Socket, type Server } from 'node:net'
import type { Proxy } from './models'
import {
  SocketReader,
  performSocks4Handshake,
  performSocks5Handshake
} from './proxy'
import { logger } from './logger'

// SOCKS5 protocol constants (RFC 1928). Mirrored from proxy.ts; kept local
// to keep proxy.ts's public API focused on DB / health-check operations.
const SOCKS5_VERSION = 0x05
const SOCKS5_AUTH_NONE = 0x00
const SOCKS5_AUTH_NO_ACCEPTABLE = 0xff
const SOCKS5_CMD_CONNECT = 0x01
const SOCKS5_ATYP_IPV4 = 0x01
const SOCKS5_ATYP_DOMAIN = 0x03
const SOCKS5_ATYP_IPV6 = 0x04
const SOCKS5_REP_SUCCESS = 0x00
const SOCKS5_REP_FAILURE = 0x01
const SOCKS5_REP_CMD_NOT_SUPPORTED = 0x07
const SOCKS5_REP_ATYP_NOT_SUPPORTED = 0x08

// Wall-clock budget for the upstream TCP connect.
const UPSTREAM_CONNECT_TIMEOUT_MS = 15_000
// Wall-clock budget for the entire upstream SOCKS handshake (auth + CONNECT
// reply). Distinct from the connect timeout above — covers a hung upstream
// that completed TCP but never replies.
const UPSTREAM_HANDSHAKE_TIMEOUT_MS = 15_000
// Idle timeout while parsing a client SOCKS5 handshake. Short by design:
// real clients (Chromium) finish the handshake in microseconds.
const CLIENT_HANDSHAKE_IDLE_MS = 10_000
// Per-client byte cap during handshake. Real handshakes are <300 bytes.
// Anything beyond this is a malformed or hostile peer.
const CLIENT_HANDSHAKE_BYTE_CAP = 8 * 1024
// Global cap on accepted connections. Chromium typically opens dozens of
// concurrent SOCKS connections per tab; 256 is well above realistic load
// while still bounding the FD/memory exposure to a misbehaving peer.
const MAX_CONCURRENT_CONNECTIONS = 256
// RFC 1035 — labels are alnum/hyphen, 63 char per label, 253 total. Allow
// dots, brackets (rare for SOCKS5 but harmless), colons (IPv6 literal),
// underscore (some service domains use it). Reject control bytes / NUL.
const DOMAIN_ATYP_REGEX = /^[A-Za-z0-9._:[\]-]{1,253}$/

// Pre-allocated reply buffers. Sharing across connections is safe because
// `Socket.write` does not mutate the source Buffer.
const METHOD_SELECT_OK = Buffer.from([SOCKS5_VERSION, SOCKS5_AUTH_NONE])
const METHOD_SELECT_REJECT = Buffer.from([SOCKS5_VERSION, SOCKS5_AUTH_NO_ACCEPTABLE])
const REPLY_SUCCESS = Buffer.from([
  SOCKS5_VERSION, SOCKS5_REP_SUCCESS, 0x00, SOCKS5_ATYP_IPV4,
  0, 0, 0, 0,
  0, 0
])
const REPLY_FAILURE = buildReply(SOCKS5_REP_FAILURE)
const REPLY_CMD_NOT_SUPPORTED = buildReply(SOCKS5_REP_CMD_NOT_SUPPORTED)
const REPLY_ATYP_NOT_SUPPORTED = buildReply(SOCKS5_REP_ATYP_NOT_SUPPORTED)

function buildReply(rep: number): Buffer {
  return Buffer.from([
    SOCKS5_VERSION, rep, 0x00, SOCKS5_ATYP_IPV4,
    0, 0, 0, 0,
    0, 0
  ])
}

export interface RelayHandle {
  port: number
  stop: () => Promise<void>
}

/**
 * Start a local SOCKS5 listener on 127.0.0.1:0 that forwards every CONNECT
 * to `upstream` (which may itself require SOCKS4/SOCKS5 user/password auth).
 *
 * Returns the bound port and a stop() function that destroys all in-flight
 * sockets and closes the server.
 */
export async function startSocks5Relay(upstream: Proxy): Promise<RelayHandle> {
  if (upstream.protocol !== 'socks4' && upstream.protocol !== 'socks5') {
    throw new Error(`socks5-relay: unsupported upstream protocol: ${upstream.protocol}`)
  }

  const live = new Set<Socket>()

  const server: Server = createServer((client) => {
    if (live.size >= MAX_CONCURRENT_CONNECTIONS) {
      safeDestroy(client)
      return
    }
    armClient(client, live)
    handleClient(client, upstream, live).catch(() => safeDestroy(client))
  })
  server.maxConnections = MAX_CONCURRENT_CONNECTIONS

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const addr = server.address()
  if (!addr || typeof addr === 'string') {
    server.close()
    throw new Error('socks5-relay: failed to bind 127.0.0.1')
  }

  logger.info(`socks5-relay started: ${upstream.protocol}://${upstream.host}:${upstream.port} → 127.0.0.1:${addr.port}`)

  return {
    port: addr.port,
    stop: async () => {
      // Snapshot before destroy: Set iteration is spec-safe under
      // concurrent modification, but a snapshot is clearer.
      const snapshot = [...live]
      live.clear()
      for (const s of snapshot) safeDestroy(s)
      await new Promise<void>((resolve) => server.close(() => resolve()))
      logger.info(`socks5-relay stopped on 127.0.0.1:${addr.port}`)
    }
  }
}

/**
 * Wire a freshly-accepted client into the `live` Set, install a handshake-
 * phase byte cap and idle timeout, and ensure the slot is freed on close.
 * The byte cap and timeout listeners are removed by `handleClient` once
 * the relay enters the data-pumping (pipe) phase.
 */
function armClient(client: Socket, live: Set<Socket>): void {
  live.add(client)
  let received = 0
  const onData = (chunk: Buffer): void => {
    received += chunk.length
    if (received > CLIENT_HANDSHAKE_BYTE_CAP) safeDestroy(client)
  }
  client.on('data', onData)
  client.setTimeout(CLIENT_HANDSHAKE_IDLE_MS)
  client.on('timeout', () => safeDestroy(client))
  client.on('close', () => live.delete(client))
  // Swallow errors here so an unhandled 'error' doesn't crash the process —
  // the 'close' handler above is the canonical lifecycle event.
  client.on('error', () => { /* lifecycle handled via 'close' */ })
}

async function handleClient(client: Socket, upstream: Proxy, live: Set<Socket>): Promise<void> {
  const clientReader = new SocketReader(client)

  // SOCKS5 method selection: VER(1) + NMETHODS(1) + METHODS(NMETHODS).
  const head = await clientReader.read(2)
  if (head[0] !== SOCKS5_VERSION) throw new Error('client: bad version')
  const nmethods = head[1]
  if (nmethods === 0) throw new Error('client: no methods')
  const methods = await clientReader.read(nmethods)
  if (!methods.includes(SOCKS5_AUTH_NONE)) {
    client.write(METHOD_SELECT_REJECT)
    throw new Error('client: no acceptable auth method')
  }
  client.write(METHOD_SELECT_OK)

  // CONNECT request: VER(1) + CMD(1) + RSV(1) + ATYP(1) + DST.ADDR + DST.PORT(2).
  const reqHead = await clientReader.read(4)
  if (reqHead[0] !== SOCKS5_VERSION) throw new Error('client: bad version on request')
  if (reqHead[1] !== SOCKS5_CMD_CONNECT) {
    client.write(REPLY_CMD_NOT_SUPPORTED)
    client.end()
    return
  }
  const atyp = reqHead[3]

  let targetHost: string
  if (atyp === SOCKS5_ATYP_IPV4) {
    const buf = await clientReader.read(4)
    targetHost = `${buf[0]}.${buf[1]}.${buf[2]}.${buf[3]}`
  } else if (atyp === SOCKS5_ATYP_DOMAIN) {
    const lenBuf = await clientReader.read(1)
    const len = lenBuf[0]
    // Guard: read(0) on SocketReader hangs forever (a 0-byte request always
    // resolves to "incomplete"); reject zero-length domains explicitly.
    if (len === 0) {
      client.write(REPLY_FAILURE)
      client.end()
      return
    }
    const nameBuf = await clientReader.read(len)
    targetHost = nameBuf.toString('ascii')
    if (!DOMAIN_ATYP_REGEX.test(targetHost)) {
      client.write(REPLY_FAILURE)
      client.end()
      return
    }
  } else if (atyp === SOCKS5_ATYP_IPV6) {
    const buf = await clientReader.read(16)
    targetHost = ipv6BytesToString(buf)
  } else {
    client.write(REPLY_ATYP_NOT_SUPPORTED)
    client.end()
    return
  }
  const portBuf = await clientReader.read(2)
  const targetPort = portBuf.readUInt16BE(0)

  // Open upstream TCP and run the upstream handshake with credentials.
  let upstreamSock: Socket
  try {
    upstreamSock = await openUpstreamTcp(upstream)
  } catch (err) {
    logger.warn('socks5-relay: upstream connect failed', {
      proxy: `${upstream.protocol}://${upstream.host}:${upstream.port}`,
      target: `${targetHost}:${targetPort}`,
      err: err instanceof Error ? err.message : String(err)
    })
    client.write(REPLY_FAILURE)
    client.end()
    return
  }
  live.add(upstreamSock)
  upstreamSock.on('close', () => live.delete(upstreamSock))
  upstreamSock.on('error', () => { /* lifecycle handled via 'close' */ })

  const upstreamReader = new SocketReader(upstreamSock)
  try {
    await runUpstreamHandshake(upstream, upstreamSock, upstreamReader, targetHost, targetPort)
  } catch (err) {
    logger.warn('socks5-relay: upstream handshake failed', {
      proxy: `${upstream.protocol}://${upstream.host}:${upstream.port}`,
      target: `${targetHost}:${targetPort}`,
      err: err instanceof Error ? err.message : String(err)
    })
    client.write(REPLY_FAILURE)
    client.end()
    safeDestroy(upstreamSock)
    return
  }

  // Tunnel established. BND.ADDR/BND.PORT are conventionally reported as
  // 0.0.0.0:0 by relays — Chrome ignores the values.
  client.write(REPLY_SUCCESS)

  // Bytes that may have arrived past the last `.read()` (e.g. upstream
  // CONNECT reply and first payload byte in the same TCP segment).
  const upstreamResidual = upstreamReader.getBuffered()
  const clientResidual = clientReader.getBuffered()

  // Detach SocketReader's listeners (data/end/close/error) and our own
  // handshake-phase listeners (data cap, timeout) before piping. Removing
  // 'close' here also strips our `live.delete` listeners — they are
  // re-armed below.
  upstreamSock.removeAllListeners('data')
  upstreamSock.removeAllListeners('end')
  upstreamSock.removeAllListeners('close')
  upstreamSock.removeAllListeners('error')
  client.removeAllListeners('data')
  client.removeAllListeners('end')
  client.removeAllListeners('close')
  client.removeAllListeners('error')
  client.removeAllListeners('timeout')
  client.setTimeout(0)

  // Re-arm lifecycle bookkeeping for the data-pumping phase.
  upstreamSock.on('close', () => live.delete(upstreamSock))
  upstreamSock.on('error', () => { /* surfaced by 'close' */ })
  client.on('close', () => live.delete(client))
  client.on('error', () => { /* surfaced by 'close' */ })

  // Disable Nagle on both sides — TLS startup records and short HTTP
  // requests are common over SOCKS, and Nagle adds up to 40ms TTFB delay
  // per connection.
  client.setNoDelay(true)
  upstreamSock.setNoDelay(true)

  if (upstreamResidual.length > 0) client.write(upstreamResidual)
  if (clientResidual.length > 0) upstreamSock.write(clientResidual)

  // Bidirectional pipe with mutual destroy on close.
  client.pipe(upstreamSock)
  upstreamSock.pipe(client)
  client.once('close', () => safeDestroy(upstreamSock))
  upstreamSock.once('close', () => safeDestroy(client))
}

/**
 * Wrap the upstream SOCKS handshake with a wall-clock deadline. The
 * connect-only timeout in `openUpstreamTcp` does not cover the case where
 * an upstream completes TCP but never replies to method-selection / auth.
 */
async function runUpstreamHandshake(
  upstream: Proxy,
  sock: Socket,
  reader: SocketReader,
  targetHost: string,
  targetPort: number
): Promise<void> {
  const handshake =
    upstream.protocol === 'socks5'
      ? performSocks5Handshake(sock, reader, upstream, targetHost, targetPort)
      : performSocks4Handshake(sock, reader, upstream, targetHost, targetPort)

  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('upstream_handshake_timeout')), UPSTREAM_HANDSHAKE_TIMEOUT_MS)
  })
  try {
    await Promise.race([handshake, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function safeDestroy(sock: Socket): void {
  try { sock.destroy() } catch { /* already destroyed */ }
}

function openUpstreamTcp(upstream: Proxy): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let settled = false
    const sock = createConnection({
      host: upstream.host,
      port: upstream.port,
      timeout: UPSTREAM_CONNECT_TIMEOUT_MS
    })
    sock.once('connect', () => {
      if (settled) return
      settled = true
      sock.setTimeout(0)
      resolve(sock)
    })
    sock.once('timeout', () => {
      if (settled) return
      settled = true
      safeDestroy(sock)
      const e = new Error('upstream_connect_timeout') as NodeJS.ErrnoException
      e.code = 'ETIMEDOUT'
      reject(e)
    })
    sock.once('error', (err) => {
      if (settled) return
      settled = true
      safeDestroy(sock)
      reject(err)
    })
  })
}

/**
 * Convert raw 16 bytes into the colon-grouped IPv6 form Node's `isIP()`
 * accepts. `performSocks5Handshake` re-encodes the result via `isIP()` +
 * `ipv6ToBytes`, so the canonical `::` compression is not required — the
 * fully-expanded form is parsed correctly.
 */
function ipv6BytesToString(buf: Buffer): string {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) {
    groups.push(((buf[i] << 8) | buf[i + 1]).toString(16))
  }
  return groups.join(':')
}
