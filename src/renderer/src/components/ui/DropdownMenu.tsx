import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'

export interface DropdownMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
}

export interface DropdownMenuProps {
  trigger: React.ReactNode
  items: DropdownMenuItem[]
  align?: 'left' | 'right'
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
    const menuWidth = 160
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault(); setOpen(true); setFocusIdx(0)
      }
      return
    }
    const enabled = items.map((it, i) => (!it.disabled ? i : -1)).filter((i) => i >= 0)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const cur = enabled.indexOf(focusIdx)
      setFocusIdx(enabled[(cur + 1) % enabled.length])
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const cur = enabled.indexOf(focusIdx)
      setFocusIdx(enabled[(cur - 1 + enabled.length) % enabled.length])
    } else if (e.key === 'Enter' && focusIdx >= 0) {
      e.preventDefault(); items[focusIdx].onClick(); close()
    } else if (e.key === 'Escape') {
      close()
    }
  }

  return (
    <div ref={triggerRef} className="relative inline-flex" onKeyDown={handleKeyDown}>
      <div onClick={() => setOpen(!open)} aria-haspopup="true" aria-expanded={open}>{trigger}</div>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed min-w-[160px] rounded-[--radius-lg] bg-elevated border border-edge p-1 shadow-xl animate-scaleIn"
          style={{ top: pos.top, left: pos.left, zIndex: 200 }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { item.onClick(); close() }}
              className={cn(
                'flex w-full items-center gap-2 rounded-[--radius-md] px-2.5 py-1.5 text-sm transition-colors',
                item.disabled && 'opacity-40 pointer-events-none',
                i === focusIdx && 'bg-card',
                item.variant === 'danger'
                  ? 'text-err hover:bg-err/10'
                  : 'text-content hover:bg-card'
              )}
            >
              {item.icon && <span className="h-4 w-4 shrink-0">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
