import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Download, Sparkles, X, RefreshCw, AlertCircle } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui'
import type { UpdateState } from '../../../preload/api-contract'

type Stage = 'idle' | 'downloading' | 'ready' | 'error'

export function UpdateNotification(): React.JSX.Element | null {
  const [stage, setStage] = useState<Stage>('idle')
  const [minimized, setMinimized] = useState(false)
  const [version, setVersion] = useState('')
  const [percent, setPercent] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [exiting, setExiting] = useState(false)

  const applyUpdateState = useCallback((data: UpdateState) => {
    setExiting(false)

    switch (data.stage) {
      case 'idle':
        setStage('idle')
        setPercent(0)
        setErrorMsg('')
        break
      case 'downloading':
        setVersion(data.version)
        setPercent(data.percent)
        setStage('downloading')
        setMinimized(false)
        break
      case 'ready':
        setVersion(data.version)
        setStage('ready')
        setMinimized(false)
        break
      case 'error':
        setErrorMsg(data.message)
        setStage('error')
        setMinimized(false)
        break
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const unsubs = [
      window.api.onUpdateAvailable((data) => {
        setVersion(data.version)
        setPercent(0)
        setStage('downloading')
        setMinimized(false)
        setExiting(false)
      }),
      window.api.onUpdateProgress((data) => {
        setPercent(data.percent)
      }),
      window.api.onUpdateDownloaded((data) => {
        setVersion(data.version)
        setStage('ready')
        setMinimized(false)
        setExiting(false)
      }),
      window.api.onUpdateError((data) => {
        setErrorMsg(data.message)
        setStage('error')
        setMinimized(false)
        setExiting(false)
      })
    ]

    window.api.getUpdateState()
      .then((state) => {
        if (!cancelled) applyUpdateState(state)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      unsubs.forEach((fn) => fn())
    }
  }, [applyUpdateState])

  const dismiss = useCallback(() => {
    setExiting(true)
    setTimeout(() => {
      setStage('idle')
      setExiting(false)
      setMinimized(false)
    }, 250)
  }, [])

  // Auto-dismiss error after 8s
  useEffect(() => {
    if (stage !== 'error') return
    const t = setTimeout(() => dismiss(), 8000)
    return () => clearTimeout(t)
  }, [stage, dismiss])

  if (stage === 'idle') return null

  // Minimized pill
  if (minimized) {
    let pillText = 'Update failed'
    if (stage === 'downloading') pillText = `Downloading ${Math.round(percent)}%`
    else if (stage === 'ready') pillText = 'Update ready'

    return createPortal(
      <button
        onClick={() => setMinimized(false)}
        className={cn(
          'fixed bottom-6 right-6 z-[350]',
          'px-3.5 py-2 rounded-full',
          'bg-card/95 backdrop-blur-2xl border border-edge/60',
          'shadow-2xl shadow-black/40',
          'text-xs font-semibold tracking-wide cursor-pointer',
          'transition-all duration-300 ease-out hover:scale-105',
          stage === 'downloading' ? 'text-accent' : stage === 'error' ? 'text-err' : 'text-ok'
        )}
      >
        {pillText}
      </button>,
      document.body
    )
  }

  // Error card
  if (stage === 'error') {
    return createPortal(
      <div
        className={cn(
          'fixed bottom-6 right-6 z-[350] w-[340px]',
          'bg-card/95 backdrop-blur-2xl border border-err/30',
          'shadow-2xl shadow-black/40 rounded-[--radius-xl]',
          'p-4 flex items-start gap-3',
          'transition-all duration-300 ease-out',
          exiting ? 'opacity-0 translate-y-3' : 'animate-slideUp'
        )}
      >
        <AlertCircle className="h-5 w-5 text-err shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-err">Update failed</p>
          <p className="text-xs text-muted mt-1 line-clamp-2">{errorMsg}</p>
        </div>
        <button onClick={dismiss} className="text-muted hover:text-content transition-colors shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>,
      document.body
    )
  }

  // Downloading card
  if (stage === 'downloading') {
    return createPortal(
      <div
        className={cn(
          'fixed bottom-6 right-6 z-[350] w-[340px]',
          'bg-card/95 backdrop-blur-2xl border border-edge/60',
          'shadow-2xl shadow-black/40 rounded-[--radius-xl]',
          'p-4 transition-all duration-300 ease-out',
          exiting ? 'opacity-0 translate-y-3' : 'animate-slideUp'
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-[--radius-md] bg-accent/12 flex items-center justify-center">
              <Download className="h-4 w-4 text-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold text-content">Downloading update</p>
              <p className="text-[11px] text-muted">v{version}</p>
            </div>
          </div>
          <button
            onClick={() => setMinimized(true)}
            className="text-muted hover:text-content transition-colors p-1 rounded-[--radius-sm] hover:bg-elevated/50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-surface overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500 ease-out shimmer-bar"
            style={{ width: `${Math.max(2, Math.round(percent))}%` }}
          />
        </div>
        <p className="text-[11px] text-muted mt-2 text-right tabular-nums font-medium">
          {Math.round(percent)}%
        </p>
      </div>,
      document.body
    )
  }

  // Ready card
  return createPortal(
    <div
      className={cn(
        'fixed bottom-6 right-6 z-[350] w-[340px]',
        'bg-card/95 backdrop-blur-2xl border border-edge/60',
        'shadow-2xl shadow-black/40 rounded-[--radius-xl]',
        'p-5 transition-all duration-300 ease-out',
        exiting ? 'opacity-0 translate-y-3' : 'animate-slideUp'
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-[--radius-lg] bg-accent/12 flex items-center justify-center shadow-[0_0_20px_var(--color-accent-glow)]">
          <Sparkles className="h-5 w-5 text-accent" />
        </div>
        <div>
          <p className="text-[15px] font-bold text-content">Update ready!</p>
          <p className="text-xs text-muted">v{version} downloaded</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={() => window.api.installUpdate()}
          className="flex-1 pulse-glow"
        >
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Restart Now
        </Button>
        <Button
          variant="ghost"
          onClick={() => setMinimized(true)}
          className="px-4"
        >
          Later
        </Button>
      </div>
    </div>,
    document.body
  )
}
