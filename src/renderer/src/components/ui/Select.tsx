import { forwardRef } from 'react'
import { cn } from '@renderer/lib/utils'
import { SELECT } from '@renderer/lib/ui'

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[]
  error?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, error, className, ...props }, ref) => {
    return (
      <div className="space-y-1">
        <select
          ref={ref}
          className={cn(
            SELECT,
            error && 'border-err/50 focus:border-err/50 focus:ring-err/20',
            className
          )}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-xs text-err">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
export { Select }
