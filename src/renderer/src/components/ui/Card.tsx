import { cn } from '@renderer/lib/utils'
import { CARD, CARD_HEADER } from '@renderer/lib/ui'

export interface CardProps {
  title?: string
  description?: string
  children: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

export function Card({ title, description, children, actions, className }: CardProps) {
  return (
    <div className={cn(CARD, className)}>
      {(title || actions) && (
        <div className={CARD_HEADER}>
          <div>
            {title && <h3 className="text-sm font-semibold text-content">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
