import { forwardRef } from 'react'
import { cn } from '@renderer/lib/utils'
import { INPUT } from '@renderer/lib/ui'

// Vault Input — shadcn-shaped, but retains the Lux flat helpers
// (`icon`, `rightIcon`, `error`) the existing pages depend on. When neither
// is set the markup is a single <input>, identical to canonical shadcn.

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
  rightIcon?: React.ReactNode
  error?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ icon, rightIcon, error, className, type = 'text', ...props }, ref) => {
    const ariaInvalid = error ? true : props['aria-invalid']
    const errorClass = error ? 'border-destructive/50 focus:border-destructive/50 focus:ring-destructive/20' : ''

    if (!icon && !rightIcon && !error) {
      return (
        <input
          ref={ref}
          type={type}
          aria-invalid={ariaInvalid}
          className={cn(INPUT, errorClass, className)}
          {...props}
        />
      )
    }

    return (
      <div className="space-y-1">
        <div className="relative">
          {icon && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            type={type}
            aria-invalid={ariaInvalid}
            className={cn(
              INPUT,
              icon && 'pl-9',
              rightIcon && 'pr-9',
              errorClass,
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
export { Input }
