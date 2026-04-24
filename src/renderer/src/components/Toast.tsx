import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useNotificationStore } from '../stores/notifications'

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
  /** Override the default auto-dismiss duration (ms). */
  duration?: number
}

interface AddToastOptions {
  action?: ToastAction
  duration?: number
  /** Skip adding the message to the persistent notification center. */
  silent?: boolean
}

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType, opts?: AddToastOptions) => number
  removeToast: (id: number) => void
}

let nextId = 0
const MAX_VISIBLE = 3
const TOAST_DURATION_DEFAULT = 3500

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type = 'info', opts) => {
    const id = ++nextId
    set((s) => ({
      toasts: [
        ...s.toasts.slice(-(MAX_VISIBLE - 1)),
        { id, message, type, action: opts?.action, duration: opts?.duration }
      ]
    }))
    // Also save to persistent notification history (unless caller opts out
    // — e.g. ephemeral undo toasts don't belong in the notification centre).
    if (!opts?.silent) {
      useNotificationStore.getState().addNotification(message, type)
    }
    return id
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
}))

/* ------------------------------------------------------------------ */
/*  Style maps                                                         */
/* ------------------------------------------------------------------ */

const accentBorder: Record<ToastType, string> = {
  info: 'border-l-accent',
  success: 'border-l-ok',
  warning: 'border-l-warn',
  error: 'border-l-err'
}

const typeIcons: Record<ToastType, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle
}

const iconColors: Record<ToastType, string> = {
  info: 'text-accent',
  success: 'text-ok',
  warning: 'text-warn',
  error: 'text-err'
}

const progressColors: Record<ToastType, string> = {
  info: 'bg-accent',
  success: 'bg-ok',
  warning: 'bg-warn',
  error: 'bg-err'
}

/* ------------------------------------------------------------------ */
/*  Single toast item                                                  */
/* ------------------------------------------------------------------ */

function ToastItem({ toast }: { toast: Toast }): React.JSX.Element {
  const remove = useToastStore((s) => s.removeToast)
  const autoDismissRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mountedRef = useRef(true)
  const [exiting, setExiting] = useState(false)

  const duration = toast.duration ?? TOAST_DURATION_DEFAULT

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(autoDismissRef.current)
      clearTimeout(exitTimerRef.current)
    }
  }, [])

  useEffect(() => {
    autoDismissRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      setExiting(true)
      exitTimerRef.current = setTimeout(() => {
        if (mountedRef.current) remove(toast.id)
      }, 200)
    }, duration)
    return () => clearTimeout(autoDismissRef.current)
  }, [toast.id, remove, duration])

  const dismiss = (): void => {
    clearTimeout(autoDismissRef.current)
    if (!mountedRef.current) return
    setExiting(true)
    exitTimerRef.current = setTimeout(() => {
      if (mountedRef.current) remove(toast.id)
    }, 200)
  }

  const onAction = (): void => {
    toast.action?.onClick()
    dismiss()
  }

  const Icon = typeIcons[toast.type]

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'relative flex items-start gap-3 rounded-[--radius-lg] border border-edge border-l-4 px-4 py-3',
        'bg-card/90 backdrop-blur-xl shadow-2xl shadow-black/40',
        'transition-all duration-200',
        accentBorder[toast.type],
        exiting ? 'opacity-0 translate-x-4' : 'animate-slideInRight'
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0 mt-0.5', iconColors[toast.type])} />
      <span className="min-w-0 flex-1 text-[13px] text-content leading-relaxed">{toast.message}</span>
      {toast.action && (
        <button
          onClick={onAction}
          className={cn(
            'shrink-0 rounded-[--radius-sm] px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide',
            'transition-colors',
            iconColors[toast.type],
            'hover:bg-elevated'
          )}
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={dismiss}
        className="shrink-0 rounded-[--radius-sm] p-1 text-muted hover:text-content hover:bg-elevated/50 transition-colors"
        aria-label="Close notification"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b-[--radius-lg]">
        <div
          className={cn('h-full opacity-60', progressColors[toast.type])}
          style={{ animation: `toastProgress ${duration}ms linear forwards` }}
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Container                                                          */
/* ------------------------------------------------------------------ */

export function ToastContainer(): React.JSX.Element | null {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[1200] flex flex-col-reverse gap-2.5 w-[360px] pointer-events-none"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}
