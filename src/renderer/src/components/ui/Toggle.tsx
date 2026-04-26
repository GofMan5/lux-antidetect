import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'
import { Switch } from './Switch'

// Vault Toggle — keeps the legacy Lux composite shape (label + description +
// checked switch) but renders the canonical shadcn `Switch` underneath. The
// previous Toggle had a fully bespoke pill; we just wrap the new Switch and
// place label/description to its right.

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
}: ToggleProps): React.JSX.Element {
  return (
    <label
      className={cn(
        'inline-flex items-center gap-3 select-none',
        disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
      )}
    >
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      {(label || description) && (
        <div className="min-w-0">
          {label && <div className="text-[13px] font-medium text-foreground">{label}</div>}
          {description && (
            <div className="text-xs text-muted-foreground leading-relaxed">{description}</div>
          )}
        </div>
      )}
    </label>
  )
}
