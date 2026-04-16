import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@renderer/lib/utils'
import { TOOLTIP } from '@renderer/lib/ui'

// `content` accepts any ReactNode so callers can render rich tooltip bodies
// (lists, links, JSX). Existing string callers keep their previous behavior —
// plain strings still render directly as text.
export interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

const GAP = 8

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  const updatePos = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    let top = 0, left = 0
    switch (side) {
      case 'top':
        top = r.top - GAP
        left = r.left + r.width / 2
        break
      case 'bottom':
        top = r.bottom + GAP
        left = r.left + r.width / 2
        break
      case 'left':
        top = r.top + r.height / 2
        left = r.left - GAP
        break
      case 'right':
        top = r.top + r.height / 2
        left = r.right + GAP
        break
    }
    setPos({ top, left })
  }, [side])

  useEffect(() => {
    if (!visible) return
    updatePos()
  }, [visible, updatePos])

  const transformOrigin: Record<string, string> = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)'
  }

  // String callers (the vast majority) expect single-line `whitespace-nowrap`
  // for backward compatibility. ReactNode bodies (e.g. bulleted reason lists)
  // would overflow on one line, so we widen and wrap them instead.
  const isStringContent = typeof content === 'string'
  const wrapClass = isStringContent
    ? 'whitespace-nowrap'
    : 'max-w-xs whitespace-normal break-words'

  return (
    <div
      ref={triggerRef}
      className="inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && createPortal(
        <div
          role="tooltip"
          className={cn(
            TOOLTIP,
            'fixed pointer-events-none',
            wrapClass,
            'animate-fadeIn',
            className
          )}
          style={{
            top: pos.top,
            left: pos.left,
            transform: transformOrigin[side],
            zIndex: 9999
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </div>
  )
}
