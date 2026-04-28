import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  captureScreenshotCDP,
  executeJavaScriptCDP,
  launchBrowser,
  listCdpPageTargets,
  openUrlInProfile,
  stopBrowser
} from './browser'
import type {
  AutomationRun,
  AutomationRunLog,
  AutomationRunResult,
  AutomationScript,
  AutomationScriptInput,
  AutomationStep,
  AutomationStepType
} from './models'

const MAX_STEPS = 100
const MAX_SCRIPT_BYTES = 256 * 1024
const DEFAULT_WAIT_SELECTOR_TIMEOUT_MS = 15_000
const DEFAULT_WAIT_SELECTOR_INTERVAL_MS = 300

const STEP_TYPES = new Set<AutomationStepType>([
  'launch',
  'open_url',
  'wait',
  'wait_selector',
  'click',
  'type',
  'evaluate',
  'screenshot',
  'stop'
])

interface RunContext {
  db: Database.Database
  profileId: string
  profilesDir: string
  mainWindow: Electron.BrowserWindow | null
  logs: AutomationRunLog[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function assertUuid(id: string, field = 'id'): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(id)) {
    throw new Error(`Invalid ${field}`)
  }
}

function validateHttpUrl(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${field} is required`)
  const url = new URL(raw.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${field} must be http or https URL`)
  }
  return url.toString()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalInt(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`)
  }
  return parsed
}

function sanitizeStep(raw: unknown, index: number): AutomationStep {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Step ${index + 1} must be an object`)
  }
  const item = raw as Record<string, unknown>
  const type = item.type
  if (typeof type !== 'string' || !STEP_TYPES.has(type as AutomationStepType)) {
    throw new Error(`Step ${index + 1} has invalid type`)
  }

  const step: AutomationStep = {
    id: optionalString(item.id) ?? uuidv4(),
    type: type as AutomationStepType,
    label: optionalString(item.label)
  }

  if ('url' in item) step.url = validateHttpUrl(item.url, `steps[${index}].url`)
  if ('selector' in item) step.selector = optionalString(item.selector)
  if ('text' in item) step.text = typeof item.text === 'string' ? item.text : undefined
  if ('script' in item) step.script = optionalString(item.script)
  step.duration_ms = optionalInt(item.duration_ms, `steps[${index}].duration_ms`, 0, 300_000)
  step.timeout_ms = optionalInt(item.timeout_ms, `steps[${index}].timeout_ms`, 1, 300_000)

  if ((step.type === 'open_url') && !step.url) throw new Error(`Step ${index + 1} requires url`)
  if ((step.type === 'click' || step.type === 'type' || step.type === 'wait_selector') && !step.selector) {
    throw new Error(`Step ${index + 1} requires selector`)
  }
  if (step.type === 'type' && step.text === undefined) throw new Error(`Step ${index + 1} requires text`)
  if (step.type === 'evaluate' && !step.script) throw new Error(`Step ${index + 1} requires script`)

  return step
}

function sanitizeSteps(rawSteps: unknown): AutomationStep[] {
  if (!Array.isArray(rawSteps)) throw new Error('steps must be an array')
  if (rawSteps.length > MAX_STEPS) throw new Error(`Too many steps (max ${MAX_STEPS})`)
  const bytes = Buffer.byteLength(JSON.stringify(rawSteps), 'utf8')
  if (bytes > MAX_SCRIPT_BYTES) throw new Error(`Automation script is too large (max ${MAX_SCRIPT_BYTES} bytes)`)
  return rawSteps.map((step, index) => sanitizeStep(step, index))
}

