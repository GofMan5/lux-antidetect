import { forwardRef } from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@renderer/lib/utils'

const labelVariants = cva(
  'text-xs font-medium text-foreground leading-none ' +
    'peer-disabled:cursor-not-allowed peer-disabled:opacity-40'
)

export interface LabelProps
  extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
    VariantProps<typeof labelVariants> {}

const Label = forwardRef<React.ElementRef<typeof LabelPrimitive.Root>, LabelProps>(
  ({ className, ...props }, ref) => (
    <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
  )
)

Label.displayName = LabelPrimitive.Root.displayName

export { Label, labelVariants }
