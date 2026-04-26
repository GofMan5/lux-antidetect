import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  description?: string
  disabled?: boolean
  'aria-label'?: string
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  'aria-label': ariaLabel
}: ToggleProps) {
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
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-[22px] w-[40px] shrink-0 rounded-full',
          'transition-colors duration-200 ease-[var(--ease-osmosis)]',
          'ring-1 ring-inset',
          checked
            ? 'bg-accent ring-accent/40 shadow-[0_0_12px_var(--color-accent-glow)]'
            : 'bg-elevated ring-edge'
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] left-[3px] h-4 w-4 rounded-full',
            'transition-[transform,background-color] duration-200 ease-[var(--ease-osmosis)]',
            'shadow-[0_1px_3px_rgba(0,0,0,0.4)]',
            checked ? 'translate-x-[18px] bg-[#1a1612]' : 'bg-content'
          )}
        />
      </button>
      {(label || description) && (
        <div className="min-w-0">
          {label && <div className="text-[13px] font-medium text-content">{label}</div>}
          {description && <div className="text-xs text-muted leading-relaxed">{description}</div>}
        </div>
      )}
    </label>
  )
}
