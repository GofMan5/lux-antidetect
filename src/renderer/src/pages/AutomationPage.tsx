import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Braces,
  Clock,
  Code2,
  Copy,
  FileCode2,
  MousePointerClick,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2
} from 'lucide-react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { TEXTAREA } from '../lib/ui'
import { useProfilesStore } from '../stores/profiles'
import { useToastStore } from '../components/Toast'
import {
  Badge,
  Button,
  CardContent,
  CardDescription,
  CardHeader,
  CardRoot,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select
} from '../components/ui'
import type {
  AutomationRun,
  AutomationRunLog,
  AutomationRunResult,
  AutomationScript,
  AutomationStep,
  AutomationStepType,
  Profile
} from '../lib/types'

const STEP_SNIPPETS: Array<{ type: AutomationStepType; label: string; step: AutomationStep }> = [
  {
    type: 'open_url',
    label: 'Open URL',
    step: { id: 'open-url', type: 'open_url', label: 'Open target URL', url: 'https://example.com' }
  },
  {
    type: 'wait_selector',
    label: 'Wait selector',
    step: { id: 'wait-selector', type: 'wait_selector', selector: 'body', timeout_ms: 15000 }
  },
  {
    type: 'click',
    label: 'Click',
    step: { id: 'click', type: 'click', selector: 'button[type="submit"]', timeout_ms: 15000 }
  },
  {
    type: 'type',
    label: 'Type',
    step: { id: 'type', type: 'type', selector: 'input[name="q"]', text: 'Lux Antidetect' }
  },
  {
    type: 'evaluate',
    label: 'Evaluate JS',
    step: { id: 'evaluate', type: 'evaluate', script: 'document.title' }
  },
  {
    type: 'screenshot',
    label: 'Screenshot',
    step: { id: 'screenshot', type: 'screenshot', label: 'Capture page screenshot' }
  }
]

const DEFAULT_STEPS: AutomationStep[] = [
  { id: 'open-start', type: 'open_url', label: 'Open workspace URL', url: 'https://example.com' },
  { id: 'wait-body', type: 'wait_selector', selector: 'body', timeout_ms: 15000 },
  { id: 'read-title', type: 'evaluate', script: 'document.title' },
  { id: 'shot', type: 'screenshot', label: 'Capture screenshot' }
]

function formatJson(steps: AutomationStep[]): string {
  return JSON.stringify(steps, null, 2)
}

function parseSteps(value: string): AutomationStep[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new Error('Steps must be a JSON array')
  return parsed.map((step, index) => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      throw new Error(`Step ${index + 1} must be an object`)
    }
    const typed = step as AutomationStep
    if (!typed.type) throw new Error(`Step ${index + 1} is missing type`)
    return { ...typed, id: typed.id || `${typed.type}-${index + 1}` }
  })
}

function parseScriptSteps(script: AutomationScript | null): AutomationStep[] {
  if (!script) return DEFAULT_STEPS
  try {
    return parseSteps(script.steps)
  } catch {
    return []
  }
}

function profileName(profiles: Profile[], profileId: string | null): string {
  if (!profileId) return 'No profile'
  return profiles.find((profile) => profile.id === profileId)?.name ?? 'Missing profile'
}

function formatTime(value: string | null): string {
  if (!value) return 'Never'
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  } catch {
    return value
  }
}

function runLogs(run: AutomationRun | null): AutomationRunLog[] {
  if (!run?.logs) return []
  try {
    const parsed = JSON.parse(run.logs) as unknown
    return Array.isArray(parsed) ? parsed as AutomationRunLog[] : []
  } catch {
    return []
  }
}

function statusVariant(status: AutomationRun['status']): 'success' | 'destructive' | 'accent' {
  if (status === 'success') return 'success'
  if (status === 'error') return 'destructive'
  return 'accent'
}

