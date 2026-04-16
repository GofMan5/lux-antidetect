import { useEffect, useState, useCallback, useRef } from 'react'
import { Copy, Check, AlertCircle, Loader2, RefreshCcw } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { Tooltip } from '../ui/Tooltip'
import { cn } from '../../lib/utils'
import { api } from '../../lib/api'
import { useProfilesStore } from '../../stores/profiles'
import { useToastStore } from '../Toast'

const COPY_FEEDBACK_MS = 1500

const buildPuppeteerSnippet = (ws: string): string =>
  `import puppeteer from 'puppeteer-core'

const browser = await puppeteer.connect({
  browserWSEndpoint: '${ws}',
  defaultViewport: null
})
const [page] = await browser.pages()
await page.goto('https://example.com')`

const buildPlaywrightSnippet = (http: string): string =>
  `import { chromium } from 'playwright'

const browser = await chromium.connectOverCDP('${http}')
const context = browser.contexts()[0] ?? await browser.newContext()
const page = context.pages()[0] ?? await context.newPage()
await page.goto('https://example.com')`

interface CdpInfo {
  port: number
  wsEndpoint: string
  httpEndpoint: string
}

export interface AutomationModalProps {
  open: boolean
  onClose: () => void
  profileId: string
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; headline: string; detail?: string }
  | { kind: 'ready'; info: CdpInfo }

function isStoppedLikeError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('not running') ||
    m.includes('no session') ||
    m.includes('stopped') ||
    m.includes('not found') ||
    m.includes('no active') ||
    m.includes('no cdp')
  )
}

export function AutomationModal({ open, onClose, profileId }: AutomationModalProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const reqSeq = useRef(0)

  // Derive current profile name + status from store by id (single source of truth).
  const profile = useProfilesStore((s) => s.profiles.find((p) => p.id === profileId))
  const profileName = profile?.name ?? 'Profile'
  const profileStatus = profile?.status
  const prevStatusRef = useRef(profileStatus)

  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setState({ kind: 'loading' })
    try {
      const info = await api.getCdpInfo(profileId)
      if (seq !== reqSeq.current) return
      setState({ kind: 'ready', info })
    } catch (err) {
      if (seq !== reqSeq.current) return
      const raw = err instanceof Error ? err.message : String(err ?? 'Unavailable')
      if (isStoppedLikeError(raw)) {
        setState({
          kind: 'error',
          headline: 'Automation endpoint unavailable',
          detail: 'Profile must be running to expose a CDP endpoint.'
        })
      } else {
        setState({ kind: 'error', headline: 'Automation endpoint unavailable', detail: raw })
      }
    }
  }, [profileId])

  useEffect(() => {
    if (!open) return
    void load()
    return () => {
      reqSeq.current++
    }
  }, [open, load])

  // If profile transitions out of running while modal is open, invalidate endpoint.
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = profileStatus
    if (!open) return
    if (prev === 'running' && profileStatus && profileStatus !== 'running') {
      reqSeq.current++
      setState({
        kind: 'error',
        headline: 'Profile stopped — endpoint no longer valid.',
        detail: 'Relaunch the profile to obtain a new CDP endpoint.'
      })
    }
  }, [open, profileStatus])

  return (
    <Modal open={open} onClose={onClose} title="Automation Endpoint" description={profileName} size="lg">
      <div role="status" aria-live="polite">
        {state.kind === 'loading' && (
          <div className="flex items-center gap-2 py-8 text-muted text-sm justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Fetching CDP endpoint…
          </div>
        )}

        {state.kind === 'error' && (
          <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex items-center gap-2 text-err text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>{state.headline}</span>
            </div>
            {state.detail && (
              <p className="text-xs text-muted max-w-sm break-words">{state.detail}</p>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCcw className="h-4 w-4" />}
              onClick={() => void load()}
            >
              Retry
            </Button>
          </div>
        )}

        {state.kind === 'ready' && <ReadyView info={state.info} />}
      </div>
    </Modal>
  )
}

function ReadyView({ info }: { info: CdpInfo }) {
  const puppeteerSnippet = buildPuppeteerSnippet(info.wsEndpoint)
  const playwrightSnippet = buildPlaywrightSnippet(info.httpEndpoint)

  return (
    <div className="flex flex-col gap-5">
      {/* Endpoints */}
      <section className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Endpoints</h3>

        <EndpointRow label="Browser WebSocket" value={info.wsEndpoint} copyLabel="Copy WebSocket endpoint" />
        <EndpointRow label="HTTP (DevTools)" value={info.httpEndpoint} copyLabel="Copy HTTP endpoint" />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="text-xs font-medium text-muted w-full sm:w-40 shrink-0">Port</span>
          <div className="flex items-center gap-2">
            <Badge>{info.port}</Badge>
            <CopyButton text={String(info.port)} ariaLabel="Copy port" />
          </div>
        </div>
      </section>

      {/* Puppeteer */}
      <SnippetSection
        title="Puppeteer"
        snippet={puppeteerSnippet}
        ariaLabel="Puppeteer snippet"
        copyLabel="Copy Puppeteer snippet"
      />

      {/* Playwright */}
      <SnippetSection
        title="Playwright"
        snippet={playwrightSnippet}
        ariaLabel="Playwright snippet"
        copyLabel="Copy Playwright snippet"
      />

      <p className="text-xs text-muted">
        The endpoint is tied to this browser session. Restarting the profile assigns a new port.
      </p>
    </div>
  )
}

function EndpointRow({
  label,
  value,
  copyLabel
}: {
  label: string
  value: string
  copyLabel: string
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <span className="text-xs font-medium text-muted w-full sm:w-40 shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <input
          readOnly
          value={value}
          className={cn(
            'flex-1 min-w-0 h-9 px-2 rounded-[--radius-md] bg-elevated border border-edge',
            'font-mono text-sm leading-relaxed text-content',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
          )}
          onFocus={(e) => e.currentTarget.select()}
        />
        <CopyButton text={value} ariaLabel={copyLabel} />
      </div>
    </div>
  )
}

function SnippetSection({
  title,
  snippet,
  ariaLabel,
  copyLabel
}: {
  title: string
  snippet: string
  ariaLabel: string
  copyLabel: string
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
        <CopyButton text={snippet} ariaLabel={copyLabel} withLabel />
      </div>
      <div className="relative group">
        <pre
          role="region"
          aria-label={ariaLabel}
          className="font-mono text-sm leading-relaxed bg-elevated border border-edge rounded-[--radius-md] p-3 pr-10 overflow-x-auto text-content"
        >
          {snippet}
        </pre>
        <div
          className={cn(
            'absolute top-2 right-2',
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            'transition-opacity'
          )}
        >
          <CopyButton text={snippet} ariaLabel={copyLabel} />
        </div>
      </div>
    </section>
  )
}

function CopyButton({
  text,
  ariaLabel,
  withLabel
}: {
  text: string
  ariaLabel: string
  withLabel?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addToast = useToastStore((s) => s.addToast)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    } catch {
      addToast('Copy failed — select the value and press Ctrl+C', 'error')
    }
  }, [text, addToast])

  const icon = copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />

  if (withLabel) {
    return (
      <Button
        variant="secondary"
        size="sm"
        icon={icon}
        onClick={() => void handleCopy()}
        aria-label={ariaLabel}
      >
        {copied ? 'Copied' : 'Copy snippet'}
      </Button>
    )
  }

  return (
    <Tooltip content="Copy to clipboard">
      <Button
        variant="ghost"
        size="sm"
        icon={icon}
        onClick={() => void handleCopy()}
        aria-label={ariaLabel}
      />
    </Tooltip>
  )
}
