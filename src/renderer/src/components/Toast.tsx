import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useNotificationStore } from '../stores/notifications'

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastStore {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType) => void
  removeToast: (id: number) => void
}

let nextId = 0
const MAX_VISIBLE = 3
const TOAST_DURATION = 3500

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type = 'info') => {
    const id = ++nextId
    set((s) => ({
      toasts: [...s.toasts.slice(-(MAX_VISIBLE - 1)), { id, message, type }]
    }))
    // Also save to persistent notification history
    useNotificationStore.getState().addNotification(message, type)
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
    }, TOAST_DURATION)
    return () => clearTimeout(autoDismissRef.current)
  }, [toast.id, remove])

  const dismiss = (): void => {
    clearTimeout(autoDismissRef.current)
    if (!mountedRef.current) return
    setExiting(true)
    exitTimerRef.current = setTimeout(() => {
      if (mountedRef.current) remove(toast.id)
    }, 200)
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
          style={{ animation: `toastProgress ${TOAST_DURATION}ms linear forwards` }}
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