function parseSavedSteps(raw: string): AutomationStep[] {
  try {
    return sanitizeSteps(JSON.parse(raw))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Saved automation steps are invalid: ${message}`)
  }
}

function readScript(db: Database.Database, id: string): AutomationScript {
  assertUuid(id, 'script id')
  const row = db.prepare('SELECT * FROM automation_scripts WHERE id = ?').get(id) as AutomationScript | undefined
  if (!row) throw new Error('Automation script not found')
  return row
}

function normalizeInput(input: AutomationScriptInput): {
  name: string
  description: string
  profileId: string | null
  steps: AutomationStep[]
} {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) throw new Error('Automation name is required')
  const profileId = input.profile_id ?? null
  if (profileId !== null) assertUuid(profileId, 'profile id')
  return {
    name,
    description: typeof input.description === 'string' ? input.description.trim() : '',
    profileId,
    steps: sanitizeSteps(input.steps)
  }
}

export function listAutomationScripts(db: Database.Database): AutomationScript[] {
  return db.prepare('SELECT * FROM automation_scripts ORDER BY updated_at DESC').all() as AutomationScript[]
}

export function getAutomationScript(db: Database.Database, id: string): AutomationScript {
  return readScript(db, id)
}

export function createAutomationScript(
  db: Database.Database,
  input: AutomationScriptInput
): AutomationScript {
  const normalized = normalizeInput(input)
  const id = uuidv4()
  const now = nowIso()
  db.prepare(
    `INSERT INTO automation_scripts (id, name, description, profile_id, steps, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    normalized.name,
    normalized.description,
    normalized.profileId,
    JSON.stringify(normalized.steps),
    now,
    now
  )
  return readScript(db, id)
}

export function updateAutomationScript(
  db: Database.Database,
  id: string,
  input: Partial<AutomationScriptInput>
): AutomationScript {
  const existing = readScript(db, id)
  const next: AutomationScriptInput = {
    name: input.name ?? existing.name,
    description: input.description ?? existing.description,
    profile_id: input.profile_id === undefined ? existing.profile_id : input.profile_id,
    steps: input.steps ?? parseSavedSteps(existing.steps)
  }
  const normalized = normalizeInput(next)
  db.prepare(
    `UPDATE automation_scripts
       SET name = ?, description = ?, profile_id = ?, steps = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    normalized.name,
    normalized.description,
    normalized.profileId,
    JSON.stringify(normalized.steps),
    nowIso(),
    id
  )
  return readScript(db, id)
}

export function deleteAutomationScript(db: Database.Database, id: string): void {
  assertUuid(id, 'script id')
  db.prepare('DELETE FROM automation_scripts WHERE id = ?').run(id)
}

export function listAutomationRuns(db: Database.Database, scriptId?: string): AutomationRun[] {
  if (scriptId) {
    assertUuid(scriptId, 'script id')
    return db
      .prepare('SELECT * FROM automation_runs WHERE script_id = ? ORDER BY started_at DESC LIMIT 100')
      .all(scriptId) as AutomationRun[]
  }
  return db.prepare('SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT 100').all() as AutomationRun[]
}

function addLog(
  logs: AutomationRunLog[],
  message: string,
  meta?: Omit<AutomationRunLog, 'ts' | 'level' | 'message'> & { level?: AutomationRunLog['level'] }
): void {
  logs.push({
    ts: nowIso(),
    level: meta?.level ?? 'info',
    message,
    ...(meta?.step_index === undefined ? {} : { step_index: meta.step_index }),
    ...(meta?.step_type === undefined ? {} : { step_type: meta.step_type }),
    ...(meta?.data === undefined ? {} : { data: meta.data })
  })
}

function createRun(db: Database.Database, scriptId: string | null, profileId: string | null): AutomationRun {
  const id = uuidv4()
  const startedAt = nowIso()
  db.prepare(
    `INSERT INTO automation_runs (id, script_id, profile_id, status, started_at, logs)
     VALUES (?, ?, ?, 'running', ?, '[]')`
  ).run(id, scriptId, profileId, startedAt)
  return db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(id) as AutomationRun
}

function finishRun(
  db: Database.Database,
  runId: string,
  status: 'success' | 'error',
  startedAt: string,
  logs: AutomationRunLog[],
  error: string | null
): AutomationRun {
  const finishedAt = nowIso()
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
  db.prepare(
    `UPDATE automation_runs
       SET status = ?, finished_at = ?, duration_ms = ?, error = ?, logs = ?
     WHERE id = ?`
  ).run(status, finishedAt, durationMs, error, JSON.stringify(logs), runId)
  return db.prepare('SELECT * FROM automation_runs WHERE id = ?').get(runId) as AutomationRun
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function jsString(value: string): string {
  return JSON.stringify(value)
}

async function waitForSelector(ctx: RunContext, selector: string, timeoutMs: number): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const result = await executeJavaScriptCDP(ctx.profileId, `Boolean(document.querySelector(${jsString(selector)}))`)
    const value = (result as { result?: { value?: unknown } })?.result?.value
    if (value === true) return
    await wait(DEFAULT_WAIT_SELECTOR_INTERVAL_MS)
  }
  throw new Error(`Selector not found within ${timeoutMs}ms: ${selector}`)
}

async function runStep(ctx: RunContext, step: AutomationStep, index: number): Promise<void> {
  addLog(ctx.logs, step.label || `Running ${step.type}`, { step_index: index, step_type: step.type })

  switch (step.type) {
    case 'launch':
      await launchBrowser(ctx.db, ctx.profileId, ctx.profilesDir, ctx.mainWindow, { targetUrl: step.url })
      return
    case 'open_url':
      await openUrlInProfile(ctx.db, ctx.profileId, step.url ?? '', ctx.profilesDir, ctx.mainWindow)
      return
    case 'wait':
      await wait(step.duration_ms ?? 1000)
      return
    case 'wait_selector':
      await waitForSelector(ctx, step.selector ?? '', step.timeout_ms ?? DEFAULT_WAIT_SELECTOR_TIMEOUT_MS)
      return
    case 'click':
      await waitForSelector(ctx, step.selector ?? '', step.timeout_ms ?? DEFAULT_WAIT_SELECTOR_TIMEOUT_MS)
      await executeJavaScriptCDP(
        ctx.profileId,
        `(() => {
          const el = document.querySelector(${jsString(step.selector ?? '')});
          if (!el) throw new Error('selector not found');
          el.scrollIntoView({ block: 'center', inline: 'center' });
          el.click();
          return true;
        })()`
      )
      return
    case 'type':
      await waitForSelector(ctx, step.selector ?? '', step.timeout_ms ?? DEFAULT_WAIT_SELECTOR_TIMEOUT_MS)
      await executeJavaScriptCDP(
        ctx.profileId,
        `(() => {
          const el = document.querySelector(${jsString(step.selector ?? '')});
          if (!el) throw new Error('selector not found');
          el.focus();
          const value = ${jsString(step.text ?? '')};
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter && el instanceof HTMLInputElement) setter.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`
      )
      return
    case 'evaluate': {
      const result = await executeJavaScriptCDP(ctx.profileId, step.script ?? '')
      addLog(ctx.logs, 'JavaScript evaluated', {
        step_index: index,
        step_type: step.type,
        data: result
      })
      return
    }
    case 'screenshot': {
      const data = await captureScreenshotCDP(ctx.profileId, { format: 'png', fullPage: true })
      addLog(ctx.logs, 'Screenshot captured', {
        step_index: index,
        step_type: step.type,
        data: { base64Length: data.length }
      })
      return
    }
    case 'stop':
      await stopBrowser(ctx.db, ctx.profileId, ctx.mainWindow)
      return
    default:
      throw new Error(`Unsupported automation step: ${step.type}`)
  }
}

export async function runAutomationScript(
  db: Database.Database,
  scriptId: string,
  profilesDir: string,
  mainWindow: Electron.BrowserWindow | null,
  overrideProfileId?: string | null
): Promise<AutomationRunResult> {
  const script = readScript(db, scriptId)
  const profileId = overrideProfileId ?? script.profile_id
  if (!profileId) throw new Error('Automation script has no profile selected')
  assertUuid(profileId, 'profile id')
  const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)
  if (!profile) throw new Error('Profile not found')

  const run = createRun(db, script.id, profileId)
  const logs: AutomationRunLog[] = []
  const steps = parseSavedSteps(script.steps)
  addLog(logs, `Started ${script.name}`, { data: { steps: steps.length, profileId } })

  try {
    const ctx: RunContext = { db, profileId, profilesDir, mainWindow, logs }
    for (let i = 0; i < steps.length; i++) {
      await runStep(ctx, steps[i], i)
    }
    addLog(logs, 'Automation completed')
    const finished = finishRun(db, run.id, 'success', run.started_at, logs, null)
    db.prepare('UPDATE automation_scripts SET last_run_at = ?, updated_at = ? WHERE id = ?').run(
      finished.finished_at,
      nowIso(),
      script.id
    )
    return { run: finished, logs }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    addLog(logs, message, { level: 'error' })
    const finished = finishRun(db, run.id, 'error', run.started_at, logs, message)
    db.prepare('UPDATE automation_scripts SET last_run_at = ? WHERE id = ?').run(finished.finished_at, script.id)
    return { run: finished, logs }
  }
}

export async function runAdHocAutomation(
  db: Database.Database,
  input: { profile_id: string; steps: AutomationStep[] },
  profilesDir: string,
  mainWindow: Electron.BrowserWindow | null
): Promise<AutomationRunResult> {
  const profileId = input.profile_id
  assertUuid(profileId, 'profile id')
  const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)
  if (!profile) throw new Error('Profile not found')
  const steps = sanitizeSteps(input.steps)
  const run = createRun(db, null, profileId)
  const logs: AutomationRunLog[] = []
  addLog(logs, 'Started ad-hoc automation', { data: { steps: steps.length, profileId } })

  try {
    const ctx: RunContext = { db, profileId, profilesDir, mainWindow, logs }
    for (let i = 0; i < steps.length; i++) {
      await runStep(ctx, steps[i], i)
    }
    addLog(logs, 'Automation completed')
    return { run: finishRun(db, run.id, 'success', run.started_at, logs, null), logs }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    addLog(logs, message, { level: 'error' })
    return { run: finishRun(db, run.id, 'error', run.started_at, logs, message), logs }
  }
}

export async function getAutomationTabs(profileId: string): Promise<unknown[]> {
  assertUuid(profileId, 'profile id')
  return listCdpPageTargets(profileId)
}