export function AutomationPage(): React.JSX.Element {
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetchProfiles)
  const addToast = useToastStore((s) => s.addToast)

  const [scripts, setScripts] = useState<AutomationScript[]>([])
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('New automation')
  const [description, setDescription] = useState('')
  const [profileId, setProfileId] = useState('')
  const [stepsJson, setStepsJson] = useState(formatJson(DEFAULT_STEPS))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<AutomationRunResult | null>(null)

  const selectedScript = useMemo(
    () => scripts.find((script) => script.id === selectedId) ?? null,
    [scripts, selectedId]
  )
  const selectedRuns = useMemo(
    () => runs.filter((run) => !selectedId || run.script_id === selectedId),
    [runs, selectedId]
  )
  const profileOptions = useMemo(
    () => [
      { value: '', label: 'Select profile' },
      ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))
    ],
    [profiles]
  )
  const currentSteps = useMemo(() => {
    try {
      return parseSteps(stepsJson)
    } catch {
      return []
    }
  }, [stepsJson])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextScripts, nextRuns] = await Promise.all([
        api.listAutomationScripts(),
        api.listAutomationRuns()
      ])
      setScripts(nextScripts)
      setRuns(nextRuns)
      if (!selectedId && nextScripts[0]) setSelectedId(nextScripts[0].id)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to load automation data', 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast, selectedId])

  useEffect(() => {
    void fetchProfiles()
    void load()
  }, [fetchProfiles, load])

  useEffect(() => {
    if (!selectedScript) return
    setName(selectedScript.name)
    setDescription(selectedScript.description)
    setProfileId(selectedScript.profile_id ?? '')
    setStepsJson(formatJson(parseScriptSteps(selectedScript)))
  }, [selectedScript])

  const resetNew = (): void => {
    setSelectedId(null)
    setName('New automation')
    setDescription('')
    setProfileId('')
    setStepsJson(formatJson(DEFAULT_STEPS))
    setLastResult(null)
  }

  const appendStep = (step: AutomationStep): void => {
    try {
      const steps = parseSteps(stepsJson)
      const suffix = Date.now().toString(36)
      setStepsJson(formatJson([...steps, { ...step, id: `${step.type}-${suffix}` }]))
    } catch {
      addToast('Fix steps JSON before inserting a snippet', 'error')
    }
  }

  const save = async (): Promise<void> => {
    if (!profileId) {
      addToast('Select a profile before saving', 'error')
      return
    }
    let steps: AutomationStep[]
    try {
      steps = parseSteps(stepsJson)
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Invalid steps JSON', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = { name, description, profile_id: profileId, steps }
      const saved = selectedId
        ? await api.updateAutomationScript(selectedId, payload)
        : await api.createAutomationScript(payload)
      setSelectedId(saved.id)
      await load()
      addToast('Automation saved', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save automation', 'error')
    } finally {
      setSaving(false)
    }
  }

  const run = async (): Promise<void> => {
    if (!profileId) {
      addToast('Select a profile before running', 'error')
      return
    }
    setRunning(true)
    try {
      const result = selectedId
        ? await api.runAutomationScript(selectedId, profileId)
        : await api.runAdhocAutomation(profileId, parseSteps(stepsJson))
      setLastResult(result)
      await load()
      addToast(
        result.run.status === 'success' ? 'Automation completed' : result.run.error || 'Automation failed',
        result.run.status === 'success' ? 'success' : 'error'
      )
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Automation failed', 'error')
    } finally {
      setRunning(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    setSaving(true)
    try {
      await api.deleteAutomationScript(selectedId)
      resetNew()
      await load()
      addToast('Automation deleted', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete automation', 'error')
    } finally {
      setSaving(false)
    }
  }

  const logs = lastResult?.logs ?? runLogs(selectedRuns[0] ?? null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border/60 bg-background/70 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h1 className="text-[18px] font-semibold tracking-tight text-foreground">Automation Studio</h1>
              <Badge variant="accent">BAS</Badge>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Build repeatable browser flows on top of Lux profiles and CDP.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void load()}>
              Refresh
            </Button>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={resetNew}>
              New script
            </Button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)_320px] gap-0">
        <aside className="min-h-0 border-r border-border/55 bg-background/45 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Scripts
            </span>
            <Badge variant="muted">{scripts.length}</Badge>
          </div>
          <div className="space-y-2">
            {loading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading automation...</div>
            ) : scripts.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<FileCode2 />}
                title="No scripts"
                description="Create the first automation flow."
              />
            ) : (
              scripts.map((script) => (
                <button
                  key={script.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(script.id)
                    setLastResult(null)
                  }}
                  className={cn(
                    'w-full rounded-[--radius-md] border px-3 py-2 text-left transition-colors',
                    selectedId === script.id
                      ? 'border-primary/35 bg-primary/8'
                      : 'border-border bg-card/35 hover:border-edge'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground">{script.name}</span>
                    <Badge variant="muted">{parseScriptSteps(script).length}</Badge>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    {profileName(profiles, script.profile_id)}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    Last run: {formatTime(script.last_run_at)}
                  </p>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4">
          <div className="grid gap-4">
            <CardRoot>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Script Definition</CardTitle>
                    <CardDescription>Manual runner with ordered BAS steps.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Save className="h-3.5 w-3.5" />}
                      loading={saving}
                      onClick={() => void save()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      icon={<Play className="h-3.5 w-3.5" />}
                      loading={running}
                      onClick={() => void run()}
                    >
                      Run
                    </Button>
                    {selectedId && (
                      <Button
                        variant="destructive"
                        size="sm"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        disabled={saving || running}
                        onClick={() => void remove()}
                      />
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-[minmax(0,1fr)_260px] gap-3">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Profile</Label>
                    <Select
                      options={profileOptions}
                      value={profileId}
                      onChange={(event) => setProfileId(event.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Input value={description} onChange={(event) => setDescription(event.target.value)} />
                </div>

                <div className="flex flex-wrap gap-2">
                  {STEP_SNIPPETS.map((snippet) => (
                    <Button
                      key={snippet.type}
                      variant="secondary"
                      size="sm"
                      icon={snippet.type === 'click' ? <MousePointerClick className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      onClick={() => appendStep(snippet.step)}
                    >
                      {snippet.label}
                    </Button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Steps JSON</Label>
                    <Badge variant={currentSteps.length > 0 ? 'success' : 'muted'}>
                      {currentSteps.length} steps
                    </Badge>
                  </div>
                  <textarea
                    value={stepsJson}
                    onChange={(event) => setStepsJson(event.target.value)}
                    spellCheck={false}
                    className={cn(TEXTAREA, 'min-h-[360px] font-mono text-[12px] leading-relaxed')}
                  />
                </div>
              </CardContent>
            </CardRoot>

            <CardRoot>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Run Log</CardTitle>
                    <CardDescription>Latest execution trace from the BAS runner.</CardDescription>
                  </div>
                  {lastResult && (
                    <Badge variant={statusVariant(lastResult.run.status)} dot>
                      {lastResult.run.status}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {logs.length === 0 ? (
                  <EmptyState
                    size="sm"
                    icon={<Code2 />}
                    title="No run log"
                    description="Run a script to see step-by-step output."
                  />
                ) : (
                  <div className="space-y-2">
                    {logs.map((log, index) => (
                      <div
                        key={`${log.ts}-${index}`}
                        className={cn(
                          'rounded-[--radius-md] border px-3 py-2 text-[12px]',
                          log.level === 'error'
                            ? 'border-err/25 bg-err/8 text-err'
                            : 'border-border bg-input text-foreground'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{log.message}</span>
                          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {formatTime(log.ts)}
                          </span>
                        </div>
                        {log.step_type && (
                          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <Badge variant="muted">{log.step_type}</Badge>
                            {log.step_index !== undefined && <span>step {log.step_index + 1}</span>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </CardRoot>
          </div>
        </main>

        <aside className="min-h-0 border-l border-border/55 bg-background/45 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Runs
            </span>
            <Badge variant="muted">{selectedRuns.length}</Badge>
          </div>
          <div className="space-y-2">
            {selectedRuns.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Clock />}
                title="No runs"
                description="History appears after first launch."
              />
            ) : (
              selectedRuns.slice(0, 30).map((run) => (
                <div key={run.id} className="rounded-[--radius-md] border border-border bg-card/35 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={statusVariant(run.status)} dot>
                      {run.status}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {run.duration_ms === null ? '...' : `${run.duration_ms}ms`}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">{formatTime(run.started_at)}</p>
                  {run.error && <p className="mt-1 text-[11px] text-err">{run.error}</p>}
                </div>
              ))
            )}
          </div>

          <CardRoot className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Braces className="h-4 w-4 text-primary" />
                Step schema
              </CardTitle>
              <CardDescription>Allowed actions in this release.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-[11px] text-muted-foreground">
              <p><code>open_url</code> requires <code>url</code>.</p>
              <p><code>wait_selector</code>, <code>click</code>, <code>type</code> require <code>selector</code>.</p>
              <p><code>evaluate</code> runs JavaScript in the active tab.</p>
              <p><code>screenshot</code> captures the active tab and stores result metadata in logs.</p>
              <Button
                className="mt-2 w-full"
                variant="secondary"
                size="sm"
                icon={<Copy className="h-3.5 w-3.5" />}
                onClick={() => {
                  void navigator.clipboard.writeText(stepsJson)
                  addToast('Steps copied', 'success')
                }}
              >
                Copy steps
              </Button>
            </CardContent>
          </CardRoot>
        </aside>
      </div>
    </div>
  )
}
