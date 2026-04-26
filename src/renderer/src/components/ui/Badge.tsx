import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

// Vault Badge — shadcn-shaped via cva, retains the Lux extras (`success`,
// `warning`, `accent`, `muted`, `info`) so existing pages keep compiling.
// Optional leading status dot via `dot` prop.

const badgeVariants = cva(
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium leading-none ' +
    'transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-elevated text-foreground border border-border',
        secondary: 'bg-secondary text-secondary-foreground border border-border',
        destructive: 'bg-destructive/12 text-destructive border border-destructive/25',
        outline: 'text-foreground border border-border',
        success: 'bg-ok/12 text-ok border border-ok/25',
        warning: 'bg-warn/12 text-warn border border-warn/25',
        error: 'bg-destructive/12 text-destructive border border-destructive/25',
        info: 'bg-info/12 text-info border border-info/25',
        accent: 'bg-primary/12 text-primary border border-primary/25',
        muted: 'bg-surface-alt text-muted-foreground border border-border'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

const dotColors = {
  default: 'bg-foreground',
  secondary: 'bg-foreground',
  destructive: 'bg-destructive',
  outline: 'bg-foreground',
  success: 'bg-ok',
  warning: 'bg-warn',
  error: 'bg-destructive',
  info: 'bg-info',
  accent: 'bg-primary',
  muted: 'bg-muted-foreground'
} as const

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = 'default', dot, children, className, ...props }, ref) => {
    const dotKey = (variant ?? 'default') as keyof typeof dotColors
    return (
      <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props}>
        {dot && <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', dotColors[dotKey])} />}
        {children}
      </span>
    )
  }
)

Badge.displayName = 'Badge'

export { Badge, badgeVariants }
