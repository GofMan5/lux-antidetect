import type { ChildProcess } from 'child_process'
import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { SessionInfo, BrowserType } from './models'

let _db: Database.Database | null = null

export function initSessionsDb(db: Database.Database): void {
  _db = db
}

export interface TrackedSession extends SessionInfo {
  process: ChildProcess
  history_id: string
}

const sessions = new Map<string, TrackedSession>()

export function addSession(
  profileId: string,
  pid: number,
  browserType: BrowserType,
  proc: ChildProcess
): void {
  const startedAt = new Date().toISOString()
  const historyId = uuidv4()
  sessions.set(profileId, {
    profile_id: profileId,
    pid,
    browser_type: browserType,
    started_at: startedAt,
    process: proc,
    history_id: historyId
  })
  if (_db) {
    try {
      _db.prepare(
        `INSERT INTO session_history (id, profile_id, started_at) VALUES (?, ?, ?)`
      ).run(historyId, profileId, startedAt)
    } catch { /* best effort */ }
  }
}

export function removeSession(profileId: string, exitCode?: number | null): void {
  const session = sessions.get(profileId)
  if (session && _db) {
    try {
      const stoppedAt = new Date().toISOString()
      const startMs = new Date(session.started_at).getTime()
      const durationSeconds = Math.round((Date.now() - startMs) / 1000)
      _db.prepare(
        `UPDATE session_history SET stopped_at = ?, duration_seconds = ?, exit_code = ? WHERE id = ?`
      ).run(stoppedAt, durationSeconds, exitCode ?? null, session.history_id)
    } catch { /* best effort */ }
  }
  sessions.delete(profileId)
}

export function getSession(profileId: string): TrackedSession | null {
  return sessions.get(profileId) ?? null
}

export function getAllSessions(): SessionInfo[] {
  return Array.from(sessions.values()).map((session) => ({
    profile_id: session.profile_id,
    pid: session.pid,
    browser_type: session.browser_type,
    started_at: session.started_at
  }))
}

export function isRunning(profileId: string): boolean {
  return sessions.has(profileId)
}

export function killAllSessions(): void {
  for (const session of sessions.values()) {
    try {
      session.process.kill()
    } catch {
      /* already exited */
    }
  }
  sessions.clear()
}

export function getSessionHistory(profileId?: string, limit = 50): unknown[] {
  if (!_db) return []
  if (profileId) {
    return _db.prepare(
      'SELECT * FROM session_history WHERE profile_id = ? ORDER BY started_at DESC LIMIT ?'
    ).all(profileId, limit)
  }
  return _db.prepare(
    'SELECT * FROM session_history ORDER BY started_at DESC LIMIT ?'
  ).all(limit)
}

export function checkProcessHealth(): { dead: string[] } {
  const dead: string[] = []
  for (const [profileId, session] of sessions) {
    try {
      // process.kill(pid, 0) checks if process exists without killing it
      process.kill(session.pid, 0)
    } catch {
      dead.push(profileId)
    }
  }
  return { dead }
}
