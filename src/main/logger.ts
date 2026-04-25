// Lightweight file logger for the main process.
//
// Writes to `<logsDir>/main.log` with simple size-based rotation (one
// rolled-over file `main.log.1` retained). Always tees to console so
// `npm run dev` users still see output.
//
// Designed for fault tolerance: every fs operation is best-effort and
// silently degrades to console on failure — the logger MUST NOT throw
// or recurse from inside an `uncaughtException` handler.

import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const MAX_LOG_BYTES = 5 * 1024 * 1024 // 5 MB before rotation
// Restrict log file to current user — defense in depth in case future code
// paths log proxy URLs or other sensitive content. No-op on Windows where
// chmod is not enforced.
const LOG_FILE_MODE = 0o600
const LOG_DIR_MODE = 0o700

let logFilePath: string | null = null
let initialized = false
let crashHandlersInstalled = false

export function initLogger(logsDir: string): void {
  if (initialized) return
  initialized = true
  try {
    if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true, mode: LOG_DIR_MODE })
    const path = join(logsDir, 'main.log')
    // Pre-create so the first append cannot race a wide umask.
    if (!existsSync(path)) {
      const fd = openSync(path, 'a', LOG_FILE_MODE)
      closeSync(fd)
    } else {
      try { chmodSync(path, LOG_FILE_MODE) } catch { /* Windows: best effort */ }
    }
    logFilePath = path
  } catch {
    logFilePath = null
  }
}

export function getLogFilePath(): string | null {
  return logFilePath
}

function rotateIfNeeded(path: string): void {
  try {
    const st = statSync(path)
    if (st.size < MAX_LOG_BYTES) return
    const rolled = `${path}.1`
    if (existsSync(rolled)) unlinkSync(rolled)
    renameSync(path, rolled)
    try { chmodSync(rolled, LOG_FILE_MODE) } catch { /* Windows: best effort */ }
    const fd = openSync(path, 'a', LOG_FILE_MODE)
    closeSync(fd)
  } catch { /* missing file or permission — write will recreate */ }
}

// Strips userinfo from URL-shaped substrings (`scheme://user:pass@host`)
// so a stack trace or proxy URL accidentally written to the log doesn't
// expose credentials.
const URL_USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)[^/\s@:"']+:[^/\s@"']+@/gi
function redact(s: string): string {
  return s.replace(URL_USERINFO_RE, '$1***:***@')
}

function formatPart(part: unknown): string {
  if (part instanceof Error) {
    return redact(part.stack || `${part.name}: ${part.message}`)
  }
  if (typeof part === 'string') return redact(part)
  try { return redact(JSON.stringify(part)) } catch { return redact(String(part)) }
}

function write(level: Level, message: string, parts: unknown[]): void {
  const ts = new Date().toISOString()
  const tail = parts.length > 0 ? ' ' + parts.map(formatPart).join(' ') : ''
  const line = `[${ts}] [${level}] ${message}${tail}\n`

  // Console mirror — preserves dev-mode visibility.
  const consoleFn =
    level === 'error' ? console.error
    : level === 'warn' ? console.warn
    : console.log
  consoleFn(line.trimEnd())

  if (!logFilePath) return
  try {
    rotateIfNeeded(logFilePath)
    appendFileSync(logFilePath, line, { encoding: 'utf8' })
  } catch { /* never let logging break the caller */ }
}

export const logger = {
  debug: (message: string, ...parts: unknown[]): void => write('debug', message, parts),
  info: (message: string, ...parts: unknown[]): void => write('info', message, parts),
  warn: (message: string, ...parts: unknown[]): void => write('warn', message, parts),
  error: (message: string, ...parts: unknown[]): void => write('error', message, parts)
}

/**
 * Wire global handlers that capture otherwise-silent crashes.
 *
 * `uncaughtException` is treated as fatal: we log, give the synchronous
 * appendFileSync time to flush, then exit. Default Node behavior would
 * crash the process; without our handler the crash is silent (no log).
 * Without an explicit exit our handler would suppress that crash and
 * leave a corrupted process serving IPC, which is worse.
 *
 * `unhandledRejection` stays non-fatal — these are commonly recoverable
 * (lost network call, abandoned promise) and Electron does not crash on
 * them by default.
 */
export function installCrashHandlers(): void {
  if (crashHandlersInstalled) return
  crashHandlersInstalled = true
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', err)
    setTimeout(() => process.exit(1), 100).unref()
  })
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason)
  })
}
