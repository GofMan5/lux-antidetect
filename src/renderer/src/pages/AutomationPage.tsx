import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Braces,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  FileCode2,
  GripVertical,
  ListChecks,
  MousePointerClick,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Timer,
  Trash2,
  XCircle
} from 'lucide-react'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { INPUT, SELECT, TEXTAREA } from '../lib/ui'
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

type StepIssue = { index: number; message: string }

const STEP_TYPES: AutomationStepType[] = [
  'launch',
  'open_url',
  'wait',
  'wait_selector',
  'click',
  'type',
  'evaluate',
  'screenshot',
  'stop'
]

const STEP_META: Record<AutomationStepType, { label: string; tone: string; icon: React.ReactNode }> = {
  launch: { label: 'Launch', tone: 'text-info bg-info/10 border-info/25', icon: <Play className="h-3.5 w-3.5" /> },
  open_url: { label: 'Open URL', tone: 'text-primary bg-primary/10 border-primary/25', icon: <Activity className="h-3.5 w-3.5" /> },
  wait: { label: 'Wait', tone: 'text-warn bg-warn/10 border-warn/25', icon: <Timer className="h-3.5 w-3.5" /> },
  wait_selector: { label: 'Wait selector', tone: 'text-info bg-info/10 border-info/25', icon: <Clock className="h-3.5 w-3.5" /> },
  click: { label: 'Click', tone: 'text-primary bg-primary/10 border-primary/25', icon: <MousePointerClick className="h-3.5 w-3.5" /> },
  type: { label: 'Type', tone: 'text-ok bg-ok/10 border-ok/25', icon: <Code2 className="h-3.5 w-3.5" /> },
  evaluate: { label: 'Evaluate', tone: 'text-accent bg-accent/10 border-accent/25', icon: <Braces className="h-3.5 w-3.5" /> },
  screenshot: { label: 'Screenshot', tone: 'text-info bg-info/10 border-info/25', icon: <FileCode2 className="h-3.5 w-3.5" /> },
  stop: { label: 'Stop', tone: 'text-err bg-err/10 border-err/25', icon: <XCircle className="h-3.5 w-3.5" /> }
}

const STEP_SNIPPETS: Array<{ type: AutomationStepType; step: AutomationStep }> = [
  { type: 'launch', step: { id: 'launch', type: 'launch', label: 'Launch profile' } },
  { type: 'open_url', step: { id: 'open-url', type: 'open_url', label: 'Open target', url: 'https://example.com' } },
  { type: 'wait_selector', step: { id: 'wait-selector', type: 'wait_selector', selector: 'body', timeout_ms: 15000 } },
  { type: 'click', step: { id: 'click', type: 'click', selector: 'button[type="submit"]', timeout_ms: 15000 } },
  { type: 'type', step: { id: 'type', type: 'type', selector: 'input[name="q"]', text: 'Lux Antidetect' } },
  { type: 'evaluate', step: { id: 'evaluate', type: 'evaluate', script: 'document.title' } },
  { type: 'screenshot', step: { id: 'screenshot', type: 'screenshot', label: 'Capture page' } },
  { type: 'stop', step: { id: 'stop', type: 'stop', label: 'Stop profile' } }
]

const DEFAULT_STEPS: AutomationStep[] = [
  { id: 'launch-start', type: 'launch', label: 'Launch profile' },
  { id: 'open-start', type: 'open_url', label: 'Open workspace URL', url: 'https://example.com' },
  { id: 'wait-body', type: 'wait_selector', selector: 'body', timeout_ms: 15000 },
  { id: 'read-title', type: 'evaluate', script: 'document.title' },
  { id: 'shot', type: 'screenshot', label: 'Capture screenshot' }
]

function stepId(type: AutomationStepType): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function cloneStep(step: AutomationStep): AutomationStep {
  return { ...step, id: stepId(step.type) }
}

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
    if (!STEP_TYPES.includes(typed.type)) throw new Error(`Step ${index + 1} has invalid type`)
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

