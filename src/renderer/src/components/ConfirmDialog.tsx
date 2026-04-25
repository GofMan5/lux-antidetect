import { useEffect } from 'react'
import { create } from 'zustand'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Modal } from '@renderer/components/ui/Modal'
import { Button } from '@renderer/components/ui/Button'

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

  const IconComponent = danger ? Trash2 : AlertTriangle

  return (
    <Modal
      open={open}
      onClose={() => close(false)}
      size="sm"
      elevated
      actions={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => close(true)}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center text-center pt-1 pb-1">
        <div
          className={`h-14 w-14 rounded-full flex items-center justify-center mb-4 ring-1 ring-inset ${
            danger ? 'bg-err/10 ring-err/25' : 'bg-warn/10 ring-warn/25'
          }`}
        >
          <IconComponent
            className={`h-6 w-6 ${danger ? 'text-err' : 'text-warn'}`}
            strokeWidth={1.9}
          />
        </div>
        <h2 className="text-[15px] font-semibold text-content tracking-tight mb-2">{title}</h2>
        <p className="text-[13px] text-muted leading-relaxed max-w-[320px]">{message}</p>
      </div>
    </Modal>
  )
}
