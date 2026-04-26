import { forwardRef, useId } from 'react'
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

// Concatenates a generated error id with any user-supplied `aria-describedby`
// so screen readers announce the error message AND any pre-existing helper
// text — preserving caller intent rather than overwriting it.
function joinDescribedBy(...ids: Array<string | undefined>): string | undefined {
  const filtered = ids.filter((id): id is string => Boolean(id))
  return filtered.length > 0 ? filtered.join(' ') : undefined
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ icon, rightIcon, error, className, type = 'text', id, ...props }, ref) => {
    const ariaInvalid = error ? true : props['aria-invalid']
    const errorClass = error ? 'border-destructive/50 focus:border-destructive/50 focus:ring-destructive/20' : ''

    // Stable error-message id so screen readers can read both the input and
    // the error via aria-describedby. Prefer an id derived from the
    // user-supplied `id` (predictable across renders) and fall back to a
    // generated one when the caller didn't provide one.
    const generatedId = useId()
    const errorId = error ? (id ? `${id}-error` : `${generatedId}-error`) : undefined
    const describedBy = joinDescribedBy(props['aria-describedby'], errorId)

    if (!icon && !rightIcon && !error) {
      return (
        <input
          ref={ref}
          id={id}
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
            id={id}
            type={type}
            aria-invalid={ariaInvalid}
            aria-describedby={describedBy}
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
        {error && (
          <p id={errorId} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = 'Input'
export { Input }