function validateSteps(steps: AutomationStep[]): StepIssue[] {
  const issues: StepIssue[] = []
  steps.forEach((step, index) => {
    if (step.enabled === false) return
    if ((step.type === 'launch' || step.type === 'open_url') && step.url) {
      try {
        const url = new URL(step.url)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          issues.push({ index, message: 'URL must use http or https' })
        }
      } catch {
        issues.push({ index, message: 'URL is invalid' })
      }
    }
    if (step.type === 'open_url' && !step.url?.trim()) issues.push({ index, message: 'URL is required' })
    if ((step.type === 'click' || step.type === 'type' || step.type === 'wait_selector') && !step.selector?.trim()) {
      issues.push({ index, message: 'Selector is required' })
    }
    if (step.type === 'type' && step.text === undefined) issues.push({ index, message: 'Text is required' })
    if (step.type === 'evaluate' && !step.script?.trim()) issues.push({ index, message: 'JavaScript is required' })
    if (step.duration_ms !== undefined && (!Number.isInteger(step.duration_ms) || step.duration_ms < 0 || step.duration_ms > 300000)) {
      issues.push({ index, message: 'Duration must be 0..300000ms' })
    }
    if (step.timeout_ms !== undefined && (!Number.isInteger(step.timeout_ms) || step.timeout_ms < 1 || step.timeout_ms > 300000)) {
      issues.push({ index, message: 'Timeout must be 1..300000ms' })
    }
    if (step.tabIndex !== undefined && (!Number.isInteger(step.tabIndex) || step.tabIndex < 0 || step.tabIndex > 100)) {
      issues.push({ index, message: 'Tab index must be 0..100' })
    }
  })
  return issues
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

