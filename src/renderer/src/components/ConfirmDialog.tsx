import { create } from 'zustand'
import { AlertTriangle, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/AlertDialog'

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

export function ConfirmDialog(): React.JSX.Element {
  const { open, title, message, confirmLabel, danger, close } = useConfirmStore()
  const IconComponent = danger ? Trash2 : AlertTriangle

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) close(false) }}>
      <AlertDialogContent>
        <div className="flex flex-col items-center text-center pt-1 pb-1">
          <div
            className={`h-14 w-14 rounded-full flex items-center justify-center mb-4 ring-1 ring-inset ${
              danger ? 'bg-destructive/10 ring-destructive/25' : 'bg-warn/10 ring-warn/25'
            }`}
          >
            <IconComponent
              className={`h-6 w-6 ${danger ? 'text-destructive' : 'text-warn'}`}
              strokeWidth={1.9}
            />
          </div>
          <AlertDialogHeader className="text-center">
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription className="max-w-[320px] mx-auto">
              {message}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => close(true)}
            autoFocus
            className={
              danger
                ? 'bg-destructive/10 text-destructive border border-destructive/25 hover:bg-destructive/15 hover:border-destructive/40 shadow-none'
                : ''
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
