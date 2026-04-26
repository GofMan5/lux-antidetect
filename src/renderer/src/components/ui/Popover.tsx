import { forwardRef } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@renderer/lib/utils'

// Vault Popover — canonical shadcn Popover via @radix-ui/react-popover.

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'z-[300] w-72 rounded-[--radius-lg] border border-border bg-popover p-4',
        'text-popover-foreground shadow-[var(--shadow-md)] surface-lit outline-none',
        'data-[state=open]:animate-scaleIn data-[state=closed]:animate-fadeOut',
        className
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
