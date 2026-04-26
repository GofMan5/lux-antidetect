import { forwardRef } from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@renderer/lib/utils'

// Vault Switch — canonical shadcn Switch, sized for the 40px row density.

const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer items-center rounded-full',
      'transition-colors duration-200 ease-[var(--ease-osmosis)]',
      'ring-1 ring-inset ring-border',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      'disabled:cursor-not-allowed disabled:opacity-40',
      'data-[state=checked]:bg-primary data-[state=checked]:ring-primary/40',
      'data-[state=checked]:shadow-[0_0_12px_var(--color-accent-glow)]',
      'data-[state=unchecked]:bg-elevated',
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'pointer-events-none block h-4 w-4 rounded-full',
        'shadow-[0_1px_3px_rgba(0,0,0,0.4)]',
        'transition-transform duration-200 ease-[var(--ease-osmosis)]',
        'data-[state=checked]:translate-x-[20px] data-[state=checked]:bg-primary-foreground',
        'data-[state=unchecked]:translate-x-[3px] data-[state=unchecked]:bg-foreground'
      )}
    />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
