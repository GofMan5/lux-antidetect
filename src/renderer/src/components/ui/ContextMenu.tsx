import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'
import type { DropdownMenuItem } from './DropdownMenu'

export interface ContextMenuProps {
  /** Viewport-coords where the menu anchors (top-left corner, clamped). */
  x: number
  y: number
  items: DropdownMenuItem[]
  onClose: () => void
}

const MENU_WIDTH = 220
const MENU_MAX_HEIGHT = 480

/**
 * A click-position-anchored menu, visually matching `DropdownMenu` but
 * driven by an (x, y) coordinate instead of a trigger element. Used for
 * right-click context menus.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click or Escape
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
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - 8))

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed min-w-[200px] max-w-[320px] max-h-[min(60vh,480px)] overflow-y-auto rounded-[--radius-lg] bg-elevated/95 border border-edge/80 p-1 backdrop-blur-md surface-lit shadow-[var(--shadow-md)] animate-scaleIn"
      style={{ top, left, zIndex: 250 }}
    >
      {items.map((item, i) => {
        if (item.kind === 'heading') {
          return (
            <div
              key={i}
              role="presentation"
              className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted select-none"
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
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              item.disabled && 'opacity-40 pointer-events-none',
              item.variant === 'danger'
                ? 'text-err hover:bg-err/12'
                : 'text-content hover:bg-card'
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
