import { forwardRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

// Vault Sheet — slide-in panel via @radix-ui/react-dialog (shadcn convention).
// Will replace heavyweight modals for editing flows in wave B.

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-background/70 backdrop-blur-[6px]',
      'data-[state=open]:animate-fadeIn data-[state=closed]:animate-fadeOut',
      className
    )}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

const sheetVariants = cva(
  'fixed z-50 gap-4 bg-card border-border shadow-[var(--shadow-lg)] flex flex-col ' +
    'focus:outline-none',
  {
    variants: {
      side: {
        top:
          'inset-x-0 top-0 border-b ' +
          'data-[state=open]:animate-slideDown data-[state=closed]:animate-fadeOut',
        bottom:
          'inset-x-0 bottom-0 border-t ' +
          'data-[state=open]:animate-slideUp data-[state=closed]:animate-fadeOut',
        left:
          'inset-y-0 left-0 h-full border-r ' +
          'data-[state=open]:animate-slideInLeft data-[state=closed]:animate-slideOutLeft',
        right:
          'inset-y-0 right-0 h-full border-l ' +
          'data-[state=open]:animate-slideInRight data-[state=closed]:animate-slideOutRight'
      },
      size: {
        sm: '',
        md: '',
        lg: '',
        full: ''
      }
    },
    compoundVariants: [
      // Horizontal sides — width sizing
      { side: 'left', size: 'sm', class: 'w-[320px] max-w-full' },
      { side: 'left', size: 'md', class: 'w-[400px] max-w-full' },
      { side: 'left', size: 'lg', class: 'w-[480px] max-w-full' },
      { side: 'left', size: 'full', class: 'w-screen' },
      { side: 'right', size: 'sm', class: 'w-[320px] max-w-full' },
      { side: 'right', size: 'md', class: 'w-[400px] max-w-full' },
      { side: 'right', size: 'lg', class: 'w-[480px] max-w-full' },
      { side: 'right', size: 'full', class: 'w-screen' },
      // Vertical sides — height sizing
      { side: 'top', size: 'sm', class: 'h-[200px]' },
      { side: 'top', size: 'md', class: 'h-[320px]' },
      { side: 'top', size: 'lg', class: 'h-[480px]' },
      { side: 'top', size: 'full', class: 'h-screen' },
      { side: 'bottom', size: 'sm', class: 'h-[200px]' },
      { side: 'bottom', size: 'md', class: 'h-[320px]' },
      { side: 'bottom', size: 'lg', class: 'h-[480px]' },
      { side: 'bottom', size: 'full', class: 'h-screen' }
    ],
    defaultVariants: {
      side: 'right',
      size: 'md'
    }
  }
)

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Hide the default top-right close button. */
  hideClose?: boolean
  /** Override CVA size sizing with an explicit width (left/right) or height (top/bottom). */
  width?: number | string
}

const SheetContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ className, children, side = 'right', size = 'md', hideClose, width, style, ...props }, ref) => {
  const widthStyle = width !== undefined
    ? side === 'top' || side === 'bottom'
      ? { height: width }
      : { width }
    : undefined

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side, size }), className)}
        style={{ ...widthStyle, ...style }}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className={cn(
              'absolute right-4 top-4 rounded-[--radius-sm] p-1 text-muted-foreground',
              'transition-colors hover:bg-elevated hover:text-foreground',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              'disabled:pointer-events-none'
            )}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
})
SheetContent.displayName = 'SheetContent'

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div className={cn('flex flex-col space-y-1.5 p-6 pb-4', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element => (
  <div
    className={cn(
      'mt-auto flex flex-col-reverse gap-2 p-6 pt-4 sm:flex-row sm:items-center sm:justify-end',
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = 'SheetFooter'

const SheetTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-[15px] font-semibold text-foreground tracking-tight', className)}
    {...props}
  />
))
SheetTitle.displayName = DialogPrimitive.Title.displayName

const SheetDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-[13px] text-muted-foreground leading-relaxed', className)}
    {...props}
  />
))
SheetDescription.displayName = DialogPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  sheetVariants
}
