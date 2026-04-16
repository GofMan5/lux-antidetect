import { useEffect, useRef, useCallback, useId } from 'react'
import { cn } from '@renderer/lib/utils'
import { OVERLAY } from '@renderer/lib/ui'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeStyles = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl'
}

export function Modal({ open, onClose, title, description, children, actions, size = 'md' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
        )
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    panelRef.current?.querySelector<HTMLElement>('button,input')?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-4 sm:p-6">
      <div className={cn(OVERLAY, 'animate-fadeIn')} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          'relative z-10 w-full rounded-[--radius-xl] bg-card border border-edge p-6 shadow-2xl animate-scaleIn',
          'max-h-[calc(100dvh-2rem)] overflow-y-auto',
          sizeStyles[size]
        )}
      >
        {title && (
          <div className="mb-4">
            <h2 id={titleId} className="text-base font-semibold text-content">{title}</h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
        )}
        <div>{children}</div>
        {actions && (
          <div className="mt-5 flex items-center justify-end gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}
