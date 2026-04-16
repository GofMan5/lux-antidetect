import { useEffect, useRef } from 'react'
import { create } from 'zustand'

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
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  }
}))

/* ------------------------------------------------------------------ */
/*  Single toast item                                                  */
/* ------------------------------------------------------------------ */

const typeStyles: Record<ToastType, string> = {
  success: 'border-ok/40 bg-ok/10 text-ok',
  error: 'border-err/40 bg-err/10 text-err',
  info: 'border-accent/40 bg-accent/10 text-accent'
}

const icons: Record<ToastType, string> = {
  success: '\u2713',
  error: '\u2715',
  info: 'i'
}

function ToastItem({ toast }: { toast: Toast }) {
  const remove = useToastStore((s) => s.removeToast)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    timerRef.current = setTimeout(() => remove(toast.id), 3000)
    return () => clearTimeout(timerRef.current)
  }, [toast.id, remove])

  return (
    <div
      className={
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-sm ' +
        'animate-slideIn ' +
        typeStyles[toast.type]
      }
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-current/15 text-[10px] font-bold leading-none">
        {icons[toast.type]}
      </span>

      <span className="min-w-0 flex-1 truncate text-content">{toast.message}</span>

      <button
        onClick={() => remove(toast.id)}
        className="ml-1 shrink-0 text-muted hover:text-content transition-colors"
        aria-label="Close"
      >
        \u2715
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Container (render once at root)                                    */
/* ------------------------------------------------------------------ */

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2 w-72">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
