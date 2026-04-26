import { forwardRef, isValidElement } from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@renderer/lib/utils'

// Vault DropdownMenu — exports BOTH the legacy Lux flat API
//   `<DropdownMenu trigger={ReactNode} items={[{label,icon,onClick,...}]} align="left|right" />`
// and the canonical shadcn Radix family for new code. Built on
// @radix-ui/react-dropdown-menu so keyboard navigation, focus trapping, and
// portal positioning come for free.

// ─── Canonical shadcn family ─────────────────────────────────────────────

const DropdownMenuRoot = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuPortal = DropdownMenuPrimitive.Portal
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2 rounded-[--radius-md] px-2.5 py-[7px]',
      'text-[13px] outline-none',
      'transition-colors duration-150 ease-[var(--ease-osmosis)]',
      'focus:bg-elevated data-[state=open]:bg-elevated',
      className
    )}
    {...props}
  />
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      'z-[300] min-w-[8rem] overflow-hidden rounded-[--radius-lg] border border-border bg-popover p-1',
      'text-popover-foreground shadow-[var(--shadow-md)] surface-lit',
      'data-[state=open]:animate-scaleIn',
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[300] min-w-[200px] max-w-[320px] max-h-[min(60vh,480px)] overflow-y-auto',
        'rounded-[--radius-lg] border border-border bg-popover p-1',
        'text-popover-foreground shadow-[var(--shadow-md)] surface-lit',
        'data-[state=open]:animate-scaleIn',
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

/**
 * Canonical shadcn `<DropdownMenu.Item>` primitive. Exported as
 * `DropdownMenuItemPrimitive` because the legacy Lux `DropdownMenuItem`
 * is already a public *interface* (the data shape passed to the flat API).
 * New shadcn-shaped code should use `DropdownMenuItemPrimitive` directly.
 */
const DropdownMenuItemPrimitive = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
    variant?: 'default' | 'danger'
  }
>(({ className, inset, variant = 'default', ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-[--radius-md] px-2.5 py-[7px]',
      'text-[13px] outline-none whitespace-nowrap',
      'transition-colors duration-150 ease-[var(--ease-osmosis)]',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      variant === 'danger'
        ? 'text-destructive focus:bg-destructive/12'
        : 'text-foreground focus:bg-elevated',
      inset && 'pl-8',
      className
    )}
    {...props}
  />
))
DropdownMenuItemPrimitive.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center rounded-[--radius-md] py-1.5 pl-8 pr-2',
      'text-[13px] outline-none focus:bg-elevated',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
      className
    )}
    {...props}
  >
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuLabel = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none',
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-border', className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element => (
  <span
    className={cn('ml-auto text-[11px] tracking-widest text-muted-foreground', className)}
    {...props}
  />
)
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut'

// ─── Legacy flat API ──────────────────────────────────────────────────────

export interface DropdownMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
  /** Render as a non-focusable section heading instead of a menuitem. */
  kind?: 'heading'
}

export interface DropdownMenuProps {
  trigger: React.ReactNode
  items: DropdownMenuItem[]
  align?: 'left' | 'right'
}

/**
 * Legacy Lux flat DropdownMenu. Forwards a single React element trigger
 * through Radix's `asChild`, so the focusable button keeps its semantics
 * (`aria-haspopup` / `aria-expanded`). Falls back to a wrapping span only
 * for non-element children (string / number / fragment).
 */
function DropdownMenu({ trigger, items, align = 'right' }: DropdownMenuProps): React.JSX.Element {
  const renderedTrigger = isValidElement(trigger) ? trigger : <span>{trigger}</span>

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>{renderedTrigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align={align === 'right' ? 'end' : 'start'}
          sideOffset={4}
          className={cn(
            'z-[300] min-w-[200px] max-w-[320px] max-h-[min(60vh,480px)] overflow-y-auto',
            'rounded-[--radius-lg] border border-border bg-popover p-1',
            'text-popover-foreground shadow-[var(--shadow-md)] surface-lit',
            'data-[state=open]:animate-scaleIn'
          )}
        >
          {items.map((item, i) => {
            if (item.kind === 'heading') {
              return (
                <DropdownMenuPrimitive.Label
                  key={i}
                  className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none"
                >
                  {item.label}
                </DropdownMenuPrimitive.Label>
              )
            }
            return (
              <DropdownMenuPrimitive.Item
                key={i}
                disabled={item.disabled}
                onSelect={() => item.onClick()}
                className={cn(
                  'relative flex cursor-pointer select-none items-center gap-2 rounded-[--radius-md] px-2.5 py-[7px]',
                  'text-[13px] outline-none whitespace-nowrap',
                  'transition-colors duration-150 ease-[var(--ease-osmosis)]',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
                  item.variant === 'danger'
                    ? 'text-destructive focus:bg-destructive/12 hover:bg-destructive/12'
                    : 'text-foreground focus:bg-elevated hover:bg-elevated'
                )}
              >
                {item.icon && <span className="h-4 w-4 shrink-0">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </DropdownMenuPrimitive.Item>
            )
          })}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

export {
  DropdownMenu,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItemPrimitive,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup
}
