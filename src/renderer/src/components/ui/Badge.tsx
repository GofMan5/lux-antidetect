import { cn } from '@renderer/lib/utils'
import { BADGE } from '@renderer/lib/ui'

// Each variant pairs a tinted background with a matching subtle border so
// badges sit cleanly on both `surface` and `elevated` rows. `default` keeps
// the high-contrast content color it historically had (count badges etc.),
// `muted` is the quieter metadata variant, and colored variants read as
// status.
const variantStyles = {
  default: 'bg-elevated text-content border border-edge/60',
  muted: 'bg-surface-alt text-muted border border-edge/40',
  success: 'bg-ok/12 text-ok border border-ok/25',
  warning: 'bg-warn/12 text-warn border border-warn/25',
  error: 'bg-err/12 text-err border border-err/25',
  info: 'bg-info/12 text-info border border-info/25',
  accent: 'bg-accent/12 text-accent border border-accent/25'
}

const dotColors = {
  default: 'bg-content',
  muted: 'bg-muted',
  success: 'bg-ok',
  warning: 'bg-warn',
  error: 'bg-err',
  info: 'bg-info',
  accent: 'bg-accent'
}

export type BadgeVariant = keyof typeof variantStyles

export interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  dot?: boolean
  className?: string
}

export function Badge({ variant = 'default', children, dot, className }: BadgeProps): React.JSX.Element {
  return (
    <span className={cn(BADGE, variantStyles[variant], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotColors[variant])} />}
      {children}
    </span>
  )
}
