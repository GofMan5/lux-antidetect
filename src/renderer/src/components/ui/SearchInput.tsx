import { forwardRef } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { INPUT } from '@renderer/lib/ui'

export interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  /** When set, a small count chip renders inside the input (right edge). */
  matchCount?: number
  id?: string
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder = 'Search…', className, matchCount, id },
  ref
) {
  const showCount = value.length > 0 && typeof matchCount === 'number'
  const showClear = value.length > 0

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
      <input
        ref={ref}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears first, then blurs on a second press — matches the
          // behaviour of VS Code / many other search fields.
          if (e.key === 'Escape') {
            if (value) {
              e.preventDefault()
              e.stopPropagation()
              onChange('')
            }
          }
        }}
        placeholder={placeholder}
        className={cn(INPUT, 'pl-9', (showCount || showClear) && 'pr-24')}
      />
      {showCount && (
        <span
          className={cn(
            'absolute right-9 top-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px] font-mono tabular-nums',
            'ring-1 ring-inset',
            matchCount === 0
              ? 'bg-err/10 text-err ring-err/20'
              : 'bg-elevated text-muted ring-edge/80'
          )}
          aria-label={`${matchCount} match${matchCount === 1 ? '' : 'es'}`}
        >
          {matchCount}
        </span>
      )}
      {showClear && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[--radius-sm] p-0.5 text-muted hover:text-content hover:bg-elevated transition-colors duration-150 ease-[var(--ease-osmosis)]"
          aria-label="Clear search"
          title="Clear (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
})
