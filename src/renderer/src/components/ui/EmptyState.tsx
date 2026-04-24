export interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  /** Smaller variant for inline cards/sections (default is full-panel). */
  size?: 'sm' | 'md'
}

export function EmptyState({ icon, title, description, action, size = 'md' }: EmptyStateProps): React.JSX.Element {
  const isSm = size === 'sm'
  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center animate-fadeIn',
        isSm ? 'py-8' : 'py-16'
      ].join(' ')}
    >
      <div
        className={[
          'mb-4 flex items-center justify-center rounded-full',
          'bg-gradient-to-b from-elevated to-surface-alt',
          'border border-edge/60 text-muted/70 shadow-sm',
          isSm ? 'h-10 w-10 [&>svg]:h-5 [&>svg]:w-5' : 'h-14 w-14 [&>svg]:h-6 [&>svg]:w-6'
        ].join(' ')}
      >
        {icon}
      </div>
      <h3 className={isSm ? 'text-sm font-medium text-content' : 'text-base font-semibold text-content'}>
        {title}
      </h3>
      {description && (
        <p className={['mt-1.5 max-w-sm text-muted leading-relaxed', isSm ? 'text-xs' : 'text-sm'].join(' ')}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
