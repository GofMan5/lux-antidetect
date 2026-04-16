import { forwardRef } from 'react'
import { cn } from '@renderer/lib/utils'
import { BTN_BASE } from '@renderer/lib/ui'

const variantStyles = {
  primary: 'bg-accent text-white hover:bg-accent-dim active:scale-[0.97] shadow-[0_0_20px_var(--color-accent-glow)]',
  secondary: 'bg-elevated text-content border border-edge hover:bg-card hover:border-muted/30',
  danger: 'bg-err/10 text-err border border-err/20 hover:bg-err/20',
  ghost: 'text-muted hover:text-content hover:bg-elevated'
}

const sizeStyles = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-base gap-2'
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: React.ReactNode
  loading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', icon, loading, children, className, disabled, type = 'button', ...props }, ref) => {
    if (!children && icon) {
      const iconSizeMap = { sm: 'h-7 w-7', md: 'h-9 w-9', lg: 'h-11 w-11' }
      const iconVariantMap = {
        primary: 'text-accent hover:text-accent-dim hover:bg-accent/10',
        secondary: 'text-muted hover:text-content hover:bg-elevated',
        danger: 'text-err hover:bg-err/10',
        ghost: 'text-muted hover:text-content hover:bg-elevated'
      }
      return (
        <button
          ref={ref}
          type={type}
          disabled={disabled || loading}
          className={cn(
            'inline-flex items-center justify-center rounded-[--radius-md] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
            iconSizeMap[size],
            iconVariantMap[variant],
            className
          )}
          {...props}
        >
          {loading ? <Spinner /> : icon}
        </button>
      )
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(
          BTN_BASE,
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {loading ? <Spinner /> : icon}
        {children}
      </button>
    )
  }
)

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
    </svg>
  )
}

Button.displayName = 'Button'
export { Button }
