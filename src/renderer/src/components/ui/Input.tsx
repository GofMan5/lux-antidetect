import { forwardRef } from 'react'
import { cn } from '@renderer/lib/utils'
import { INPUT } from '@renderer/lib/ui'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
  rightIcon?: React.ReactNode
  error?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ icon, rightIcon, error, className, ...props }, ref) => {
    return (
      <div className="space-y-1">
        <div className="relative">
          {icon && (
            <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              INPUT,
              icon && 'pl-9',
              rightIcon && 'pr-9',
              error && 'border-err/50 focus:border-err/50 focus:ring-err/20',
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-err">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
export { Input }
