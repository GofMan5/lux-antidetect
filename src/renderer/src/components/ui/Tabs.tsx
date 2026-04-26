import { forwardRef, useRef, useState, useLayoutEffect, useEffect } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@renderer/lib/utils'

// Vault Tabs — shadcn-canonical primitives + a backward-compatible flat
// API for legacy Lux callers (`<Tabs tabs={[{id,label,icon}]} activeTab onChange />`).
// The flat API renders `Tabs.Root` with the indicator-style underline that
// matches the previous design.

const TabsRoot = TabsPrimitive.Root

const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('relative inline-flex items-center gap-0.5 border-b border-border', className)}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex items-center gap-1.5 px-3.5 pb-2.5 pt-1.5 text-[13px] font-medium',
      'transition-colors duration-150 ease-[var(--ease-osmosis)]',
      'text-muted-foreground hover:text-foreground/90',
      'data-[state=active]:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      'disabled:pointer-events-none disabled:opacity-40',
      // Active underline (drawn under each trigger).
      'after:pointer-events-none after:absolute after:-bottom-px after:left-0 after:right-0 after:h-[2px] ' +
        'after:rounded-full after:bg-primary after:opacity-0 ' +
        "data-[state=active]:after:opacity-100",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

// ─── Flat back-compat API ─────────────────────────────────────────────────

export interface TabsProps {
  tabs: { id: string; label: string; icon?: React.ReactNode }[]
  activeTab: string
  onChange: (id: string) => void
  className?: string
}

/**
 * Legacy Lux flat Tabs — the page passes its own `activeTab` + tabs array,
 * we render the underline indicator and pass clicks through. Built on top
 * of Radix Tabs so keyboard navigation comes for free.
 */
function Tabs({ tabs, activeTab, onChange, className }: TabsProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  // Recalculate the indicator whenever the active tab changes. We poll twice
  // (initial + after fonts settle) — Inter loads asynchronously and shifts
  // tab widths slightly when it swaps in.
  const reposition = (): void => {
    const container = containerRef.current
    if (!container) return
    const active = container.querySelector<HTMLElement>(`[data-tab-id="${activeTab}"]`)
    if (active) setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
  }

  useLayoutEffect(reposition, [activeTab, tabs])
  useEffect(() => {
    const id = setTimeout(reposition, 80)
    return () => clearTimeout(id)
  }, [activeTab])

  return (
    <TabsPrimitive.Root value={activeTab} onValueChange={onChange}>
      <TabsPrimitive.List
        ref={containerRef}
        className={cn('relative flex gap-0.5 border-b border-border', className)}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.id}
            value={tab.id}
            data-tab-id={tab.id}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-3.5 pb-2.5 pt-1.5 text-[13px] font-medium',
              'transition-colors duration-150 ease-[var(--ease-osmosis)]',
              'focus-visible:outline-none',
              activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/90'
            )}
          >
            {tab.icon}
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
        <div
          className="absolute -bottom-px h-[2px] bg-primary rounded-full transition-all duration-200 ease-[var(--ease-osmosis)]"
          style={{ left: indicator.left, width: indicator.width }}
        />
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

export { Tabs, TabsRoot, TabsList, TabsTrigger, TabsContent }
