import { cn } from '@renderer/lib/utils'
import { BADGE } from '@renderer/lib/ui'

const variantStyles = {
  default: 'bg-elevated text-content',
  success: 'bg-ok/10 text-ok',
  warning: 'bg-warn/10 text-warn',
  error: 'bg-err/10 text-err',
  accent: 'bg-accent/10 text-accent'
}

export interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'accent'
  children: React.ReactNode
  dot?: boolean
  className?: string
}

export function Badge({ variant = 'default', children, dot, className }: BadgeProps) {
  return (
    <span className={cn(BADGE, variantStyles[variant], className)}>
      {dot && (
        <span
          className={cn('h-1.5 w-1.5 rounded-full', {
            'bg-content': variant === 'default',
            'bg-ok': variant === 'success',
            'bg-warn': variant === 'warning',
            'bg-err': variant === 'error',
            'bg-accent': variant === 'accent'
          })}
        />
      )}
      {children}
    </span>
  )
}
