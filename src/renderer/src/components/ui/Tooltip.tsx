import { forwardRef, isValidElement } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@renderer/lib/utils'

// Vault Tooltip — exports BOTH a flat back-compat API
//   `<Tooltip content={ReactNode|string} side="top">{trigger}</Tooltip>`
// and the canonical shadcn Radix family for new code. The flat API renders
// strings as `whitespace-nowrap` and ReactNode bodies as `max-w-xs whitespace-normal`,
// preserving the previous behavior exactly.

const TooltipProvider = TooltipPrimitive.Provider
const TooltipRoot = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      'z-[400] overflow-hidden rounded-[--radius-md] border border-border bg-popover px-2.5 py-1.5',
      'text-xs text-popover-foreground shadow-[var(--shadow-md)]',
      'data-[state=delayed-open]:animate-fadeIn data-[state=closed]:animate-fadeOut',
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

// ─── Flat back-compat API ─────────────────────────────────────────────────

export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

const FLAT_DELAY_MS = 250

/**
 * Legacy Lux flat tooltip. Wraps Radix's TooltipPrimitive — string content
 * stays single-line, ReactNode wraps with a max width, matching the shape
 * of the old hand-rolled portal-based tooltip.
 *
 * `children` is forwarded directly via `asChild` when it's a single React
 * element so visibility classes (e.g. `hidden md:inline`) and event handlers
 * land on the actual trigger. A wrapper span is only inserted as a fallback
 * for non-element children (string / number / fragment).
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  className
}: TooltipProps): React.JSX.Element {
  const isStringContent = typeof content === 'string'
  const wrapClass = isStringContent
    ? 'whitespace-nowrap'
    : 'max-w-xs whitespace-normal break-words'

  const trigger = isValidElement(children) ? children : <span className="inline-flex">{children}</span>

  return (
    <TooltipProvider delayDuration={FLAT_DELAY_MS}>
      <TooltipRoot>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side={side} className={cn(wrapClass, className)}>
          {content}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  )
}

export { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipContent }
