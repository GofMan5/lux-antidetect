import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

// Vault Button — shadcn-shaped via cva, plus legacy Lux variant aliases so
// existing call-sites keep compiling. Canonical variants are
// `default | destructive | outline | secondary | ghost | link`. Legacy
// names (`primary`, `danger`) are mapped internally.

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[--radius-md] ' +
    'text-sm font-medium select-none cursor-pointer ' +
    'transition-colors duration-150 ease-[var(--ease-osmosis)] ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-0 ' +
    'disabled:pointer-events-none disabled:opacity-40 ' +
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-accent-dim active:translate-y-[0.5px] ' +
          'shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_2px_8px_rgba(59,130,246,0.20)]',
        destructive:
          'bg-destructive/10 text-destructive border border-destructive/25 ' +
          'hover:bg-destructive/15 hover:border-destructive/40 active:translate-y-[0.5px]',
        outline:
          'border border-border bg-transparent text-foreground ' +
          'hover:bg-elevated hover:border-edge active:translate-y-[0.5px]',
        secondary:
          'bg-elevated/60 text-foreground border border-border ' +
          'hover:bg-elevated hover:border-edge active:translate-y-[0.5px]',
        ghost:
          'text-muted-foreground hover:text-foreground hover:bg-elevated/60 active:translate-y-[0.5px]',
        link:
          'text-primary underline-offset-4 hover:underline'
      },
      size: {
        sm: 'h-7 px-2.5 text-xs gap-1.5',
        md: 'h-9 px-4',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9 p-0'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'md'
    }
  }
)

// Legacy Lux variant names. Maps to canonical shadcn variants so existing
// callsites (`variant="primary" | "danger"`) keep working.
type LegacyVariant = 'primary' | 'danger'
type CanonicalVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>

const LEGACY_VARIANT_MAP: Record<LegacyVariant, CanonicalVariant> = {
  primary: 'default',
  danger: 'destructive'
}

function resolveVariant(variant: ButtonProps['variant']): CanonicalVariant {
  if (!variant) return 'default'
  if (variant in LEGACY_VARIANT_MAP) {
    return LEGACY_VARIANT_MAP[variant as LegacyVariant]
  }
  return variant as CanonicalVariant
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'variant'> {
  /** shadcn variants + legacy Lux aliases (`primary` → `default`, `danger` → `destructive`) */
  variant?: CanonicalVariant | LegacyVariant
  /** Render an icon before children. When no children, an icon-only button. */
  icon?: React.ReactNode
  loading?: boolean
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant,
      size,
      icon,
      loading,
      children,
      className,
      disabled,
      asChild,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const resolvedVariant = resolveVariant(variant)
    // Auto-promote to icon size when there are no children but an icon is set
    // (matches the previous Button's "icon-only" affordance).
    const resolvedSize = size ?? (icon && !children ? 'icon' : 'md')

    const Comp = asChild ? Slot : 'button'

    // When using asChild we cannot inject siblings (Slot expects a single child),
    // so spinner / icon prefixing is only applied for the native <button> path.
    if (asChild) {
      return (
        <Comp
          ref={ref as React.Ref<HTMLButtonElement>}
          className={cn(buttonVariants({ variant: resolvedVariant, size: resolvedSize }), className)}
          {...props}
        >
          {children}
        </Comp>
      )
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(buttonVariants({ variant: resolvedVariant, size: resolvedSize }), className)}
        {...props}
      >
        {loading ? <Spinner /> : icon}
        {children}
      </button>
    )
  }
)

function Spinner(): React.JSX.Element {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
    </svg>
  )
}

Button.displayName = 'Button'
// eslint-disable-next-line react-refresh/only-export-components -- shadcn-style variant helper is intentionally exported with the component.
export { Button, buttonVariants }
