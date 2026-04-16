import { cn } from '@renderer/lib/utils'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-3 select-none',
        disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
      )}
    >
      <button
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-edge'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked && 'translate-x-4'
          )}
        />
      </button>
      {(label || description) && (
        <div className="min-w-0">
          {label && <div className="text-sm text-content">{label}</div>}
          {description && <div className="text-xs text-muted">{description}</div>}
        </div>
      )}
    </label>
  )
}
