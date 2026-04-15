import { create } from 'zustand'

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

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fadeIn"
      onClick={() => close(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="bg-card rounded-xl p-5 w-[90%] max-w-[380px] border border-edge shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-content mb-2">{title}</h2>
        <p className="text-xs text-muted mb-4 leading-relaxed">{message}</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => close(true)}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
              danger
                ? 'bg-err hover:bg-err/80'
                : 'bg-accent hover:bg-accent-dim'
            }`}
            autoFocus
          >
            {confirmLabel}
          </button>
          <button
            onClick={() => close(false)}
            className="rounded-lg border border-edge px-4 py-2 text-sm font-medium text-muted hover:text-content hover:bg-elevated transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
