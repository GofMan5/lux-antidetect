import { useEffect } from 'react'
import { create } from 'zustand'
import { AlertTriangle } from 'lucide-react'

interface ConfirmState {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  danger: boolean
  resolve: ((value: boolean) => void) | null
  show: (opts: { title?: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>
  close: (result: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  title: 'Confirm',
  message: '',
  confirmLabel: 'Confirm',
  danger: false,
  resolve: null,

  show: (opts) =>
    new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: opts.title ?? 'Confirm',
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        danger: opts.danger ?? false,
        resolve
      })
    }),

  close: (result) => {
    const { resolve } = get()
    if (resolve) resolve(result)
    set({ open: false, resolve: null })
  }
}))

export function ConfirmDialog(): React.JSX.Element | null {
  const { open, title, message, confirmLabel, danger, close } = useConfirmStore()

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, close])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn"
      onClick={() => close(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="bg-card rounded-2xl p-6 w-[90%] max-w-[380px] border border-edge shadow-2xl animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        {danger && (
          <div className="h-10 w-10 rounded-full bg-err/10 flex items-center justify-center mb-4">
            <AlertTriangle className="h-5 w-5 text-err" />
          </div>
        )}
        <h2 className="text-sm font-semibold text-content mb-1.5">{title}</h2>
        <p className="text-[13px] text-muted mb-5 leading-relaxed">{message}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => close(true)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-all duration-150 active:scale-[0.98] ${
              danger
                ? 'bg-err hover:bg-err/80 shadow-sm shadow-err/20'
                : 'bg-accent hover:bg-accent-dim shadow-sm shadow-accent/20'
            }`}
            autoFocus
          >
            {confirmLabel}
          </button>
          <button
            onClick={() => close(false)}
            className="rounded-lg border border-edge bg-elevated/50 px-4 py-2 text-sm font-medium text-muted hover:text-content hover:bg-elevated transition-all duration-150"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
