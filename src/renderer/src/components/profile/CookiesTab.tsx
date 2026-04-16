import { useEffect, useState } from 'react'
import { Cookie, Download, Upload, Copy, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { api } from '../../lib/api'
import { useToastStore } from '../Toast'
import { Button, Card, Badge } from '../ui'
import { LABEL, TEXTAREA } from '../../lib/ui'
import { cn } from '../../lib/utils'

type CookieFormat = 'netscape' | 'json'

const COOKIE_FORMATS: Array<{ value: CookieFormat; label: string; ext: string }> = [
  { value: 'netscape', label: 'Netscape (cookies.txt)', ext: 'txt' },
  { value: 'json', label: 'JSON', ext: 'json' }
]

const COOKIES_RUNNING_HINT =
  'The profile must be running for export/import (uses Chrome DevTools Protocol).'

interface CookiesTabProps {
  profileId: string
  profileName?: string
}

export function CookiesTab({ profileId, profileName }: CookiesTabProps): React.JSX.Element {
  const addToast = useToastStore((s) => s.addToast)

  const [isRunning, setIsRunning] = useState<boolean | null>(null)
  const [exporting, setExporting] = useState<CookieFormat | null>(null)
  const [copying, setCopying] = useState<CookieFormat | null>(null)
  const [importing, setImporting] = useState(false)
  const [importFormat, setImportFormat] = useState<CookieFormat>('json')
  const [importText, setImportText] = useState('')

  // Poll running status on mount (and refresh when triggered).
  useEffect(() => {
    let cancelled = false
    const refresh = async (): Promise<void> => {
      try {
        const sessions = await api.getRunningSessions()
        if (cancelled) return
        setIsRunning(sessions.some((s) => s.profile_id === profileId))
      } catch {
        if (!cancelled) setIsRunning(null)
      }
    }
    refresh()
    const id = setInterval(refresh, 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [profileId])

  const statusReady = isRunning !== null
  const canAct = statusReady && isRunning !== false

  const triggerDownload = (content: string, format: CookieFormat): void => {
    const meta = COOKIE_FORMATS.find((f) => f.value === format)!
    const base = (profileName || 'profile').replace(/[^a-z0-9-_]+/gi, '_')
    const filename = `${base}-cookies.${meta.ext}`
    const mime = format === 'json' ? 'application/json' : 'text/plain'
    const blob = new Blob([content], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleExport = async (format: CookieFormat): Promise<void> => {
    setExporting(format)
    try {
      const result = await api.exportCookies(profileId, format)
      triggerDownload(result.data, format)
      addToast(`Exported ${result.count} cookies (${format})`, 'success')
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to export cookies',
        'error'
      )
    } finally {
      setExporting(null)
    }
  }

  const handleCopy = async (format: CookieFormat): Promise<void> => {
    setCopying(format)
    try {
      const result = await api.exportCookies(profileId, format)
      await navigator.clipboard.writeText(result.data)
      addToast(`Copied ${result.count} cookies to clipboard (${format})`, 'success')
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to copy cookies',
        'error'
      )
    } finally {
      setCopying(null)
    }
  }

  const handleImport = async (): Promise<void> => {
    const trimmed = importText.trim()
    if (!trimmed) {
      addToast('Paste cookie data first', 'warning')
      return
    }
    setImporting(true)
    try {
      const result = await api.importCookies(profileId, trimmed, importFormat)
      addToast(
        `Imported ${result.imported}${result.total ? ` / ${result.total}` : ''} cookies`,
        'success'
      )
      setImportText('')
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to import cookies',
        'error'
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header / status */}
      <div className="flex items-start gap-2">
        <Cookie className="h-4 w-4 mt-0.5 shrink-0 text-muted" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-content">Cookies</h3>
            {!statusReady && <Badge dot>Checking…</Badge>}
            {isRunning === true && (
              <Badge variant="success" dot>
                Running
              </Badge>
            )}
            {isRunning === false && (
              <Badge variant="warning" dot>
                Not running
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted">{COOKIES_RUNNING_HINT}</p>
        </div>
      </div>

      {isRunning === false && (
        <div
          role="alert"
          className="rounded-[--radius-md] border border-warn/20 bg-warn/10 px-3 py-2 text-xs text-warn flex items-start gap-2"
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Launch the profile first, then retry export or import. Cookies are read
            over CDP from the live browser session.
          </span>
        </div>
      )}

      {/* Export */}
      <Card title="Export" description="Download cookies from the running browser">
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {COOKIE_FORMATS.map((f) => (
            <Button
              key={`download-${f.value}`}
              variant="secondary"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              loading={exporting === f.value}
              disabled={!canAct || exporting !== null || copying !== null}
              onClick={() => handleExport(f.value)}
              type="button"
            >
              {f.label}
            </Button>
          ))}
          {COOKIE_FORMATS.map((f) => (
            <Button
              key={`copy-${f.value}`}
              variant="ghost"
              size="sm"
              icon={<Copy className="h-3.5 w-3.5" />}
              loading={copying === f.value}
              disabled={!canAct || exporting !== null || copying !== null}
              onClick={() => handleCopy(f.value)}
              type="button"
            >
              Copy {f.value === 'netscape' ? 'Netscape' : 'JSON'}
            </Button>
          ))}
        </div>
      </Card>

      {/* Import */}
      <Card title="Import" description="Paste cookie data to load into the profile">
        <div className="pt-2 space-y-3">
          <fieldset>
            <legend className={LABEL}>Format</legend>
            <div className="flex gap-4">
              {COOKIE_FORMATS.map((f) => (
                <label
                  key={f.value}
                  className="inline-flex items-center gap-2 text-xs text-content cursor-pointer"
                >
                  <input
                    type="radio"
                    name="cookie-import-format"
                    value={f.value}
                    checked={importFormat === f.value}
                    onChange={() => setImportFormat(f.value)}
                    className="accent-accent"
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="cookies-import-data" className={LABEL}>
              Data
            </label>
            <textarea
              id="cookies-import-data"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder={
                importFormat === 'json'
                  ? '[{"name":"sid","value":"…","domain":".example.com", …}]'
                  : '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t0\tsid\t…'
              }
              className={cn(TEXTAREA, 'font-mono text-[11px]')}
              spellCheck={false}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted flex items-center gap-1.5">
              <Info className="h-3 w-3 shrink-0" />
              Existing cookies with the same name + domain will be overwritten.
            </p>
            <Button
              variant="primary"
              size="sm"
              icon={<Upload className="h-3.5 w-3.5" />}
              loading={importing}
              disabled={!canAct || importing || !importText.trim()}
              onClick={handleImport}
              type="button"
            >
              Import
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex items-start gap-2 text-[11px] text-muted">
        <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-ok/70" />
        <span>
          Tip: exported files download locally via your browser — no main-process
          file system access is needed.
        </span>
      </div>
    </div>
  )
}
