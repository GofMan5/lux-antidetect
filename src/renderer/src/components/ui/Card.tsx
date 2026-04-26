import { forwardRef } from 'react'
import { cn } from '@renderer/lib/utils'
import { CARD, CARD_HEADER } from '@renderer/lib/ui'

// Vault Card — shadcn-style subcomponent family + a backward-compatible
// `Card` flat API for legacy call sites that pass `title`/`description`/
// `actions` as props.

const CardRoot = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn(CARD, className)} {...props} />
  )
)
CardRoot.displayName = 'CardRoot'

const CardHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 mb-4', className)} {...props} />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-[14px] font-semibold text-foreground tracking-tight', className)}
      {...props}
    />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-[12px] text-muted-foreground leading-relaxed', className)}
      {...props}
    />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('mt-4 flex items-center', className)} {...props} />
  )
)
CardFooter.displayName = 'CardFooter'

// ─── Flat back-compat API ─────────────────────────────────────────────────
//
// Existing pages (Settings, ProfileEditor, profile/CookiesTab) call
// `<Card title=... description=... actions=...>{children}</Card>`. The new
// shadcn family doesn't have a flat shape, so the default export wraps the
// new subcomponents to match the old API exactly.

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  description?: string
  actions?: React.ReactNode
}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ title, description, children, actions, className, ...props }, ref) => {
    const showHeader = Boolean(title || actions)
    return (
      <div ref={ref} className={cn(CARD, className)} {...props}>
        {showHeader && (
          <div className={CARD_HEADER}>
            <div>
              {title && (
                <h3 className="text-[14px] font-semibold text-foreground tracking-tight">{title}</h3>
              )}
              {description && (
                <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">{description}</p>
              )}
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    )
  }
)
Card.displayName = 'Card'

export {
  Card,
  CardRoot,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
}
