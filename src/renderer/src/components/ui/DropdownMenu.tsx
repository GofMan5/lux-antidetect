import { useState, useRef, useEffect, useCallback, cloneElement, isValidElement } from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'

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

type TriggerProps = {
  onClick?: (e: React.MouseEvent) => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  'aria-haspopup'?: boolean | 'menu' | 'true' | 'false'
  'aria-expanded'?: boolean
}

export function DropdownMenu({ trigger, items, align = 'right' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const close = useCallback(() => { setOpen(false); setFocusIdx(-1) }, [])

  // Calculate position from trigger rect
  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const menuWidth = 220
    let left = align === 'right' ? rect.right - menuWidth : rect.left
    // Clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8))
    let top = rect.bottom + 4
    // If it would overflow bottom, show above
    if (top + 200 > window.innerHeight) {
      top = Math.max(8, rect.top - 4)
    }
    setPos({ top, left })
  }, [align])

  useEffect(() => {
    if (!open) return
    updatePos()
    const onScroll = () => updatePos()
    // Listen on capture to catch scroll in any ancestor
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, updatePos])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const enabledIdxs = items
      .map((it, i) => (!it.disabled && it.kind !== 'heading' ? i : -1))
      .filter((i) => i >= 0)
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
        setFocusIdx(enabledIdxs[0] ?? -1)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const cur = enabledIdxs.indexOf(focusIdx)
      if (enabledIdxs.length) setFocusIdx(enabledIdxs[(cur + 1) % enabledIdxs.length])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const cur = enabledIdxs.indexOf(focusIdx)
      if (enabledIdxs.length) setFocusIdx(enabledIdxs[(cur - 1 + enabledIdxs.length) % enabledIdxs.length])
    } else if (e.key === 'Enter' && focusIdx >= 0) {
      e.preventDefault(); items[focusIdx].onClick(); close()
    } else if (e.key === 'Escape') {
      close()
    }
  }, [open, items, focusIdx, close])

  // Hoist aria-haspopup/aria-expanded + click handler onto the actual
  // focusable trigger element (typically a <button>). Falls back to a
  // wrapping div if `trigger` is not a single React element.
  const renderedTrigger = (() => {
    if (isValidElement(trigger)) {
      const element = trigger as ReactElement<TriggerProps>
      const originalOnClick = element.props.onClick
      const originalOnKeyDown = element.props.onKeyDown
      return cloneElement(element, {
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: (e: React.MouseEvent) => {
          originalOnClick?.(e)
          if (!e.defaultPrevented) setOpen((o) => !o)
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          originalOnKeyDown?.(e)
          handleKeyDown(e)
        }
      })
    }
    return (
      <div
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </div>
    )
  })()

  return (
    <div ref={triggerRef} className="relative inline-flex">
      {renderedTrigger}
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed min-w-[200px] max-w-[320px] max-h-[min(60vh,480px)] overflow-y-auto rounded-[--radius-lg] bg-elevated border border-edge p-1 shadow-xl animate-scaleIn"
          style={{ top: pos.top, left: pos.left, zIndex: 200 }}
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
                onClick={() => { item.onClick(); close() }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[--radius-md] px-2.5 py-1.5 text-sm transition-colors whitespace-nowrap',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                  item.disabled && 'opacity-40 pointer-events-none',
                  i === focusIdx && 'bg-card',
                  item.variant === 'danger'
                    ? 'text-err hover:bg-err/10'
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
      )}
    </div>
  )
}
