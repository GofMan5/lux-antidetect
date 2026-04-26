import { forwardRef, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { cn } from '@renderer/lib/utils'
import type { DropdownMenuItem } from './DropdownMenu'

// Vault ContextMenu — exports BOTH:
//
//   1. The legacy Lux imperative API used by ProfilesPage right-click flow:
//      `<ContextMenu x={px} y={px} items={...} onClose={() => ...} />`
//      This stays a click-position-anchored overlay (its semantics are
//      "the user already opened me, render me at this point"). We keep it
//      portal-rendered with an outside-click + Escape close.
//
//   2. The canonical shadcn @radix-ui/react-context-menu family for new code
//      (right-click on a Trigger element). Wave B can use this for native
//      browser-style context menus on rows.

// ─── Canonical shadcn family ─────────────────────────────────────────────

const ContextMenuRoot = ContextMenuPrimitive.Root
const ContextMenuTrigger = ContextMenuPrimitive.Trigger
const ContextMenuGroup = ContextMenuPrimitive.Group
const ContextMenuPortal = ContextMenuPrimitive.Portal
const ContextMenuSub = ContextMenuPrimitive.Sub
const ContextMenuRadioGroup = ContextMenuPrimitive.RadioGroup

const ContextMenuSubTrigger = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubTrigger>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex cursor-pointer select-none items-center gap-2 rounded-[--radius-md] px-2.5 py-[7px]',
      'text-[13px] outline-none focus:bg-elevated data-[state=open]:bg-elevated',
      className
    )}
    {...props}
  />
))
ContextMenuSubTrigger.displayName = ContextMenuPrimitive.SubTrigger.displayName

const ContextMenuSubContent = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.SubContent
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
ContextMenuSubContent.displayName = ContextMenuPrimitive.SubContent.displayName

const ContextMenuContent = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        'z-[300] min-w-[200px] max-w-[320px] max-h-[min(60vh,480px)] overflow-y-auto',
        'rounded-[--radius-lg] border border-border bg-popover p-1',
        'text-popover-foreground shadow-[var(--shadow-md)] surface-lit',
        'data-[state=open]:animate-scaleIn',
        className
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = ContextMenuPrimitive.Content.displayName

const ContextMenuItemPrimitive = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item> & {
    inset?: boolean
    variant?: 'default' | 'danger'
  }
>(({ className, inset, variant = 'default', ...props }, ref) => (
  <ContextMenuPrimitive.Item
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
ContextMenuItemPrimitive.displayName = ContextMenuPrimitive.Item.displayName

const ContextMenuLabel = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Label
    ref={ref}
    className={cn(
      'px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none',
      className
    )}
    {...props}
  />
))
ContextMenuLabel.displayName = ContextMenuPrimitive.Label.displayName

const ContextMenuSeparator = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator
    ref={ref}
    className={cn('my-1 h-px bg-border', className)}
    {...props}
  />
))
ContextMenuSeparator.displayName = ContextMenuPrimitive.Separator.displayName

const ContextMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element => (
  <span
    className={cn('ml-auto text-[11px] tracking-widest text-muted-foreground', className)}
    {...props}
  />
)
ContextMenuShortcut.displayName = 'ContextMenuShortcut'

// ─── Legacy imperative-position API ─────────────────────────────────────

export interface ContextMenuProps {
  /** Viewport-coords where the menu anchors (top-left corner, clamped). */
  x: number
  y: number
  items: DropdownMenuItem[]
  onClose: () => void
}

const MENU_WIDTH = 220
const MENU_MAX_HEIGHT = 480
const VIEWPORT_PADDING = 8

/**
 * A click-position-anchored menu, visually matching `DropdownMenu` but driven
 * by an (x, y) coordinate instead of a trigger element. Used by ProfilesPage
 * right-click flow — the page already owns "where did the user click" and
 * "should I be open" state, we just render the menu there.
 *
 * Built without Radix (Radix Context Menu requires a Trigger to wrap its
 * target — that doesn't fit the imperative shape here without breaking the
 * caller's coordinate semantics). Outside-click + Escape + scroll close are
 * implemented manually, matching the previous behavior exactly.
 */
function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (menuRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = (): void => onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  // Clamp to viewport so the menu never renders past the screen edge.
  const left = Math.max(VIEWPORT_PADDING, Math.min(x, window.innerWidth - MENU_WIDTH - VIEWPORT_PADDING))
  const top = Math.max(VIEWPORT_PADDING, Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - VIEWPORT_PADDING))

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed min-w-[200px] max-w-[320px] max-h-[min(60vh,480px)] overflow-y-auto rounded-[--radius-lg] bg-popover border border-border p-1 backdrop-blur-md surface-lit shadow-[var(--shadow-md)] animate-scaleIn"
      style={{ top, left, zIndex: 250 }}
    >
      {items.map((item, i) => {
        if (item.kind === 'heading') {
          return (
            <div
              key={i}
              role="presentation"
              className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none"
            >
              {item.label}
            </div>
          )
        }
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onClick()
              onClose()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-[--radius-md] px-2.5 py-[7px] text-[13px] whitespace-nowrap',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              item.disabled && 'opacity-40 pointer-events-none',
              item.variant === 'danger'
                ? 'text-destructive hover:bg-destructive/12'
                : 'text-foreground hover:bg-elevated'
            )}
          >
            {item.icon && <span className="h-4 w-4 shrink-0">{item.icon}</span>}
            <span className="truncate">{item.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}

export {
  ContextMenu,
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItemPrimitive,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup
}
