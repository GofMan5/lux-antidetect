import { cn } from '@renderer/lib/utils'

export interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  /** Smaller variant for inline cards/sections (default is full-panel). */
  size?: 'sm' | 'md'
}

// Vault EmptyState — graphite icon disc with near-invisible border. Subtle
// drop shadow for depth without faking elevation.

export function EmptyState({
  icon,
  title,
  description,
  action,
  size = 'md'
}: EmptyStateProps): React.JSX.Element {
  const isSm = size === 'sm'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center animate-fadeIn',
        isSm ? 'py-8' : 'py-16'
      )}
    >
      <div
        className={cn(
          'mb-4 flex items-center justify-center rounded-full surface-lit',
          'bg-gradient-to-b from-elevated to-surface-alt',
          'border border-border text-muted-foreground/70',
          'shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_4px_12px_rgba(0,0,0,0.3)]',
          isSm ? 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5' : 'h-16 w-16 [&>svg]:h-7 [&>svg]:w-7'
        )}
      >
        {icon}
      </div>
      <h3
        className={
          isSm
            ? 'text-[13px] font-semibold text-foreground tracking-tight'
            : 'text-[15px] font-semibold text-foreground tracking-tight'
        }
      >
        {title}
      </h3>
      {description && (
        <p
          className={cn(
            'mt-1.5 max-w-sm text-muted-foreground leading-relaxed',
            isSm ? 'text-xs' : 'text-[13px]'
          )}
        >
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
