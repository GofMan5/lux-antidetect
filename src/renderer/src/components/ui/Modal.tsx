import { cn } from '@renderer/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from './Dialog'

// Vault Modal — backward-compatible thin wrapper around the canonical
// shadcn Dialog so existing call sites
//   <Modal open onClose title description size="md" actions={...}>...</Modal>
// continue to work without modification. New code should reach for
// Dialog directly.

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Escalate z-index above other Modals (ConfirmDialog stacked on a form Modal, etc). */
  elevated?: boolean
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl'
} as const

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  size = 'md',
  elevated = false
}: ModalProps): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent
        className={cn(sizeStyles[size], elevated && 'z-[900]')}
        onEscapeKeyDown={(e) => {
          // Defer to onClose() so callers stay in control of state.
          e.preventDefault()
          onClose()
        }}
      >
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
        )}
        <div>{children}</div>
        {actions && (
          <DialogFooter>{actions}</DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