function stepSummary(step: AutomationStep): string {
  if (step.enabled === false) return 'Disabled'
  if (step.url) return step.url
  if (step.selector) return step.selector
  if (step.script) return step.script
  if (step.text) return step.text
  if (step.duration_ms !== undefined) return `${step.duration_ms}ms`
  return step.label || STEP_META[step.type].label
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
  const [steps, setSteps] = useState<AutomationStep[]>(DEFAULT_STEPS)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [stepsJson, setStepsJson] = useState(formatJson(DEFAULT_STEPS))
  const [jsonError, setJsonError] = useState('')
  const [scriptQuery, setScriptQuery] = useState('')
  const [savedSnapshot, setSavedSnapshot] = useState('')
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
  const visibleRuns = useMemo(() => {
    const resultRuns = lastResult && !selectedRuns.some((run) => run.id === lastResult.run.id)
      ? [lastResult.run, ...selectedRuns]
      : selectedRuns
    return resultRuns
  }, [lastResult, selectedRuns])
  const filteredScripts = useMemo(() => {
    const query = scriptQuery.trim().toLowerCase()
    if (!query) return scripts
    return scripts.filter((script) =>
      `${script.name} ${script.description} ${profileName(profiles, script.profile_id)}`.toLowerCase().includes(query)
    )
  }, [profiles, scriptQuery, scripts])
  const profileOptions = useMemo(
    () => [
      { value: '', label: 'Select profile' },
      ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))
    ],
    [profiles]
  )
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId) ?? null,
    [profileId, profiles]
  )
  const issues = useMemo(() => validateSteps(steps), [steps])
  const issueMap = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const issue of issues) {
      const current = map.get(issue.index) ?? []
      current.push(issue.message)
      map.set(issue.index, current)
    }
    return map
  }, [issues])
  const latestRun = lastResult?.run ?? visibleRuns[0] ?? null
  const logs = lastResult?.logs ?? runLogs(visibleRuns[0] ?? null)
  const snapshot = useMemo(
    () => JSON.stringify({ selectedId, name, description, profileId, steps }),
    [description, name, profileId, selectedId, steps]
  )
  const isDirty = savedSnapshot !== '' && snapshot !== savedSnapshot

  const confirmDiscard = useCallback((): boolean => {
    if (!isDirty) return true
    return window.confirm('Discard unsaved automation changes?')
  }, [isDirty])

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
    let nextSteps: AutomationStep[]
    try {
      nextSteps = parseSteps(selectedScript.steps)
      setJsonError('')
      setAdvancedOpen(false)
    } catch (err) {
      nextSteps = []
      setAdvancedOpen(true)
      setJsonError(err instanceof Error ? err.message : 'Saved steps JSON is invalid')
      addToast('Saved automation has invalid steps JSON', 'error')
    }
    setName(selectedScript.name)
    setDescription(selectedScript.description)
    setProfileId(selectedScript.profile_id ?? '')
    setSteps(nextSteps)
    setStepsJson(nextSteps.length > 0 ? formatJson(nextSteps) : selectedScript.steps)
    setSavedSnapshot(JSON.stringify({
      selectedId: selectedScript.id,
      name: selectedScript.name,
      description: selectedScript.description,
      profileId: selectedScript.profile_id ?? '',
      steps: nextSteps
    }))
  }, [addToast, selectedScript])

  const replaceSteps = (nextSteps: AutomationStep[]): void => {
    setSteps(nextSteps)
    setStepsJson(formatJson(nextSteps))
    setJsonError('')
  }

  const resetNew = (skipConfirm = false): void => {
    if (!skipConfirm && !confirmDiscard()) return
    setSelectedId(null)
    setName('New automation')
    setDescription('')
    setProfileId('')
    replaceSteps(DEFAULT_STEPS)
    setLastResult(null)
    setSavedSnapshot(JSON.stringify({
      selectedId: null,
      name: 'New automation',
      description: '',
      profileId: '',
      steps: DEFAULT_STEPS
    }))
  }

  const appendStep = (step: AutomationStep): void => {
    replaceSteps([...steps, cloneStep(step)])
  }

  const updateStep = (index: number, patch: Partial<AutomationStep>): void => {
    replaceSteps(steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step))
  }

  const updateStepType = (index: number, type: AutomationStepType): void => {
    const template = STEP_SNIPPETS.find((snippet) => snippet.type === type)?.step ?? { id: type, type }
    replaceSteps(steps.map((step, stepIndex) => stepIndex === index ? { ...cloneStep(template), label: step.label } : step))
  }

  const moveStep = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    const [item] = next.splice(index, 1)
    next.splice(target, 0, item)
    replaceSteps(next)
  }

  const removeStep = (index: number): void => {
    replaceSteps(steps.filter((_, stepIndex) => stepIndex !== index))
  }

  const applyJson = (): AutomationStep[] | null => {
    try {
      const parsed = parseSteps(stepsJson)
      setSteps(parsed)
      setStepsJson(formatJson(parsed))
      setJsonError('')
      return parsed
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid steps JSON'
      setJsonError(message)
      addToast(message, 'error')
      return null
    }
  }

  const getRunnableSteps = (): AutomationStep[] | null => {
    const runnableSteps = advancedOpen ? applyJson() : steps
    if (!runnableSteps) return null
    const runnableIssues = validateSteps(runnableSteps)
    if (runnableIssues.length > 0) {
      addToast(`Fix ${runnableIssues.length} automation issue${runnableIssues.length === 1 ? '' : 's'}`, 'error')
      return null
    }
    if (runnableSteps.length === 0) {
      addToast('Add at least one step', 'error')
      return null
    }
    return runnableSteps
  }

  const save = async (): Promise<void> => {
    if (!profileId) {
      addToast('Select a profile before saving', 'error')
      return
    }
    const runnableSteps = getRunnableSteps()
    if (!runnableSteps) return

    setSaving(true)
    try {
      const payload = { name, description, profile_id: profileId, steps: runnableSteps }
      const saved = selectedId
        ? await api.updateAutomationScript(selectedId, payload)
        : await api.createAutomationScript(payload)
      setSelectedId(saved.id)
      setSavedSnapshot(JSON.stringify({
        selectedId: saved.id,
        name,
        description,
        profileId,
        steps: runnableSteps
      }))
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
    const runnableSteps = getRunnableSteps()
    if (!runnableSteps) return

    setRunning(true)
    try {
      const result = await api.runAdhocAutomation(profileId, runnableSteps)
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

  const runDraft = async (): Promise<void> => {
    if (!profileId) {
      addToast('Select a profile before running', 'error')
      return
    }
    const runnableSteps = getRunnableSteps()
    if (!runnableSteps) return

    setRunning(true)
    try {
      const result = await api.runAdhocAutomation(profileId, runnableSteps)
      setLastResult(result)
      await load()
      addToast(
        result.run.status === 'success' ? 'Draft completed' : result.run.error || 'Draft failed',
        result.run.status === 'success' ? 'success' : 'error'
      )
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Draft failed', 'error')
    } finally {
      setRunning(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!selectedId) return
    setSaving(true)
    try {
      await api.deleteAutomationScript(selectedId)
      resetNew(true)
      await load()
      addToast('Automation deleted', 'success')
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete automation', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="shrink-0 border-b border-border/60 bg-background/80 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h1 className="truncate text-[18px] font-semibold tracking-tight text-foreground">Automation Studio</h1>
              <Badge variant="accent">BAS</Badge>
              {latestRun && <Badge variant={statusVariant(latestRun.status)} dot>{latestRun.status}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="muted">{scripts.length} scripts</Badge>
              <Badge variant="muted">{runs.length} runs</Badge>
              <Badge variant={issues.length === 0 ? 'success' : 'destructive'} dot>
                {issues.length === 0 ? 'valid flow' : `${issues.length} issues`}
              </Badge>
              {selectedProfile && <Badge variant={selectedProfile.status === 'running' ? 'success' : 'muted'} dot>{selectedProfile.status}</Badge>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isDirty && <Badge variant="warning" dot>unsaved</Badge>}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => {
                if (confirmDiscard()) void load()
              }}
            >
              Refresh
            </Button>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => resetNew()}>
              New
            </Button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 min-[1180px]:grid-cols-[220px_minmax(500px,1fr)_240px] 2xl:grid-cols-[280px_minmax(560px,1fr)_340px]">
        <aside className="max-h-[280px] overflow-y-auto border-b border-border/55 bg-background/45 p-3 min-[1180px]:max-h-none min-[1180px]:min-h-0 min-[1180px]:border-b-0 min-[1180px]:border-r">
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              className={cn(INPUT, 'pl-8 text-xs')}
              value={scriptQuery}
              onChange={(event) => setScriptQuery(event.target.value)}
              placeholder="Search scripts..."
            />
          </div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Scripts</span>
            <Badge variant="muted">{filteredScripts.length}</Badge>
          </div>
          <div className="space-y-2">
            {loading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">Loading automation...</div>
            ) : filteredScripts.length === 0 ? (
              <EmptyState size="sm" icon={<FileCode2 />} title="No scripts" description="Create a flow." />
            ) : (
              filteredScripts.map((script) => {
                const scriptSteps = parseScriptSteps(script)
                const lastRun = runs.find((runItem) => runItem.script_id === script.id)
                return (
                  <button
                    key={script.id}
                    type="button"
                    onClick={() => {
                      if (!confirmDiscard()) return
                      setSelectedId(script.id)
                      setLastResult(null)
                    }}
                    className={cn(
                      'w-full rounded-[--radius-md] border px-3 py-2.5 text-left transition-colors',
                      selectedId === script.id
                        ? 'border-primary/40 bg-primary/10'
                        : 'border-border bg-card/35 hover:border-edge hover:bg-card/55'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">{script.name}</span>
                      <Badge variant="muted">{scriptSteps.length}</Badge>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {profileName(profiles, script.profile_id)}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] text-muted-foreground/75">{formatTime(script.last_run_at)}</span>
                      {lastRun && <Badge variant={statusVariant(lastRun.status)} dot>{lastRun.status}</Badge>}
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto p-4">
          <div className="grid gap-4">
            <CardRoot>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>Flow</CardTitle>
                    <CardDescription>{selectedId ? 'Saved scenario' : 'Draft scenario'}</CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" icon={<Save className="h-3.5 w-3.5" />} loading={saving} onClick={() => void save()}>
                      Save
                    </Button>
                    <Button variant="secondary" size="sm" icon={<Play className="h-3.5 w-3.5" />} loading={running} onClick={() => void runDraft()}>
                      Run draft
                    </Button>
                    <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} loading={running} onClick={() => void run()}>
                      Run current
                    </Button>
                    {selectedId && (
                      <Button variant="destructive" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={saving || running} onClick={() => void remove()} />
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Profile</Label>
                    <Select options={profileOptions} value={profileId} onChange={(event) => setProfileId(event.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Input value={description} onChange={(event) => setDescription(event.target.value)} />
                </div>
              </CardContent>
            </CardRoot>

            <CardRoot>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <ListChecks className="h-4 w-4 text-primary" />
                      Steps
                    </CardTitle>
                    <CardDescription>{steps.length} actions in execution order</CardDescription>
                  </div>
                  <Badge variant={issues.length === 0 ? 'success' : 'destructive'} dot>
                    {issues.length === 0 ? 'ready' : `${issues.length} issues`}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {STEP_SNIPPETS.map((snippet) => (
                    <Button
                      key={snippet.type}
                      variant="secondary"
                      size="sm"
                      icon={STEP_META[snippet.type].icon}
                      onClick={() => appendStep(snippet.step)}
                    >
                      {STEP_META[snippet.type].label}
                    </Button>
                  ))}
                </div>

                {steps.length === 0 ? (
                  <EmptyState size="sm" icon={<ListChecks />} title="No steps" description="Add an action." />
                ) : (
                  <div className="space-y-3">
                    {steps.map((step, index) => {
                      const meta = STEP_META[step.type]
                      const stepIssues = issueMap.get(index) ?? []
                      return (
                        <div
                          key={step.id}
                          className={cn(
                            'rounded-[--radius-lg] border bg-card/40 p-3',
                            stepIssues.length > 0 ? 'border-err/35' : 'border-border'
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-1 text-muted-foreground">
                              <GripVertical className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1 space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge className={meta.tone}>{meta.icon}{meta.label}</Badge>
                                <span className="truncate text-xs text-muted-foreground">#{index + 1} - {stepSummary(step)}</span>
                                {stepIssues.length === 0 ? (
                                  <CheckCircle2 className="ml-auto h-4 w-4 text-ok" />
                                ) : (
                                  <AlertCircle className="ml-auto h-4 w-4 text-err" />
                                )}
                              </div>

                              <div className="grid grid-cols-1 gap-2 md:grid-cols-[160px_minmax(0,1fr)]">
                                <select
                                  className={SELECT}
                                  value={step.type}
                                  onChange={(event) => updateStepType(index, event.target.value as AutomationStepType)}
                                >
                                  {STEP_TYPES.map((type) => (
                                    <option key={type} value={type}>{STEP_META[type].label}</option>
                                  ))}
                                </select>
                                <input
                                  className={INPUT}
                                  value={step.label ?? ''}
                                  onChange={(event) => updateStep(index, { label: event.target.value })}
                                  placeholder="Step label"
                                />
                              </div>

                              <div className="grid grid-cols-1 gap-2 md:grid-cols-[120px_minmax(0,1fr)_120px]">
                                <select
                                  className={SELECT}
                                  value={step.enabled === false ? 'disabled' : 'enabled'}
                                  onChange={(event) => updateStep(index, { enabled: event.target.value === 'disabled' ? false : undefined })}
                                >
                                  <option value="enabled">Enabled</option>
                                  <option value="disabled">Disabled</option>
                                </select>
                                <input
                                  className={INPUT}
                                  value={step.urlContains ?? ''}
                                  onChange={(event) => updateStep(index, { urlContains: event.target.value })}
                                  placeholder="Target tab URL contains"
                                />
                                <input
                                  className={INPUT}
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={step.tabIndex ?? ''}
                                  onChange={(event) => updateStep(index, { tabIndex: event.target.value ? Number(event.target.value) : undefined })}
                                  placeholder="tab index"
                                />
                              </div>

                              {(step.type === 'launch' || step.type === 'open_url') && (
                                <input
                                  className={INPUT}
                                  value={step.url ?? ''}
                                  onChange={(event) => updateStep(index, { url: event.target.value })}
                                  placeholder={step.type === 'launch' ? 'Optional launch URL' : 'https://example.com'}
                                />
                              )}

                              {(step.type === 'wait_selector' || step.type === 'click' || step.type === 'type') && (
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_150px]">
                                  <input
                                    className={INPUT}
                                    value={step.selector ?? ''}
                                    onChange={(event) => updateStep(index, { selector: event.target.value })}
                                    placeholder="CSS selector"
                                  />
                                  <input
                                    className={INPUT}
                                    type="number"
                                    min={1}
                                    max={300000}
                                    value={step.timeout_ms ?? ''}
                                    onChange={(event) => updateStep(index, { timeout_ms: event.target.value ? Number(event.target.value) : undefined })}
                                    placeholder="timeout ms"
                                  />
                                </div>
                              )}

                              {step.type === 'type' && (
                                <input
                                  className={INPUT}
                                  value={step.text ?? ''}
                                  onChange={(event) => updateStep(index, { text: event.target.value })}
                                  placeholder="Text to type"
                                />
                              )}

                              {step.type === 'wait' && (
                                <input
                                  className={INPUT}
                                  type="number"
                                  min={0}
                                  max={300000}
                                  value={step.duration_ms ?? ''}
                                  onChange={(event) => updateStep(index, { duration_ms: event.target.value ? Number(event.target.value) : undefined })}
                                  placeholder="Duration ms"
                                />
                              )}

                              {step.type === 'evaluate' && (
                                <textarea
                                  className={cn(TEXTAREA, 'min-h-[88px] font-mono text-[12px]')}
                                  value={step.script ?? ''}
                                  onChange={(event) => updateStep(index, { script: event.target.value })}
                                  spellCheck={false}
                                  placeholder="document.title"
                                />
                              )}

                              {stepIssues.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {stepIssues.map((issue) => (
                                    <Badge key={issue} variant="destructive">{issue}</Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex shrink-0 flex-col gap-1">
                              <Button variant="ghost" size="icon" icon={<ArrowUp className="h-3.5 w-3.5" />} disabled={index === 0} onClick={() => moveStep(index, -1)} />
                              <Button variant="ghost" size="icon" icon={<ArrowDown className="h-3.5 w-3.5" />} disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)} />
                              <Button variant="ghost" size="icon" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => replaceSteps([...steps.slice(0, index + 1), cloneStep(step), ...steps.slice(index + 1)])} />
                              <Button variant="destructive" size="icon" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => removeStep(index)} />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </CardRoot>

            <CardRoot>
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Braces className="h-4 w-4 text-primary" />
                      JSON
                    </CardTitle>
                    <CardDescription>Advanced editor</CardDescription>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setAdvancedOpen(!advancedOpen)
                      setStepsJson(formatJson(steps))
                      setJsonError('')
                    }}
                  >
                    {advancedOpen ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </CardHeader>
              {advancedOpen && (
                <CardContent className="space-y-3">
                  <textarea
                    value={stepsJson}
                    onChange={(event) => setStepsJson(event.target.value)}
                    spellCheck={false}
                    className={cn(TEXTAREA, 'min-h-[300px] font-mono text-[12px] leading-relaxed')}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-xs text-err">{jsonError}</div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setStepsJson(formatJson(steps))}>Reset JSON</Button>
                      <Button size="sm" onClick={() => void applyJson()}>Apply JSON</Button>
                    </div>
                  </div>
                </CardContent>
              )}
            </CardRoot>
          </div>
        </main>

        <aside className="min-h-0 overflow-y-auto border-t border-border/55 bg-background/45 p-3 min-[1180px]:border-l min-[1180px]:border-t-0">
          <CardRoot className="mb-3">
            <CardHeader>
              <CardTitle>Run Log</CardTitle>
              <CardDescription>{latestRun ? formatTime(latestRun.started_at) : 'No execution'}</CardDescription>
            </CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <EmptyState size="sm" icon={<Code2 />} title="No log" description="Run a flow." />
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
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 font-medium">{log.message}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{formatTime(log.ts)}</span>
                      </div>
                      {log.step_type && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <Badge variant="muted">{STEP_META[log.step_type].label}</Badge>
                          {log.step_index !== undefined && <span>step {log.step_index + 1}</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CardRoot>

          <CardRoot>
            <CardHeader>
              <CardTitle>Runs</CardTitle>
              <CardDescription>{visibleRuns.length} records</CardDescription>
            </CardHeader>
            <CardContent>
              {visibleRuns.length === 0 ? (
                <EmptyState size="sm" icon={<Clock />} title="No runs" description="History appears here." />
              ) : (
                <div className="space-y-2">
                  {visibleRuns.slice(0, 30).map((runItem) => (
                    <div key={runItem.id} className="rounded-[--radius-md] border border-border bg-card/35 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={statusVariant(runItem.status)} dot>{runItem.status}</Badge>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {runItem.duration_ms === null ? '...' : `${runItem.duration_ms}ms`}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">{formatTime(runItem.started_at)}</p>
                      {runItem.error && <p className="mt-1 break-words text-[11px] text-err">{runItem.error}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </CardRoot>
        </aside>
      </div>
    </div>
  )
}
