import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { CheckCircle2, XCircle, Info, X } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

type ToastType = 'success' | 'error' | 'info'

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

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (message, type = 'info') => {
    const id = ++nextId
    set((s) => ({
      toasts: [...s.toasts.slice(-4), { id, message, type }]
    }))
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
}))

/* ------------------------------------------------------------------ */
/*  Single toast item                                                  */
/* ------------------------------------------------------------------ */

const typeStyles: Record<ToastType, string> = {
  success: 'border-ok/30 bg-ok/8',
  error: 'border-err/30 bg-err/8',
  info: 'border-accent/30 bg-accent/8'
}

const typeIcons: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info
}

const iconColors: Record<ToastType, string> = {
  success: 'text-ok',
  error: 'text-err',
  info: 'text-accent'
}

function ToastItem({ toast }: { toast: Toast }) {
  const remove = useToastStore((s) => s.removeToast)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    timerRef.current = setTimeout(() => remove(toast.id), 3500)
    return () => clearTimeout(timerRef.current)
  }, [toast.id, remove])

  const Icon = typeIcons[toast.type]

  return (
    <div
      className={
        'flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-xl backdrop-blur-md ' +
        'animate-slideIn ' +
        typeStyles[toast.type]
      }
    >
      <Icon className={`h-4 w-4 shrink-0 ${iconColors[toast.type]}`} />
      <span className="min-w-0 flex-1 text-content leading-relaxed">{toast.message}</span>
      <button
        onClick={() => remove(toast.id)}
        className="ml-1 shrink-0 rounded-md p-0.5 text-muted hover:text-content transition-colors"
        aria-label="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Container                                                          */
/* ------------------------------------------------------------------ */

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2 w-80">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
