import { useRef, useState, useLayoutEffect } from 'react'
import { cn } from '@renderer/lib/utils'

export interface TabsProps {
  tabs: { id: string; label: string; icon?: React.ReactNode }[]
  activeTab: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>(`[data-tab-id="${activeTab}"]`)
    if (active) {
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
    }
  }, [activeTab])

  return (
    <div ref={containerRef} role="tablist" className={cn('relative flex gap-1 border-b border-edge', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          data-tab-id={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative inline-flex items-center gap-1.5 px-3 pb-2.5 pt-1 text-sm transition-colors',
            activeTab === tab.id ? 'text-content' : 'text-muted hover:text-content'
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
      <div
        className="absolute bottom-0 h-0.5 bg-accent rounded-full transition-all duration-200"
        style={{ left: indicator.left, width: indicator.width }}
      />
    </div>
  )
}
